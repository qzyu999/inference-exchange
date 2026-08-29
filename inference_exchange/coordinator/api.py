"""OpenAI-compatible consumer API endpoints."""

import asyncio
import json
import logging
import time
import uuid

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from inference_exchange.shared.crypto import EncryptedPayload, encrypt_json
from inference_exchange.shared.protocol import (
    InferenceDone,
    InferenceError,
    InferenceRequest,
    InferenceResponseChunk,
)

from .auth import AuthStore
from .billing import BillingLedger
from .provider_hub import ProviderHub
from .rate_limiter import RateLimiter
from .reputation import ReputationTracker
from .tps_tracker import TPSTracker

logger = logging.getLogger(__name__)
router = APIRouter()

# --- Request trace log (ring buffer of recent request decisions) ---

_request_traces: list[dict] = []
MAX_TRACES = 100


def _add_trace(trace: dict):
    _request_traces.append(trace)
    if len(_request_traces) > MAX_TRACES:
        _request_traces.pop(0)


def _estimate_input_tokens(messages: list) -> int:
    """Estimate token count from messages (approximate: ~4 chars per token for English).

    This is a fast approximation. For exact counting, use the model's tokenizer.
    Good enough for billing at the micro-USD level.
    """
    total_chars = sum(len(str(m.get("content", "") if isinstance(m, dict) else getattr(m, "content", ""))) for m in messages)
    # Add ~4 tokens per message for role/formatting overhead
    overhead = len(messages) * 4
    return max(1, total_chars // 4 + overhead)


# --- Request/Response models (OpenAI-compatible) ---


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: str = "default"
    messages: list[ChatMessage]
    max_tokens: int = 1024
    temperature: float = 0.7
    stream: bool = True
    # OCIP routing preferences (consumer controls)
    ocip_preference: str = "balanced"  # cheapest | fastest | most_secure | balanced
    ocip_min_confidence: str = "open"  # open | contained | hardened | confidential
    ocip_max_price: float | None = None  # Max $/Mtok output (None = no limit)
    ocip_session_id: str | None = None  # Session ID for cache affinity


class ModelInfo(BaseModel):
    id: str
    object: str = "model"
    owned_by: str = "inference-exchange"


# --- Dependency: ProviderHub is injected from main.py ---

_hub: ProviderHub | None = None
_billing: BillingLedger | None = None
_auth: AuthStore | None = None
_tps: TPSTracker | None = None
_reputation: ReputationTracker | None = None
_rate_limiter: RateLimiter = RateLimiter()  # Default: 30 req/min, burst 10


def set_hub(hub: ProviderHub):
    global _hub
    _hub = hub


def set_billing(billing: BillingLedger):
    global _billing
    _billing = billing


def set_auth(auth: AuthStore):
    global _auth
    _auth = auth


def set_tps_tracker(tracker: TPSTracker):
    global _tps
    _tps = tracker


def set_reputation(tracker: ReputationTracker):
    global _reputation
    _reputation = tracker


def get_hub() -> ProviderHub:
    if _hub is None:
        raise RuntimeError("ProviderHub not initialized")
    return _hub


def get_billing() -> BillingLedger:
    if _billing is None:
        raise RuntimeError("BillingLedger not initialized")
    return _billing


def get_auth() -> AuthStore:
    if _auth is None:
        raise RuntimeError("AuthStore not initialized")
    return _auth


def get_tps_tracker() -> TPSTracker:
    if _tps is None:
        raise RuntimeError("TPSTracker not initialized")
    return _tps


def get_reputation_tracker() -> ReputationTracker:
    if _reputation is None:
        raise RuntimeError("ReputationTracker not initialized")
    return _reputation


# --- Endpoints ---


# --- Auth endpoints ---


@router.post("/v1/auth/keys")
async def create_api_key(request: Request):
    """Create a new API key. Returns the key (shown only once)."""
    auth = get_auth()
    billing = get_billing()
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    name = body.get("name", "API Key")

    raw_key, consumer_id = auth.create_key(name=name)

    # Create billing account with $10 free credit
    billing.get_or_create_consumer(consumer_id, name)

    return {
        "api_key": raw_key,
        "consumer_id": consumer_id,
        "name": name,
        "balance_usd": 10.0,
        "note": "Save this key — it won't be shown again.",
    }


@router.get("/v1/auth/keys")
async def list_api_keys():
    """List all API keys (metadata only, no raw values)."""
    auth = get_auth()
    return {"keys": auth.list_keys()}


@router.get("/v1/auth/me")
async def get_current_user(request: Request):
    """Get the current authenticated consumer's info."""
    auth = get_auth()
    billing = get_billing()
    consumer_id = auth.resolve_consumer(request.headers.get("authorization"))
    account = billing.get_or_create_consumer(consumer_id)
    # account may be a dict (SQLite) or an object — handle both
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


# --- Inference endpoints ---


@router.get("/v1/models")
async def list_models():
    """List available models (OpenAI-compatible)."""
    hub = get_hub()
    models = hub.available_models
    if not models:
        models = ["default"]
    return {
        "object": "list",
        "data": [{"id": m, "object": "model", "owned_by": "inference-exchange"} for m in models],
    }


@router.get("/v1/exchange/providers")
async def list_providers():
    """List all connected providers with their pricing and status."""
    hub = get_hub()
    providers = []
    for p in hub._providers.values():
        providers.append({
            "id": p.provider_id,
            "name": p.name,
            "models": p.capabilities.models,
            "trust_level": p.capabilities.trust_level.value,
            "hardware": p.capabilities.hardware,
            "price_input": p.capabilities.price_per_mtok_input,
            "price_output": p.capabilities.price_per_mtok_output,
            "measured_tps": p.capabilities.measured_tps,
            "load": round(p.load_factor, 2),
            "active_requests": p.active_requests,
            "max_concurrent": p.capabilities.max_concurrent,
            "status": "online",
            "encrypted": bool(p.encryption_public_key),
            "uptime_seconds": int(time.time() - p.connected_at),
        })
    return {"providers": providers}


@router.get("/v1/exchange/pricing")
async def get_pricing():
    """Get current market pricing per model (cheapest available provider)."""
    hub = get_hub()
    pricing = {}
    for p in hub._providers.values():
        for model in p.capabilities.models:
            if model not in pricing or p.capabilities.price_per_mtok_output < pricing[model]["output"]:
                pricing[model] = {
                    "model": model,
                    "input": p.capabilities.price_per_mtok_input,
                    "output": p.capabilities.price_per_mtok_output,
                    "cheapest_provider": p.name,
                    "providers_available": 0,
                }
    # Count providers per model
    for p in hub._providers.values():
        for model in p.capabilities.models:
            if model in pricing:
                pricing[model]["providers_available"] += 1
    return {"pricing": list(pricing.values())}


@router.get("/v1/exchange/balance")
async def get_balance(request: Request):
    """Get consumer account balance."""
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


@router.get("/v1/exchange/stats")
async def get_stats():
    """Marketplace statistics."""
    hub = get_hub()
    billing = get_billing()
    summary = billing.summary()
    return {
        "providers_online": hub.provider_count,
        "models_available": len(hub.available_models),
        "total_requests": summary["total_requests"],
        "total_volume_usd": round(summary["total_volume_usd"], 6),
        "total_tokens": summary["total_tokens"],
    }


@router.get("/v1/exchange/history")
async def get_history():
    """Recent transaction history."""
    billing = get_billing()
    return {
        "transactions": [
            {
                "request_id": b.request_id[:8],
                "model": b.model,
                "tokens": b.input_tokens + b.output_tokens,
                "cost_usd": round(b.cost_micro / 1_000_000, 6),
                "provider_earned_usd": round(b.provider_earning_micro / 1_000_000, 6),
                "timestamp": b.timestamp,
            }
            for b in billing.recent_bills[-20:]
        ]
    }


@router.get("/v1/exchange/depth")
async def get_depth():
    """Order book depth — provider capacity at each price level (like a DOM).

    Returns asks (sell side) grouped by price level with available slots.
    """
    hub = get_hub()
    # Group providers by price level (rounded to $0.05 increments)
    price_levels: dict[float, dict] = {}

    for p in hub._providers.values():
        # Round to nearest $0.05 for grouping
        price_bucket = round(round(p.capabilities.price_per_mtok_output / 0.05) * 0.05, 2)

        if price_bucket not in price_levels:
            price_levels[price_bucket] = {
                "price": price_bucket,
                "total_slots": 0,
                "available_slots": 0,
                "providers": 0,
                "avg_throughput": 0,
                "max_confidence": "open",
                "encrypted_count": 0,
            }

        level = price_levels[price_bucket]
        level["total_slots"] += p.capabilities.max_concurrent
        level["available_slots"] += p.capabilities.max_concurrent - p.active_requests
        level["providers"] += 1
        level["avg_throughput"] += p.capabilities.measured_tps
        if p.encryption_public_key:
            level["encrypted_count"] += 1

        # Track max confidence at this level
        conf_order = ["open", "contained", "hardened", "confidential"]
        current = conf_order.index(level["max_confidence"]) if level["max_confidence"] in conf_order else 0
        provider_conf = conf_order.index(p.capabilities.trust_level.value) if p.capabilities.trust_level.value in conf_order else 0
        if provider_conf > current:
            level["max_confidence"] = p.capabilities.trust_level.value

    # Finalize averages
    for level in price_levels.values():
        if level["providers"] > 0:
            level["avg_throughput"] = round(level["avg_throughput"] / level["providers"], 1)

    # Sort by price ascending (cheapest first, like an order book)
    sorted_levels = sorted(price_levels.values(), key=lambda x: x["price"])

    return {
        "asks": sorted_levels,
        "total_capacity": sum(l["total_slots"] for l in sorted_levels),
        "available_capacity": sum(l["available_slots"] for l in sorted_levels),
    }


@router.get("/v1/exchange/traces")
async def get_traces():
    """Full decision traces for recent requests — shows the matching engine's reasoning."""
    return {"traces": list(reversed(_request_traces[-30:]))}


@router.get("/v1/exchange/tps")
async def get_tps_stats():
    """Dynamic TPS measurements per provider per model."""
    tracker = get_tps_tracker()
    return {"tps_stats": tracker.get_all_stats()}


@router.get("/v1/exchange/reputation")
async def get_reputation():
    """Provider reputation scores."""
    tracker = get_reputation_tracker()
    return {"reputation": tracker.get_all_stats()}


@router.get("/v1/exchange/models/search")
async def search_models(q: str = ""):
    """Search HuggingFace for GGUF models and show availability on the exchange."""
    from .model_registry import ModelRegistry
    hub = get_hub()
    registry = ModelRegistry()

    if not q:
        return {"models": [], "hint": "Pass ?q=llama to search HuggingFace for GGUF models"}

    results = registry.search_hf_models(q, limit=10)

    # Cross-reference with what's currently available on the exchange
    available_models = set()
    for p in hub._providers.values():
        for m in p.capabilities.models:
            available_models.add(m.lower())

    for result in results:
        # Check if any provider has this model (fuzzy match on repo name parts)
        repo_parts = result["repo_id"].lower().replace("/", " ").replace("-", " ").split()
        result["available_on_exchange"] = any(
            any(part in avail for part in repo_parts if len(part) > 3)
            for avail in available_models
        )
        # Count providers serving this model
        result["provider_count"] = sum(
            1 for p in hub._providers.values()
            if any(part in m.lower() for m in p.capabilities.models for part in repo_parts if len(part) > 3)
        )

    return {"query": q, "models": results, "exchange_models": sorted(available_models)}


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

    # Matching engine config
    matching_config = {
        "strategy": "GreedyStrategy",
        "scoring_weights": {
            "cheapest": {"price": 0.8, "speed": 0.05, "trust": 0.05, "load": 0.1},
            "fastest": {"price": 0.05, "speed": 0.8, "trust": 0.05, "load": 0.1},
            "most_secure": {"price": 0.05, "speed": 0.05, "trust": 0.8, "load": 0.1},
            "balanced": {"price": 0.3, "speed": 0.3, "trust": 0.2, "load": 0.2},
        },
        "scoring_formula": "score = w_price × (1/(1+price)) + w_speed × (tps/(10+tps)) + w_trust × trust_val + w_load × (1-load)",
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


@router.get("/v1/exchange/telemetry")
async def get_telemetry():
    """Engine telemetry — health metrics for the matching system."""
    hub = get_hub()
    billing = get_billing()

    # Provider health
    providers_online = hub.provider_count
    total_slots = sum(p.capabilities.max_concurrent for p in hub._providers.values())
    used_slots = sum(p.active_requests for p in hub._providers.values())
    encrypted_providers = sum(1 for p in hub._providers.values() if p.encryption_public_key)

    # Billing stats
    summary = billing.summary()
    recent = billing.recent_bills[-100:]

    # Compute throughput over last minute
    now = time.time()
    recent_1m = [b for b in recent if (now - b.timestamp) < 60]
    recent_5m = [b for b in recent if (now - b.timestamp) < 300]

    # Average cost per request
    avg_cost = (
        sum(b.cost_micro for b in recent) / len(recent) / 1_000_000
        if recent else 0
    )

    # Average tokens per request
    avg_tokens = (
        sum(b.output_tokens for b in recent) / len(recent)
        if recent else 0
    )

    return {
        "engine": {
            "strategy": "GreedyStrategy",  # TODO: wire to actual engine
            "match_rate": 1.0 if summary["total_requests"] > 0 else 0,
            "total_matched": summary["total_requests"],
            "total_failed": 0,
            "pending_orders": 0,
        },
        "fleet": {
            "providers_online": providers_online,
            "total_capacity_slots": total_slots,
            "used_slots": used_slots,
            "utilization": round(used_slots / total_slots, 3) if total_slots > 0 else 0,
            "encrypted_providers": encrypted_providers,
            "encryption_coverage": round(encrypted_providers / providers_online, 2) if providers_online > 0 else 0,
        },
        "throughput": {
            "requests_last_1m": len(recent_1m),
            "requests_last_5m": len(recent_5m),
            "tokens_last_1m": sum(b.output_tokens for b in recent_1m),
            "tokens_last_5m": sum(b.output_tokens for b in recent_5m),
        },
        "economics": {
            "avg_cost_per_request_usd": round(avg_cost, 6),
            "avg_tokens_per_request": round(avg_tokens, 1),
            "total_volume_usd": round(summary["total_volume_usd"], 6),
            "total_requests": summary["total_requests"],
        },
    }


@router.post("/v1/chat/completions")
async def chat_completions(request: ChatCompletionRequest, raw_request: Request):
    """OpenAI-compatible chat completions endpoint."""
    hub = get_hub()
    auth = get_auth()

    # Resolve consumer identity from auth header
    consumer_id = auth.resolve_consumer(raw_request.headers.get("authorization"))

    # Rate limit check
    if not _rate_limiter.allow(consumer_id):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Try again in a few seconds.",
            headers={"Retry-After": "5"},
        )

    # Select a provider
    provider = hub.select_provider(
        request.model,
        preference=request.ocip_preference,
        min_confidence=request.ocip_min_confidence,
        max_price=request.ocip_max_price,
        session_id=request.ocip_session_id,
        reputation_fn=get_reputation_tracker().get_score,
    )
    if provider is None:
        _add_trace({
            "request_id": request_id,
            "timestamp": time.time(),
            "model": request.model,
            "status": "no_match",
            "reason": f"No provider (pref={request.ocip_preference}, min_trust={request.ocip_min_confidence}, max_price={request.ocip_max_price})",
            "providers_evaluated": hub.provider_count,
        })
        raise HTTPException(
            status_code=503,
            detail="No provider available for this model. Is a provider connected?",
        )

    # Build scoring trace for this decision
    scoring_details = []
    for p in hub._providers.values():
        score = p.score_for_request(request.model, request.ocip_preference)
        scoring_details.append({
            "provider_id": p.provider_id,
            "name": p.name,
            "price": p.capabilities.price_per_mtok_output,
            "trust": p.capabilities.trust_level.value,
            "load": round(p.load_factor, 2),
            "tps": p.capabilities.measured_tps,
            "score": round(score, 4),
            "selected": p.provider_id == provider.provider_id,
            "encrypted": bool(p.encryption_public_key),
        })
    scoring_details.sort(key=lambda x: x["score"], reverse=True)

    request_id = str(uuid.uuid4())

    # Create response queue before sending request
    queue = hub.create_response_queue(request_id)

    # Build request — encrypt if provider supports E2E
    messages_plain = [m.model_dump() for m in request.messages]
    encrypted_body = None

    if provider.encryption_public_key:
        # OCIP E2E: encrypt messages to provider's key
        encrypted_body = encrypt_json(
            {"messages": messages_plain},
            provider.encryption_public_key,
        ).to_dict()
        logger.info(f"[{request_id[:8]}] 🔐 Request encrypted to provider")

    inference_req = InferenceRequest(
        request_id=request_id,
        model=request.model,
        messages=messages_plain if not encrypted_body else None,
        encrypted_body=encrypted_body,
        max_tokens=request.max_tokens,
        temperature=request.temperature,
        stream=request.stream,
    )

    try:
        await hub.send_to_provider(provider, inference_req)
    except Exception as e:
        hub.remove_response_queue(request_id)
        # RETRY: try another provider
        logger.warning(f"[{request_id[:8]}] Provider {provider.name} unreachable, retrying...")
        retry_provider = hub.select_provider(
            request.model,
            preference=request.ocip_preference,
            min_confidence=request.ocip_min_confidence,
            max_price=request.ocip_max_price,
        )
        if retry_provider and retry_provider.provider_id != provider.provider_id:
            queue = hub.create_response_queue(request_id)
            provider = retry_provider  # Use the retry provider for billing/traces
            try:
                await hub.send_to_provider(retry_provider, inference_req)
                logger.info(f"[{request_id[:8]}] Retried on {retry_provider.name}")
            except Exception as e2:
                hub.remove_response_queue(request_id)
                raise HTTPException(status_code=502, detail=f"All providers failed: {e2}")
        else:
            raise HTTPException(status_code=502, detail=f"Failed to reach provider: {e}")

    # Log the full decision trace
    _add_trace({
        "request_id": request_id[:8],
        "timestamp": time.time(),
        "model": request.model,
        "preference": request.ocip_preference,
        "min_confidence": request.ocip_min_confidence,
        "max_price": request.ocip_max_price,
        "status": "matched",
        "selected_provider": provider.name,
        "selected_price": provider.capabilities.price_per_mtok_output,
        "selected_trust": provider.capabilities.trust_level.value,
        "encrypted": bool(provider.encryption_public_key),
        "scoring": scoring_details,
        "providers_evaluated": len(scoring_details),
    })

    if request.stream:
        return StreamingResponse(
            _stream_response(request_id, request.model, queue, hub, provider, consumer_id),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-OCIP-Provider": provider.name,
                "X-OCIP-Trust-Level": provider.capabilities.trust_level.value,
                "X-OCIP-Price-Output": str(provider.capabilities.price_per_mtok_output),
            },
        )
    else:
        # Non-streaming: collect all tokens and return as one response
        return await _collect_response(request_id, request.model, queue, hub, provider, consumer_id)


