"""GitHub OAuth sign-in (authorization code flow with state + PKCE).

Config:
  IE_GITHUB_CLIENT_ID / IE_GITHUB_CLIENT_SECRET  - OAuth app credentials
  IE_PUBLIC_URL        - base URL users reach the app at (callback = {IE_PUBLIC_URL}/v1/auth/github/callback)
  IE_GITHUB_MIN_AGE_DAYS - reject GitHub accounts younger than this (anti-abuse, default 0)
"""

import base64
import hashlib
import logging
import os
import secrets
import time
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse

from inference_exchange.config import is_production

from .dependencies import get_store
from .routes_auth import _set_session

logger = logging.getLogger(__name__)
router = APIRouter()

AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"
API_URL = "https://api.github.com"
STATE_COOKIE = "ie_oauth_state"
STATE_TTL_SECONDS = 600
HTTP_TIMEOUT_SECONDS = 10


def github_configured() -> bool:
    return bool(os.environ.get("IE_GITHUB_CLIENT_ID") and os.environ.get("IE_GITHUB_CLIENT_SECRET"))


def _callback_url(request: Request) -> str:
    base = os.environ.get("IE_PUBLIC_URL", "").rstrip("/") or str(request.base_url).rstrip("/")
    return f"{base}/v1/auth/github/callback"


def _pkce_challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


@router.get("/v1/auth/github/login")
async def github_login(request: Request):
    if not github_configured():
        return JSONResponse({"error": "GitHub sign-in is not configured"}, status_code=404)
    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    params = {
        "client_id": os.environ["IE_GITHUB_CLIENT_ID"],
        "redirect_uri": _callback_url(request),
        "scope": "read:user user:email",
        "state": state,
        "code_challenge": _pkce_challenge(verifier),
        "code_challenge_method": "S256",
        "allow_signup": "true",
    }
    response = RedirectResponse(f"{AUTHORIZE_URL}?{urlencode(params)}", status_code=302)
    response.set_cookie(
        STATE_COOKIE, f"{state}.{verifier}",
        httponly=True, samesite="lax", secure=is_production(), max_age=STATE_TTL_SECONDS,
    )
    return response


def _login_error(reason: str) -> RedirectResponse:
    response = RedirectResponse(f"/login?error={reason}", status_code=302)
    response.delete_cookie(STATE_COOKIE)
    return response


async def _fetch_github_identity(code: str, verifier: str, redirect_uri: str) -> dict:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
        r = await client.post(TOKEN_URL, headers={"Accept": "application/json"}, data={
            "client_id": os.environ["IE_GITHUB_CLIENT_ID"],
            "client_secret": os.environ["IE_GITHUB_CLIENT_SECRET"],
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": verifier,
        })
        token = r.json().get("access_token")
        if not token:
            raise ValueError("token exchange failed")
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
        user = (await client.get(f"{API_URL}/user", headers=headers)).json()
        email = user.get("email") or ""
        if not email:
            emails = (await client.get(f"{API_URL}/user/emails", headers=headers)).json()
            primary = next((e for e in emails if e.get("primary") and e.get("verified")), None)
            email = primary["email"] if primary else ""
        return {**user, "email": email}


def _account_age_days(created_at: str) -> float:
    created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - created).total_seconds() / 86400


@router.get("/v1/auth/github/callback")
async def github_callback(request: Request, code: str = "", state: str = ""):
    if not github_configured():
        return JSONResponse({"error": "GitHub sign-in is not configured"}, status_code=404)
    stored = request.cookies.get(STATE_COOKIE, "")
    stored_state, _, verifier = stored.partition(".")
    if not code or not state or not stored_state or not secrets.compare_digest(state, stored_state):
        return _login_error("state")

    try:
        gh = await _fetch_github_identity(code, verifier, _callback_url(request))
    except (httpx.HTTPError, ValueError, KeyError) as e:
        logger.warning(f"❌ GitHub OAuth failed: {e}")
        return _login_error("github")

    min_age = float(os.environ.get("IE_GITHUB_MIN_AGE_DAYS", "0"))
    if min_age and gh.get("created_at") and _account_age_days(gh["created_at"]) < min_age:
        return _login_error("account_too_new")

    try:
        user, created = get_store().upsert_github_user(
            str(gh["id"]), gh.get("login", ""), gh.get("email", ""), gh.get("name") or "",
        )
    except ValueError:
        return _login_error("email_taken")

    logger.info(f"✅ GitHub sign-in: {gh.get('login')} ({'new' if created else 'returning'}) at {int(time.time())}")
    response = RedirectResponse("/chat", status_code=302)
    response.delete_cookie(STATE_COOKIE)
    _set_session(response, user)
    return response
