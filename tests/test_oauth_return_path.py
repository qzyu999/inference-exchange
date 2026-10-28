"""AUTH-018 (#107): after GitHub sign-in, return to the intended page, never off-site."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from inference_exchange.coordinator.main import create_app
from inference_exchange.coordinator.oauth_github import NEXT_COOKIE, safe_next_path

# Same cases as web/src/lib/nav.test.mjs
UNSAFE = [None, "", "chat", "https://evil.example/x", "//evil.example", "/\\evil.example",
          "\\\\evil", "javascript:alert(1)", "/ok\nSet-Cookie:x", "/v1/admin/controls",
          "/ws/provider", "/login", "/" + "a" * 600]
SAFE = ["/chat", "/keys", "/billing", "/trace?id=abc123", "/docs/requirements/auth", "/admin"]
IDENTITY = {"id": 99, "login": "octo", "email": "octo@example.com", "name": "Octo",
            "created_at": "2015-01-01T00:00:00Z"}


@pytest.mark.parametrize("value", UNSAFE)
def test_unsafe_next_falls_back(value):
    assert safe_next_path(value) == "/chat"


@pytest.mark.parametrize("value", SAFE)
def test_safe_next_is_kept(value):
    assert safe_next_path(value) == value


@pytest.fixture
def gh(monkeypatch):
    monkeypatch.setenv("IE_ENV", "dev")
    monkeypatch.setenv("IE_GITHUB_CLIENT_ID", "cid")
    monkeypatch.setenv("IE_GITHUB_CLIENT_SECRET", "csecret")
    return TestClient(create_app())


def _sign_in(c: TestClient, next_value: str | None) -> str:
    url = "/v1/auth/github/login" + (f"?next={next_value}" if next_value is not None else "")
    assert c.get(url, follow_redirects=False).status_code == 302
    state = c.cookies.get("ie_oauth_state").split(".")[0]
    with patch("inference_exchange.coordinator.oauth_github._fetch_github_identity", return_value=IDENTITY):
        r = c.get(f"/v1/auth/github/callback?code=c&state={state}", follow_redirects=False)
    assert r.status_code == 302
    return r.headers["location"]


def test_callback_returns_to_requested_page(gh):
    assert _sign_in(gh, "/keys") == "/keys"
    assert gh.get("/v1/auth/me").json()["email"] == "octo@example.com"


def test_callback_defaults_to_chat(gh):
    assert _sign_in(gh, None) == "/chat"


@pytest.mark.parametrize("value", ["https://evil.example", "//evil.example", "/v1/admin/state"])
def test_callback_never_redirects_off_site(gh, value):
    assert _sign_in(gh, value) == "/chat"


def test_tampered_next_cookie_is_revalidated(gh):
    assert gh.get("/v1/auth/github/login?next=/keys", follow_redirects=False).status_code == 302
    state_cookie = gh.cookies.get("ie_oauth_state")
    state = state_cookie.split(".")[0]
    # Send an explicit Cookie header, so that only the tampered value reaches the server
    gh.cookies.clear()
    tampered = f"ie_oauth_state={state_cookie}; {NEXT_COOKIE}=https://evil.example"
    with patch("inference_exchange.coordinator.oauth_github._fetch_github_identity", return_value=IDENTITY):
        r = gh.get(f"/v1/auth/github/callback?code=c&state={state}", headers={"cookie": tampered},
                   follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "/chat"
