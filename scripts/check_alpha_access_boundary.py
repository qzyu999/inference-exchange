#!/usr/bin/env python3
"""Unauthenticated public-alpha ingress smoke test (no credentials required).

This check is intended for AFTER staging path-specific admin Access applications
and removing the broad hostname Access application. It never creates accounts,
mints keys, invokes an authenticated inference request, or prints secrets.

    python3 scripts/check_alpha_access_boundary.py --url https://alpha.inferenceex.com

A passing run is necessary but not sufficient for a secure public alpha.
Cloudflare path policy, alternate tunnel/DNS routes, authenticated admin and
provider sessions, and cross-account isolation require manual checks too.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass
class Result:
    status: int
    headers: dict[str, str]
    body: str

    def json(self):
        try:
            return json.loads(self.body)
        except (ValueError, TypeError):
            return None


def probe(opener, base: str, path: str, timeout: float, data: bytes | None = None) -> Result:
    headers = {"Accept": "application/json", "User-Agent": "IE-alpha-boundary-check/1"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = Request(base + path, data=data, headers=headers, method="POST" if data is not None else "GET")
    try:
        response = opener.open(req, timeout=timeout)
    except HTTPError as exc:
        response = exc
    with response:
        return Result(
            status=response.status,
            headers={k.lower(): v for k, v in response.headers.items()},
            body=response.read(8192).decode("utf-8", errors="replace"),
        )


def cloudflare_access_challenge(result: Result) -> bool:
    """Require visible Access challenge evidence, not just an IE admin 403.

    CF can redirect to a login path or return its own Access denied document.
    A JSON 403 from IE alone DOES NOT establish that the edge path is private.
    """
    location = result.headers.get("location", "").lower()
    if 300 <= result.status < 400:
        return "cloudflareaccess.com" in location or "/cdn-cgi/access/" in location
    if result.status in (401, 403):
        body = result.body.lower()
        content_type = result.headers.get("content-type", "").lower()
        return "text/html" in content_type and (
            "cloudflare access" in body or "/cdn-cgi/access/" in body
        )
    return False


def schema_hidden(result: Result) -> bool:
    """The FastAPI OpenAPI schema must not be served publicly (OPS-011)."""
    # Fail closed. The probe intentionally reads only 8192 response bytes; a
    # larger OpenAPI schema might be truncated and fail JSON decoding.
    # On the public Caddy ingress this endpoint must be an outright 404.
    return result.status == 404


# Expand these when adding public-facing owner or operator endpoints.
# Tests guard the parent paths that a wildcard Access application may not match.
PUBLIC_PAGES = ("/", "/provide")
PRIVATE_ACCOUNT_PATHS = (
    "/v1/auth/me",
    "/v1/exchange/balance",
    "/v1/provider/nodes",
    "/v1/provider/credentials",
    "/v1/provider/earnings",
)
ACCESS_ADMIN_PATHS = (
    "/admin",
    "/admin/",
    "/v1/admin",
    "/v1/admin/",
    "/v1/admin/controls",
    "/v1/admin/accounts",
    "/v1/admin/provider-tokens",
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Public alpha HTTPS origin")
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()
    parts = urlsplit(args.url)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        parser.error("--url must be a public HTTPS origin without credentials")
    if parts.path.strip("/") or parts.query or parts.fragment:
        parser.error("--url must be an origin only (e.g. https://alpha.inferenceex.com)")
    base = args.url.rstrip("/")
    opener = build_opener(NoRedirect())
    failed = []

    def check(description: str, path: str, predicate, data: bytes | None = None):
        try:
            result = probe(opener, base, path, args.timeout, data)
            ok = predicate(result)
            print(f"{'PASS' if ok else 'FAIL'} {description} (HTTP {result.status})")
            if not ok:
                failed.append(description)
        except (URLError, OSError, TimeoutError) as exc:
            print(f"FAIL {description} ({type(exc).__name__})")
            failed.append(description)

    for path in PUBLIC_PAGES:
        check(f"Public browser page {path}", path,
              lambda r: r.status == 200 and "text/html" in r.headers.get("content-type", "").lower())

    check("Public GitHub auth configuration", "/v1/auth/config",
          lambda r: r.status == 200 and isinstance(r.json(), dict) and r.json().get("github") is True)
    check("Public model listing", "/v1/models",
          lambda r: r.status == 200 and isinstance(r.json(), dict) and isinstance(r.json().get("data"), list))
    for path in PRIVATE_ACCOUNT_PATHS:
        check(f"Private account API requires IE auth {path}", path, lambda r: r.status == 401)
    payload = json.dumps({
        "model": "default",
        "messages": [{"role": "user", "content": "unauthenticated smoke test"}],
        "max_tokens": 1,
        "ocip_min_confidence": "open",
    }).encode("utf-8")
    check("Anonymous inference is rejected", "/v1/chat/completions",
          lambda r: r.status == 401, data=payload)
    check("No shared default key exposed by health", "/health?include_key=1",
          lambda r: r.status == 200 and isinstance(r.json(), dict)
          and r.json().get("status") == "ok" and "default_api_key" not in r.json())
    check("Metrics hidden by local gateway", "/metrics", lambda r: r.status == 404)
    for path in ACCESS_ADMIN_PATHS:
        check(f"Operator path challenged at Cloudflare edge {path}", path,
              cloudflare_access_challenge)
    check("API schema hidden", "/openapi.json", schema_hidden)

    if failed:
        print(f"\n{len(failed)} boundary check(s) failed. Keep/re-enable blanket Access; do not open registration.")
        return 1
    print("\nAnonymous ingress checks passed. Manually verify authenticated users, SDK, provider,")
    print("admin Access session, alternate tunnel paths, and rate limits before inviting testers.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
