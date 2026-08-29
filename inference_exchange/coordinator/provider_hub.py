"""Manages WebSocket connections to providers and routes requests."""

import asyncio
import logging
import secrets
import time
from dataclasses import dataclass, field

from fastapi import WebSocket

from inference_exchange.shared.protocol import (
    AttestationChallenge,
    AttestationResponse,
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
    model_verified: bool = False  # HF hash verification passed
    attestation_status: str = "pending"  # pending | passed | degraded
    last_attestation: float = 0.0  # Timestamp of last successful attestation
    pending_challenge_nonce: str | None = None  # Nonce awaiting response
    challenge_sent_at: float = 0.0  # When the current challenge was sent

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


@dataclass
class PendingRequest:
    """A consumer request waiting in the queue for a provider to free up."""

    request_id: str
    inference_req: InferenceRequest
    event: asyncio.Event
    provider: ConnectedProvider | None = None
    queued_at: float = field(default_factory=time.time)
    # Routing constraints (so dispatch picks a compatible provider)
    model: str = "default"
    preference: str = "balanced"
    min_confidence: str = "open"
    max_price: float | None = None
    session_id: str | None = None


class ProviderHub:
    """Manages all connected providers and routes inference requests."""

    QUEUE_MAX_DEPTH = 50
    QUEUE_TIMEOUT_SECONDS = 30.0

    def __init__(self):
        self._providers: dict[str, ConnectedProvider] = {}
        # Maps request_id → asyncio.Queue for streaming responses back to consumer
        self._response_queues: dict[str, asyncio.Queue] = {}
        self._next_provider_id = 0
        # Session affinity: session_id → provider_id (for cache preference)
        self._session_affinity: dict[str, str] = {}
        # Maps request_id → provider_id (for disconnect cleanup)
        self._request_to_provider: dict[str, str] = {}
        # Pending request queue: requests waiting for a provider to free up
        self._pending_queue: asyncio.Queue[PendingRequest] = asyncio.Queue(
            maxsize=self.QUEUE_MAX_DEPTH
        )

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
        """Remove a provider on disconnect. Push errors to any in-flight request queues."""
        if provider_id in self._providers:
            provider = self._providers[provider_id]
            name = provider.name

            # Find all in-flight requests assigned to this provider
            orphaned_requests = [
                req_id for req_id, pid in self._request_to_provider.items()
                if pid == provider_id
            ]

            # Push an InferenceError to each orphaned queue so consumers get a clean error
            for req_id in orphaned_requests:
                if req_id in self._response_queues:
                    error = InferenceError(
                        request_id=req_id,
                        error="provider_disconnected",
                    )
                    self._response_queues[req_id].put_nowait(error)
                    logger.warning(
                        f"Provider {name} disconnected mid-stream — "
                        f"pushed error to request {req_id[:8]}"
                    )
                self._request_to_provider.pop(req_id, None)

            del self._providers[provider_id]
            logger.info(f"Provider disconnected: {name} ({provider_id})")

            return orphaned_requests

        return []

    def select_provider(
        self, model: str, preference: str = "balanced",
        min_confidence: str = "open", max_price: float | None = None,
        session_id: str | None = None,
        reputation_fn=None,
    ) -> ConnectedProvider | None:
        """Pick the best available provider for a request with consumer preferences.

        Args:
            model: Required model name
            preference: Routing preference (cheapest/fastest/most_secure/balanced)
            min_confidence: Minimum trust level
            max_price: Max $/Mtok output
            session_id: If provided, prefer the provider that last served this session (cache affinity)
            reputation_fn: Callable(provider_id) → float [0,1] reputation score
        """
        # Map confidence strings to numeric values for comparison
        confidence_map = {"open": 0, "contained": 1, "hardened": 2, "confidential": 3}
        min_conf_val = confidence_map.get(min_confidence, 0)

        # Session affinity: check if we have a previous provider for this session
        session_provider: ConnectedProvider | None = None
        if session_id and session_id in self._session_affinity:
            pid = self._session_affinity[session_id]
            if pid in self._providers:
                candidate = self._providers[pid]
                # Verify it's still eligible
                score = candidate.score_for_request(model, preference)
                conf = confidence_map.get(candidate.capabilities.trust_level.value, 0)
                price_ok = max_price is None or candidate.capabilities.price_per_mtok_output <= max_price
                if score > 0 and conf >= min_conf_val and price_ok:
                    session_provider = candidate

        # If session affinity found a valid provider, prefer it (cache benefit)
        if session_provider:
            return session_provider

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

            # Factor in reputation (if available)
            if reputation_fn:
                rep_score = reputation_fn(provider.provider_id)
                score *= (0.5 + 0.5 * rep_score)  # Reputation scales score 50%-100%

            if score > best_score:
                best_score = score
                best = provider

        # Record session affinity for next request
        if best and session_id:
            self._session_affinity[session_id] = best.provider_id

        return best

    def create_response_queue(self, request_id: str) -> asyncio.Queue:
        """Create a queue for streaming response chunks back to the consumer."""
        queue: asyncio.Queue = asyncio.Queue()
        self._response_queues[request_id] = queue
        return queue

    def remove_response_queue(self, request_id: str):
        """Clean up after request completes."""
        self._response_queues.pop(request_id, None)
        self._request_to_provider.pop(request_id, None)

    async def send_to_provider(self, provider: ConnectedProvider, request: InferenceRequest):
        """Send an inference request to a provider."""
        provider.active_requests += 1
        self._request_to_provider[request.request_id] = provider.provider_id
        await provider.ws.send_json(request.model_dump())

    def enqueue_request(
        self,
        inference_req: InferenceRequest,
        *,
        model: str = "default",
        preference: str = "balanced",
        min_confidence: str = "open",
        max_price: float | None = None,
        session_id: str | None = None,
    ) -> PendingRequest:
        """Enqueue a request for later dispatch when a provider frees up.

        Returns a PendingRequest whose .event the caller should await.
        Raises asyncio.QueueFull if the queue is at capacity.
        """
        pending = PendingRequest(
            request_id=inference_req.request_id,
            inference_req=inference_req,
            event=asyncio.Event(),
            model=model,
            preference=preference,
            min_confidence=min_confidence,
            max_price=max_price,
            session_id=session_id,
        )
        self._pending_queue.put_nowait(pending)  # Raises QueueFull if at max depth
        logger.info(
            f"[{inference_req.request_id[:8]}] Queued — "
            f"depth={self._pending_queue.qsize()}/{self.QUEUE_MAX_DEPTH}"
        )
        return pending

    @property
    def pending_queue_size(self) -> int:
        return self._pending_queue.qsize()

    async def _try_dispatch_queued(self, freed_provider_id: str | None = None):
        """Try to dispatch the oldest queued request to a newly-freed provider.

        Called after a provider completes a request (InferenceDone / InferenceError).
        Scans the queue front-to-back (FIFO) and dispatches the first compatible
        request to any available provider.
        """
        if self._pending_queue.empty():
            return

        # Collect all pending items, try to dispatch the first compatible one,
        # and re-enqueue the rest in order.
        items: list[PendingRequest] = []
        dispatched = False

        while not self._pending_queue.empty():
            try:
                items.append(self._pending_queue.get_nowait())
            except asyncio.QueueEmpty:
                break

        for i, pending in enumerate(items):
            if dispatched:
                # Already dispatched one — put the rest back
                self._pending_queue.put_nowait(pending)
                continue

            # Try to find a provider for this pending request
            provider = self.select_provider(
                pending.model,
                preference=pending.preference,
                min_confidence=pending.min_confidence,
                max_price=pending.max_price,
                session_id=pending.session_id,
            )
            if provider is not None:
                # Dispatch it
                pending.provider = provider
                pending.event.set()
                dispatched = True
                logger.info(
                    f"[{pending.request_id[:8]}] Dispatched from queue → "
                    f"{provider.name} ({provider.provider_id})"
                )
            else:
                # No provider yet — put it back
                self._pending_queue.put_nowait(pending)

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
            # Try to dispatch a queued request now that this provider freed capacity
            asyncio.ensure_future(self._try_dispatch_queued(freed_provider_id=provider_id))

        elif msg_type == MessageType.INFERENCE_ERROR:
            error = InferenceError(**data)
            queue.put_nowait(error)
            if provider_id in self._providers:
                self._providers[provider_id].active_requests = max(
                    0, self._providers[provider_id].active_requests - 1
                )
            # Also try dispatch on error — the provider freed a slot
            asyncio.ensure_future(self._try_dispatch_queued(freed_provider_id=provider_id))

    def handle_heartbeat(self, provider_id: str, msg: HeartbeatMessage):
        """Update provider state from heartbeat."""
        if provider_id in self._providers:
            provider = self._providers[provider_id]
            provider.active_requests = msg.active_requests
            provider.last_heartbeat = time.time()

    async def send_attestation_challenge(self, provider: ConnectedProvider) -> str:
        """Send an attestation challenge to a provider. Returns the nonce."""
        nonce = secrets.token_hex(16)
        challenge = AttestationChallenge(
            nonce=nonce,
            timestamp=time.time(),
        )
        provider.pending_challenge_nonce = nonce
        provider.challenge_sent_at = time.time()
        await provider.ws.send_json(challenge.model_dump())
        logger.info(f"Attestation challenge sent to {provider.name} ({provider.provider_id})")
        return nonce

    def handle_attestation_response(self, provider_id: str, data: dict):
        """Process an attestation response from a provider."""
        if provider_id not in self._providers:
            return

        provider = self._providers[provider_id]
        response = AttestationResponse(**data)

        if provider.pending_challenge_nonce and response.nonce == provider.pending_challenge_nonce:
            provider.attestation_status = "passed"
            provider.last_attestation = time.time()
            provider.pending_challenge_nonce = None
            logger.info(
                f"Attestation passed: {provider.name} "
                f"(SIP={response.sip_enabled}, secure_boot={response.secure_boot})"
            )
        else:
            provider.attestation_status = "degraded"
            logger.warning(
                f"Attestation FAILED for {provider.name}: nonce mismatch "
                f"(expected={provider.pending_challenge_nonce}, got={response.nonce})"
            )

    def check_attestation_timeouts(self, timeout_seconds: float = 30.0):
        """Mark providers as degraded if they haven't responded to a challenge in time."""
        now = time.time()
        for provider in self._providers.values():
            if (
                provider.pending_challenge_nonce
                and provider.challenge_sent_at > 0
                and (now - provider.challenge_sent_at) > timeout_seconds
            ):
                provider.attestation_status = "degraded"
                provider.pending_challenge_nonce = None
                logger.warning(
                    f"Attestation timeout for {provider.name} ({provider.provider_id}) — marked degraded"
                )