async def _stream_response(
    request_id: str, model: str, queue: asyncio.Queue, hub: ProviderHub, provider, consumer_id: str
):
    """Generate SSE stream from provider response chunks."""
    token_count = 0
    start_time = time.time()
    outcome = "success"  # Track outcome for reputation
    try:
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=120.0)
            except asyncio.TimeoutError:
                # Send error and close
                outcome = "timeout"
                error_data = {
                    "error": {"message": "Provider timeout", "type": "timeout"}
                }
                yield f"data: {json.dumps(error_data)}\n\n"
                break

            if isinstance(msg, InferenceResponseChunk):
                token_count += 1
                chunk = {
                    "id": f"chatcmpl-{request_id[:8]}",
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": msg.token},
                            "finish_reason": msg.finish_reason,
                        }
                    ],
                }
                yield f"data: {json.dumps(chunk)}\n\n"

                if msg.finish_reason:
                    break

            elif isinstance(msg, InferenceDone):
                # Final chunk with finish_reason
                chunk = {
                    "id": f"chatcmpl-{request_id[:8]}",
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                }
                yield f"data: {json.dumps(chunk)}\n\n"
                break

            elif isinstance(msg, InferenceError):
                outcome = "disconnect" if msg.error == "provider_disconnected" else "error"
                error_data = {"error": {"message": msg.error, "type": "provider_error"}}
                yield f"data: {json.dumps(error_data)}\n\n"
                break

        yield "data: [DONE]\n\n"

        # Bill the request
        billing = get_billing()
        billing.charge_request(
            request_id=request_id,
            consumer_id=consumer_id,
            provider_id=provider.provider_id,
            model=model,
            input_tokens=_estimate_input_tokens(request.messages),  # Approximate; real counting would need tokenizer
            output_tokens=token_count,
            price_per_mtok_input=provider.capabilities.price_per_mtok_input,
            price_per_mtok_output=provider.capabilities.price_per_mtok_output,
        )

        # Record TPS measurement
        elapsed = time.time() - start_time
        if token_count > 0 and elapsed > 0:
            tps_tracker = get_tps_tracker()
            tps_tracker.record_request(
                provider_id=provider.provider_id,
                model=model,
                tokens=token_count,
                seconds=elapsed,
                hardware=provider.capabilities.hardware,
            )

        # Record reputation outcome
        reputation = get_reputation_tracker()
        elapsed_ms = int((time.time() - start_time) * 1000)
        if outcome == "success":
            reputation.record_success(provider.provider_id, tokens=token_count, latency_ms=elapsed_ms)
        elif outcome == "timeout":
            reputation.record_timeout(provider.provider_id)
        elif outcome == "disconnect":
            reputation.record_disconnect(provider.provider_id)
        elif outcome == "error":
            reputation.record_error(provider.provider_id)
    finally:
        hub.remove_response_queue(request_id)


