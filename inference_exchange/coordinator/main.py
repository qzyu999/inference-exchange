"""Coordinator entrypoint — FastAPI app with WebSocket provider hub."""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from inference_exchange.config import CoordinatorConfig
from inference_exchange.shared.protocol import (
    AttestationResponse,
    HeartbeatMessage,
    MessageType,
    RegisteredMessage,
    RegisterMessage,
)

from .dependencies import set_auth, set_billing, set_event_bus, set_hub, set_reputation, set_store, set_tps_tracker, set_audit_log
from .audit_log import AuditLog
from .routes_admin import router as admin_router
from .routes_auth import router as auth_router
from .routes_exchange import router as exchange_router
from .routes_inference import router as inference_router
from .event_bus import EventBus
from .model_registry import ModelRegistry
from .provider_hub import ProviderHub
from .reputation import ReputationTracker
from .store import Store
from .tps_tracker import TPSTracker

STATIC_DIR = Path(__file__).parent / "static"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


class StoreAuthAdapter:
    """Adapts Store to the AuthStore interface expected by api.py."""

    def __init__(self, store: Store):
        self._store = store

    @property
    def default_key(self) -> str:
        return self._store.default_key

    def create_key(self, name: str = "API Key") -> tuple[str, str]:
        return self._store.create_api_key(name)

    def validate_key(self, raw_key: str):
        return self._store.validate_key(raw_key)

    def resolve_consumer(self, authorization: str | None) -> str:
        return self._store.resolve_consumer(authorization)

    def list_keys(self) -> list[dict]:
        return self._store.list_keys()

    # For admin state access
    @property
    def _keys_by_hash(self):
        """Compatibility: return count for admin endpoint."""
        return self._store.list_keys()


class StoreBillingAdapter:
    """Adapts Store to the BillingLedger interface expected by api.py."""

    def __init__(self, store: Store):
        self._store = store

    PLATFORM_FEE_PERCENT = 10

    def get_or_create_consumer(self, consumer_id: str, name: str = "Consumer"):
        return self._store.get_or_create_account(consumer_id, name)

    def get_or_create_provider(self, provider_id: str, name: str = "Provider"):
        return self._store.get_or_create_account(provider_id, name)

    def charge_request(self, **kwargs):
        return self._store.charge_request(**kwargs)

    @property
    def recent_bills(self) -> list:
        """Return recent transactions as objects with expected attributes."""
        rows = self._store.recent_transactions(50)
        # Convert dicts to objects with attribute access
        class Bill:
            def __init__(self, d):
                for k, v in d.items():
                    setattr(self, k, v)
        return [Bill(r) for r in reversed(rows)]

    @property
    def total_requests(self) -> int:
        return self._store.billing_summary()["total_requests"]

    def summary(self) -> dict:
        return self._store.billing_summary()

    # For admin state access
    @property
    def _accounts(self):
        """Return accounts as a dict-like for admin endpoint."""
        accounts = self._store.list_accounts()
        class Acc:
            def __init__(self, d):
                for k, v in d.items():
                    setattr(self, k, v)
                self.balance_usd = d["balance_micro"] / 1_000_000
                self.total_spent_usd = d["total_spent_micro"] / 1_000_000
                self.total_earned_usd = d["total_earned_micro"] / 1_000_000
        return {a["account_id"]: Acc(a) for a in accounts}


def verify_model_hash(registry: ModelRegistry, reg: RegisterMessage) -> bool:
    """Verify provider's model file hash against HuggingFace's published hashes.

    Returns True if verification passed (or was skipped due to missing data).
    """
    identity = reg.model_identity
    if not identity:
        logger.info("No model_identity in registration — skipping hash verification")
        return False

    file_hash = identity.get("file_hash", "")
    model_name = identity.get("name", "")
    if not file_hash or file_hash.startswith("skipped-"):
        logger.info(f"No usable file hash for {model_name} — skipping verification")
        return False

    # Check each advertised model against known HF hashes
    for model in reg.capabilities.models:
        if model == "default":
            continue
        pm = registry.register_provider_model(
            provider_id="pending",  # Will be updated after registration
            model_name=model,
            file_hash=file_hash,
        )
        if pm.verified:
            logger.info(f"✅ Model hash verified via HuggingFace: {model}")
            return True

    # Try a direct HF lookup for the model's repo if we don't have it cached
    repo_id = identity.get("repo_id", "")
    filename = identity.get("filename", "")
    if repo_id and filename:
        hf_info = registry.register_model_from_hf(repo_id, filename)
        if hf_info and hf_info.sha256 and hf_info.sha256 == file_hash:
            logger.info(f"✅ Model hash verified via HuggingFace lookup: {repo_id}/{filename}")
            return True

    logger.warning(f"⚠️  Could not verify model hash for {model_name}")
    return False


