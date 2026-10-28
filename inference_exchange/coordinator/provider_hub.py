"""Manages WebSocket connections to providers and routes requests."""

import asyncio
import logging
import os
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
    ModelCapabilities,
    ProviderCapabilities,
    RegisterMessage,
)

logger = logging.getLogger(__name__)


@dataclass
class ConnectedProvider:
    provider_id: str
    name: str
    ws: WebSocket
    capabilities: ProviderCapabilities
    encryption_public_key: str = ""
    connected_at: float = field(default_factory=time.time)
    active_requests: int = 0
    last_heartbeat: float = field(default_factory=time.time)
    model_verified: bool = False
    model_identity: dict = field(default_factory=dict)
    model_capabilities: ModelCapabilities = field(default_factory=ModelCapabilities)
    attestation_status: str = "pending"
    app_attest_verified: bool = False
    admission_expires_at: float = 0.0
    app_attest_key_id: str = ""
    provider_artifact_hash: str = ""
    last_attestation: float = 0.0
    pending_challenge_nonce: str | None = None
    challenge_sent_at: float = 0.0
    # Provider token used to connect ("" = unauthenticated dev connection) (#113)
    token_id: str = ""
    # Credential-bound ledger account; not a WebSocket routing ID (#136).
    billing_account_id: str = ""
    # Globally unique connection audit ID, including across coordinator restarts.
    session_id: str = field(default_factory=lambda: "conn-" + __import__("secrets").token_hex(16))
    # Operator removed this provider from routing; it stays connected (#113)
    quarantined: bool = False
    quarantine_reason: str = ""

    @property
    def requires_app_attest(self) -> bool:
        return self.capabilities.trust_level.value == "confidential"

    @property
    def admitted(self) -> bool:
        if self.requires_app_attest:
            return self.app_attest_verified and self.admission_expires_at > time.time()
        return True

    @property
    def verified_trust_level(self) -> str | None:
        """Trust level backed by evidence, or None. Single hook point for L2/L3 verification (#1)."""
        if self.requires_app_attest and self.admitted:
            return self.capabilities.trust_level.value
        return None

    @property
    def load_factor(self) -> float:
        if self.capabilities.max_concurrent == 0:
            return 1.0
        return self.active_requests / self.capabilities.max_concurrent

    def score_for_request(self, model: str, preference: str = "balanced") -> float:
        from .matching.models import ConfidenceLevel, InferenceOrder, ProviderOffer, RoutingPreference
        from .matching.strategy import compute_score

        pref_map = {
            "cheapest": RoutingPreference.CHEAPEST,
            "fastest": RoutingPreference.FASTEST,
            "most_secure": RoutingPreference.MOST_SECURE,
            "balanced": RoutingPreference.BALANCED,
        }
        conf_map = {"open": ConfidenceLevel.OPEN, "contained": ConfidenceLevel.CONTAINED,
                     "hardened": ConfidenceLevel.HARDENED, "confidential": ConfidenceLevel.CONFIDENTIAL}
        order = InferenceOrder(order_id="trace", consumer_id="", model=model,
                               preference=pref_map.get(preference, RoutingPreference.BALANCED))
        offer = ProviderOffer(
            provider_id=self.provider_id,
            provider_name=self.name,
            models=self.capabilities.models,
            price_per_mtok_input=self.capabilities.price_per_mtok_input,
            price_per_mtok_output=self.capabilities.price_per_mtok_output,
            confidence_level=conf_map.get(self.capabilities.trust_level.value, ConfidenceLevel.OPEN),
            measured_throughput_tps=self.capabilities.measured_tps,
            total_slots=self.capabilities.max_concurrent,
            used_slots=self.active_requests,
            encrypted=bool(self.encryption_public_key),
            hardware=self.capabilities.hardware,
        )
        return compute_score(order, offer)


