"""Exchange endpoints — providers, pricing, balance, stats, history, depth,
traces, tps, reputation, events, model search, and telemetry."""

import time

from fastapi import APIRouter, Request

from .dependencies import (
    get_auth,
    get_billing,
    get_event_bus,
    get_hub,
    get_price_collector,
    get_reputation_tracker,
    get_tps_tracker,
    traces_for,
)
from .event_bus import public_event

router = APIRouter()


def trust_record(p) -> dict:
    """Claimed vs verified trust, kept separate so clients never mistake a claim for evidence."""
    verified = p.verified_trust_level
    return {"claimed": p.capabilities.trust_level.value, "verified": verified, "basis": "attested" if verified else "self_reported"}


@router.get("/v1/models")
async def list_models():
    """List available models (OpenAI-compatible).

    Only returns real model names from connected providers.
    'default' is a routing hint, not a model — handled by the chat UI.
    """
    hub = get_hub()
    models = [m for m in hub.available_models if m != "default"]
    return {
        "object": "list",
        "data": [{"id": m, "object": "model", "owned_by": "inference-exchange"} for m in models],
    }


@router.get("/v1/encryption-key")
async def get_encryption_key():
    """Public coordinator encryption key (for optional sender-side sealing)."""
    # In coordinator-terminated mode, the coordinator has a long-lived X25519 key
    # For now, return a placeholder indicating E2E is provider-direct only
    return {
        "mode": "provider-direct",
        "note": "E2E encryption is per-provider. Provider keys are in /v1/exchange/providers.",
        "algorithm": "x25519-xsalsa20-poly1305",
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
            "trust": trust_record(p),
            "hardware": p.capabilities.hardware,
            "price_input": p.capabilities.price_per_mtok_input,
            "price_output": p.capabilities.price_per_mtok_output,
            "price_cache": p.capabilities.price_per_mtok_cache,
            "measured_tps": p.capabilities.measured_tps,
            "load": round(p.load_factor, 2),
            "active_requests": p.active_requests,
            "max_concurrent": p.capabilities.max_concurrent,
            "status": "online",
            "encrypted": bool(p.encryption_public_key),
            "encryption_public_key": p.encryption_public_key or None,
            "uptime_seconds": int(time.time() - p.connected_at),
            "model_capabilities": {
                "context_length": p.model_capabilities.context_length,
                "supports_tool_calling": p.model_capabilities.supports_tool_calling,
                "supports_vision": p.model_capabilities.supports_vision,
                "architecture": p.model_capabilities.architecture,
                "model_format": p.model_capabilities.model_format,
            },
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


@router.get("/v1/exchange/billing-config")
async def get_billing_config():
    """Public billing rules, so the UI does not hard-code them (BILL-009)."""
    from .store import MIN_CHARGE_MICRO, Store
    from inference_exchange.config import is_production

    return {
        "allow_balance_reset": not is_production(),
        "minimum_charge_micro": MIN_CHARGE_MICRO,
        "minimum_charge_usd": MIN_CHARGE_MICRO / 1_000_000,
        "platform_fee_percent": Store.PLATFORM_FEE_PERCENT,
        "simulated_credits": True,  # alpha: no real payments
    }


@router.get("/v1/exchange/balance")
async def get_balance(request: Request):
    """Get consumer account balance."""
    from .routes_auth import resolve_private_caller

    billing = get_billing()
    consumer_id = resolve_private_caller(request)

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


def _minimum_applied(row: dict) -> bool:
    """True if the per-request minimum (BILL-004) set the charge, not the token prices."""
    from .store import MIN_CHARGE_MICRO

    token_cost = row.get("cost_input_micro", 0) + row.get("cost_output_micro", 0) + row.get("cost_cache_micro", 0)
    return row["cost_micro"] == MIN_CHARGE_MICRO and token_cost < MIN_CHARGE_MICRO


@router.get("/v1/exchange/history")
async def get_history(request: Request):
    """Recent transaction history (filtered by authenticated user)."""
    from .routes_auth import resolve_private_caller
    from .dependencies import get_store

    store = get_store()
    consumer_id = resolve_private_caller(request)

    # Fetch per-user transactions
    rows = store.list_consumer_transactions(consumer_id, limit=50)

    return {
        "transactions": [
            {
                "request_id": dict(r)["request_id"][:8],
                "full_request_id": dict(r)["request_id"],
                "model": dict(r)["model"],  # legacy requested model
                "requested_model": dict(r).get("requested_model") or dict(r)["model"],
                "served_model": dict(r).get("served_model"),
                "provider_name": dict(r).get("provider_name", ""),
                "input_tokens": dict(r)["input_tokens"],
                "output_tokens": dict(r)["output_tokens"],
                "cached_tokens": dict(r).get("cached_tokens", 0),
                "tokens": dict(r)["input_tokens"] + dict(r)["output_tokens"],
                "cost_usd": round(dict(r)["cost_micro"] / 1_000_000, 6),
                # BILL-009: exact integer amounts, so clients sum without float drift
                "cost_micro": dict(r)["cost_micro"],
                "provider_earning_micro": dict(r)["provider_earning_micro"],
                "platform_fee_micro": dict(r)["platform_fee_micro"],
                "minimum_applied": _minimum_applied(dict(r)),
                "cost_input_usd": round(dict(r).get("cost_input_micro", 0) / 1_000_000, 6),
                "cost_output_usd": round(dict(r).get("cost_output_micro", 0) / 1_000_000, 6),
                "cost_cache_usd": round(dict(r).get("cost_cache_micro", 0) / 1_000_000, 6),
                "trust_level": dict(r).get("trust_level", ""),
                "encrypted": bool(dict(r).get("encrypted", 0)),
                "preference": dict(r).get("preference", ""),
                "latency_ms": dict(r).get("latency_ms", 0),
                "tps": dict(r).get("tps", 0),
                "queued": bool(dict(r).get("queued", 0)),
                "queue_wait_ms": dict(r).get("queue_wait_ms", 0),
                "timestamp": dict(r)["timestamp"],
            }
            for r in rows
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
async def get_traces(request: Request):
    """Caller's own decision traces (admins see all)."""
    from .routes_auth import is_admin_request, resolve_private_caller
    consumer_id = resolve_private_caller(request)  # deny anonymous access to private traces in prod
    if is_admin_request(request):
        return {"traces": traces_for(None)}
    return {"traces": traces_for(consumer_id)}


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
    return {"events": [public_event(e) for e in bus.recent_events(50)]}


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


@router.get("/v1/exchange/market")
async def get_market_data(request: Request):
    """Live market grouped by the same exact identity as the published catalog."""
    from .reference_pricing import compute_savings
    hub = get_hub()
    cache = request.app.state.ticker_cache
    resolver = cache.resolver()
    providers = hub._providers
    view = cache.catalog(providers.values(), ie_only=True, limit=20000)
    result = []
    for model in view["models"]:
        rows = []
        capabilities = None
        for offer in model["offers"]:
            if not offer.get("ie"):
                continue
            provider = providers[offer["provider_id"]]
            caps = provider.model_capabilities
            if capabilities is None and caps.context_length > 0:
                capabilities = {key: getattr(caps, key) for key in
                    ("context_length", "supports_vision", "supports_tool_calling", "architecture", "model_type")}
            rows.append({
                "id": provider.provider_id, "name": provider.name,
                "price_output": float(offer["output"]), "price_input": float(offer["input"]),
                "price_cache": float(offer["cache_read"]), "tps": provider.capabilities.measured_tps,
                "trust": provider.capabilities.trust_level.value,
                "encrypted": bool(provider.encryption_public_key), "load": round(provider.load_factor, 2),
                "hardware": provider.capabilities.hardware,
                "slots": f"{provider.active_requests}/{provider.capabilities.max_concurrent}",
                "quantization": offer.get("quantization") or "", "context_length": caps.context_length,
                "format": caps.model_format, "verified": offer["artifact_verification"] == "verified",
                "artifact_verification": offer["artifact_verification"],
                "identity_source": offer["identity_source"], "identity_trust": offer["identity_trust"],
                "original_model": offer["original_model"],
            })
        rows.sort(key=lambda p: p["price_output"])
        cheapest = rows[0]
        trust_order = ["open", "contained", "hardened", "confidential"]
        count = model.get("total_parameters")
        data = {"model": model["name"], "family": model.get("family") or "",
                "size": f"{count / 1_000_000_000:g}B" if count is not None else "",
                "variant": " ".join(model.get("variant_tags") or []), "canonical_id": model["id"],
                "total_parameters": count, "active_parameters": model.get("active_parameters"),
                "variant_tags": model.get("variant_tags"), "release": model.get("release"),
                "capabilities": capabilities or {"context_length": 0, "supports_vision": False,
                    "supports_tool_calling": False, "architecture": "", "model_type": ""},
                "providers": rows, "provider_count": len(rows), "cheapest_output": cheapest["price_output"],
                "fastest_tps": max(p["tps"] for p in rows),
                "max_trust": max((p["trust"] for p in rows), key=lambda t: trust_order.index(t)),
                "reference_prices": compute_savings(cheapest["price_output"], model["id"],
                    cheapest["price_input"], cheapest["price_cache"], resolver=resolver,
                    quantization=cheapest["quantization"], context_length=cheapest["context_length"])["comparisons"]}
        result.append(data)
    result.sort(key=lambda m: -m["provider_count"])
    return {"models": result, "total_providers": len({p["id"] for m in result for p in m["providers"]}),
            "total_models": len(result)}


@router.get("/v1/exchange/provider-earnings")
async def get_provider_earnings(request: Request):
    """Provider earnings summary. Query by provider_id or get all. Admin only until provider accounts exist (#53)."""
    from .dependencies import get_store
    from .routes_auth import admin_required_response, is_admin_request
    if not is_admin_request(request):
        return admin_required_response()
    store = get_store()

    provider_id = request.query_params.get("provider_id", "")
    return store.admin_provider_earnings(provider_id)

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


@router.get("/v1/exchange/reference-prices")
async def get_reference_prices(request: Request, model: str = "", source: str = ""):
    """Current quotes grouped only by exact catalog or unresolved raw source IDs."""
    from .model_facets import facets_from_identity, public_facets
    cache = request.app.state.ticker_cache
    resolver = cache.resolver()
    collector = get_price_collector()
    groups = {}
    for entry in collector.get_all_current() if collector else []:
        if source and source != entry.source:
            continue
        key = resolver.external(entry.source, entry.model_id)
        catalog_model = resolver.models.get(key)
        facets = facets_from_identity({"name": entry.display_name}, catalog_model=catalog_model,
                                     family_labels=resolver.family_labels)
        group = groups.setdefault(key, {"family_key": key, "display_name": facets.display_name,
                                       **public_facets(facets), "prices": []})
        group["prices"].append({"source": entry.source, "model_id": entry.model_id,
            "display_name": entry.display_name, "price_input": entry.input_per_mtok,
            "price_output": entry.output_per_mtok, "price_cache_read": entry.cache_per_mtok,
            "price_cache_write": entry.cache_write_per_mtok, "context_length": entry.context_length,
            "comparison_type": "same_model" if catalog_model else "unmapped",
            "quantization": entry.quantization or None, "intelligence_index": entry.intelligence_index,
            "coding_index": entry.coding_index})
    if not source or source == "inference-exchange":
        for local in (await get_market_data(request))["models"]:
            key = local["canonical_id"]
            group = groups.setdefault(key, {"family_key": key, "display_name": local["model"],
                "family": local["family"], "total_parameters": local["total_parameters"], "prices": []})
            for provider in local["providers"]:
                group["prices"].append({"source": "inference-exchange", "model_id": provider["original_model"],
                    "display_name": local["model"], "price_input": provider["price_input"],
                    "price_output": provider["price_output"], "price_cache_read": provider["price_cache"],
                    "context_length": provider["context_length"], "quantization": provider["quantization"],
                    "comparison_type": "same_model", "identity_source": provider["identity_source"],
                    "identity_trust": provider["identity_trust"]})
    result = []
    for group in groups.values():
        if model.casefold() not in (group["family_key"] + " " + group["display_name"] + " " + (group.get("family") or "")).casefold():
            continue
        group["prices"].sort(key=lambda p: p["price_output"])
        group["provider_count"] = len(group["prices"])
        result.append(group)
    result.sort(key=lambda m: -m["provider_count"])
    return {"models": result, "sources": sorted({p["source"] for m in result for p in m["prices"]}),
            "last_updated": collector.get_sources_metadata() if collector else {}}


@router.get("/v1/exchange/reference-prices/history")
async def get_reference_price_history(family_key: str = "", days: int = 30):
    """Historical reference prices from SQLite for trend charts.

    Returns daily price snapshots grouped by source.

    Query params:
    - family_key: model family (e.g. "llama-8b-instruct"). Required.
    - days: how many days of history (default 30, max 90)
    """
    from .dependencies import get_store

    if not family_key:
        return {"error": "family_key parameter required", "hint": "e.g. ?family_key=llama-8b-instruct"}

    days = min(days, 90)
    store = get_store()
    cutoff = time.time() - (days * 86400)

    rows = store.list_reference_price_history(family_key, cutoff)

    # Group by date and source — one price per source per day (latest that day)
    from collections import defaultdict
    daily: dict[str, dict[str, dict]] = defaultdict(dict)

    for row in rows:
        r = dict(row)
        date = time.strftime("%Y-%m-%d", time.gmtime(r["fetched_at"]))
        src = r["source"]
        # Keep latest entry per day per source
        daily[date][src] = {
            "input": round(r["input_per_mtok"], 6),
            "output": round(r["output_per_mtok"], 6),
        }

    history = [
        {"date": date, "prices": prices}
        for date, prices in sorted(daily.items())
    ]

    return {
        "family_key": family_key,
        "days": days,
        "data_points": len(history),
        "history": history,
    }


@router.get("/v1/exchange/country-activity")
async def country_activity():
    """Public, suppressed country totals for the previous UTC day. No trace links."""
    from .country_activity import activity
    return activity.snapshot()


@router.get("/v1/exchange/usage")
async def get_usage(request: Request):
    from .routes_auth import resolve_private_caller
    from .dependencies import get_store
    return get_store().consumer_usage(resolve_private_caller(request))


@router.get("/v1/exchange/activity/recent")
async def get_recent_activity(request: Request):
    from .routes_auth import resolve_private_caller, is_admin_request
    from .dependencies import get_store
    from .country_activity import enabled
    caller = resolve_private_caller(request)
    admin = is_admin_request(request)
    rows = get_store().request_outcomes(None if admin else caller, 30, completed=True)
    # Disabling collection also hides retained location metadata.
    if not enabled():
        rows = [{**row, "provider_country": None, "caller_country": None} for row in rows]
    return {"scope": "exchange" if admin else "your_account", "retention_days": 7, "limit": 30, "enabled": enabled(), "requests": rows}


@router.get("/v1/exchange/traces/{request_id}")
async def get_trace(request_id: str, request: Request):
    from fastapi import HTTPException
    from .routes_auth import resolve_private_caller, is_admin_request
    from .dependencies import get_store
    caller = resolve_private_caller(request)
    trace = get_store().request_outcome(request_id, None if is_admin_request(request) else caller)
    if trace is None:
        raise HTTPException(status_code=404, detail="Request trace not found in retained history")
    return {"trace": trace}


@router.get("/v1/exchange/activity/network")
async def get_network_activity():
    """Shared account-free activity. Exact traces remain owner/admin only."""
    from .dependencies import get_store
    from .country_activity import enabled
    return get_store().public_network_activity(geography_enabled=enabled())


@router.get("/v1/exchange/catalog")
async def catalog(request: Request, q: str = "", ie_only: bool = False, offset: int = 0, limit: int = 100):
    """Public advertised prices and live IE offers. No account data."""
    return request.app.state.ticker_cache.catalog(
        get_hub()._providers.values(), query=q[:200], ie_only=ie_only,
        offset=max(0, offset), limit=max(1, min(limit, 100)))


@router.get("/v1/exchange/catalog/history")
async def catalog_history(request: Request, model: str = ""):
    return request.app.state.ticker_cache.history(model)
