import hashlib
import json
from copy import deepcopy

import pytest
from inference_exchange.coordinator.ticker_catalog import SnapshotCache, validate_snapshot, savings


def snapshot(version=1):
    return {'schema_version': 1, 'generation': version, 'generated_at': 1000 + version,
            'models': [{'id': 'qwen/model-1', 'name': 'Model 1', 'aliases': ['Model One'], 'offers': [
                {'id': 'or/provider/model-1', 'provider': 'Provider', 'route': 'OpenRouter',
                 'input': '0', 'cache_read': None, 'output': '0.5', 'observed_at': 1000,
                 'quantization': None, 'source_url': 'https://openrouter.ai/qwen/model-1',
                 'history': [{'at': 1000, 'input': '0', 'cache_read': None, 'output': '0.5'}]}]}]}


def test_validation_free_unknown_and_exact_models():
    data = validate_snapshot(snapshot(), now=2000)
    assert data['models'][0]['offers'][0]['input'] == '0'
    assert data['models'][0]['offers'][0]['cache_read'] is None
    bad = snapshot(); bad['models'].append(deepcopy(bad['models'][0]))
    with pytest.raises(ValueError): validate_snapshot(bad, now=2000)
    for price in ['NaN', '-1', 'Infinity', True]:
        bad = snapshot(); bad['models'][0]['offers'][0]['output'] = price
        with pytest.raises(ValueError): validate_snapshot(bad, now=2000)


def test_atomic_install_restart_rollback_and_corruption(tmp_path):
    cache = SnapshotCache(tmp_path / 'cache.json')
    raw = json.dumps(snapshot(2)).encode()
    digest = hashlib.sha256(raw).hexdigest()
    assert cache.install(raw, digest, now=2000)
    assert not cache.install(json.dumps(snapshot(1)).encode(), None, now=2000)
    with pytest.raises(ValueError): cache.install(b'broken', digest, now=2000)
    assert cache.data['generation'] == 2
    assert SnapshotCache(tmp_path / 'cache.json').data['generation'] == 2
    with pytest.raises(OSError):
        blocked = SnapshotCache(tmp_path / 'missing' / 'cache.json')
        blocked.path = tmp_path  # replace directory must fail, memory stays empty
        blocked.install(raw, digest, now=2000)
    assert blocked.data['generation'] == 0


def test_savings_all_dimensions_stale_and_free():
    assert savings('0.05', '0.20', fresh=True, comparable=True) == 75
    assert savings('0.01', '0.05', fresh=True, comparable=True) == 80
    assert savings('0.15', '0.60', fresh=True, comparable=True) == 75
    assert savings('0.6', '0.5', fresh=True, comparable=True) == -20
    for ie, other, fresh, comparable in [(None,'1',True,True),('1','0',True,True),('1','2',False,True),('1','2',True,False)]:
        assert savings(ie, other, fresh=fresh, comparable=comparable) is None

@pytest.mark.asyncio
async def test_sync_pins_commit_and_rejects_mixed_publication(tmp_path):
    import httpx
    raw = json.dumps(snapshot(2)).encode()
    calls = []
    generation = 2
    def handler(request):
        calls.append(str(request.url))
        if '/commits/' in str(request.url): return httpx.Response(200,json={'sha':'a'*40})
        if str(request.url).endswith('manifest.json'):
            return httpx.Response(200,json={'schema_version':1,'generation':generation,'sha256':hashlib.sha256(raw).hexdigest()})
        return httpx.Response(200,content=raw)
    cache = SnapshotCache(tmp_path/'cache.json')
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await cache.sync(client,'owner/repo')
        assert cache.data['generation'] == 2
        assert all('/'+'a'*40+'/' in u for u in calls[1:])
        generation = 3
        with pytest.raises(ValueError, match='Mixed'): await cache.sync(client,'owner/repo')
        assert cache.data['generation'] == 2


def test_ie_filter_keeps_external_offers_and_does_not_fuzzy_match(tmp_path):
    from types import SimpleNamespace as S
    cache = SnapshotCache(tmp_path/'cache.json')
    cache.install(json.dumps(snapshot()).encode(),None,now=2000)
    provider = S(provider_id='p1',name='Local',model_identity={'quantization':'Q4'},
        model_capabilities=S(context_length=4096),capabilities=S(models=['Model One'],
        price_per_mtok_input=0,price_per_mtok_cache=0,price_per_mtok_output=0.1,trust_level=S(value='open')))
    result = cache.catalog([provider],ie_only=True,now=2000)
    assert result['total'] == 1
    assert len(result['models'][0]['offers']) == 2
    assert result['models'][0]['ie_count'] == 1
    provider.capabilities.models=['Model One v2']
    assert cache.catalog([provider],ie_only=True,now=2000)['models'][0]['id'] == 'ie/p1/Model%20One%20v2'
    assert cache.catalog([],now=100000)['models'][0]['offers'][0]['stale']
    assert cache.history('missing')['offers'] == []