async def _collect_response(
    request_id: str, model: str, queue: asyncio.Queue, hub: ProviderHub, provider, consumer_id: str
) -> dict:
    """Collect all tokens into a single non-streaming response."""
    tokens: list[str] = []
    start_time = time.time()
    outcome = "success"
    try:
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=120.0)
            except asyncio.TimeoutError:
                outcome = "timeout"
                # Record reputation before raising
                reputation = get_reputation_tracker()
                reputation.record_timeout(provider.provider_id)
                raise HTTPException(status_code=504, detail="Provider timeout")

            if isinstance(msg, InferenceResponseChunk):
                tokens.append(msg.token)
                if msg.finish_reason:
                    break
            elif isinstance(msg, InferenceDone):
                break
            elif isinstance(msg, InferenceError):
                outcome = "error"
                # Record reputation before raising
                reputation = get_reputation_tracker()
                reputation.record_error(provider.provider_id)
                raise HTTPException(status_code=502, detail=msg.error)
    finally:
        hub.remove_response_queue(request_id)

    # Bill the request
    billing = get_billing()
    billing.charge_request(
        request_id=request_id,
        consumer_id=consumer_id,
        provider_id=provider.provider_id,
        model=model,
        input_tokens=_estimate_input_tokens(request.messages),
        output_tokens=len(tokens),
        price_per_mtok_input=provider.capabilities.price_per_mtok_input,
        price_per_mtok_output=provider.capabilities.price_per_mtok_output,
    )

    # Record TPS
    elapsed = time.time() - start_time
    if len(tokens) > 0 and elapsed > 0:
        tps_tracker = get_tps_tracker()
        tps_tracker.record_request(
            provider_id=provider.provider_id,
            model=model,
            tokens=len(tokens),
            seconds=elapsed,
            hardware=provider.capabilities.hardware,
        )

    # Record reputation — success
    reputation = get_reputation_tracker()
    elapsed_ms = int((time.time() - start_time) * 1000)
    reputation.record_success(provider.provider_id, tokens=len(tokens), latency_ms=elapsed_ms)

    content = "".join(tokens)
    return {
        "id": f"chatcmpl-{request_id[:8]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": len(tokens), "total_tokens": 10 + len(tokens)},
    }
