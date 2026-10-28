"""Admin endpoints -- system state dump, provider token management.

Admin endpoints require either:
- No users in the system (dev mode)
- A logged-in user with role='admin' (production)
"""

import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .dependencies import (
    _request_traces,
    get_auth,
    get_billing,
    get_hub,
    get_store,
    traces_for,
)
from .routes_auth import admin_required_response, is_admin_request, resolve_user_from_request
from .store import ProviderOwnershipError

router = APIRouter()


@router.get("/v1/admin/state")
async def get_admin_state(request: Request):
    """Full system state dump for the admin dashboard."""
    if not is_admin_request(request):
        return admin_required_response()

    hub = get_hub()
    billing = get_billing()
    auth = get_auth()

    # All accounts with balances
    accounts = []
    for acc in billing._accounts.values():
        accounts.append({
            "account_id": acc.account_id,
            "name": acc.name,
            "balance_usd": round(acc.balance_usd, 6),
            "total_spent_usd": round(acc.total_spent_usd, 6),
            "total_earned_usd": round(acc.total_earned_usd, 6),
            "requests_made": acc.requests_made,
            "tokens_consumed": acc.tokens_consumed,
        })

    # All providers with full internal state
    providers = []
    for p in hub._providers.values():
        providers.append({
            "provider_id": p.provider_id,
            "billing_account_id": p.billing_account_id,
            "session_id": p.session_id,
            "name": p.name,
            "models": p.capabilities.models,
            "trust_level": p.capabilities.trust_level.value,
            "hardware": p.capabilities.hardware,
            "price_input": p.capabilities.price_per_mtok_input,
            "price_output": p.capabilities.price_per_mtok_output,
            "measured_tps": p.capabilities.measured_tps,
            "max_concurrent": p.capabilities.max_concurrent,
            "active_requests": p.active_requests,
            "load": round(p.load_factor, 2),
            "encrypted": bool(p.encryption_public_key),
            "encryption_key_preview": p.encryption_public_key[:16] + "..." if p.encryption_public_key else None,
            "connected_at": p.connected_at,
            "uptime_seconds": int(time.time() - p.connected_at),
            "last_heartbeat": p.last_heartbeat,
            "seconds_since_heartbeat": int(time.time() - p.last_heartbeat),
            "token_id": p.token_id,
            "quarantined": p.quarantined,
            "quarantine_reason": p.quarantine_reason,
        })

    # Matching engine config (must match matching/strategy.py compute_score)
    matching_config = {
        "strategy": "GreedyStrategy",
        "scoring_weights": {
            "cheapest": {"price": 0.6, "speed": 0.15, "trust": 0.1, "load": 0.15},
            "fastest": {"price": 0.1, "speed": 0.6, "trust": 0.1, "load": 0.2},
            "most_secure": {"price": 0.1, "speed": 0.1, "trust": 0.6, "load": 0.2},
            "balanced": {"price": 0.35, "speed": 0.25, "trust": 0.2, "load": 0.2},
        },
        "scoring_formula": "score = w_price * 1/(1+price) + w_speed * tps/(10+tps) + w_trust * level/4 + w_load * (1-load)",
        "modifiers": "reputation: score *= (0.5 + 0.5 * rep), session_affinity: score *= 1.2",
    }

    # Protocol stats
    protocol_stats = {
        "total_ws_connections": hub._next_provider_id,
        "active_connections": hub.provider_count,
        "active_response_queues": len(hub._response_queues),
        "total_requests_traced": len(_request_traces),
    }

    # Recent bills
    recent_bills = [
        {
            "request_id": b.request_id[:8],
            "consumer_id": b.consumer_id,
            "provider_id": b.provider_id,
            "model": b.model,
            "input_tokens": b.input_tokens,
            "output_tokens": b.output_tokens,
            "cost_usd": round(b.cost_micro / 1_000_000, 6),
            "provider_earned_usd": round(b.provider_earning_micro / 1_000_000, 6),
            "platform_fee_usd": round(b.platform_fee_micro / 1_000_000, 6),
            "timestamp": b.timestamp,
        }
        for b in billing.recent_bills[-50:]
    ]

    return {
        "system": {
            "uptime_note": "In-memory only — state resets on restart",
            "components": [
                {"name": "Coordinator", "status": "running", "port": 8000},
                {"name": "ProviderHub", "status": "running", "connections": hub.provider_count},
                {"name": "BillingLedger", "status": "running", "transactions": billing.total_requests},
                {"name": "AuthStore", "status": "running", "keys": len(auth._keys_by_hash)},
                {"name": "MatchingEngine", "status": "running", "strategy": "GreedyStrategy"},
                {"name": "E2E Encryption", "status": "active", "algorithm": "X25519+XSalsa20-Poly1305"},
            ],
        },
        "accounts": accounts,
        "api_keys": auth.list_keys(),
        "providers": providers,
        "matching": matching_config,
        "protocol": protocol_stats,
        "billing": {
            "summary": billing.summary(),
            "recent": recent_bills,
            "platform_fee_percent": billing.PLATFORM_FEE_PERCENT,
        },
        "traces": traces_for(None, limit=20),
    }


