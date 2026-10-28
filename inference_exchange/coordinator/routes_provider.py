"""Read-only private provider account views (BILL-011, PRIV-009)."""

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from .dependencies import get_hub, get_store
from .routes_auth import InvalidCredentials, _check_not_suspended, resolve_user_from_request

router = APIRouter()


def _owner_id(request: Request) -> str:
    """Management uses IE browser/JWT identity, not consumer or provider API keys."""
    user = resolve_user_from_request(request)
    if not user:
        raise InvalidCredentials()
    return _check_not_suspended(user["user_id"])


@router.get("/v1/provider/nodes")
async def get_owned_nodes(request: Request):
    owner_id = _owner_id(request)
    nodes = get_store().list_owned_provider_nodes(owner_id)
    active = {}
    for provider in get_hub()._providers.values():
        # A principal may have several sessions. Show actual observed sessions.
        active.setdefault(provider.billing_account_id, []).append(provider)
    result = []
    for node in nodes:
        sessions = active.get(node["billing_account_id"], [])
        # Ignore an unbound or corrupted provider connection; only display
        # sessions with matching principal and an established node mapping.
        sessions = [
            p for p in sessions if get_store().get_provider_node_owner(
                node["node_id"], p.billing_account_id
            ) == owner_id
        ]
        live = sorted(sessions, key=lambda p: p.connected_at, reverse=True)
        p = live[0] if live else None
        result.append({
            "node_id": node["node_id"],
            "name": node["name"],
            "created_at": node["created_at"],
            "status": ("busy" if any(s.active_requests > 0 for s in live)
                       else "online" if live else "offline"),
            "active_connections": len(live),
            "models": list(p.capabilities.models) if p else [],
            "hardware_claim": p.capabilities.hardware if p else None,
            "claimed_trust_level": p.capabilities.trust_level.value if p else None,
            "verified_trust_level": p.verified_trust_level if p else None,
            "price_input_per_mtok": p.capabilities.price_per_mtok_input if p else None,
            "price_output_per_mtok": p.capabilities.price_per_mtok_output if p else None,
            "max_concurrent": p.capabilities.max_concurrent if p else None,
            "last_heartbeat": max((s.last_heartbeat for s in live), default=None),
        })
    return {"nodes": result, "simulated_credits": True}


@router.get("/v1/provider/earnings")
async def get_owned_earnings(
    request: Request,
    node_id: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=50, ge=1, le=100),
    before_id: int | None = Query(default=None, ge=1),
):
    owner_id = _owner_id(request)
    data = get_store().get_owned_provider_earnings(
        owner_id, node_id=node_id, limit=limit, before_id=before_id,
    )
    if data is None:
        # Do not reveal the existence or ownership of foreign node IDs.
        return JSONResponse({"error": "Provider node not found"}, status_code=404)
    return {"simulated_credits": True, "unit": "micro_usd", **data}
