"""Auth endpoints -- API key management, user signup/login, JWT sessions."""

import hashlib
import hmac
import json
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .dependencies import get_auth, get_billing, get_store

router = APIRouter()

# JWT secret (generated at import time, changes on restart -- fine for alpha)
import secrets as _secrets
_JWT_SECRET = _secrets.token_hex(32)


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
    token = request.cookies.get("ie_session")
    if not token:
        # Check Authorization header (Bearer <jwt>)
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer ") and not auth[7:].startswith("sk-ie-"):
            token = auth[7:]
    if token:
        return verify_jwt(token)
    return None


# --- Signup / Login ---

class SignupRequest(BaseModel):
    email: str
    password: str
    name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/v1/auth/signup")
async def signup(req: SignupRequest):
    """Create a new user account with email + password."""
    store = get_store()

    if len(req.password) < 6:
        return JSONResponse({"error": "Password must be at least 6 characters"}, status_code=400)

    if not req.email or "@" not in req.email:
        return JSONResponse({"error": "Invalid email"}, status_code=400)

    try:
        user = store.create_user(req.email, req.password, req.name)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=409)

    # Create JWT
    token = create_jwt({"user_id": user["user_id"], "email": user["email"], "name": user["name"]})

    response = JSONResponse({
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "api_key": user["api_key"],
        "balance_usd": 10.0,
        "note": "Welcome! You have $10.00 in free credits.",
    })
    response.set_cookie("ie_session", token, httponly=True, samesite="lax", max_age=86400)
    return response


@router.post("/v1/auth/login")
async def login(req: LoginRequest):
    """Login with email + password. Returns JWT in cookie."""
    store = get_store()
    user = store.authenticate_user(req.email, req.password)
    if not user:
        return JSONResponse({"error": "Invalid email or password"}, status_code=401)

    token = create_jwt({"user_id": user["user_id"], "email": user["email"], "name": user["name"]})

    # Get account info
    account = store.get_account(user["user_id"])
    balance = account["balance_micro"] / 1_000_000 if account else 0

    response = JSONResponse({
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "balance_usd": round(balance, 6),
    })
    response.set_cookie("ie_session", token, httponly=True, samesite="lax", max_age=86400)
    return response


@router.post("/v1/auth/logout")
async def logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie("ie_session")
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

    # Otherwise, create a standalone key with new account
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
    auth = get_auth()
    return {"keys": auth.list_keys()}
