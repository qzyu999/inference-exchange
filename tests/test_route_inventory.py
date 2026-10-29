"""OPS-011 (#123): every route has an ingress category, and the server enforces it.

If you add a route, add it to ROUTES. The test fails for an unclassified route,
so that nobody makes a new public endpoint by accident.
"""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from inference_exchange.coordinator.main import create_app

PUBLIC = "public"        # anonymous read-only or sign-in entry points
ACCOUNT = "account"      # IE session or API key; 401 when anonymous
ADMIN = "admin"          # IE admin role; Cloudflare Access at the edge too
OPS = "ops"              # not for the internet; 404 without a configured token
PROVIDER = "provider"    # IE provider token (PROV-002, PROV-011)

ROUTES = {
    ("GET", "/health"): PUBLIC,
    ("GET", "/readiness"): PUBLIC,
    ("GET", "/metrics"): OPS,
    ("GET", "/v1/models"): PUBLIC,
    ("GET", "/v1/encryption-key"): PUBLIC,
    ("GET", "/v1/auth/config"): PUBLIC,
    ("GET", "/v1/auth/github/login"): PUBLIC,
    ("GET", "/v1/auth/github/callback"): PUBLIC,
    ("POST", "/v1/auth/login"): PUBLIC,
    ("POST", "/v1/auth/signup"): PUBLIC,
    ("POST", "/v1/auth/logout"): PUBLIC,
    ("GET", "/v1/auth/keys"): PUBLIC,  # AUTH-008: empty list when anonymous
    ("GET", "/v1/exchange/providers"): PUBLIC,
    ("GET", "/v1/exchange/confidential/providers"): PUBLIC,
    ("GET", "/v1/exchange/pricing"): PUBLIC,
    ("GET", "/v1/exchange/billing-config"): PUBLIC,
    ("GET", "/v1/exchange/stats"): PUBLIC,
    ("GET", "/v1/exchange/depth"): PUBLIC,
    ("GET", "/v1/exchange/tps"): PUBLIC,
    ("GET", "/v1/exchange/reputation"): PUBLIC,
    ("GET", "/v1/exchange/events/recent"): PUBLIC,  # PRIV-003 strips identifiers
    ("GET", "/v1/exchange/models/search"): PUBLIC,
    ("GET", "/v1/exchange/market"): PUBLIC,
    ("GET", "/v1/exchange/telemetry"): PUBLIC,
    ("GET", "/v1/exchange/reference-prices"): PUBLIC,
    ("GET", "/v1/exchange/reference-prices/history"): PUBLIC,
    ("GET", "/v1/auth/me"): ACCOUNT,
    ("POST", "/v1/auth/keys"): ACCOUNT,
    ("DELETE", "/v1/auth/keys/{key_id}"): ACCOUNT,
    ("DELETE", "/v1/auth/account"): ACCOUNT,
    ("POST", "/v1/auth/reset-balance"): ACCOUNT,
    ("GET", "/v1/exchange/balance"): ACCOUNT,
    ("GET", "/v1/exchange/history"): ACCOUNT,
    ("GET", "/v1/provider/nodes"): ACCOUNT,
    ("POST", "/v1/provider/nodes"): ACCOUNT,
    ("GET", "/v1/provider/earnings"): ACCOUNT,
    ("GET", "/v1/exchange/traces"): ACCOUNT,
    ("POST", "/v1/chat/completions"): ACCOUNT,
    ("POST", "/v1/confidential/infer"): ACCOUNT,
    ("GET", "/v1/exchange/provider-earnings"): ADMIN,
    ("GET", "/v1/admin/state"): ADMIN,
    ("GET", "/v1/admin/accounts"): ADMIN,
    ("POST", "/v1/admin/accounts/{user_id}/suspend"): ADMIN,
    ("POST", "/v1/admin/accounts/{user_id}/unsuspend"): ADMIN,
    ("GET", "/v1/admin/account-actions"): ADMIN,
    ("GET", "/v1/admin/controls"): ADMIN,
    ("POST", "/v1/admin/controls"): ADMIN,
    ("POST", "/v1/admin/queue/clear"): ADMIN,
    ("GET", "/v1/admin/provider-tokens"): ADMIN,
    ("POST", "/v1/admin/provider-tokens"): ADMIN,
    ("POST", "/v1/admin/provider-claims"): ADMIN,
    ("DELETE", "/v1/admin/provider-tokens/{token_id}"): ADMIN,
    ("POST", "/v1/admin/providers/{provider_id}/quarantine"): ADMIN,
    ("POST", "/v1/admin/providers/{provider_id}/release"): ADMIN,
    ("POST", "/v1/admin/providers/{provider_id}/disconnect"): ADMIN,
    ("WS", "/ws/provider"): PROVIDER,
    ("WS", "/ws/events"): PUBLIC,  # PRIV-003 strips identifiers
}

