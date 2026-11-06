"""GEO-003: shared allowlisted activity without account or request identifiers."""
import json
import time

from fastapi.testclient import TestClient

from inference_exchange.coordinator import dependencies
from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.store import Store

FIELDS = {'timestamp_minute', 'status', 'model', 'provider_country', 'caller_country',
          'input_tokens', 'output_tokens', 'cost_micro', 'latency_ms'}


def seed(store, request_id, owner, *, country='GH'):
    store.get_or_create_account(owner, owner)
    store.save_request_outcome({'request_id': request_id, 'timestamp': time.time(), 'status': 'matched',
        'model': 'private-requested-model', 'reason': 'private-prompt-text', 'api_key': 'private-secret',
        'scoring': [{'provider_id': 'private-provider', 'email': 'private@example.com'}]}, owner)
    store.charge_request(request_id=request_id, consumer_id=owner, provider_id='private-provider',
        model='private-requested-model', served_model='Example public model', input_tokens=2, output_tokens=3,
        price_per_mtok_input=.05, price_per_mtok_output=.15, latency_ms=125)
    store.amend_request_outcome(request_id, consumer_id=owner, status='completed', provider_country='US', caller_country=country)


def test_public_projection_is_allowlisted_and_minute_precision(tmp_path):
    store = Store(tmp_path / 'db')
    seed(store, 'private-request-id', 'private-user-id')
    store.save_request_outcome({'request_id': 'private-rejected-id', 'timestamp': time.time() + 1,
        'status': 'no_compatible_provider', 'model': 'private-requested-model', 'reason': 'private-email@example.com'}, 'other-user')
    snapshot = store.public_network_activity(geography_enabled=True)
    assert snapshot['scope'] == 'exchange' and snapshot['time_precision'] == 'minute'
    for row in snapshot['requests'] + snapshot['completions']:
        assert set(row) == FIELDS
        assert row['timestamp_minute'] % 60 == 0
    assert snapshot['requests'][0]['model'] is None
    assert snapshot['requests'][0]['cost_micro'] is None
    completed = snapshot['completions'][0]
    assert completed['model'] == 'Example public model'
    assert completed['input_tokens'] == 2 and completed['output_tokens'] == 3
    assert completed['cost_micro'] == 100 and completed['latency_ms'] == 125
    assert completed['provider_country'] == 'US' and completed['caller_country'] == 'GH'
    assert 'private-' not in json.dumps(snapshot)
    assert 'other-user' not in json.dumps(snapshot)
    assert not any(key in json.dumps(snapshot) for key in ['request_id', 'consumer_id', 'provider_id', 'reason', 'prompt', 'api_key', 'scoring'])
    hidden = store.public_network_activity(geography_enabled=False)
    assert all(r['provider_country'] is None and r['caller_country'] is None for r in hidden['requests'] + hidden['completions'])


def test_latest_completions_have_separate_window_and_no_daily_threshold(tmp_path):
    store = Store(tmp_path / 'db')
    now = time.time()
    for i in range(75):
        store.save_request_outcome({'request_id': f'r-{i:03}', 'timestamp': now + i,
            'status': 'matched' if i < 35 else 'queue_timeout'}, 'one-account')
        if i < 35:
            store.amend_request_outcome(f'r-{i:03}', consumer_id='one-account', status='completed', provider_country='US', caller_country='US')
    snapshot = store.public_network_activity(geography_enabled=True)
    assert len(snapshot['requests']) == len(snapshot['completions']) == 30
    assert all(r['status'] == 'queue_timeout' for r in snapshot['requests'])
    assert all(r['status'] == 'completed' for r in snapshot['completions'])
    assert all(r['provider_country'] == r['caller_country'] == 'US' for r in snapshot['completions'])
    assert snapshot['requests'][0]['timestamp_minute'] >= snapshot['requests'][-1]['timestamp_minute']
    store.save_request_outcome({'request_id': 'old', 'timestamp': now - 8 * 86400, 'status': 'failed'}, 'one-account')
    assert len(store.request_outcomes(None, 100)) == 75
    store.save_request_outcome({'request_id': 'bad-status', 'timestamp': now + 76, 'status': 'private-email@example.com'}, 'one-account')
    assert store.public_network_activity(geography_enabled=True)['requests'][0]['status'] == 'other'


def test_anonymous_other_account_and_admin_get_same_network_but_not_same_trace(monkeypatch, tmp_path):
    monkeypatch.setenv('IE_DB_PATH', str(tmp_path / 'db'))
    monkeypatch.setenv('IE_ENV', 'production')
    monkeypatch.setenv('IE_PASSWORD_AUTH', '1')
    monkeypatch.setenv('IE_JWT_SECRET', 'test-secret')
    monkeypatch.setenv('IE_ADMIN_EMAILS', 'boss@example.com')
    monkeypatch.setenv('IE_COUNTRY_ACTIVITY_ENABLED', '1')
    monkeypatch.setenv('IE_GEO_INGRESS_SECRET', 'a' * 40)
    client = TestClient(create_app(), base_url='https://testserver')
    store = dependencies.get_store()
    seed(store, 'private-request-id', 'private-user-id')
    anonymous = client.get('/v1/exchange/activity/network')
    assert anonymous.status_code == 200
    assert client.get('/v1/exchange/traces/private-request-id').status_code == 401
    assert client.get('/v1/exchange/usage').status_code == 401
    assert client.post('/v1/auth/signup', json={'email': 'new@example.com', 'password': 'password1'}).status_code == 200
    assert client.get('/v1/exchange/activity/network').json() == anonymous.json()
    assert client.get('/v1/exchange/traces/private-request-id').status_code == 404
    assert client.get('/v1/exchange/traces').json()['traces'] == []
    assert client.get('/v1/admin/signups').status_code == 403
    assert client.post('/v1/auth/signup', json={'email': 'boss@example.com', 'password': 'password1'}).status_code == 200
    assert client.get('/v1/exchange/activity/network').json() == anonymous.json()
    assert client.get('/v1/exchange/traces/private-request-id').status_code == 200
