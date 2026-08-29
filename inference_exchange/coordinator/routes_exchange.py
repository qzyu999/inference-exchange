"""Exchange endpoints — providers, pricing, balance, stats, history, depth,
traces, tps, reputation, events, model search, and telemetry."""

import time

from fastapi import APIRouter, Request

from .dependencies import (
    _request_traces,
    get_auth,
    get_billing,
    get_event_bus,
    get_hub,
    get_reputation_tracker,
    get_tps_tracker,
)

router = APIRouter()


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


@router.get("/v1/exchange/events/recent")
async def get_recent_events():
    """Return the last 50 events for clients that missed real-time updates."""
    bus = get_event_bus()
    if bus is None:
        return {"events": []}
    return {"events": bus.recent_events(50)}


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
            "strategy": "GreedyStrategy",
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
