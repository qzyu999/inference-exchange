"""GEO-001: trusted ingress, coarse daily release, bounded ephemeral state."""
import json
import time
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

from inference_exchange.coordinator import country_activity as geo


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv('IE_COUNTRY_ACTIVITY_ENABLED', '1')
    monkeypatch.setenv('IE_GEO_INGRESS_SECRET', 'test-marker-' + 'a' * 40)
    return Headers({'cf-ipcountry': 'GH', 'x-ie-geo-secret': 'test-marker-' + 'a' * 40})


def test_headers_fail_closed_and_opt_out(configured, monkeypatch):
    assert geo.trusted_country(configured) == 'GH'
    assert geo.trusted_country(Headers({'cf-ipcountry': 'GH'})) is None
    for country in ['ZZ', 'XX', 'T1', 'gh', 'USA', 'GH,US', '', '<x>']:
        assert geo.trusted_country(Headers({**dict(configured), 'cf-ipcountry': country})) is None
    assert geo.trusted_country(Headers({**dict(configured), 'x-ie-geo-secret': 'wrong'})) is None
    assert geo.trusted_country(Headers({**dict(configured), 'x-ie-exclude-geography': 'true'})) is None
    monkeypatch.delenv('IE_COUNTRY_ACTIVITY_ENABLED')
    assert geo.trusted_country(configured) is None
    monkeypatch.setenv('IE_COUNTRY_ACTIVITY_ENABLED', '1')
    monkeypatch.setenv('IE_GEO_INGRESS_SECRET', 'short')
    assert geo.trusted_country(configured) is None


def seed(activity, *, consumers=3, count=5, day=100):
    for i in range(count):
        activity.record('US', 'GH', f'account-{i % consumers}', f'request-{i}', now=day * geo.DAY + 10)


def test_daily_release_suppression_dedup_and_no_identifiers(configured):
    activity = geo.CountryActivity()
    seed(activity, consumers=2)
    assert activity.snapshot(now=101 * geo.DAY)['routes'] == []
    activity.record('US', 'GH', 'third-account', 'sixth-request', now=100 * geo.DAY + 100)
    assert activity.snapshot(now=100 * geo.DAY + 200)['routes'] == []
    expected = {'provider_country': 'US', 'caller_country': 'GH', 'count_band': '5–9'}
    assert activity.snapshot(now=101 * geo.DAY)['routes'] == [expected]
    # Retries/callback repeats must not increment the count.
    seed(activity, count=5)
    assert activity.snapshot(now=101 * geo.DAY)['routes'] == [expected]
    public = json.dumps(activity.snapshot(now=101 * geo.DAY))
    assert not any(word in public for word in ['request-', 'account-', 'third-account', 'provider_id', 'model', 'timestamp', 'ip'])
    assert activity.snapshot(now=102 * geo.DAY)['routes'] == []
    assert activity._days == {}
    sparse = geo.CountryActivity()
    seed(sparse, count=4)
    assert sparse.snapshot(now=101 * geo.DAY)['routes'] == []


def test_unknown_anonymous_disabled_and_bounded_storage(configured, monkeypatch):
    activity = geo.CountryActivity()
    for source, target, caller in [(None, 'GH', 'a'), ('US', None, 'a'), ('US', 'GH', 'default-consumer')]:
        activity.record(source, target, caller, 'r', now=geo.DAY * 100)
    assert activity._days == {}
    monkeypatch.setattr(geo, 'MAX_COMPLETIONS_PER_DAY', 6)
    seed(activity, count=100)
    assert len(activity._days[100]['seen']) == 6
    assert len(activity._days[100]['routes'][('US', 'GH')]['consumers']) == 3
    monkeypatch.setenv('IE_COUNTRY_ACTIVITY_ENABLED', '0')
    assert activity.snapshot(now=101 * geo.DAY) == {'enabled': False, 'period': None, 'routes': []}
    assert activity._days == {}


