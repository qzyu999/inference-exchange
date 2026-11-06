"""ANALYTICS-001/002/003: durable owner-scoped operations, ledger totals, signups."""
import json
import time

import pytest
from fastapi.testclient import TestClient

from inference_exchange.coordinator import dependencies as deps
from inference_exchange.coordinator.store import Store
from inference_exchange.coordinator.main import create_app


def test_restart_order_completion_and_owner_isolation(tmp_path):
    path = tmp_path / 'exchange.db'
    store = Store(path)
    now = time.time()
    for request_id, owner in [('a', 'alice'), ('b', 'bob'), ('c', 'alice')]:
        store.save_request_outcome({'request_id': request_id, 'timestamp': now, 'status': 'matched'}, owner)
    store.amend_request_outcome('a', consumer_id='bob', status='completed')
    assert store.request_outcomes('alice')[1]['status'] == 'matched'
    store.amend_request_outcome('a', consumer_id='alice', status='completed', served_model='model', provider_country='US', caller_country='US')
    store.amend_request_outcome('a', status='failed')
    store._conn.close()
    restarted = Store(path)
    assert [t['request_id'] for t in restarted.request_outcomes('alice')] == ['c', 'a']
    assert [t['status'] for t in restarted.request_outcomes('alice')] == ['interrupted', 'completed']
    assert len(restarted.request_outcomes(None)) == 3
    recent = restarted.request_outcomes('alice', completed=True)
    assert restarted.request_outcome('b', 'alice') is None
    assert restarted.request_outcome('a', 'alice')['status'] == 'completed'
    assert recent[0]['provider_country'] == recent[0]['caller_country'] == 'US'
    assert 'provider_country' not in json.dumps(restarted.request_outcomes(None))


def test_retention_is_bounded_and_never_prunes_ledger(tmp_path, monkeypatch):
    import inference_exchange.coordinator.store as module
    store = Store(tmp_path / 'db')
    monkeypatch.setattr(module, 'TRACE_MAX_ROWS', 3)
    for i in range(5):
        store.save_request_outcome({'request_id': str(i), 'timestamp': time.time() + i, 'status': 'completed'}, 'a')
    assert [t['request_id'] for t in store.request_outcomes('a')] == ['4', '3', '2']
    store.save_request_outcome({'request_id': 'old', 'timestamp': time.time() - 8 * 86400, 'status': 'completed'}, 'a')
    assert len(store.request_outcomes(None)) == 3
    assert store.billing_summary()['total_requests'] == 0


def test_latest_30_completions_not_latest_30_attempts(tmp_path):
    store = Store(tmp_path / 'db')
    for i in range(75):
        store.save_request_outcome({'request_id': f'{i:03}', 'timestamp': time.time() + i, 'status': 'completed' if i < 40 else 'no_compatible_provider'}, 'alice')
    rows = store.request_outcomes('alice', 30, completed=True)
    assert len(rows) == 30
    assert rows[0]['request_id'] == '039' and rows[-1]['request_id'] == '010'


def test_all_time_usage_includes_more_than_50_and_unknown_models(tmp_path):
    store = Store(tmp_path / 'db')
    store.get_or_create_account('alice', 'Alice')
    # Use the real settlement path, including its integer accounting and fee split.
    for i in range(65):
        store.charge_request(request_id=f'charge-{i}', consumer_id='alice', provider_id='provider', model='requested',
                             served_model='served' if i < 60 else None, input_tokens=1, output_tokens=1,
                             price_per_mtok_input=0.05, price_per_mtok_output=0.15)
    usage = store.consumer_usage('alice')
    assert usage['requests'] == 65
    assert usage['cost_micro'] == sum(r['cost_micro'] for r in usage['models']) == 6500
    assert len(store.list_consumer_transactions('alice', 50)) == 50
    assert store.consumer_usage('bob')['cost_micro'] == 0
    assert {r['served_model'] for r in usage['models']} == {'served', None}


def test_signup_country_only_on_creation_and_migration_idempotent(tmp_path):
    path = tmp_path / 'db'
    store = Store(path)
    old, _ = store.upsert_github_user('old', 'old', 'old@example.com', 'Old')
    user, created = store.upsert_github_user('new', 'new', 'new@example.com', 'New', signup_country='GH')
    assert created
    _, created = store.upsert_github_user('new', 'new', 'new@example.com', 'New', signup_country='US')
    assert not created
    metrics = store.signup_analytics()
    assert metrics['total_accounts'] == metrics['created_today'] == metrics['created_last_30_days'] == 2
    assert metrics['countries'] == [{'country': 'GH', 'accounts': 1}, {'country': 'unknown', 'accounts': 1}]
    store._conn.close()
    store = Store(path)
    assert store.signup_analytics()['total_accounts'] == 2
    store.delete_user(user['user_id'])
    assert store.signup_analytics()['total_accounts'] == 1