class CreateProviderTokenRequest(BaseModel):
    name: str = "Provider"


@router.post("/v1/admin/provider-tokens")
async def create_provider_token(body: CreateProviderTokenRequest, request: Request):
    """Create a new provider auth token. The token is shown once."""
    if not is_admin_request(request):
        return admin_required_response()
    store = get_store()
    raw_token = store.create_provider_token(body.name)
    return {"token": raw_token, "name": body.name}


@router.get("/v1/admin/provider-tokens")
async def list_provider_tokens(request: Request):
    """List all provider tokens (without the raw token values)."""
    if not is_admin_request(request):
        return admin_required_response()
    store = get_store()
    return {"tokens": store.list_provider_tokens()}


class ProviderClaimRequest(BaseModel):
    billing_account_id: str = Field(min_length=1, max_length=120)
    owner_user_id: str = Field(min_length=1, max_length=120)
    reason: str = Field(min_length=1, max_length=500)


@router.post("/v1/admin/provider-claims")
async def claim_legacy_provider(body: ProviderClaimRequest, request: Request):
    """Manually bind an unclaimed provider principal after verifying ownership off-band."""
    actor = resolve_user_from_request(request)
    # Never rely on the permissive no-users dev admin bootstrap for ownership claims.
    if not actor or actor.get("role") != "admin" or not is_admin_request(request):
        return admin_required_response()
    try:
        result = get_store().claim_legacy_provider(
            body.billing_account_id, body.owner_user_id, actor["user_id"], body.reason,
        )
    except ProviderOwnershipError as exc:
        return JSONResponse({"error": str(exc)}, status_code=exc.status_code)
    return {"node": result}


# --- Account moderation (#111, AUTH-017) ---

def _admin_actor(request: Request) -> str:
    """Who performed an admin action, for the audit trail."""
    from .routes_auth import resolve_user_from_request
    user = resolve_user_from_request(request)
    if not user:
        return "dev-admin"
    return user.get("email") or user["user_id"]


class SuspendRequest(BaseModel):
    reason: str
    # None = permanent ban
    duration_seconds: float | None = None


class UnsuspendRequest(BaseModel):
    reason: str = ""


@router.get("/v1/admin/accounts")
async def list_accounts(request: Request):
    """Account metadata for operators. No prompts, no key material."""
    if not is_admin_request(request):
        return admin_required_response()
    return {"accounts": get_store().list_users_for_admin()}


@router.post("/v1/admin/accounts/{user_id}/suspend")
async def suspend_account(user_id: str, body: SuspendRequest, request: Request):
    """Suspend (temporary) or ban (permanent) an account. Ends its sessions; its keys stop working."""
    if not is_admin_request(request):
        return admin_required_response()
    if not body.reason.strip():
        return JSONResponse({"error": "A reason is required"}, status_code=400)
    if body.duration_seconds is not None and body.duration_seconds <= 0:
        return JSONResponse({"error": "duration_seconds must be positive, or null for a permanent ban"}, status_code=400)
    result = get_store().suspend_user(user_id, body.reason.strip(), _admin_actor(request), body.duration_seconds)
    if result is None:
        return JSONResponse({"error": "Account not found"}, status_code=404)
    # A suspended provider owner must stop serving, not only fail the next handshake.
    billing_principals = get_store().provider_billing_principals_for_owner(user_id)
    hub = get_hub()
    for provider in list(hub._providers.values()):
        if provider.billing_account_id in billing_principals:
            await hub.force_disconnect(provider.provider_id, "Provider owner suspended")
    return {"ok": True, "suspension": result}


