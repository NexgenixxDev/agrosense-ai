import base64
import io
from PIL import Image
from fastapi.testclient import TestClient
from app import app

def photo(blank=False):
    image = Image.new('RGB', (240, 240), 'white')
    if not blank:
        for x in range(120):
            for y in range(240):
                image.putpixel((x,y),(30,100,20))
    out=io.BytesIO();image.save(out,format='PNG');return base64.b64encode(out.getvalue()).decode()

def send(monkeypatch, mode='fixture', crop='tomato', image=None):
    monkeypatch.setenv('AI_SERVICE_TOKEN','test-token')
    monkeypatch.setenv('AI_MODE',mode)
    return TestClient(app).post('/analyze',headers={'X-Service-Token':'test-token'},json={'case_id':'test','crop':crop,'image_base64':image or photo()})

def test_fixture_is_explicit(monkeypatch):
    r=send(monkeypatch).json();assert r['mode']=='fixture';assert 'DEVELOPMENT FIXTURE' in r['reason']

def test_unavailable_is_honest(monkeypatch):
    r=send(monkeypatch,'unavailable').json();assert r['status']=='unavailable';assert not r['candidates']

def test_mahangu_unsupported(monkeypatch):
    assert send(monkeypatch,crop='mahangu').json()['status']=='unsupported'

def test_invalid_and_blank(monkeypatch):
    assert send(monkeypatch,image='invalid').json()['status']=='retake'
    assert send(monkeypatch,image=photo(True)).json()['status']=='retake'

def test_requires_private_token(monkeypatch):
    monkeypatch.setenv('AI_SERVICE_TOKEN','secret')
    assert TestClient(app).get('/coverage').status_code==401

def test_real_cannot_fall_back(monkeypatch):
    monkeypatch.delenv('INFERENCE_URL',raising=False)
    r=send(monkeypatch,'real').json();assert r['status'] in ('unsupported','unavailable');assert not r['candidates']

def test_unvalidated_real_prediction_abstains(monkeypatch):
    import app as module
    monkeypatch.setenv('INFERENCE_URL', 'https://licensed.example/analyze')
    monkeypatch.setenv('INFERENCE_API_KEY', 'test-key')
    monkeypatch.setenv('MODEL_VERSION', 'test-real-v1')
    monkeypatch.setenv('MODEL_VALIDATED', 'false')
    monkeypatch.setenv('SUPPORTED_CONDITIONS_JSON', '{"tomato":["test_condition"]}')
    class Response:
        def raise_for_status(self): pass
        def json(self):
            return {'status':'accepted','mode':'real','model_version':'test-real-v1','candidates':[{'condition':'test_condition'}],'reason':'Provider suggestion','quality_flags':[]}
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, *args, **kwargs): return Response()
    monkeypatch.setattr(module.httpx, 'AsyncClient', Client)
    output = send(monkeypatch, 'real').json()
    assert output['status'] == 'uncertain'
    assert output['mode'] == 'real'
    assert 'local evaluation' in output['reason']

def test_production_rejects_fixture_configuration(monkeypatch):
    import pytest
    monkeypatch.setenv('NODE_ENV','production')
    monkeypatch.setenv('AI_MODE','fixture')
    with pytest.raises(RuntimeError, match='prohibited'):
        TestClient(app).get('/health')
