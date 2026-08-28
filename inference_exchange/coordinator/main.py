"""Coordinator entrypoint — FastAPI app with WebSocket provider hub."""

import json
import logging
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from inference_exchange.config import CoordinatorConfig
from inference_exchange.shared.protocol import HeartbeatMessage, MessageType, RegisterMessage

from .api import router, set_auth, set_billing, set_hub
from .provider_hub import ProviderHub
from .store import Store

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


def create_app() -> FastAPI:
    app = FastAPI(
        title="Inference Exchange",
        description="Decentralized private inference marketplace",
        version="0.1.0",
    )

    # SQLite-backed store (persists across restarts)
    store = Store()

    hub = ProviderHub()
    auth = StoreAuthAdapter(store)
    billing = StoreBillingAdapter(store)
    set_hub(hub)
    set_billing(billing)
    set_auth(auth)

    # Mount consumer API
    app.include_router(router)

    # Provider WebSocket endpoint
    @app.websocket("/ws/provider")
    async def provider_websocket(ws: WebSocket):
        await ws.accept()
        provider_id: str | None = None

        try:
            # First message must be a registration
            raw = await ws.receive_text()
            data = json.loads(raw)

            if data.get("type") != MessageType.REGISTER:
                await ws.close(code=4001, reason="First message must be register")
                return

            reg = RegisterMessage(**data)
            provider_id = hub.register_provider(ws, reg)

            # Create billing account + log connection
            billing.get_or_create_provider(provider_id, reg.provider_name)
            store.log_provider_connect(
                provider_id, reg.provider_name,
                reg.capabilities.hardware,
                reg.capabilities.trust_level.value,
                reg.capabilities.price_per_mtok_output,
                reg.capabilities.measured_tps,
            )

            # Main message loop
            while True:
                raw = await ws.receive_text()
                data = json.loads(raw)
                msg_type = data.get("type")

                if msg_type == MessageType.HEARTBEAT:
                    hb = HeartbeatMessage(**data)
                    hub.handle_heartbeat(provider_id, hb)

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
                hub.disconnect_provider(provider_id)
                store.log_provider_disconnect(provider_id)

    # Health / info endpoints
    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "providers": hub.provider_count,
            "models": hub.available_models,
            "default_api_key": auth.default_key,
            "db": str(store._db_path),
        }

    # Serve web UI at root
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

    return app


def main():
    config = CoordinatorConfig()
    logger.info(f"Starting Inference Exchange coordinator on {config.host}:{config.port}")
    app = create_app()
    uvicorn.run(app, host=config.host, port=config.port)


if __name__ == "__main__":
    main()