@router.post("/v1/admin/accounts/{user_id}/unsuspend")
async def unsuspend_account(user_id: str, body: UnsuspendRequest, request: Request):
    if not is_admin_request(request):
        return admin_required_response()
    if not get_store().unsuspend_user(user_id, body.reason.strip(), _admin_actor(request)):
        return JSONResponse({"error": "Account not found"}, status_code=404)
    return {"ok": True}


@router.get("/v1/admin/account-actions")
async def list_account_actions(request: Request, user_id: str | None = None):
    """Audit trail of suspend, ban, and unsuspend actions."""
    if not is_admin_request(request):
        return admin_required_response()
    return {"actions": get_store().list_account_actions(user_id)}


# --- Operator controls (#112, OPS-008/009/010) ---

class ControlsUpdate(BaseModel):
    inference_paused: bool | None = None
    signup_disabled: bool | None = None
    max_concurrent_per_account: int | None = None


def _controls_view() -> dict:
    from .operator_controls import get_controls
    hub = get_hub()
    return {
        **get_controls().snapshot(),
        "queue_length": hub.pending_queue_size,
        "queue_max_depth": hub.QUEUE_MAX_DEPTH,
        "queue_timeout_seconds": hub.QUEUE_TIMEOUT_SECONDS,
        "providers_connected": hub.provider_count,
        "runtime_changes_persist": False,
    }


@router.get("/v1/admin/controls")
async def get_operator_controls(request: Request):
    if not is_admin_request(request):
        return admin_required_response()
    return _controls_view()


@router.post("/v1/admin/controls")
async def update_operator_controls(body: ControlsUpdate, request: Request):
    """Change pause, signup, and concurrency at runtime. Resets to env values on restart."""
    if not is_admin_request(request):
        return admin_required_response()
    if body.max_concurrent_per_account is not None and body.max_concurrent_per_account < 0:
        return JSONResponse({"error": "max_concurrent_per_account must be 0 (no limit) or more"}, status_code=400)
    from .operator_controls import get_controls
    get_controls().update(_admin_actor(request), **body.model_dump())
    return _controls_view()


@router.post("/v1/admin/queue/clear")
async def clear_request_queue(request: Request):
    """Fail every queued request with 503 queue_cleared. Requests already on a provider continue."""
    if not is_admin_request(request):
        return admin_required_response()
    cleared = get_hub().clear_queue()
    return {"ok": True, "cleared": cleared}


# --- Provider revocation and quarantine (#113, PROV-010) ---

class QuarantineRequest(BaseModel):
    reason: str = ""


@router.delete("/v1/admin/provider-tokens/{token_id}")
async def revoke_provider_token(token_id: str, request: Request):
    """Revoke a provider token and disconnect every provider that uses it."""
    if not is_admin_request(request):
        return admin_required_response()
    if not get_store().revoke_provider_token(token_id):
        return JSONResponse({"error": "Token not found or already revoked"}, status_code=404)
    hub = get_hub()
    disconnected = []
    for provider_id in hub.providers_with_token(token_id):
        if await hub.force_disconnect(provider_id, "Provider token revoked"):
            disconnected.append(provider_id)
    return {"ok": True, "token_id": token_id, "disconnected": disconnected}


@router.post("/v1/admin/providers/{provider_id}/quarantine")
async def quarantine_provider(provider_id: str, body: QuarantineRequest, request: Request):
    """Remove a connected provider from routing at once. It stays connected."""
    if not is_admin_request(request):
        return admin_required_response()
    if not get_hub().set_quarantine(provider_id, True, body.reason.strip()):
        return JSONResponse({"error": "Provider not connected"}, status_code=404)
    return {"ok": True, "provider_id": provider_id, "quarantined": True}


@router.post("/v1/admin/providers/{provider_id}/release")
async def release_provider(provider_id: str, request: Request):
    if not is_admin_request(request):
        return admin_required_response()
    if not get_hub().set_quarantine(provider_id, False):
        return JSONResponse({"error": "Provider not connected"}, status_code=404)
    return {"ok": True, "provider_id": provider_id, "quarantined": False}


@router.post("/v1/admin/providers/{provider_id}/disconnect")
async def disconnect_provider(provider_id: str, request: Request):
    """Close a provider connection. In-flight requests get provider_disconnected."""
    if not is_admin_request(request):
        return admin_required_response()
    if not await get_hub().force_disconnect(provider_id):
        return JSONResponse({"error": "Provider not connected"}, status_code=404)
    return {"ok": True, "provider_id": provider_id}
