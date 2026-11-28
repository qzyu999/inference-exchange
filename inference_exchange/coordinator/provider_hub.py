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
    CancelRequest,
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
    # Slots the hub has reserved for this provider. Only Assignment changes it.
    active_requests: int = 0
    # What the provider's last heartbeat said. Display only, never routing (MUSE-018).
    reported_active_requests: int = 0
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
    session_id: str = field(default_factory=lambda: "conn-" + secrets.token_hex(16))
    # Operator removed this provider from routing; it stays connected (#113)
    # Private, approximate handshake country. Never included in provider listings.
    network_country: str | None = None
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

    def score_for_request(self, model: str, preference: str = "balanced", reputation: float = 1.0) -> float:
        """The routing score for this provider, from the same function routing uses."""
        from .paid import policy
        from .paid.model import Candidate, Order
        if model != "default" and model not in self.capabilities.models:
            return -1
        levels = ("open", "contained", "hardened", "confidential")
        return policy.score(Order(model=model, preference=preference), Candidate(
            provider_id=self.provider_id, models=frozenset(self.capabilities.models),
            price_output=self.capabilities.price_per_mtok_output,
            trust=levels.index(self.capabilities.trust_level.value),
            slots=self.capabilities.max_concurrent, used=self.active_requests,
            tps=self.capabilities.measured_tps, reputation=reputation,
        ))


@dataclass
class Assignment:
    """One request on one provider connection.

    The hub accepts a frame for the request only from this provider and this
    connection session (MUSE-012). The queue and the done callback exist before
    the send (MUSE-016). The slot is reserved once and released once (MUSE-017/019).
    """
    request_id: str
    provider: ConnectedProvider
    session_id: str
    queue: asyncio.Queue
    on_done: object = None
    holds_slot: bool = False
    finished: bool = False

    def reserve(self) -> None:
        if not self.holds_slot:
            self.provider.active_requests += 1
            self.holds_slot = True

    def release(self) -> None:
        self.release_pending()

    def release_pending(self) -> bool:
        if self.holds_slot:
            self.provider.active_requests = max(0, self.provider.active_requests - 1)
            self.holds_slot = False
            return True
        return False


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
    abandoned: bool = False


