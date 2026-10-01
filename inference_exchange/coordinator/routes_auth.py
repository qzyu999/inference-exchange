"""Auth endpoints -- API key management, user signup/login, JWT sessions."""

import hashlib
import hmac
import json
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from inference_exchange.config import admin_emails, is_production

from .dependencies import get_auth, get_billing, get_store
from .store import DEFAULT_CONSUMER_ID

router = APIRouter()

# Rate limiter for auth endpoints (prevent brute-force)
_auth_attempts: dict[str, list[float]] = {}
_AUTH_RATE_LIMIT = 10  # max attempts per window
_AUTH_RATE_WINDOW = 300  # 5 minute window


def _check_auth_rate(ip: str) -> bool:
    """Return True if request is allowed, False if rate-limited."""
    import time
    now = time.time()
    attempts = _auth_attempts.get(ip, [])
    # Remove old attempts
    attempts = [t for t in attempts if now - t < _AUTH_RATE_WINDOW]
    if len(attempts) >= _AUTH_RATE_LIMIT:
        return False
    attempts.append(now)
    _auth_attempts[ip] = attempts
    return True

# JWT secret: use env var if set, otherwise generate (and warn)
import os as _os
import secrets as _secrets
_JWT_SECRET = _os.environ.get("IE_JWT_SECRET", "")
if not _JWT_SECRET:
    _JWT_SECRET = _secrets.token_hex(32)
    # Only warn in non-test environments
    import logging as _log
    _log.getLogger(__name__).warning("IE_JWT_SECRET not set — JWT tokens will not survive restarts. Set IE_JWT_SECRET env var for production.")


# --- JWT helpers (minimal, no external dependency) ---

def _b64url(data: bytes) -> str:
    import base64
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    import base64
    padding = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + "=" * padding)


