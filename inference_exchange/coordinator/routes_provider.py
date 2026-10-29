"""Private provider account views and self-service enrollment (PROV-018)."""

import os
import threading
import time

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from inference_exchange.config import is_production

from .dependencies import get_hub, get_store
from .routes_auth import (
    InvalidCredentials, _check_not_suspended, resolve_user_from_request,
    verify_jwt, SESSION_COOKIE,
)
from .store import ProviderOwnershipError

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


# Enrollment checks use their own identity resolver. A browser cookie must not
# override an explicitly invalid Authorization header.
def _management_owner(request: Request, *, mutation: bool = False) -> str:
    auth = request.headers.get("authorization", "")
    if auth:
        if not auth.lower().startswith("bearer "):
            raise InvalidCredentials()
        raw = auth[7:].strip()
        if raw.startswith(("sk-ie-", "pt-ie-")):
            raise InvalidCredentials()
        user = verify_jwt(raw)
        if not user or get_store().get_session_version(user.get("user_id", "")) != user.get("sv", 0):
            raise InvalidCredentials()
    else:
        user = resolve_user_from_request(request)
        if not user:
            raise InvalidCredentials()
        if mutation:
            # No missing-Origin or Referer fallback for credential issuance.
            origin = request.headers.get("origin", "")
            public_origin = os.environ.get("IE_PUBLIC_URL", "").rstrip("/")
            if not public_origin and not is_production():
                public_origin = str(request.base_url).rstrip("/")
            if not public_origin or origin != public_origin:
                raise ProviderOwnershipError("CSRF check failed", 403)
    owner_id = _check_not_suspended(user["user_id"])
    if not get_store().is_github_linked_user(owner_id):
        raise ProviderOwnershipError("A linked GitHub identity is required", 403)
    return owner_id


class _EnrollmentRate:
    """Bound per-account and direct-peer admission without trusting forwarded IPs."""

    def __init__(self):
        self._lock = threading.Lock()
        self._attempts = {}

    def allow(self, owner_id: str, peer: str) -> bool:
        now = time.monotonic()
        with self._lock:
            for key, max_count in (("owner:" + owner_id, 6), ("peer:" + peer, 100)):
                history = [t for t in self._attempts.get(key, []) if t > now - 900]
                self._attempts[key] = history
                if len(history) >= max_count:
                    return False
            for key in ("owner:" + owner_id, "peer:" + peer):
                self._attempts[key].append(now)
        return True


def _error(exc: ProviderOwnershipError) -> JSONResponse:
    return JSONResponse({"error": str(exc)}, status_code=exc.status_code)


@router.post("/v1/provider/nodes")
async def enroll_provider_node(request: Request):
    owner_id = _management_owner(request, mutation=True)
    if os.environ.get("IE_PROVIDER_SELF_ENROLL_ENABLED", "0") != "1":
        return JSONResponse({"error": "Provider enrollment is not enabled"}, status_code=503)
    limiter = getattr(request.app.state, "provider_enrollment_limiter", None)
    if limiter is None:
        limiter = _EnrollmentRate()
        request.app.state.provider_enrollment_limiter = limiter
    if not limiter.allow(owner_id, request.client.host if request.client else "unknown"):
        return JSONResponse({"error": "Too many enrollment attempts"}, status_code=429)
    try:
        payload = await request.json()
        if not isinstance(payload, dict) or set(payload) != {"name", "profile"}:
            return JSONResponse({"error": "Invalid enrollment request"}, status_code=400)
        result = get_store().enroll_provider_node(owner_id, payload["name"], payload["profile"])
    except (ValueError, TypeError):
        return JSONResponse({"error": "Invalid enrollment request"}, status_code=400)
    except ProviderOwnershipError as exc:
        return _error(exc)
    return JSONResponse(result, status_code=201, headers={"Cache-Control": "no-store"})
