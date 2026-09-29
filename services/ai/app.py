"""Crop inference boundary. Fixture results are never a real-mode fallback."""
import base64
import binascii
import hmac
import io
import json
import os
from pathlib import Path
from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from PIL import Image, ImageStat, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, model_validator

load_dotenv(Path(__file__).resolve().parents[2] / '.env')
Image.MAX_IMAGE_PIXELS = 24_000_000
app = FastAPI(title='AgroSense inference service', version='0.1.0')


class Scan(BaseModel):
    model_config = ConfigDict(extra='forbid')
    case_id: str = Field(min_length=1, max_length=100)
    crop: Literal['tomato', 'maize', 'mahangu', 'sorghum']
    image_base64: str = Field(max_length=12_000_000)


class Candidate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    condition: str = Field(min_length=1, max_length=150)


class Result(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: Literal['accepted', 'uncertain', 'unsupported', 'retake', 'unavailable']
    model_version: str = Field(min_length=1, max_length=150)
    mode: Literal['real', 'fixture', 'unavailable']
    candidates: list[Candidate] = Field(max_length=3)
    reason: str = Field(min_length=1, max_length=1000)
    quality_flags: list[str] = Field(max_length=10)

    @model_validator(mode='after')
    def accepted_needs_candidate(self):
        if self.status == 'accepted' and (not self.candidates or self.mode == 'unavailable'):
            raise ValueError('Accepted result requires candidates and an inference mode')
        return self


def mode():
    value = os.getenv('AI_MODE', 'unavailable')
    if value not in ('fixture', 'real', 'unavailable'):
        raise RuntimeError('Unknown AI_MODE')
    if os.getenv('NODE_ENV') == 'production' and value == 'fixture':
        raise RuntimeError('Fixture inference is prohibited in production')
    return value


def authenticate(x_service_token: str = Header(default='')):
    expected = os.getenv('AI_SERVICE_TOKEN', '')
    if not expected or not hmac.compare_digest(expected, x_service_token):
        raise HTTPException(401, 'Invalid service authentication')


def coverage():
    if mode() == 'fixture':
        return {'tomato': ['fixture_leaf_condition']}
    if mode() != 'real' or not os.getenv('INFERENCE_URL') or not os.getenv('MODEL_VERSION'):
        return {}
    value = json.loads(os.getenv('SUPPORTED_CONDITIONS_JSON', '{}'))
    if not isinstance(value, dict) or any(k not in ('tomato', 'maize') or not isinstance(v, list) or any(not isinstance(c, str) or not c for c in v) for k, v in value.items()):
        raise RuntimeError('Only explicitly configured tomato and maize conditions are eligible; mahangu remains referral-only')
    return value


def result(status, reason, flags=None):
    return Result(status=status, model_version=os.getenv('MODEL_VERSION') or 'none', mode=mode(), candidates=[], reason=reason, quality_flags=flags or [])


@app.get('/health')
def health():
    return {'status': 'ok', 'mode': mode()}


@app.get('/coverage', dependencies=[Depends(authenticate)])
def get_coverage():
    return {'mode': mode(), 'conditions': coverage(), 'locally_validated': os.getenv('MODEL_VALIDATED') == 'true'}


@app.post('/analyze', response_model=Result, dependencies=[Depends(authenticate)])
async def analyze(scan: Scan, idempotency_key: str = Header(default='')):
    try:
        raw = base64.b64decode(scan.image_base64, validate=True)
        if len(raw) > 8 * 1024 * 1024:
            raise ValueError('Image too large')
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ('JPEG', 'PNG') or min(image.size) < 224:
                raise ValueError('Invalid image dimensions or format')
            image.load()
            # Deliberately limited check: detects near-blank input, not all blur/non-plant subjects.
            if ImageStat.Stat(image.convert('L').resize((128, 128))).stddev[0] < 3:
                return result('retake', 'This photo has too little visible detail. Take a clear close-up in even light.', ['low_detail'])
    except (ValueError, binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        return result('retake', 'Use a valid JPEG or PNG photograph at least 224 pixels on each side.', ['invalid_image'])
    if scan.crop in ('mahangu', 'sorghum'):
        return result('unsupported', 'Automatic assessment is not enabled for this crop. Request advisor review.')
    if mode() == 'unavailable':
        return result('unavailable', 'No licensed inference provider or trained model is configured. Your case is saved; you can request advisor review.')
    conditions = coverage().get(scan.crop, [])
    if not conditions:
        return result('unsupported', 'This crop has no configured model coverage. Request advisor review.')
    if mode() == 'fixture':
        return Result(status='accepted', model_version='fixture-v1', mode='fixture', candidates=[Candidate(condition='fixture_leaf_condition')], reason='DEVELOPMENT FIXTURE — this fixed result does not diagnose the photo.', quality_flags=['development_only'])
    url = os.getenv('INFERENCE_URL', '')
    key = os.getenv('INFERENCE_API_KEY', '')
    if not url.startswith('https://') or not key:
        return result('unavailable', 'Configure an HTTPS inference endpoint, API key, verified model version and explicit supported conditions.')
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
            response = await client.post(url, json=scan.model_dump(), headers={'Authorization': f'Bearer {key}', 'Idempotency-Key': idempotency_key or scan.case_id})
            response.raise_for_status()
            output = Result.model_validate(response.json())
        if output.mode != 'real' or output.model_version != os.getenv('MODEL_VERSION'):
            raise ValueError('Unexpected model identity')
        if any(c.condition not in conditions for c in output.candidates):
            raise ValueError('Provider returned a condition outside configured coverage')
        if output.status == 'accepted' and os.getenv('MODEL_VALIDATED') != 'true':
            output.status = 'uncertain'
            output.reason = 'The model has not passed the local evaluation gate. An advisor should review these suggestions.'
        return output
    except (httpx.HTTPError, ValueError):
        # Transient failures are retried by the durable API worker; no synthetic fallback.
        raise HTTPException(502, 'Inference provider unavailable or response invalid') from None