async def attestation_challenge_loop(hub: ProviderHub):
    """Background task: send attestation challenges to all providers every 5 minutes."""
    CHALLENGE_INTERVAL = 300  # 5 minutes
    TIMEOUT_CHECK_INTERVAL = 10  # Check for timeouts every 10 seconds
    CHALLENGE_TIMEOUT = 30  # 30 seconds to respond

    while True:
        try:
            # Send challenges to all connected providers
            for provider in list(hub._providers.values()):
                if provider.pending_challenge_nonce is None:
                    try:
                        await hub.send_attestation_challenge(provider)
                    except Exception as e:
                        logger.warning(f"Failed to send attestation challenge to {provider.name}: {e}")

            # Wait for the interval, checking timeouts periodically
            elapsed = 0.0
            while elapsed < CHALLENGE_INTERVAL:
                await asyncio.sleep(TIMEOUT_CHECK_INTERVAL)
                elapsed += TIMEOUT_CHECK_INTERVAL
                hub.check_attestation_timeouts(timeout_seconds=CHALLENGE_TIMEOUT)

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Attestation loop error: {e}")
            await asyncio.sleep(60)


def create_app() -> FastAPI:
    # SQLite-backed store (persists across restarts)
    store = Store()
    hub = ProviderHub()
    auth = StoreAuthAdapter(store)
    billing = StoreBillingAdapter(store)
    tps_tracker = TPSTracker()
    reputation = ReputationTracker()
    model_registry = ModelRegistry()
    event_bus = EventBus()

    set_hub(hub)
    set_billing(billing)
    set_auth(auth)
    set_tps_tracker(tps_tracker)
    set_reputation(reputation)
    set_event_bus(event_bus)
    set_store(store)

    audit_log = AuditLog()
    set_audit_log(audit_log)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Start attestation challenge background task
        task = asyncio.create_task(attestation_challenge_loop(hub))
        logger.info("Attestation challenge loop started (interval=5m, timeout=30s)")
        yield
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    app = FastAPI(
        title="Inference Exchange",
        description="Decentralized private inference marketplace",
        version="0.1.0",
        lifespan=lifespan,
    )

    # CORS: allow same-origin + configured origins
    ALLOWED_ORIGINS = {"http://localhost:3000", "http://localhost:8000"}
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(ALLOWED_ORIGINS),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # CSRF protection: on state-changing requests with cookies, verify Origin
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.responses import JSONResponse as StarletteJSONResponse

    class CSRFMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            if request.method in ("POST", "PUT", "DELETE", "PATCH"):
                # Only check if the request uses cookie auth (has ie_session cookie)
                if "ie_session" in request.cookies:
                    origin = request.headers.get("origin", "")
                    referer = request.headers.get("referer", "")
                    # Allow if origin matches, or referer starts with allowed origin, or no origin (same-origin)
                    if origin and origin not in ALLOWED_ORIGINS:
                        if not any(referer.startswith(o) for o in ALLOWED_ORIGINS):
                            return StarletteJSONResponse(
                                {"error": "CSRF check failed"}, status_code=403
                            )
            return await call_next(request)

    app.add_middleware(CSRFMiddleware)

    # Mount consumer API routers
    app.include_router(auth_router)
    app.include_router(exchange_router)
    app.include_router(admin_router)
    app.include_router(inference_router)

    # Provider WebSocket endpoint
    WS_MAX_MESSAGE_SIZE = 1_000_000  # 1MB max per WS message
    WS_IDLE_TIMEOUT = 300  # 5 min idle = disconnect

    @app.websocket("/ws/provider")
    async def provider_websocket(ws: WebSocket):
        await ws.accept()
        provider_id: str | None = None

        # Authenticate provider via token (query param or first-message field)
        token = ws.query_params.get("token", "")
        if token:
            token_info = store.validate_provider_token(token)
            if not token_info:
                await ws.close(code=4003, reason="Invalid provider token")
                return
            logger.info(f"Provider authenticated: {token_info['name']} ({token_info['token_id']})")
        else:
            # Allow unauthenticated in dev mode (no tokens exist yet)
            token_count = len(store.list_provider_tokens())
            if token_count > 0:
                await ws.close(code=4003, reason="Provider token required. Create one via POST /v1/admin/provider-tokens")
                return
            # No tokens created yet -- open access (dev mode)

        try:
            # First message must be a registration
            raw = await ws.receive_text()
            data = json.loads(raw)

            if data.get("type") != MessageType.REGISTER:
                await ws.close(code=4001, reason="First message must be register")
                return

            reg = RegisterMessage(**data)
            provider_id = hub.register_provider(ws, reg)

            # Send registration confirmation
            confirmed = RegisteredMessage(
                provider_id=provider_id,
                confidence_level=reg.capabilities.trust_level.value,
            )
            await ws.send_json(confirmed.model_dump())

            # HF hash verification
            model_verified = verify_model_hash(model_registry, reg)
            if provider_id in hub._providers:
                hub._providers[provider_id].model_verified = model_verified

            # Create billing account + log connection
            billing.get_or_create_provider(provider_id, reg.provider_name)
            store.log_provider_connect(
                provider_id, reg.provider_name,
                reg.capabilities.hardware,
                reg.capabilities.trust_level.value,
                reg.capabilities.price_per_mtok_output,
                reg.capabilities.measured_tps,
            )

            # Publish provider_connect event
            event_bus.publish({
                "type": "provider_connect",
                "provider": reg.provider_name,
                "provider_id": provider_id,
                "models": reg.capabilities.models,
                "trust_level": reg.capabilities.trust_level.value,
            })

            # Main message loop
            while True:
                try:
                    raw = await asyncio.wait_for(ws.receive_text(), timeout=WS_IDLE_TIMEOUT)
                except asyncio.TimeoutError:
                    logger.warning(f"Provider {provider_id}: idle timeout ({WS_IDLE_TIMEOUT}s), disconnecting")
                    break
                if len(raw) > WS_MAX_MESSAGE_SIZE:
                    logger.warning(f"Provider {provider_id}: message too large ({len(raw)} bytes)")
                    continue
                data = json.loads(raw)
                msg_type = data.get("type")

                if msg_type == MessageType.HEARTBEAT:
                    hb = HeartbeatMessage(**data)
                    hub.handle_heartbeat(provider_id, hb)

                elif msg_type == MessageType.ATTESTATION_RESPONSE:
                    hub.handle_attestation_response(provider_id, data)
                    # Publish attestation event
                    if provider_id in hub._providers:
                        p = hub._providers[provider_id]
                        event_bus.publish({
                            "type": "attestation",
                            "provider": p.name,
                            "provider_id": provider_id,
                            "status": p.attestation_status,
                        })
                        # Audit log
                        resp = AttestationResponse(**data)
                        audit_log.log_attestation(
                            provider_id=provider_id,
                            provider_name=p.name,
                            status=p.attestation_status,
                            sip_enabled=resp.sip_enabled,
                            hardened_runtime=resp.hardened_runtime,
                            pt_deny_attach=resp.pt_deny_attach,
                            agent_hash=resp.agent_binary_hash,
                            server_hash=resp.server_binary_hash,
                            platform=resp.platform,
                        )

                elif msg_type in (
                    MessageType.INFERENCE_RESPONSE,
                    MessageType.INFERENCE_DONE,
                    MessageType.INFERENCE_ERROR,
                ):
                    hub.handle_provider_message(provider_id, data)

                else:
                    logger.warning(f"Unknown message type from {provider_id}: {msg_type}")

        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.error(f"Provider WebSocket error: {e}")
        finally:
            if provider_id:
                name = hub._providers[provider_id].name if provider_id in hub._providers else provider_id
                hub.disconnect_provider(provider_id)
                store.log_provider_disconnect(provider_id)
                event_bus.publish({
                    "type": "provider_disconnect",
                    "provider": name,
                    "provider_id": provider_id,
                })

    # Dashboard real-time event feed
    @app.websocket("/ws/events")
    async def events_websocket(ws: WebSocket):
        await ws.accept()
        queue = event_bus.subscribe()
        try:
            while True:
                event = await queue.get()
                await ws.send_json(event)
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            event_bus.unsubscribe(queue)

    # Health / info endpoints
    @app.get("/health")
    async def health(raw_request: Request):
        result = {
            "status": "ok",
            "providers": hub.provider_count,
            "models": hub.available_models,
        }
        if raw_request.query_params.get("include_key") == "1":
            result["default_api_key"] = auth.default_key
        return result

    @app.get("/readiness")
    async def readiness():
        """Readiness probe for orchestrators (Fly.io, k8s)."""
        return {"ready": True, "providers": hub.provider_count}

    # Alpha-only: reset balance (dummy money)
    @app.post("/v1/auth/reset-balance")
    async def reset_balance(raw_request: Request):
        """Reset the authenticated user's balance to $10 (alpha only, dummy money)."""
        from .routes_auth import resolve_user_from_request
        user_info = resolve_user_from_request(raw_request)
        if user_info:
            consumer_id = user_info["user_id"]
        else:
            consumer_id = auth.resolve_consumer(raw_request.headers.get("authorization"))
        store._conn.execute(
            "UPDATE accounts SET balance_micro = ? WHERE account_id = ?",
            (10 * 1_000_000, consumer_id),
        )
        store._conn.commit()
        return {"ok": True, "balance_usd": 10.0, "note": "Balance reset to $10.00 (alpha dummy credits)"}

    # Serve web UI at root
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

    return app


def main():
    config = CoordinatorConfig()
    logger.info(f"Starting Inference Exchange coordinator on {config.host}:{config.port}")
    app = create_app()
    uvicorn.run(
        app,
        host=config.host,
        port=config.port,
        timeout_graceful_shutdown=10,  # 10s drain for in-flight requests
    )


if __name__ == "__main__":
    main()
