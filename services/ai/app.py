"""Crop inference boundary. Fixture results are never a real-mode fallback."""
import base64
import binascii
import hmac
import io
import json
import os
from pathlib import Path
from typing import Literal

import anthropic
import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from PIL import Image, ImageStat, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, model_validator

# Local runs read the repository .env; containers (/app/app.py) get env from compose.
_parents = Path(__file__).resolve().parents
if len(_parents) > 2:
    load_dotenv(_parents[2] / '.env')
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
    mode: Literal['real', 'fixture', 'unavailable', 'claude', 'gemini']
    candidates: list[Candidate] = Field(max_length=3)
    reason: str = Field(min_length=1, max_length=1000)
    quality_flags: list[str] = Field(max_length=10)
    # Claude and Gemini modes only: a readable assessment for the farmer and the printed report.
    confidence: Literal['low', 'medium', 'high'] | None = None
    next_steps: list[str] = Field(default_factory=list, max_length=5)

    @model_validator(mode='after')
    def accepted_needs_candidate(self):
        if self.status == 'accepted' and (not self.candidates or self.mode == 'unavailable'):
            raise ValueError('Accepted result requires candidates and an inference mode')
        return self


def mode():
    value = os.getenv('AI_MODE', 'unavailable')
    if value not in ('fixture', 'real', 'unavailable', 'claude', 'gemini'):
        raise RuntimeError('Unknown AI_MODE')
    if os.getenv('NODE_ENV') == 'production' and value == 'fixture':
        raise RuntimeError('Fixture inference is prohibited in production')
    return value


def authenticate(x_service_token: str = Header(default='')):
    expected = os.getenv('AI_SERVICE_TOKEN', '')
    if not expected or not hmac.compare_digest(expected, x_service_token):
        raise HTTPException(401, 'Invalid service authentication')


CROP_NAMES = {'tomato': 'tomato', 'maize': 'maize', 'mahangu': 'mahangu (pearl millet)', 'sorghum': 'sorghum'}

ASSESSMENT_INSTRUCTIONS = """You look at one photograph of a crop taken by a farmer in Namibia and give a short, practical assessment. It is shown to the farmer and printed for an agricultural advisor.

- Say what you can actually see. If the photo is too blurry, dark, far away or cropped to judge, ask for a retake instead of guessing.
- If the photo does not show the crop the farmer selected, or shows no plant, say so.
- Name the most likely condition in plain words (for example "Healthy", "Early blight", "Nitrogen deficiency", "Fall armyworm damage"). If several are plausible, choose "uncertain" and name the most likely one.
- Confidence reflects how clearly the photo shows it, not how common the condition is.
- The summary is two or three plain sentences a farmer can follow: what you see and why it matters.
- Next steps are up to four short, safe actions: inspection, removing affected leaves, watering or spacing, and when to contact a local extension officer. Do not give pesticide names or doses; say to ask an extension officer for chemical treatment."""

ASSESSMENT_SCHEMA = {
    'type': 'object',
    'properties': {
        'assessment': {'type': 'string', 'enum': ['identified', 'uncertain', 'retake', 'not_this_crop']},
        'condition': {'type': 'string'},
        'confidence': {'type': 'string', 'enum': ['low', 'medium', 'high']},
        'summary': {'type': 'string'},
        'next_steps': {'type': 'array', 'items': {'type': 'string'}},
    },
    'required': ['assessment', 'condition', 'confidence', 'summary', 'next_steps'],
    'additionalProperties': False,
}

# The environment variable holding each AI mode's key.
AI_KEYS = {'claude': 'ANTHROPIC_API_KEY', 'gemini': 'GEMINI_API_KEY'}

STATUS_FOR = {'identified': 'accepted', 'uncertain': 'uncertain', 'retake': 'retake', 'not_this_crop': 'unsupported'}


def claude_client():
    # Reads ANTHROPIC_API_KEY. No SDK retries: the API worker retries failed jobs, and a call
    # must finish inside the worker's 75 s request timeout and 90 s job lease.
    return anthropic.AsyncAnthropic(timeout=60.0, max_retries=0)


async def claude_assessment(scan, image_format):
    try:
        response = await claude_client().beta.messages.create(
            model=os.getenv('CLAUDE_MODEL', 'claude-opus-5-5'),
            max_tokens=16000,
            betas=['server-side-fallback-2026-07-01'],
            fallbacks='default',
            output_config={'effort': 'medium', 'format': {'type': 'json_schema', 'schema': ASSESSMENT_SCHEMA}},
            system=ASSESSMENT_INSTRUCTIONS,
            messages=[{
                'role': 'user',
                'content': [
                    {'type': 'image', 'source': {'type': 'base64', 'media_type': f'image/{image_format.lower()}', 'data': scan.image_base64}},
                    {'type': 'text', 'text': f'The farmer says this is {CROP_NAMES[scan.crop]}. Assess the photo.'},
                ],
            }],
        )
    except anthropic.APIError:
        # Rate limits, outages and bad keys alike: the worker retries a few times, then marks the job failed.
        raise HTTPException(502, 'Claude is unavailable') from None
    if response.stop_reason == 'refusal':
        return result('uncertain', 'The AI could not assess this photo. Try another photo or ask an extension officer.', ['ai_declined'])
    if response.stop_reason == 'max_tokens':
        raise HTTPException(502, 'Claude response was cut off')
    try:
        data = json.loads(next(b.text for b in response.content if b.type == 'text'))
    except (StopIteration, json.JSONDecodeError):
        raise HTTPException(502, 'Claude response was not valid JSON') from None
    return assessment_result(data, response.model, 'claude')