@dataclass
class PendingRequest:
    request_id: str
    inference_req: InferenceRequest
    event: asyncio.Event
    provider: ConnectedProvider | None = None
    queued_at: float = field(default_factory=time.time)
    model: str = "default"
    preference: str = "balanced"
    min_confidence: str = "open"
    max_price: float | None = None
    session_id: str | None = None
    cleared: bool = False


class ProviderHub:
    QUEUE_MAX_DEPTH = 50
    QUEUE_TIMEOUT_SECONDS = 30.0

    def __init__(self):
        # Operator overrides (#112): IE_QUEUE_MAX_DEPTH, IE_QUEUE_TIMEOUT_SECONDS
        self.QUEUE_MAX_DEPTH = int(os.environ.get("IE_QUEUE_MAX_DEPTH", self.QUEUE_MAX_DEPTH))
        self.QUEUE_TIMEOUT_SECONDS = float(os.environ.get("IE_QUEUE_TIMEOUT_SECONDS", self.QUEUE_TIMEOUT_SECONDS))
        self._providers: dict[str, ConnectedProvider] = {}
        self._response_queues: dict[str, asyncio.Queue] = {}
        self._next_provider_id = 0
        self._session_affinity: dict[str, str] = {}
        self._SESSION_AFFINITY_MAX = 1000
        self._request_to_provider: dict[str, str] = {}
        self._pending_queue: asyncio.Queue[PendingRequest] = asyncio.Queue(maxsize=self.QUEUE_MAX_DEPTH)
        # Billing callbacks keyed by request_id, invoked when InferenceDone arrives
        self._billing_callbacks: dict[str, callable] = {}

    @property
    def provider_count(self) -> int:
        return len(self._providers)

    @property
    def available_models(self) -> list[str]:
        models = set()
        for p in self._providers.values():
            models.update(p.capabilities.models)
        return sorted(models)

    def register_provider(self, ws: WebSocket, msg: RegisterMessage) -> str:
        self._next_provider_id += 1
        provider_id = f"provider-{self._next_provider_id}"
        self._providers[provider_id] = ConnectedProvider(
            provider_id=provider_id,
            name=msg.provider_name,
            ws=ws,
            capabilities=msg.capabilities,
            encryption_public_key=msg.encryption_public_key,
            app_attest_key_id=msg.app_attest_key_id,
            provider_artifact_hash=msg.provider_artifact_hash,
        )
        encrypted_status = "🔐 E2E" if msg.encryption_public_key else "🔓 plaintext"
        logger.info(
            f"Provider registered: {msg.provider_name} ({provider_id}) "
            f"models={msg.capabilities.models} trust={msg.capabilities.trust_level} [{encrypted_status}]"
        )
        return provider_id

    def disconnect_provider(self, provider_id: str):
        if provider_id in self._providers:
            provider = self._providers[provider_id]
            name = provider.name
            orphaned_requests = [req_id for req_id, pid in self._request_to_provider.items() if pid == provider_id]
            for req_id in orphaned_requests:
                if req_id in self._response_queues:
                    self._response_queues[req_id].put_nowait(
                        InferenceError(request_id=req_id, error="provider_disconnected")
                    )
                self._request_to_provider.pop(req_id, None)
            del self._providers[provider_id]
            logger.info(f"Provider disconnected: {name} ({provider_id})")
            return orphaned_requests
        return []

    def set_quarantine(self, provider_id: str, quarantined: bool, reason: str = "") -> bool:
        provider = self._providers.get(provider_id)
        if provider is None:
            return False
        provider.quarantined = quarantined
        provider.quarantine_reason = reason if quarantined else ""
        logger.warning(f"Provider {provider.name} ({provider_id}) {'quarantined' if quarantined else 'released'}")
        return True

    async def force_disconnect(self, provider_id: str, reason: str = "Disconnected by operator") -> bool:
        """Close a provider's WebSocket and fail its in-flight requests."""
        provider = self._providers.get(provider_id)
        if provider is None:
            return False
        self.disconnect_provider(provider_id)
        try:
            await provider.ws.close(code=4003, reason=reason)
        except Exception as e:  # socket may already be gone
            logger.debug(f"Close of {provider_id} failed: {e}")
        return True

    def providers_with_token(self, token_id: str) -> list[str]:
        return [pid for pid, p in self._providers.items() if token_id and p.token_id == token_id]

    def select_provider(self, model: str, preference: str = "balanced",
                        min_confidence: str = "open", max_price: float | None = None,
                        session_id: str | None = None, reputation_fn=None) -> ConnectedProvider | None:
        from .matching.models import ConfidenceLevel, InferenceOrder, ProviderOffer, RoutingPreference
        from .matching.strategy import GreedyStrategy

        pref_map = {"cheapest": RoutingPreference.CHEAPEST, "fastest": RoutingPreference.FASTEST,
                    "most_secure": RoutingPreference.MOST_SECURE, "balanced": RoutingPreference.BALANCED}
        conf_map = {"open": ConfidenceLevel.OPEN, "contained": ConfidenceLevel.CONTAINED,
                     "hardened": ConfidenceLevel.HARDENED, "confidential": ConfidenceLevel.CONFIDENTIAL}
        affinity_pid = self._session_affinity.get(session_id, "") if session_id else ""
        order = InferenceOrder(
            order_id="select", consumer_id="", model=model,
            max_price_per_mtok=max_price if max_price is not None else float("inf"),
            min_confidence=conf_map[min_confidence],  # fail closed on unknown levels (P1)
            preference=pref_map.get(preference, RoutingPreference.BALANCED),
            session_affinity_provider_id=affinity_pid,
        )

        offers = []
        for p in self._providers.values():
            # Confidential providers are invisible to routing until App Attest admission succeeds.
            if not p.admitted:
                continue
            # Operator quarantine (PROV-010)
            if p.quarantined:
                continue
            rep = reputation_fn(p.provider_id) if reputation_fn else 1.0
            offers.append(ProviderOffer(
                provider_id=p.provider_id,
                provider_name=p.name,
                models=p.capabilities.models,
                price_per_mtok_input=p.capabilities.price_per_mtok_input,
                price_per_mtok_output=p.capabilities.price_per_mtok_output,
                confidence_level=conf_map.get(p.capabilities.trust_level.value, ConfidenceLevel.OPEN),
                measured_throughput_tps=p.capabilities.measured_tps,
                total_slots=p.capabilities.max_concurrent,
                used_slots=p.active_requests,
                encrypted=bool(p.encryption_public_key),
                hardware=p.capabilities.hardware,
                reputation_score=rep,
            ))
        matches, _ = GreedyStrategy().match([order], offers)
        if matches:
            winner_id = matches[0].provider_id
            if winner_id in self._providers:
                if session_id:
                    self._session_affinity[session_id] = winner_id
                    if len(self._session_affinity) > self._SESSION_AFFINITY_MAX:
                        del self._session_affinity[next(iter(self._session_affinity))]
                return self._providers[winner_id]
        return None

    def explain_no_match(self, model: str, min_confidence: str = "open",
                         max_price: float | None = None) -> dict | None:
        """Why no connected provider could ever serve this request, ignoring current load.

        Returns None when at least one routable provider meets every hard constraint
        (it may only be busy, so the request can queue). Otherwise returns
        {"code", "message"} for an immediate, explicit error (ROUTE-010).
        Never relaxes a constraint: the caller decides whether to lower trust (P1).
        """
        levels = ["open", "contained", "hardened", "confidential"]
        need = levels.index(min_confidence)  # ValueError, never downgrade to open (P1)
        routable = [p for p in self._providers.values() if p.admitted and not p.quarantined]
        if not routable:
            return {
                "code": "no_provider_available",
                "message": "No provider is online right now. Try again later.",
            }
        serving = [p for p in routable if model == "default" or model in p.capabilities.models]
        if not serving:
            available = sorted({m for p in routable for m in p.capabilities.models})
            return {
                "code": "model_not_available",
                "message": f"No online provider serves model '{model}'. Available models: {', '.join(available)}. "
                           "Use model 'default' to accept any model.",
            }
        trusted = [p for p in serving if levels.index(p.capabilities.trust_level.value) >= need]
        if not trusted:
            best = max((p.capabilities.trust_level.value for p in serving), key=levels.index)
            return {
                "code": "no_compatible_provider",
                "message": f"No online provider meets ocip_min_confidence='{min_confidence}' for model '{model}'. "
                           f"The highest available level is '{best}' (claimed by the provider, not verified). "
                           f"To accept it, set ocip_min_confidence to '{best}' in the request.",
            }
        if max_price is not None:
            priced = [p for p in trusted if p.capabilities.price_per_mtok_output <= max_price]
            if not priced:
                cheapest = min(p.capabilities.price_per_mtok_output for p in trusted)
                return {
                    "code": "no_compatible_provider",
                    "message": f"No online provider meets ocip_max_price={max_price} for model '{model}' "
                               f"at ocip_min_confidence='{min_confidence}'. The lowest price is {cheapest} per million "
                               "output tokens.",
                }
        return None

    def create_response_queue(self, request_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._response_queues[request_id] = queue
        return queue

    def remove_response_queue(self, request_id: str):
        self._response_queues.pop(request_id, None)
        self._request_to_provider.pop(request_id, None)
        self._billing_callbacks.pop(request_id, None)

    def register_billing_callback(self, request_id: str, callback: callable):
        """Register a callback invoked when InferenceDone arrives for this request."""
        self._billing_callbacks[request_id] = callback

    async def send_to_provider(self, provider: ConnectedProvider, request: InferenceRequest):
        if not provider.admitted and provider.requires_app_attest:
            raise PermissionError("provider is not App Attest admitted")
        provider.active_requests += 1
        self._request_to_provider[request.request_id] = provider.provider_id
        await provider.ws.send_json(request.model_dump())

    def enqueue_request(self, inference_req: InferenceRequest, *, model: str = "default",
                        preference: str = "balanced", min_confidence: str = "open",
                        max_price: float | None = None, session_id: str | None = None) -> PendingRequest:
        pending = PendingRequest(request_id=inference_req.request_id, inference_req=inference_req,
                                 event=asyncio.Event(), model=model, preference=preference,
                                 min_confidence=min_confidence, max_price=max_price, session_id=session_id)
        self._pending_queue.put_nowait(pending)
        return pending

    @property
    def pending_queue_size(self) -> int:
        return self._pending_queue.qsize()

    def clear_queue(self) -> int:
        """Fail every queued request (operator action). Returns the number cleared."""
        cleared = 0
        while not self._pending_queue.empty():
            try:
                pending = self._pending_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            pending.cleared = True
            pending.event.set()
            cleared += 1
        if cleared:
            logger.warning(f"Request queue cleared by operator ({cleared} requests)")
        return cleared

    async def _try_dispatch_queued(self, freed_provider_id: str | None = None):
        if self._pending_queue.empty():
            return
        items: list[PendingRequest] = []
        dispatched = False
        while not self._pending_queue.empty():
            try:
                items.append(self._pending_queue.get_nowait())
            except asyncio.QueueEmpty:
                break
        for pending in items:
            if dispatched:
                self._pending_queue.put_nowait(pending)
                continue
            provider = self.select_provider(pending.model, preference=pending.preference,
                                            min_confidence=pending.min_confidence,
                                            max_price=pending.max_price, session_id=pending.session_id)
            if provider is not None:
                pending.provider = provider
                pending.event.set()
                dispatched = True
            else:
                self._pending_queue.put_nowait(pending)

    def handle_provider_message(self, provider_id: str, data: dict):
        msg_type = data.get("type")
        request_id = data.get("request_id")
        if not request_id:
            return

        # InferenceDone billing must fire even after the response queue is
        # cleaned up (the streaming generator may have finished and removed
        # the queue before InferenceDone arrives from the provider).
        if msg_type == MessageType.INFERENCE_DONE:
            done_msg = InferenceDone(**data)
            # Deliver to queue if it still exists (streaming generator reads it)
            queue = self._response_queues.get(request_id)
            if queue is not None:
                queue.put_nowait(done_msg)
            # Fire billing callback regardless of queue state
            callback = self._billing_callbacks.pop(request_id, None)
            if callback:
                try:
                    callback(done_msg)
                except Exception as e:
                    logger.error(f"Billing callback error for {request_id[:8]}: {e}")
            if provider_id in self._providers:
                self._providers[provider_id].active_requests = max(0, self._providers[provider_id].active_requests - 1)
            asyncio.ensure_future(self._try_dispatch_queued(freed_provider_id=provider_id))
            return

        # All other message types require an active response queue
        if request_id not in self._response_queues:
            return
        queue = self._response_queues[request_id]
        if msg_type == MessageType.INFERENCE_RESPONSE:
            queue.put_nowait(InferenceResponseChunk(**data))
        elif msg_type == MessageType.INFERENCE_ERROR:
            queue.put_nowait(InferenceError(**data))
            self._billing_callbacks.pop(request_id, None)
            if provider_id in self._providers:
                self._providers[provider_id].active_requests = max(0, self._providers[provider_id].active_requests - 1)
            asyncio.ensure_future(self._try_dispatch_queued(freed_provider_id=provider_id))

    def handle_heartbeat(self, provider_id: str, msg: HeartbeatMessage):
        if provider_id in self._providers:
            provider = self._providers[provider_id]
            provider.active_requests = msg.active_requests
            provider.last_heartbeat = time.time()

    async def send_attestation_challenge(self, provider: ConnectedProvider) -> str:
        nonce = secrets.token_hex(32)
        challenge = AttestationChallenge(nonce=nonce, timestamp=time.time(), required_profile=provider.capabilities.trust_level.value)
        provider.pending_challenge_nonce = nonce
        provider.challenge_sent_at = time.time()
        await provider.ws.send_json(challenge.model_dump())
        return nonce

    def handle_attestation_response(self, provider_id: str, data: dict):
        if provider_id not in self._providers:
            return
        provider = self._providers[provider_id]
        response = AttestationResponse(**data)
        if not provider.pending_challenge_nonce or response.nonce != provider.pending_challenge_nonce:
            provider.attestation_status = "degraded"
            provider.app_attest_verified = False
            return
        provider.pending_challenge_nonce = None
        provider.last_attestation = time.time()
        trust_claim = provider.capabilities.trust_level.value
        issues = []
        if trust_claim in ("hardened", "confidential"):
            if not response.sip_enabled:
                issues.append("SIP disabled")
            if not response.hardened_runtime:
                issues.append("no Hardened Runtime")
            if not response.agent_binary_hash:
                issues.append("agent not frozen")
        if trust_claim == "confidential" and not response.app_attest_attestation_object:
            issues.append("missing cryptographic App Attest attestation")
        if issues:
            provider.attestation_status = "degraded"
            provider.app_attest_verified = False
        else:
            # Cryptographic App Attest verification is performed by the coordinator admission service.
            # Do not turn self-reported `hardware_attestation` into an admission grant.
            provider.attestation_status = "passed" if trust_claim != "confidential" else "pending"
            provider.app_attest_verified = False

    def check_attestation_timeouts(self, timeout_seconds: float = 30.0):
        now = time.time()
        for provider in self._providers.values():
            if provider.pending_challenge_nonce and now - provider.challenge_sent_at > timeout_seconds:
                provider.pending_challenge_nonce = None
                provider.attestation_status = "degraded"
                provider.app_attest_verified = False