def test_sdk_http_path_reads_country_and_resets_context(configured, monkeypatch):
    from inference_exchange.coordinator.main import create_app
    from inference_exchange.coordinator import routes_inference as ri
    seen = []
    async def dispatch(request, consumer_id):
        seen.append(geo.consumer_country.get())
        return {'ok': True}
    monkeypatch.setattr(ri, '_route_and_dispatch', dispatch)
    client = TestClient(create_app())
    body = {'model': 'example-model', 'messages': [{'role': 'user', 'content': 'hello'}]}
    assert client.post('/v1/chat/completions', json=body, headers=dict(configured)).status_code == 200
    assert client.post('/v1/chat/completions', json=body).status_code == 200
    assert seen == ['GH', None]
    assert geo.consumer_country.get() is None


def test_completion_captures_provider_and_caller_before_context_reset(configured, monkeypatch):
    from inference_exchange.coordinator.provider_hub import ConnectedProvider
    from inference_exchange.shared.protocol import ProviderCapabilities, TrustLevel, InferenceDone
    from inference_exchange.coordinator import routes_inference as ri
    provider = ConnectedProvider(provider_id='actual-retry-provider', name='Example', ws=AsyncMock(), capabilities=ProviderCapabilities(models=['Example'], trust_level=TrustLevel.OPEN), network_country='US')
    billing = Mock()
    monkeypatch.setattr(ri, 'get_billing', lambda: billing)
    monkeypatch.setattr(ri, 'get_event_bus', lambda: None)
    monkeypatch.setattr(ri, '_complete_trace', Mock())
    record = Mock()
    monkeypatch.setattr(ri.country_activity, 'record', record)
    token = geo.consumer_country.set('GH')
    callback = ri._make_billing_callback('real-completion', 'Example', provider, 'account', 1, time.time())
    geo.consumer_country.reset(token)
    assert not record.called
    callback(InferenceDone(request_id='real-completion'))
    record.assert_called_once_with('US', 'GH', 'account', 'real-completion')
    # A feature failure must never prevent settlement/completion handling.
    record.side_effect = RuntimeError('test failure')
    callback(InferenceDone(request_id='real-completion'))
    assert billing.charge_request.call_count == 2
    assert ri._complete_trace.call_count == 2


def test_public_endpoint_exposes_only_release_schema(configured, monkeypatch):
    from inference_exchange.coordinator.main import create_app
    activity = geo.CountryActivity()
    seed(activity)
    monkeypatch.setattr(geo, 'activity', activity)
    monkeypatch.setattr(geo.time, 'time', lambda: 101 * geo.DAY)
    response = TestClient(create_app()).get('/v1/exchange/country-activity')
    assert response.status_code == 200
    assert set(response.json()) == {'enabled', 'period', 'routes'}
    assert response.json()['routes'][0] == {'provider_country': 'US', 'caller_country': 'GH', 'count_band': '5–9'}


def test_expiry_route_cap_and_cross_day_callback_replay(configured, monkeypatch):
    activity = geo.CountryActivity()
    seed(activity)
    activity.record('US', 'GH', 'new-account', 'request-0', now=101 * geo.DAY + 10)
    assert activity._days[101]['routes'] == {}
    monkeypatch.setattr(geo, 'MAX_ROUTES_PER_DAY', 1)
    activity.record('US', 'GH', 'a', 'new-1', now=101 * geo.DAY + 10)
    activity.record('US', 'GB', 'a', 'new-2', now=101 * geo.DAY + 10)
    assert len(activity._days[101]['routes']) == 1
    monkeypatch.setattr(geo.time, 'time', lambda: 103 * geo.DAY)
    activity.expire()
    assert activity._days == {}


def test_provider_handshake_country_stays_out_of_public_listing(configured, monkeypatch):
    from inference_exchange.coordinator.main import create_app
    from inference_exchange.coordinator.dependencies import get_hub
    from inference_exchange.shared.protocol import ProviderCapabilities, RegisterMessage
    monkeypatch.setenv('IE_ENV', 'dev')
    client = TestClient(create_app())
    registration = RegisterMessage(provider_name='country-test', capabilities=ProviderCapabilities(models=['mock'], hardware='apple-m6', model_format='gguf')).model_dump()
    for headers, expected in [(dict(configured), 'GH'), ({'cf-ipcountry': 'GH'}, None)]:
        with client.websocket_connect('/ws/provider', headers=headers) as ws:
            ws.send_json(registration)
            provider_id = ws.receive_json()['provider_id']
            assert get_hub()._providers[provider_id].network_country == expected
            assert 'network_country' not in client.get('/v1/exchange/providers').text