class ProviderHub:
    QUEUE_MAX_DEPTH = 50
    QUEUE_TIMEOUT_SECONDS = 30.0
    # Frames buffered per request before the client is too slow (MUSE-038).
    RESPONSE_QUEUE_MAX = 2048

    def __init__(self):
        # Operator overrides (#112): IE_QUEUE_MAX_DEPTH, IE_QUEUE_TIMEOUT_SECONDS
        self.QUEUE_MAX_DEPTH = int(os.environ.get("IE_QUEUE_MAX_DEPTH", self.QUEUE_MAX_DEPTH))
        self.QUEUE_TIMEOUT_SECONDS = float(os.environ.get("IE_QUEUE_TIMEOUT_SECONDS", self.QUEUE_TIMEOUT_SECONDS))
        self._providers: dict[str, ConnectedProvider] = {}
        self._next_provider_id = 0
        self._session_affinity: dict[str, str] = {}
        self._SESSION_AFFINITY_MAX = 1000
        self._assignments: dict[str, Assignment] = {}
        # Provider reputation in [0, 1], set by the composition root. Every
        # selection path uses it, including the queue scheduler (design §2).
        self.reputation_fn = None
        self._pending_queue: asyncio.Queue[PendingRequest] = asyncio.Queue(maxsize=self.QUEUE_MAX_DEPTH)

    @property
    def _response_queues(self) -> dict[str, asyncio.Queue]:
        """Live queues by request ID (read-only view for admin stats)."""
        return {rid: a.queue for rid, a in self._assignments.items() if not a.finished}

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

    @staticmethod
    def _record_failed_outcome(request_id: str):
        from .dependencies import get_store
        try:
            get_store().amend_request_outcome(request_id, status="failed")
        except Exception:
            logger.warning("Request outcome failure could not be saved")

    def disconnect_provider(self, provider_id: str):
        if provider_id in self._providers:
            provider = self._providers[provider_id]
            name = provider.name
            orphaned_requests = [rid for rid, a in self._assignments.items()
                                 if a.provider is provider and not a.finished]
            for req_id in orphaned_requests:
                self._record_failed_outcome(req_id)
                self._fail(self._assignments[req_id], "provider_disconnected")
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

    TRUST_LEVELS = ("open", "contained", "hardened", "confidential")

    def candidates(self, reputation_fn=None) -> list:
        """Routable providers as pure `Candidate`s (paid/policy.py)."""
        from .paid.model import Candidate
        rep = reputation_fn or self.reputation_fn
        out = []
        for p in self._providers.values():
            # Confidential providers are invisible to routing until App Attest admission succeeds.
            if not p.admitted or p.quarantined:  # quarantine: PROV-010
                continue
            out.append(Candidate(
                provider_id=p.provider_id, models=frozenset(p.capabilities.models),
                price_output=p.capabilities.price_per_mtok_output,
                trust=self.TRUST_LEVELS.index(p.capabilities.trust_level.value),
                slots=p.capabilities.max_concurrent, used=p.active_requests,
                tps=p.capabilities.measured_tps,
                reputation=rep(p.provider_id) if rep else 1.0,
            ))
        return out

    def select_provider(self, model: str, preference: str = "balanced",
                        min_confidence: str = "open", max_price: float | None = None,
                        session_id: str | None = None, reputation_fn=None,
                        exclude=frozenset()) -> ConnectedProvider | None:
        """The one selection used by the immediate, queued and retry paths (design §4 rule 1)."""
        from .paid import policy
        from .paid.model import Order

        if min_confidence not in self.TRUST_LEVELS:
            raise KeyError(min_confidence)  # fail closed on an unknown level (P1)
        order = Order(
            model=model, preference=preference, max_price=max_price,
            min_trust=self.TRUST_LEVELS.index(min_confidence),
            exclude=frozenset(exclude),
            affinity=self._session_affinity.get(session_id, "") if session_id else "",
        )
        chosen = policy.choose(order, self.candidates(reputation_fn))
        if chosen is None:
            return None
        if session_id:
            self._session_affinity[session_id] = chosen.provider_id
            if len(self._session_affinity) > self._SESSION_AFFINITY_MAX:
                del self._session_affinity[next(iter(self._session_affinity))]
        return self._providers[chosen.provider_id]

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

    # --- Assignment lifecycle ------------------------------------------------

    def start(self, request_id: str, provider: ConnectedProvider, *, on_done=None,
              reserved: bool = False) -> asyncio.Queue:
        """Bind a request to one provider connection before anything is sent.

        `reserved=True` means the queue scheduler already reserved the slot for
        this provider (MUSE-019). Returns the bounded response queue.
        """
        if request_id in self._assignments:
            raise ValueError(f"request {request_id[:8]} is already assigned")
        assignment = Assignment(
            request_id=request_id, provider=provider, session_id=provider.session_id,
            queue=asyncio.Queue(maxsize=self.RESPONSE_QUEUE_MAX), on_done=on_done,
            holds_slot=reserved,
        )
        assignment.reserve()
        self._assignments[request_id] = assignment
        return assignment.queue

    def set_on_done(self, request_id: str, on_done) -> None:
        assignment = self._assignments.get(request_id)
        if assignment is not None:
            assignment.on_done = on_done

    def finish(self, request_id: str) -> None:
        """The route is done with this request. Releases the slot if still held."""
        assignment = self._assignments.pop(request_id, None)
        if assignment is not None:
            assignment.finished = True
            if assignment.release_pending():
                self._schedule_dispatch()

    async def cancel(self, request_id: str) -> None:
        """Release the request. If the provider may still be working, tell it to stop.

        A request that ended with Done, an error or a disconnect sends no frame.
        """
        assignment = self._assignments.get(request_id)
        if assignment is None:
            return
        provider_still_working = not assignment.finished
        self.finish(request_id)
        if provider_still_working:
            await self._send_cancel(assignment)

    async def _send_cancel(self, assignment: Assignment) -> None:
        if self._providers.get(assignment.provider.provider_id) is not assignment.provider:
            return  # the connection is gone
        try:
            await assignment.provider.ws.send_json(CancelRequest(request_id=assignment.request_id).model_dump())
        except Exception as e:  # the socket may already be closing
            logger.debug(f"cancel_request to {assignment.provider.provider_id} failed: {e}")

    async def send_to_provider(self, provider: ConnectedProvider, request: InferenceRequest):
        if not provider.admitted and provider.requires_app_attest:
            raise PermissionError("provider is not App Attest admitted")
        assignment = self._assignments.get(request.request_id)
        if assignment is None or assignment.provider is not provider:
            raise RuntimeError("call ProviderHub.start() for this provider before sending")
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

    def abandon(self, pending: PendingRequest) -> None:
        """The waiting route gave up. Return any slot the scheduler reserved for it."""
        pending.abandoned = True
        if pending.provider is not None and pending.request_id not in self._assignments:
            pending.provider.active_requests = max(0, pending.provider.active_requests - 1)
            pending.provider = None
            self._schedule_dispatch()

    def _schedule_dispatch(self) -> None:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return
        asyncio.ensure_future(self._try_dispatch_queued())

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
            if pending.abandoned or pending.cleared:
                continue
            if dispatched:
                self._pending_queue.put_nowait(pending)
                continue
            provider = self.select_provider(pending.model, preference=pending.preference,
                                            min_confidence=pending.min_confidence,
                                            max_price=pending.max_price, session_id=pending.session_id)
            if provider is not None:
                # Reserve now, in the same step as the choice, so a second pass
                # sees the slot as taken (MUSE-019). start(reserved=True) adopts it.
                provider.active_requests += 1
                pending.provider = provider
                pending.event.set()
                dispatched = True
            else:
                self._pending_queue.put_nowait(pending)

    def _owned(self, provider_id: str, request_id: str) -> Assignment | None:
        """The live assignment, only if this provider connection owns it (MUSE-012)."""
        assignment = self._assignments.get(request_id)
        if assignment is None or assignment.finished:
            return None
        provider = self._providers.get(provider_id)
        if provider is None or provider is not assignment.provider or provider.session_id != assignment.session_id:
            logger.warning(f"Dropped frame for {request_id[:8]} from {provider_id}: not the assigned provider")
            return None
        return assignment

    def _deliver(self, assignment: Assignment, msg) -> bool:
        """Put a frame on the queue. A full queue fails the request (MUSE-038)."""
        try:
            assignment.queue.put_nowait(msg)
            return True
        except asyncio.QueueFull:
            self._fail(assignment, "response_overflow", leave_room=True)
            asyncio.ensure_future(self._send_cancel(assignment))
            return False

    def _fail(self, assignment: Assignment, error: str, *, leave_room: bool = False) -> None:
        """End a live assignment with an error. Its slot is released once."""
        if assignment.finished:
            return
        assignment.finished = True
        assignment.on_done = None
        if leave_room:  # drop the oldest frame so the error always fits
            try:
                assignment.queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        try:
            assignment.queue.put_nowait(InferenceError(request_id=assignment.request_id, error=error))
        except asyncio.QueueFull:
            pass
        if assignment.release_pending():
            self._schedule_dispatch()

    def handle_provider_message(self, provider_id: str, data: dict):
        msg_type = data.get("type")
        request_id = data.get("request_id")
        if not request_id:
            return
        assignment = self._owned(provider_id, request_id)
        if assignment is None:
            return

        if msg_type == MessageType.INFERENCE_RESPONSE:
            self._deliver(assignment, InferenceResponseChunk(**data))
        elif msg_type == MessageType.INFERENCE_DONE:
            done_msg = InferenceDone(**data)
            # Terminal: one Done per assignment. The callback runs at most once.
            assignment.finished = True
            callback, assignment.on_done = assignment.on_done, None
            try:
                assignment.queue.put_nowait(done_msg)
            except asyncio.QueueFull:
                pass
            if callback:
                try:
                    callback(done_msg)
                except Exception as e:
                    self._record_failed_outcome(request_id)
                    logger.error(f"Billing callback error for {request_id[:8]}: {e}")
            if assignment.release_pending():
                self._schedule_dispatch()
        elif msg_type == MessageType.INFERENCE_ERROR:
            self._record_failed_outcome(request_id)
            msg = InferenceError(**data)
            self._fail(assignment, msg.error)

    def handle_heartbeat(self, provider_id: str, msg: HeartbeatMessage):
        if provider_id in self._providers:
            provider = self._providers[provider_id]
            provider.reported_active_requests = msg.active_requests
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