# Valid-shaped bodies, so that auth runs before body validation where it matters
BODIES = {
    "/v1/chat/completions": {"messages": [{"role": "user", "content": "x"}], "ocip_min_confidence": "open"},
    "/v1/confidential/infer": {"session_id": "s", "encrypted_envelope": {}},
    "/v1/admin/accounts/{user_id}/suspend": {"reason": "test", "days": 1},
}


def _app_routes(app) -> set[tuple[str, str]]:
    found = set()
    for route in app.routes:
        path = getattr(route, "path", None)
        if path is None or path in ("/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"):
            continue
        methods = getattr(route, "methods", None)
        if methods is None:
            if type(route).__name__.endswith("WebSocketRoute"):
                found.add(("WS", path))
            continue
        found.update((m, path) for m in methods if m != "HEAD")
    return found


def _app_routes_including_routers(app) -> set[tuple[str, str]]:
    # FastAPI may wrap included routers; the OpenAPI schema lists every HTTP route
    schema_paths = app.openapi()["paths"]
    http = {(m.upper(), p) for p, ops in schema_paths.items() for m in ops}
    return http | {r for r in _app_routes(app) if r[0] == "WS"}


@pytest.fixture
def prod(monkeypatch, tmp_path):
    monkeypatch.setenv("IE_ENV", "prod")
    monkeypatch.setenv("IE_JWT_SECRET", "inventory-test-secret")
    monkeypatch.setenv("IE_DB_PATH", str(tmp_path / "inv.db"))
    monkeypatch.delenv("IE_METRICS_TOKEN", raising=False)
    return TestClient(create_app(), base_url="https://testserver")


def test_every_route_is_classified(monkeypatch):
    monkeypatch.setenv("IE_ENV", "dev")
    actual = _app_routes_including_routers(create_app())
    unclassified = actual - set(ROUTES)
    stale = set(ROUTES) - actual
    assert not unclassified, f"Add these routes to ROUTES with a category: {sorted(unclassified)}"
    assert not stale, f"Remove these routes from ROUTES: {sorted(stale)}"


def _fill(path: str) -> str:
    return (path.replace("{key_id}", "k").replace("{user_id}", "u")
            .replace("{token_id}", "t").replace("{provider_id}", "p"))


@pytest.mark.parametrize("method,path", sorted(k for k, v in ROUTES.items() if v == ACCOUNT))
def test_account_routes_need_credentials_in_prod(prod, method, path):
    r = prod.request(method, _fill(path), json=BODIES.get(path, {}))
    assert r.status_code == 401, f"{method} {path} -> {r.status_code}"


@pytest.mark.parametrize("method,path", sorted(k for k, v in ROUTES.items() if v == ADMIN))
def test_admin_routes_need_admin_in_prod(prod, method, path):
    r = prod.request(method, _fill(path), json=BODIES.get(path, {}))
    assert r.status_code in (401, 403), f"{method} {path} -> {r.status_code}"


def test_provider_socket_needs_token_in_prod(prod):
    with pytest.raises(WebSocketDisconnect) as exc:
        with prod.websocket_connect("/ws/provider") as ws:
            ws.receive_text()
    assert exc.value.code == 4003


@pytest.mark.parametrize("path", ["/openapi.json", "/redoc", "/docs"])
def test_api_schema_and_docs_hidden_in_prod(prod, path):
    r = prod.get(path)
    assert "swagger" not in r.text.lower() and "redoc" not in r.text.lower() and '"openapi"' not in r.text


def test_metrics_hidden_in_prod_without_token(prod):
    assert prod.get("/metrics").status_code == 404


def test_metrics_with_token_in_prod(monkeypatch, prod):
    monkeypatch.setenv("IE_METRICS_TOKEN", "m3trics")
    assert prod.get("/metrics").status_code == 401
    assert prod.get("/metrics", headers={"authorization": "Bearer m3trics"}).status_code == 200


def test_alpha_caddy_blocks_ops_paths():
    from pathlib import Path

    text = (Path(__file__).resolve().parents[1] / "deploy" / "Caddyfile.alpha-local").read_text()
    blocked = next(line for line in text.splitlines() if line.strip().startswith("@blocked"))
    for path in ("/metrics", "/openapi.json", "/redoc"):
        assert path in blocked.split()
    assert "bind 127.0.0.1" in text
