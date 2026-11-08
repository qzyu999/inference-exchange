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