def test_llama_alias_groups_offers_without_verifying_artifacts(tmp_path):
    from types import SimpleNamespace as S
    data = snapshot()
    model = data['models'][0]
    model.update(id='meta-llama/llama-3.2-1b-instruct', name='Llama 3.2 1B Instruct',
                 aliases=['Llama 3.2 1B Instruct'])
    model['offers'][0].update(provider='Cloudflare', quantization='FP16')
    cache = SnapshotCache(tmp_path/'cache.json')
    cache.install(json.dumps(data).encode(), None, now=2000)
    identity = {'name': 'Llama 3.2 1B Instruct', 'quantization': 'Q4_K_M', 'file_hash': 'claimed-hash'}
    provider = S(provider_id='p1', name='Local', model_identity=identity,
        model_capabilities=S(context_length=4096), capabilities=S(
        models=['Llama 3.2 1B Instruct', 'Qwen2.5 0.5B Instruct'],
        price_per_mtok_input=0, price_per_mtok_cache=0, price_per_mtok_output=0.1,
        trust_level=S(value='open')))
    models = {m['id']: m for m in cache.catalog([provider], now=2000)['models']}
    llama = models['meta-llama/llama-3.2-1b-instruct']
    assert [(o['provider'], o['route'], o['quantization']) for o in llama['offers']] == [
        ('Cloudflare', 'OpenRouter', 'FP16'), ('Local', 'Inference Exchange', 'Q4_K_M')]
    assert models['ie/p1/Qwen2.5%200.5B%20Instruct']['ie_count'] == 1
    assert len(models['ie/p1/Qwen2.5%200.5B%20Instruct']['offers']) == 1
    assert provider.model_identity == identity
    assert not any(o.get('verified') or o.get('file_hash') for o in llama['offers'])

@pytest.mark.parametrize('data', [[], None, {'schema_version':1,'generation':1,'generated_at':1,'models':[None]}])
def test_invalid_shapes_are_rejected_without_startup_failure(tmp_path, data):
    with pytest.raises(ValueError): validate_snapshot(data)
    path = tmp_path/'cache.json'; path.write_text(json.dumps(data))
    assert SnapshotCache(path).data['generation'] == 0


def test_unknown_fields_cannot_impersonate_ie(tmp_path):
    data = snapshot()
    data['models'][0]['offers'][0]['ie'] = True
    data['models'][0]['offers'][0]['secret'] = 'not-public'
    cache = SnapshotCache(tmp_path/'cache.json')
    cache.install(json.dumps(data).encode(), None, now=2000)
    offer = cache.catalog([], now=2000)['models'][0]['offers'][0]
    assert 'ie' not in offer and 'secret' not in offer


@pytest.mark.asyncio
async def test_manifest_requires_digest(tmp_path):
    import httpx
    def handler(request):
        if '/commits/' in str(request.url): return httpx.Response(200,json={'sha':'a'*40})
        return httpx.Response(200,json={'schema_version':1,'generation':2,'sha256':None})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError): await SnapshotCache(tmp_path/'cache.json').sync(client,'owner/repo')


def test_catalog_and_history_routes_are_read_only_and_bounded(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from inference_exchange.coordinator.main import create_app
    monkeypatch.setenv('IE_PRICE_COLLECTOR','0')
    app = create_app()
    cache = SnapshotCache(tmp_path/'cache.json')
    cache.install(json.dumps(snapshot()).encode(),None,now=2000)
    app.state.ticker_cache = cache
    client = TestClient(app)
    response = client.get('/v1/exchange/catalog?limit=99999&offset=-1&q=Model')
    assert response.status_code == 200
    data = response.json()
    assert data['total'] == 1
    assert 'history' not in data['models'][0]['offers'][0]
    assert client.get('/v1/exchange/catalog?ie_only=true').json()['models'] == []
    history = client.get('/v1/exchange/catalog/history?model=qwen/model-1').json()
    assert history['offers'][0]['points'][0]['at'] == 1000
    assert client.post('/v1/exchange/catalog',json={}).status_code == 405


def test_quote_kinds_are_validated_and_catalog_rows_do_not_count_providers(tmp_path):
    from test_comparison_identity import make_provider
    data = snapshot()
    offer = data["models"][0]["offers"][0]
    assert validate_snapshot(data, now=2000)["models"][0]["offers"][0]["quote_kind"] == "endpoint"
    offer.update(quote_kind="catalog", provider="A named label", route="A different route")
    endpoint = {**deepcopy(offer), "id": "endpoint/one", "provider": "Cloudflare", "quote_kind": "endpoint"}
    second = {**deepcopy(endpoint), "id": "endpoint/two"}
    data["models"][0]["offers"].extend([endpoint, second])
    cache = SnapshotCache(tmp_path / "cache.json")
    cache.install(json.dumps(data).encode(), None, now=2000)
    provider = make_provider(models=["Model One"])
    result = cache.catalog([provider], now=2000)["models"][0]
    assert result["provider_count"] == 2  # One named external provider and one IE provider.
    assert len(result["offers"]) == 4
    assert result["offers"][0]["quote_kind"] == "catalog"
    assert result["offers"][0]["source_url"] == offer["source_url"]
    assert result["offers"][-1]["quote_kind"] == "endpoint"
    invalid = snapshot(2)
    invalid["models"][0]["offers"][0]["quote_kind"] = "guessed"
    with pytest.raises(ValueError):
        cache.install(json.dumps(invalid).encode(), None, now=2000)
    assert cache.data["generation"] == 1