def create_jwt(payload: dict, ttl_hours: int = 24) -> str:
    """Create a simple HMAC-SHA256 JWT. No external deps needed."""
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload["exp"] = int(time.time()) + ttl_hours * 3600
    payload["iat"] = int(time.time())
    body = _b64url(json.dumps(payload).encode())
    sig = _b64url(hmac.new(_JWT_SECRET.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest())
    return f"{header}.{body}.{sig}"


def verify_jwt(token: str) -> dict | None:
    """Verify and decode a JWT. Returns payload or None."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header, body, sig = parts
        expected_sig = _b64url(hmac.new(_JWT_SECRET.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected_sig):
            return None
        payload = json.loads(_b64url_decode(body))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


def resolve_user_from_request(request: Request) -> dict | None:
    """Extract user from JWT cookie or Authorization header."""
    # Check cookie first (web console)
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        # Check Authorization header (Bearer <jwt>)
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer ") and not auth[7:].startswith("sk-ie-"):
            token = auth[7:]
    if not token:
        return None
    payload = verify_jwt(token)
    if not payload:
        return None
    # Reject sessions issued before the last logout / revocation
    current = get_store().get_session_version(payload.get("user_id", ""))
    if current is None or payload.get("sv", 0) != current:
        return None
    return payload


def resolve_consumer_id(request: Request) -> str:
    """Caller's consumer id: JWT user > API key > shared default consumer."""
    user_info = resolve_user_from_request(request)
    if user_info:
        return user_info["user_id"]
    return get_auth().resolve_consumer(request.headers.get("authorization"))


def is_admin_request(request: Request) -> bool:
    """Admin = JWT with role=admin. In dev, also allowed while no users exist yet."""
    user = resolve_user_from_request(request)
    if user and user.get("role") == "admin":
        return True
    return not is_production() and not get_store().has_users()


def anonymous_inference_blocked(consumer_id: str) -> bool:
    """In prod, the shared anonymous account cannot run inference."""
    return is_production() and consumer_id == DEFAULT_CONSUMER_ID


def sign_in_required_response() -> JSONResponse:
    return JSONResponse(
        {"error": {"message": "Sign in or use an API key to run inference.", "type": "authentication_required"}},
        status_code=401,
    )


def admin_required_response() -> JSONResponse:
    return JSONResponse({"error": "Admin access required"}, status_code=403)


def _role_for(email: str, stored_role: str = "consumer") -> str:
    return "admin" if email.lower().strip() in admin_emails() else stored_role


SESSION_COOKIE = "ie_session"
SESSION_TTL_SECONDS = 86400


def _session_token(user: dict) -> str:
    return create_jwt({
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "role": _role_for(user["email"], user.get("role", "consumer")),
        "sv": user.get("session_version", 0),
    })


def _set_session(response, user: dict) -> None:
    response.set_cookie(
        SESSION_COOKIE, _session_token(user),
        httponly=True, samesite="lax", secure=is_production(), max_age=SESSION_TTL_SECONDS,
    )


def password_auth_enabled() -> bool:
    """Email/password auth: on in dev, off in prod unless IE_PASSWORD_AUTH=1."""
    default = "0" if is_production() else "1"
    return _os.environ.get("IE_PASSWORD_AUTH", default) == "1"


def _password_auth_disabled() -> JSONResponse:
    return JSONResponse({"error": "Password sign-in is disabled. Use GitHub."}, status_code=403)


# --- Signup / Login ---

class SignupRequest(BaseModel):
    email: str
    password: str
    name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/v1/auth/signup")
async def signup(req: SignupRequest, request: Request):
    """Create a new user account with email + password."""
    if not password_auth_enabled():
        return _password_auth_disabled()
    if not _check_auth_rate(request.client.host if request.client else "unknown"):
        return JSONResponse({"error": "Too many attempts. Try again in a few minutes."}, status_code=429)

    store = get_store()

    if len(req.password) < 6:
        return JSONResponse({"error": "Password must be at least 6 characters"}, status_code=400)

    if not req.email or "@" not in req.email:
        return JSONResponse({"error": "Invalid email"}, status_code=400)

    try:
        user = store.create_user(req.email, req.password, req.name)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=409)

    response = JSONResponse({
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "api_key": user["api_key"],
        "balance_usd": 10.0,
        "note": "Welcome! You have $10.00 in free credits.",
    })
    _set_session(response, user)
    return response


@router.post("/v1/auth/login")
async def login(req: LoginRequest, request: Request):
    """Login with email + password. Returns JWT in cookie."""
    if not password_auth_enabled():
        return _password_auth_disabled()
    if not _check_auth_rate(request.client.host if request.client else "unknown"):
        return JSONResponse({"error": "Too many attempts. Try again in a few minutes."}, status_code=429)

    store = get_store()
    user = store.authenticate_user(req.email, req.password)
    if not user:
        return JSONResponse({"error": "Invalid email or password"}, status_code=401)

    # Get account info
    account = store.get_account(user["user_id"])
    balance = account["balance_micro"] / 1_000_000 if account else 0

    response = JSONResponse({
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "balance_usd": round(balance, 6),
    })
    _set_session(response, user)
    return response


@router.post("/v1/auth/logout")
async def logout(request: Request):
    """Sign out everywhere: bumps the session version so all issued JWTs stop working."""
    user = resolve_user_from_request(request)
    if user:
        get_store().bump_session_version(user["user_id"])
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE)
    return response


@router.get("/v1/auth/config")
async def auth_config():
    """Which sign-in methods the UI should offer."""
    from .oauth_github import github_configured
    return {"github": github_configured(), "password": password_auth_enabled()}


@router.delete("/v1/auth/keys/{key_id}")
async def revoke_api_key(key_id: str, request: Request):
    user = resolve_user_from_request(request)
    if not user:
        return JSONResponse({"error": "Sign in required"}, status_code=401)
    if not get_store().revoke_api_key(user["user_id"], key_id):
        return JSONResponse({"error": "Key not found"}, status_code=404)
    return {"ok": True, "key_id": key_id}


