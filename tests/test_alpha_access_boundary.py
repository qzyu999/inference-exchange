"""No-secret unit tests for the hosted alpha ingress checker."""

import io
import sys
from pathlib import Path
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from check_alpha_access_boundary import (  # noqa: E402
    ACCESS_ADMIN_PATHS, PRIVATE_ACCOUNT_PATHS, PUBLIC_PAGES,
    Result, cloudflare_access_challenge, probe, schema_hidden,
)


def result(status: int, body: str = "", location: str = "", content_type: str = "text/html") -> Result:
    return Result(status=status, headers={"location": location, "content-type": content_type}, body=body)


def test_challenge_detects_cloudflare_login_redirect():
    assert cloudflare_access_challenge(
        result(302, location="https://team.cloudflareaccess.com/cdn-cgi/access/login")
    )
    assert cloudflare_access_challenge(
        result(302, location="/cdn-cgi/access/login/alpha.inferenceex.com")
    )


def test_challenge_detects_access_denied_html():
    assert cloudflare_access_challenge(
        result(403, body="<html>Cloudflare Access - Denied</html>")
    )


def test_challenge_does_not_confuse_ie_admin_for_access():
    assert not cloudflare_access_challenge(
        result(403, body='{"error":"Admin access required"}', content_type="application/json")
    )
    assert not cloudflare_access_challenge(result(200, body="<html>SPA</html>"))
    assert not cloudflare_access_challenge(result(302, location="/login"))


def test_probe_returns_body_of_http_error():
    class RejectingOpener:
        def open(self, req, timeout=10.0):
            raise HTTPError(
                req.full_url,
                401,
                "Unauthorized",
                {"Content-Type": "application/json"},
                io.BytesIO(b'{"error":"Sign in required"}'),
            )

    got = probe(RejectingOpener(), "https://alpha.inferenceex.com", "/v1/auth/me", 1.0)
    assert got.status == 401
    assert got.json() == {"error": "Sign in required"}


def test_schema_hidden_detects_public_openapi():
    assert not schema_hidden(result(200, body='{"openapi":"3.1.0","paths":{}}', content_type="application/json"))
    assert schema_hidden(result(404, body='{"detail":"Not Found"}', content_type="application/json"))
    # A 200 with a truncated 10KB OpenAPI document must never pass.
    assert not schema_hidden(result(200, body='{"openapi":"3.1.0","paths":{' + "x" * 10000,
                                   content_type="application/json"))
    # An SPA fallback is also a misrouted API endpoint: require a hard 404.
    assert not schema_hidden(result(200, body="<html>SPA</html>"))
    assert not schema_hidden(result(302, location="https://other.example/"))
    assert not schema_hidden(result(403, body="<html>Access denied</html>"))

def test_operator_cloudflare_matrix_guards_exact_parents_and_nested_paths():
    assert {"/admin", "/admin/", "/v1/admin", "/v1/admin/"}.issubset(ACCESS_ADMIN_PATHS)
    assert {"/v1/admin/controls", "/v1/admin/accounts", "/v1/admin/provider-tokens"}.issubset(ACCESS_ADMIN_PATHS)
    assert len(ACCESS_ADMIN_PATHS) == len(set(ACCESS_ADMIN_PATHS))
    assert all(path.startswith(("/admin", "/v1/admin")) for path in ACCESS_ADMIN_PATHS)


def test_owner_and_guest_routes_must_not_require_cloudflare_login():
    assert {"/", "/provide"} == set(PUBLIC_PAGES)
    assert {"/v1/auth/me", "/v1/exchange/balance", "/v1/provider/nodes",
            "/v1/provider/credentials", "/v1/provider/earnings"}.issubset(PRIVATE_ACCOUNT_PATHS)
    assert not set(PRIVATE_ACCOUNT_PATHS) & set(ACCESS_ADMIN_PATHS)
    assert not set(PUBLIC_PAGES) & set(ACCESS_ADMIN_PATHS)


def test_access_challenge_cannot_be_mistaken_for_account_denial():
    for path in ACCESS_ADMIN_PATHS:
        # An IE 401/403 on an operator API is not proof of edge protection.
        assert not cloudflare_access_challenge(
            result(403, body='{"error": "Admin access required"}', content_type="application/json")
        ), path
