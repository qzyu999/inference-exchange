"""No-secret unit tests for the hosted alpha ingress checker."""

import io
import sys
from pathlib import Path
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from check_alpha_access_boundary import Result, cloudflare_access_challenge, probe  # noqa: E402


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
