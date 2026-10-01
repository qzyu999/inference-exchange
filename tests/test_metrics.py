from fastapi.testclient import TestClient

from inference_exchange.coordinator.main import create_app


def test_metrics_exposes_gauges_and_route_templates(monkeypatch):
    monkeypatch.delenv("IE_METRICS_TOKEN", raising=False)
    c = TestClient(create_app())
    c.get("/health")
    c.delete("/v1/auth/keys/abc123")  # path param must not appear in labels
    body = c.get("/metrics").text
    assert "ie_providers_connected 0" in body
    assert 'route="/health",status="200"' in body
    assert 'route="/v1/auth/keys/{key_id}"' in body
    assert "abc123" not in body


def test_metrics_token(monkeypatch):
    monkeypatch.setenv("IE_METRICS_TOKEN", "t0k")
    c = TestClient(create_app())
    assert c.get("/metrics").status_code == 401
    assert c.get("/metrics", headers={"authorization": "Bearer t0k"}).status_code == 200