def test_private_endpoints_and_admin_scope(monkeypatch, tmp_path):
    monkeypatch.setenv('IE_DB_PATH', str(tmp_path / 'db'))
    monkeypatch.setenv('IE_ENV', 'production')
    monkeypatch.setenv('IE_PASSWORD_AUTH', '1')
    monkeypatch.setenv('IE_JWT_SECRET', 'test-secret')
    monkeypatch.setenv('IE_ADMIN_EMAILS', 'boss@example.com')
    monkeypatch.setenv('IE_COUNTRY_ACTIVITY_ENABLED', '1')
    monkeypatch.setenv('IE_GEO_INGRESS_SECRET', 'a' * 40)
    client = TestClient(create_app(), base_url='https://testserver')
    for route in ['/v1/exchange/usage', '/v1/exchange/activity/recent']:
        assert client.get(route).status_code == 401
    assert client.get('/v1/admin/signups').status_code == 403
    result = client.post('/v1/auth/signup', json={'email': 'alice@example.com', 'password': 'password1'}, headers={'cf-ipcountry': 'GH', 'x-ie-geo-secret': 'a' * 40})
    assert result.status_code == 200, result.text
    owner = client.get('/v1/auth/me').json()['user_id']
    store = deps.get_store()
    for request_id, caller in [('mine', owner), ('theirs', 'someone-else')]:
        store.save_request_outcome({'request_id': request_id, 'timestamp': time.time(), 'status': 'matched'}, caller)
        store.amend_request_outcome(request_id, consumer_id=caller, status='completed', provider_country='US', caller_country='GH')
    assert client.get('/v1/exchange/traces/mine').status_code == 200
    assert client.get('/v1/exchange/traces/theirs').status_code == 404
    assert client.get('/v1/exchange/traces/missing').status_code == 404
    body = client.get('/v1/exchange/activity/recent').json()
    assert body['scope'] == 'your_account'
    assert [r['request_id'] for r in body['requests']] == ['mine']
    assert client.get('/v1/admin/signups').status_code == 403
    monkeypatch.setenv('IE_COUNTRY_ACTIVITY_ENABLED', '0')
    assert client.get('/v1/exchange/activity/recent').json()['requests'][0]['caller_country'] is None
    client.post('/v1/auth/signup', json={'email': 'boss@example.com', 'password': 'password1'})
    assert client.get('/v1/admin/signups').json()['total_accounts'] == 2
    assert client.get('/v1/admin/signups').json()['countries'] == [{'country': 'GH', 'accounts': 1}, {'country': 'unknown', 'accounts': 1}]
    assert client.get('/v1/exchange/activity/recent').json()['scope'] == 'exchange'
    assert len(client.get('/v1/exchange/activity/recent').json()['requests']) == 2


def test_callback_persists_captured_geography_only_after_settlement(tmp_path, monkeypatch):
    from unittest.mock import AsyncMock
    from inference_exchange.coordinator.provider_hub import ConnectedProvider
    from inference_exchange.shared.protocol import ProviderCapabilities, TrustLevel, InferenceDone
    from inference_exchange.coordinator import routes_inference as ri
    from inference_exchange.coordinator.country_activity import consumer_country
    store = Store(tmp_path / 'db')
    monkeypatch.setattr(deps, '_store', store)
    monkeypatch.setattr(ri, 'get_billing', lambda: store)
    monkeypatch.setattr(ri, 'get_event_bus', lambda: None)
    provider = ConnectedProvider(provider_id='actual-provider', name='Example', ws=AsyncMock(),
        capabilities=ProviderCapabilities(models=['Example'], trust_level=TrustLevel.OPEN), network_country='US')
    store.get_or_create_account('alice', 'Alice')
    deps._add_trace({'request_id': 'complete', 'timestamp': time.time(), 'status': 'matched'}, 'alice')
    token = consumer_country.set('GH')
    callback = ri._make_billing_callback('complete', 'Example', provider, 'alice', 1, time.time())
    consumer_country.reset(token)
    assert store.request_outcomes('alice', completed=True) == []
    callback(InferenceDone(request_id='complete', input_tokens=2, tokens_generated=3, model='Example'))
    assert store.request_outcomes('alice', completed=True)[0]['caller_country'] == 'GH'
    assert store.consumer_usage('alice')['requests'] == 1
    deps._add_trace({'request_id': 'unsettled', 'timestamp': time.time(), 'status': 'matched'}, 'alice')
    def fail(**kwargs):
        raise RuntimeError('settlement failure')
    monkeypatch.setattr(store, 'charge_request', fail)
    callback = ri._make_billing_callback('unsettled', 'Example', provider, 'alice', 1, time.time())
    with pytest.raises(RuntimeError):
        callback(InferenceDone(request_id='unsettled'))
    assert [r['request_id'] for r in store.request_outcomes('alice', completed=True)] == ['complete']
