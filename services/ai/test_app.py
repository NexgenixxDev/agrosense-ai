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

def fake_claude(monkeypatch, answer=None, stop_reason='end_turn', error=None):
    """Replace the Claude client; returns the list of request kwargs it received."""
    import json as _json
    import app as module
    calls = []
    class Block:
        type = 'text'
        text = _json.dumps(answer or {})
    class Response:
        model = 'claude-opus-5-5'
        content = [Block()]
    Response.stop_reason = stop_reason
    class Messages:
        async def create(self, **kwargs):
            calls.append(kwargs)
            if error: raise error
            return Response()
    class Client:
        class beta:
            messages = Messages()
    monkeypatch.setattr(module, 'claude_client', lambda: Client())
    monkeypatch.setenv('ANTHROPIC_API_KEY', 'test-key')
    return calls

def test_claude_identifies_condition_with_readable_result(monkeypatch):
    calls = fake_claude(monkeypatch, {'assessment':'identified','condition':'Early blight','confidence':'medium','summary':'Brown rings on lower leaves.','next_steps':['Remove affected leaves','Water at the base']})
    r = send(monkeypatch, 'claude', crop='mahangu').json()
    assert r['status'] == 'accepted' and r['mode'] == 'claude'
    assert r['candidates'] == [{'condition':'Early blight'}]
    assert r['confidence'] == 'medium' and r['next_steps'] == ['Remove affected leaves','Water at the base']
    assert r['reason'] == 'Brown rings on lower leaves.' and r['quality_flags'] == ['ai_suggestion']
    sent = calls[0]
    assert sent['model'] == 'claude-opus-5-5' and sent['fallbacks'] == 'default'
    assert sent['output_config']['format']['type'] == 'json_schema'
    assert sent['messages'][0]['content'][0]['source']['media_type'] == 'image/png'
    assert 'mahangu (pearl millet)' in sent['messages'][0]['content'][1]['text']

def test_claude_retake_and_wrong_crop_have_no_candidates(monkeypatch):
    fake_claude(monkeypatch, {'assessment':'retake','condition':'','confidence':'low','summary':'Too blurry.','next_steps':[]})
    r = send(monkeypatch, 'claude').json(); assert r['status'] == 'retake' and r['candidates'] == []
    fake_claude(monkeypatch, {'assessment':'not_this_crop','condition':'Maize','confidence':'high','summary':'This is maize.','next_steps':[]})
    r = send(monkeypatch, 'claude').json(); assert r['status'] == 'unsupported' and r['candidates'] == []

def test_claude_identified_without_condition_becomes_uncertain(monkeypatch):
    fake_claude(monkeypatch, {'assessment':'identified','condition':' ','confidence':'low','summary':'Something is wrong.','next_steps':[]})
    assert send(monkeypatch, 'claude').json()['status'] == 'uncertain'

def test_claude_refusal_is_uncertain_not_an_error(monkeypatch):
    fake_claude(monkeypatch, stop_reason='refusal')
    r = send(monkeypatch, 'claude').json(); assert r['status'] == 'uncertain' and 'ai_declined' in r['quality_flags']

def test_claude_errors_are_retryable_502(monkeypatch):
    import anthropic, httpx2
    error = anthropic.APIConnectionError(request=httpx2.Request('POST', 'https://api.anthropic.com/v1/messages'))
    fake_claude(monkeypatch, error=error)
    assert send(monkeypatch, 'claude').status_code == 502

def test_claude_without_key_is_unavailable(monkeypatch):
    monkeypatch.delenv('ANTHROPIC_API_KEY', raising=False)
    r = send(monkeypatch, 'claude').json(); assert r['status'] == 'unavailable' and not r['candidates']