def gemini_client():
    # Reads GEMINI_API_KEY. Timeout is in milliseconds; stays inside the worker's 75 s.
    return genai.Client(http_options=genai_types.HttpOptions(timeout=60_000))


async def gemini_assessment(scan, raw, image_format):
    model = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')
    try:
        response = await gemini_client().aio.models.generate_content(
            model=model,
            contents=[
                genai_types.Part.from_bytes(data=raw, mime_type=f'image/{image_format.lower()}'),
                f'The farmer says this is {CROP_NAMES[scan.crop]}. Assess the photo.',
            ],
            config=genai_types.GenerateContentConfig(
                system_instruction=ASSESSMENT_INSTRUCTIONS,
                response_mime_type='application/json',
                response_json_schema=ASSESSMENT_SCHEMA,
            ),
        )
    except genai_errors.APIError:
        # Free-tier rate limits (429), outages and bad keys: the worker retries, then marks the job failed.
        raise HTTPException(502, 'Gemini is unavailable') from None
    finish = response.candidates[0].finish_reason if response.candidates else None
    if not response.candidates or finish not in (genai_types.FinishReason.STOP, None):
        if finish == genai_types.FinishReason.MAX_TOKENS:
            raise HTTPException(502, 'Gemini response was cut off')
        # Blocked by Gemini's safety filters or no answer: tell the farmer rather than retrying.
        return result('uncertain', 'The AI could not assess this photo. Try another photo or ask an extension officer.', ['ai_declined'])
    try:
        data = json.loads(response.text)
    except (TypeError, json.JSONDecodeError):
        raise HTTPException(502, 'Gemini response was not valid JSON') from None
    return assessment_result(data, response.model_version or model, 'gemini')


def assessment_result(data, model, source):
    status = STATUS_FOR[data['assessment']]
    condition = data['condition'].strip()[:150]
    if status == 'accepted' and not condition:
        status = 'uncertain'
    return Result(
        status=status,
        model_version=model[:150],
        mode=source,
        candidates=[Candidate(condition=condition)] if condition and status in ('accepted', 'uncertain') else [],
        reason=(data['summary'].strip() or 'No summary was given.')[:1000],
        quality_flags=['ai_suggestion'],
        confidence=data['confidence'],
        next_steps=[s.strip()[:300] for s in data['next_steps'] if s.strip()][:5],
    )


def coverage():
    if mode() == 'fixture':
        return {'tomato': ['fixture_leaf_condition']}
    if mode() in AI_KEYS:
        return {crop: ['ai_assessment'] for crop in CROP_NAMES} if os.getenv(AI_KEYS[mode()]) else {}
    if mode() != 'real' or not os.getenv('INFERENCE_URL') or not os.getenv('MODEL_VERSION'):
        return {}
    value = json.loads(os.getenv('SUPPORTED_CONDITIONS_JSON', '{}'))
    if not isinstance(value, dict) or any(k not in ('tomato', 'maize') or not isinstance(v, list) or any(not isinstance(c, str) or not c for c in v) for k, v in value.items()):
        raise RuntimeError('Only explicitly configured tomato and maize conditions are eligible; mahangu remains referral-only')
    return value


def result(status, reason, flags=None):
    version = {'claude': os.getenv('CLAUDE_MODEL', 'claude-opus-5-5'), 'gemini': os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')}.get(mode()) or os.getenv('MODEL_VERSION') or 'none'
    return Result(status=status, model_version=version, mode=mode(), candidates=[], reason=reason, quality_flags=flags or [])


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
            image_format = image.format
            # Deliberately limited check: detects near-blank input, not all blur/non-plant subjects.
            if ImageStat.Stat(image.convert('L').resize((128, 128))).stddev[0] < 3:
                return result('retake', 'This photo has too little visible detail. Take a clear close-up in even light.', ['low_detail'])
    except (ValueError, binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        return result('retake', 'Use a valid JPEG or PNG photograph at least 224 pixels on each side.', ['invalid_image'])
    if mode() in AI_KEYS:
        if not os.getenv(AI_KEYS[mode()]):
            return result('unavailable', f'Set {AI_KEYS[mode()]} to enable AI analysis. Your case is saved.')
        if mode() == 'gemini':
            return await gemini_assessment(scan, raw, image_format)
        return await claude_assessment(scan, image_format)
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