@router.delete("/v1/auth/account")
async def delete_account(request: Request):
    """Delete the caller's account, keys, and balance (#57)."""
    user = resolve_user_from_request(request)
    if not user:
        return JSONResponse({"error": "Sign in required"}, status_code=401)
    get_store().delete_user(user["user_id"])
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE)
    return response


@router.get("/v1/auth/me")
async def get_current_user(request: Request):
    """Get the current authenticated user's info."""
    store = get_store()

    # Try JWT session first (web console)
    user_info = resolve_user_from_request(request)
    if user_info:
        user_id = user_info["user_id"]
        account = store.get_account(user_id)
        keys = store.get_user_api_keys(user_id)
        return {
            "user_id": user_id,
            "email": user_info.get("email", ""),
            "name": user_info.get("name", ""),
            "balance_usd": round(account["balance_micro"] / 1_000_000, 6) if account else 0,
            "total_spent_usd": round(account["total_spent_micro"] / 1_000_000, 6) if account else 0,
            "requests_made": account["requests_made"] if account else 0,
            "tokens_consumed": account["tokens_consumed"] if account else 0,
            "api_keys": len(keys),
        }

    # Fall back to API key auth
    auth = get_auth()
    billing = get_billing()
    consumer_id = auth.resolve_consumer(request.headers.get("authorization"))
    account = billing.get_or_create_consumer(consumer_id)
    if isinstance(account, dict):
        return {
            "consumer_id": consumer_id,
            "balance_usd": round(account["balance_micro"] / 1_000_000, 6),
            "total_spent_usd": round(account["total_spent_micro"] / 1_000_000, 6),
            "requests_made": account["requests_made"],
            "tokens_consumed": account["tokens_consumed"],
        }
    return {
        "consumer_id": consumer_id,
        "balance_usd": round(account.balance_usd, 6),
        "total_spent_usd": round(account.total_spent_usd, 6),
        "requests_made": account.requests_made,
        "tokens_consumed": account.tokens_consumed,
    }


# --- API key management ---

@router.post("/v1/auth/keys")
async def create_api_key(request: Request):
    """Create a new API key. If logged in, ties to user's account."""
    store = get_store()
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    name = body.get("name", "API Key")

    # If user is logged in via JWT, create key tied to their account
    user_info = resolve_user_from_request(request)
    if user_info:
        raw_key = store.create_api_key_for_user(user_info["user_id"], name)
        return {"api_key": raw_key, "consumer_id": user_info["user_id"], "name": name}

    # Anonymous key creation mints a new funded account each time; dev only
    if is_production():
        return JSONResponse({"error": "Sign in to create API keys"}, status_code=401)

    auth = get_auth()
    billing = get_billing()
    raw_key, consumer_id = auth.create_key(name=name)
    billing.get_or_create_consumer(consumer_id, name)
    return {
        "api_key": raw_key,
        "consumer_id": consumer_id,
        "name": name,
        "balance_usd": 10.0,
    }


@router.get("/v1/auth/keys")
async def list_api_keys(request: Request):
    """List API keys. If logged in, shows only user's keys."""
    store = get_store()
    user_info = resolve_user_from_request(request)
    if user_info:
        keys = store.get_user_api_keys(user_info["user_id"])
        return {"keys": keys}
    return {"keys": []}


@router.post("/v1/auth/reset-balance")
async def reset_balance(request: Request):
    """Reset the caller's balance to $10 (alpha only, dummy money)."""
    consumer_id = resolve_consumer_id(request)
    # The shared anonymous account must not be resettable by anyone in prod
    if is_production() and consumer_id == DEFAULT_CONSUMER_ID:
        return JSONResponse({"error": "Sign in to reset your balance"}, status_code=401)
    store = get_store()
    store._conn.execute(
        "UPDATE accounts SET balance_micro = ? WHERE account_id = ?",
        (10 * 1_000_000, consumer_id),
    )
    store._conn.commit()
    return {"ok": True, "balance_usd": 10.0, "note": "Balance reset to $10.00 (alpha dummy credits)"}
