"""Manages WebSocket connections to providers and routes requests."""

import asyncio
import logging
import time
from dataclasses import dataclass, field

from fastapi import WebSocket

from inference_exchange.shared.protocol import (
    HeartbeatMessage,
    InferenceDone,
    InferenceError,
    InferenceRequest,
    InferenceResponseChunk,
    MessageType,
    ProviderCapabilities,
    RegisterMessage,
)

logger = logging.getLogger(__name__)


@dataclass
class ConnectedProvider:
    """A provider currently connected via WebSocket."""

    provider_id: str
    name: str
    ws: WebSocket
    capabilities: ProviderCapabilities
    encryption_public_key: str = ""  # X25519 public key for E2E
    connected_at: float = field(default_factory=time.time)
    active_requests: int = 0
    last_heartbeat: float = field(default_factory=time.time)

    @property
    def load_factor(self) -> float:
        """0.0 = idle, 1.0 = fully loaded."""
        if self.capabilities.max_concurrent == 0:
            return 1.0
        return self.active_requests / self.capabilities.max_concurrent

    def score_for_request(self, model: str, preference: str = "balanced") -> float:
        """Higher score = better candidate for serving this request."""
        if model != "default" and model not in self.capabilities.models:
            return -1  # Can't serve this model

        if self.load_factor >= 1.0:
            return -1  # At capacity

        # Weights based on consumer preference
        if preference == "cheapest":
            w_price, w_speed, w_trust, w_load = 0.8, 0.05, 0.05, 0.1
        elif preference == "fastest":
            w_price, w_speed, w_trust, w_load = 0.05, 0.8, 0.05, 0.1
        elif preference == "most_secure":
            w_price, w_speed, w_trust, w_load = 0.05, 0.05, 0.8, 0.1
        else:  # balanced
            w_price, w_speed, w_trust, w_load = 0.3, 0.3, 0.2, 0.2

        # Price score: cheaper → higher (0 to 1)
        price = self.capabilities.price_per_mtok_output
        price_score = 1.0 / (1.0 + price)

        # Speed score: faster → higher (0 to ~1)
        tps = self.capabilities.measured_tps
        speed_score = tps / (10.0 + tps)

        # Trust score: higher confidence → higher (0 to 1)
        trust_map = {"open": 0, "contained": 0.25, "hardened": 0.5, "confidential": 0.75}
        trust_score = trust_map.get(self.capabilities.trust_level.value, 0)

        # Load score: less loaded → higher
        load_score = 1.0 - self.load_factor

        score = (
            w_price * price_score
            + w_speed * speed_score
            + w_trust * trust_score
            + w_load * load_score
        )
        return score


class ProviderHub:
    """Manages all connected providers and routes inference requests."""

    def __init__(self):
        self._providers: dict[str, ConnectedProvider] = {}
        # Maps request_id → asyncio.Queue for streaming responses back to consumer
        self._response_queues: dict[str, asyncio.Queue] = {}
        self._next_provider_id = 0

    @property
    def provider_count(self) -> int:
        return len(self._providers)

    @property
    def available_models(self) -> list[str]:
        """All models available across all connected providers."""
        models = set()
        for p in self._providers.values():
            models.update(p.capabilities.models)
        return sorted(models)

    def register_provider(self, ws: WebSocket, msg: RegisterMessage) -> str:
        """Register a new provider connection. Returns provider_id."""
        self._next_provider_id += 1
        provider_id = f"provider-{self._next_provider_id}"
        self._providers[provider_id] = ConnectedProvider(
            provider_id=provider_id,
            name=msg.provider_name,
            ws=ws,
            capabilities=msg.capabilities,
            encryption_public_key=msg.encryption_public_key,
        )
        encrypted_status = "🔐 E2E" if msg.encryption_public_key else "🔓 plaintext"
        logger.info(
            f"Provider registered: {msg.provider_name} ({provider_id}) "
            f"models={msg.capabilities.models} trust={msg.capabilities.trust_level} "
            f"[{encrypted_status}]"
        )
        return provider_id

    def disconnect_provider(self, provider_id: str):
        """Remove a provider on disconnect."""
        if provider_id in self._providers:
            name = self._providers[provider_id].name
            del self._providers[provider_id]
            logger.info(f"Provider disconnected: {name} ({provider_id})")

    def select_provider(
        self, model: str, preference: str = "balanced",
        min_confidence: str = "open", max_price: float | None = None,
    ) -> ConnectedProvider | None:
        """Pick the best available provider for a request with consumer preferences."""
        # Map confidence strings to numeric values for comparison
        confidence_map = {"open": 0, "contained": 1, "hardened": 2, "confidential": 3}
        min_conf_val = confidence_map.get(min_confidence, 0)

        best: ConnectedProvider | None = None
        best_score = -1.0

        for provider in self._providers.values():
            score = provider.score_for_request(model, preference)
            if score < 0:
                continue

            # Hard constraint: minimum confidence level
            provider_conf = confidence_map.get(provider.capabilities.trust_level.value, 0)
            if provider_conf < min_conf_val:
                continue

            # Hard constraint: max price
            if max_price is not None and provider.capabilities.price_per_mtok_output > max_price:
                continue

            if score > best_score:
                best_score = score
                best = provider

        return best

    def create_response_queue(self, request_id: str) -> asyncio.Queue:
        """Create a queue for streaming response chunks back to the consumer."""
        queue: asyncio.Queue = asyncio.Queue()
        self._response_queues[request_id] = queue
        return queue

    def remove_response_queue(self, request_id: str):
        """Clean up after request completes."""
        self._response_queues.pop(request_id, None)

    async def send_to_provider(self, provider: ConnectedProvider, request: InferenceRequest):
        """Send an inference request to a provider."""
        provider.active_requests += 1
        await provider.ws.send_json(request.model_dump())

    def handle_provider_message(self, provider_id: str, data: dict):
        """Process a message from a provider and route to the correct response queue."""
        msg_type = data.get("type")
        request_id = data.get("request_id")

        if not request_id or request_id not in self._response_queues:
            return

        queue = self._response_queues[request_id]

        if msg_type == MessageType.INFERENCE_RESPONSE:
            chunk = InferenceResponseChunk(**data)
            queue.put_nowait(chunk)

        elif msg_type == MessageType.INFERENCE_DONE:
            done = InferenceDone(**data)
            queue.put_nowait(done)
            # Decrement active requests
            if provider_id in self._providers:
                self._providers[provider_id].active_requests = max(
                    0, self._providers[provider_id].active_requests - 1
                )

        elif msg_type == MessageType.INFERENCE_ERROR:
            error = InferenceError(**data)
            queue.put_nowait(error)
            if provider_id in self._providers:
                self._providers[provider_id].active_requests = max(
                    0, self._providers[provider_id].active_requests - 1
                )

    def handle_heartbeat(self, provider_id: str, msg: HeartbeatMessage):
        """Update provider state from heartbeat."""
        if provider_id in self._providers:
            provider = self._providers[provider_id]
            provider.active_requests = msg.active_requests
            provider.last_heartbeat = time.time()
