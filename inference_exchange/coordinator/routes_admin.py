"""Admin endpoints — system state dump, provider token management."""

import time

from fastapi import APIRouter, Request
from pydantic import BaseModel

from .dependencies import (
    _request_traces,
    get_auth,
    get_billing,
    get_hub,
    get_store,
)

router = APIRouter()


@router.get("/v1/admin/state")
async def get_admin_state(request: Request):
    """Full system state dump for the admin dashboard."""
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
        "traces": list(reversed(_request_traces[-20:])),
    }


class CreateProviderTokenRequest(BaseModel):
    name: str = "Provider"


@router.post("/v1/admin/provider-tokens")
async def create_provider_token(request: CreateProviderTokenRequest):
    """Create a new provider auth token. The token is shown once."""
    store = get_store()
    raw_token = store.create_provider_token(request.name)
    return {"token": raw_token, "name": request.name}


@router.get("/v1/admin/provider-tokens")
async def list_provider_tokens():
    """List all provider tokens (without the raw token values)."""
    store = get_store()
    return {"tokens": store.list_provider_tokens()}
