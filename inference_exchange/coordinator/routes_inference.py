"""Inference endpoints — POST /v1/chat/completions (OpenAI-compatible)."""

import asyncio
import json
import logging
import time
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from inference_exchange.shared.crypto import encrypt_json
from inference_exchange.shared.errors import (
    NoProviderAvailable,
    ProviderError,
    ProviderTimeout,
    QueueFull,
    QueueTimeout,
    RateLimitExceeded,
)
from inference_exchange.shared.protocol import (
    InferenceDone,
    InferenceError,
    InferenceRequest,
    InferenceResponseChunk,
)

from .dependencies import (
    _add_trace,
    _rate_limiter,
    get_auth,
    get_billing,
    get_event_bus,
    get_hub,
    get_reputation_tracker,
    get_tps_tracker,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# --- Request/Response models (OpenAI-compatible) ---


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: str = "default"
    messages: list[ChatMessage]
    max_tokens: int = 1024
    temperature: float = 0.7
    stream: bool = True
    # OCIP routing preferences (consumer controls)
    ocip_preference: str = "balanced"  # cheapest | fastest | most_secure | balanced
    ocip_min_confidence: str = "open"  # open | contained | hardened | confidential
    ocip_max_price: float | None = None  # Max $/Mtok output (None = no limit)
    ocip_session_id: str | None = None  # Session ID for cache affinity


class ModelInfo(BaseModel):
    id: str
    object: str = "model"
    owned_by: str = "inference-exchange"


def _estimate_input_tokens(messages: list) -> int:
    """Estimate token count from messages (approximate: ~4 chars per token for English).

    This is a fast approximation. For exact counting, use the model's tokenizer.
    Good enough for billing at the micro-USD level.
    """
    total_chars = sum(len(str(m.get("content", "") if isinstance(m, dict) else getattr(m, "content", ""))) for m in messages)
    # Add ~4 tokens per message for role/formatting overhead
    overhead = len(messages) * 4
    return max(1, total_chars // 4 + overhead)


@router.post("/v1/chat/completions")
async def chat_completions(request: ChatCompletionRequest, raw_request: Request):
    """OpenAI-compatible chat completions endpoint."""
    hub = get_hub()
    auth = get_auth()

    # Resolve consumer identity from auth header
    consumer_id = auth.resolve_consumer(raw_request.headers.get("authorization"))

    # Rate limit check
    if not _rate_limiter.allow(consumer_id):
        raise RateLimitExceeded()

    # Pre-compute input token estimate for billing (used by both paths)
    messages_plain = [m.model_dump() for m in request.messages]
    input_token_estimate = _estimate_input_tokens(messages_plain)

    # Select a provider
    provider = hub.select_provider(
        request.model,
        preference=request.ocip_preference,
        min_confidence=request.ocip_min_confidence,
        max_price=request.ocip_max_price,
        session_id=request.ocip_session_id,
        reputation_fn=get_reputation_tracker().get_score,
    )
    if provider is None:
        # No provider available right now — try queuing
        request_id = str(uuid.uuid4())

        # Build the inference request early so it's ready when dispatched
        inference_req = InferenceRequest(
            request_id=request_id,
            model=request.model,
            messages=messages_plain,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            stream=request.stream,
        )

        try:
            pending = hub.enqueue_request(
                inference_req,
                model=request.model,
                preference=request.ocip_preference,
                min_confidence=request.ocip_min_confidence,
                max_price=request.ocip_max_price,
                session_id=request.ocip_session_id,
            )
        except asyncio.QueueFull:
            _add_trace({
                "request_id": request_id[:8],
                "timestamp": time.time(),
                "model": request.model,
                "status": "queue_full",
                "reason": f"Queue full ({hub.QUEUE_MAX_DEPTH} pending)",
                "providers_evaluated": hub.provider_count,
            })
            raise QueueFull(hub.QUEUE_MAX_DEPTH)

        # Wait for a provider to be assigned (up to timeout)
        try:
            await asyncio.wait_for(
                pending.event.wait(),
                timeout=hub.QUEUE_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            _add_trace({
                "request_id": request_id[:8],
                "timestamp": time.time(),
                "model": request.model,
                "status": "queue_timeout",
                "reason": f"No provider available after {hub.QUEUE_TIMEOUT_SECONDS}s wait",
                "providers_evaluated": hub.provider_count,
            })
            raise QueueTimeout(hub.QUEUE_TIMEOUT_SECONDS)

        # Provider was assigned by the dispatch loop
        provider = pending.provider
        if provider is None:
            raise NoProviderAvailable("Provider assignment failed.")

        logger.info(
            f"[{request_id[:8]}] Dequeued → {provider.name} "
            f"(waited {time.time() - pending.queued_at:.1f}s)"
        )

        # Re-encrypt if needed (the initial inference_req was built with plaintext)
        if provider.encryption_public_key:
            encrypted_body = encrypt_json(
                {"messages": messages_plain},
                provider.encryption_public_key,
            ).to_dict()
            inference_req = InferenceRequest(
                request_id=request_id,
                model=request.model,
                messages=None,
                encrypted_body=encrypted_body,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
                stream=request.stream,
            )
            logger.info(f"[{request_id[:8]}] 🔐 Request encrypted to provider")

        # Now send to the assigned provider
        queue = hub.create_response_queue(request_id)
        try:
            await hub.send_to_provider(provider, inference_req)
        except Exception as e:
            hub.remove_response_queue(request_id)
            raise ProviderError(f"Failed to reach provider: {e}")

        # Build scoring trace
        scoring_details = []
        for p in hub._providers.values():
            score = p.score_for_request(request.model, request.ocip_preference)
            scoring_details.append({
                "provider_id": p.provider_id,
                "name": p.name,
                "price": p.capabilities.price_per_mtok_output,
                "trust": p.capabilities.trust_level.value,
                "load": round(p.load_factor, 2),
                "tps": p.capabilities.measured_tps,
                "score": round(score, 4),
                "selected": p.provider_id == provider.provider_id,
                "encrypted": bool(p.encryption_public_key),
            })
        scoring_details.sort(key=lambda x: x["score"], reverse=True)

        _add_trace({
            "request_id": request_id[:8],
            "timestamp": time.time(),
            "model": request.model,
            "preference": request.ocip_preference,
            "min_confidence": request.ocip_min_confidence,
            "max_price": request.ocip_max_price,
            "status": "matched_from_queue",
            "wait_seconds": round(time.time() - pending.queued_at, 2),
            "selected_provider": provider.name,
            "selected_price": provider.capabilities.price_per_mtok_output,
            "selected_trust": provider.capabilities.trust_level.value,
            "encrypted": bool(provider.encryption_public_key),
            "scoring": scoring_details,
            "providers_evaluated": len(scoring_details),
        })

        # Publish match event
        bus = get_event_bus()
        if bus is not None:
            bus.publish({
                "type": "match",
                "request_id": request_id,
                "provider": provider.name,
                "model": request.model,
                "source": "queue",
            })

        if request.stream:
            return StreamingResponse(
                _stream_response(request_id, request.model, queue, hub, provider, consumer_id, input_token_estimate),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-OCIP-Provider": provider.name,
                    "X-OCIP-Trust-Level": provider.capabilities.trust_level.value,
                    "X-OCIP-Price-Output": str(provider.capabilities.price_per_mtok_output),
                    "X-OCIP-Queued": "true",
                },
            )
        else:
            return await _collect_response(request_id, request.model, queue, hub, provider, consumer_id, input_token_estimate)

    # Build scoring trace for this decision
    scoring_details = []
    for p in hub._providers.values():
        score = p.score_for_request(request.model, request.ocip_preference)
        scoring_details.append({
            "provider_id": p.provider_id,
            "name": p.name,
            "price": p.capabilities.price_per_mtok_output,
            "trust": p.capabilities.trust_level.value,
            "load": round(p.load_factor, 2),
            "tps": p.capabilities.measured_tps,
            "score": round(score, 4),
            "selected": p.provider_id == provider.provider_id,
            "encrypted": bool(p.encryption_public_key),
        })
    scoring_details.sort(key=lambda x: x["score"], reverse=True)

    request_id = str(uuid.uuid4())

    # Create response queue before sending request
    queue = hub.create_response_queue(request_id)

    # Build request — encrypt if provider supports E2E
    encrypted_body = None

    if provider.encryption_public_key:
        # OCIP E2E: encrypt messages to provider's key
        encrypted_body = encrypt_json(
            {"messages": messages_plain},
            provider.encryption_public_key,
        ).to_dict()
        logger.info(f"[{request_id[:8]}] 🔐 Request encrypted to provider")

    inference_req = InferenceRequest(
        request_id=request_id,
        model=request.model,
        messages=messages_plain if not encrypted_body else None,
        encrypted_body=encrypted_body,
        max_tokens=request.max_tokens,
        temperature=request.temperature,
        stream=request.stream,
    )

    try:
        await hub.send_to_provider(provider, inference_req)
    except Exception as e:
        hub.remove_response_queue(request_id)
        # RETRY: try another provider
        logger.warning(f"[{request_id[:8]}] Provider {provider.name} unreachable, retrying...")
        retry_provider = hub.select_provider(
            request.model,
            preference=request.ocip_preference,
            min_confidence=request.ocip_min_confidence,
            max_price=request.ocip_max_price,
        )
        if retry_provider and retry_provider.provider_id != provider.provider_id:
            queue = hub.create_response_queue(request_id)
            provider = retry_provider  # Use the retry provider for billing/traces
            try:
                await hub.send_to_provider(retry_provider, inference_req)
                logger.info(f"[{request_id[:8]}] Retried on {retry_provider.name}")
            except Exception as e2:
                hub.remove_response_queue(request_id)
                raise ProviderError(f"All providers failed: {e2}")
        else:
            raise ProviderError(f"Failed to reach provider: {e}")

    # Log the full decision trace
    _add_trace({
        "request_id": request_id[:8],
        "timestamp": time.time(),
        "model": request.model,
        "preference": request.ocip_preference,
        "min_confidence": request.ocip_min_confidence,
        "max_price": request.ocip_max_price,
        "status": "matched",
        "selected_provider": provider.name,
        "selected_price": provider.capabilities.price_per_mtok_output,
        "selected_trust": provider.capabilities.trust_level.value,
        "encrypted": bool(provider.encryption_public_key),
        "scoring": scoring_details,
        "providers_evaluated": len(scoring_details),
    })

    # Publish match event
    bus = get_event_bus()
    if bus is not None:
        bus.publish({
            "type": "match",
            "request_id": request_id,
            "provider": provider.name,
            "model": request.model,
            "score": max((s["score"] for s in scoring_details if s["selected"]), default=0),
        })

    if request.stream:
        return StreamingResponse(
            _stream_response(request_id, request.model, queue, hub, provider, consumer_id, input_token_estimate),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-OCIP-Provider": provider.name,
                "X-OCIP-Trust-Level": provider.capabilities.trust_level.value,
                "X-OCIP-Price-Output": str(provider.capabilities.price_per_mtok_output),
            },
        )
    else:
        # Non-streaming: collect all tokens and return as one response
        return await _collect_response(request_id, request.model, queue, hub, provider, consumer_id, input_token_estimate)


async def _stream_response(
    request_id: str, model: str, queue: asyncio.Queue, hub, provider, consumer_id: str,
    input_token_estimate: int,
):
    """Generate SSE stream from provider response chunks."""
    token_count = 0
    start_time = time.time()
    outcome = "success"  # Track outcome for reputation
    try:
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=120.0)
            except asyncio.TimeoutError:
                # Send error and close
                outcome = "timeout"
                error_data = {
                    "error": {"message": "Provider timeout", "type": "timeout"}
                }
                yield f"data: {json.dumps(error_data)}\n\n"
                break

            if isinstance(msg, InferenceResponseChunk):
                token_count += 1
                chunk = {
                    "id": f"chatcmpl-{request_id[:8]}",
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": msg.token},
                            "finish_reason": msg.finish_reason,
                        }
                    ],
                }
                yield f"data: {json.dumps(chunk)}\n\n"

                if msg.finish_reason:
                    break

            elif isinstance(msg, InferenceDone):
                # Final chunk with finish_reason
                chunk = {
                    "id": f"chatcmpl-{request_id[:8]}",
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                }
                yield f"data: {json.dumps(chunk)}\n\n"
                break

            elif isinstance(msg, InferenceError):
                outcome = "disconnect" if msg.error == "provider_disconnected" else "error"
                error_data = {"error": {"message": msg.error, "type": "provider_error"}}
                yield f"data: {json.dumps(error_data)}\n\n"
                break

        yield "data: [DONE]\n\n"

        # Bill the request
        billing = get_billing()
        billing.charge_request(
            request_id=request_id,
            consumer_id=consumer_id,
            provider_id=provider.provider_id,
            model=model,
            input_tokens=input_token_estimate,
            output_tokens=token_count,
            price_per_mtok_input=provider.capabilities.price_per_mtok_input,
            price_per_mtok_output=provider.capabilities.price_per_mtok_output,
        )

        # Publish billing event
        bus = get_event_bus()
        if bus is not None:
            bus.publish({
                "type": "billing",
                "request_id": request_id,
                "consumer_id": consumer_id,
                "provider_id": provider.provider_id,
                "model": model,
                "cost_usd": round(
                    (token_count * provider.capabilities.price_per_mtok_output) / 1_000_000, 6
                ),
                "tokens": token_count,
            })

        # Record TPS measurement
        elapsed = time.time() - start_time
        if token_count > 0 and elapsed > 0:
            tps_tracker = get_tps_tracker()
            tps_tracker.record_request(
                provider_id=provider.provider_id,
                model=model,
                tokens=token_count,
                seconds=elapsed,
                hardware=provider.capabilities.hardware,
            )

        # Record reputation outcome
        reputation = get_reputation_tracker()
        elapsed_ms = int((time.time() - start_time) * 1000)
        if outcome == "success":
            reputation.record_success(provider.provider_id, tokens=token_count, latency_ms=elapsed_ms)
        elif outcome == "timeout":
            reputation.record_timeout(provider.provider_id)
        elif outcome == "disconnect":
            reputation.record_disconnect(provider.provider_id)
        elif outcome == "error":
            reputation.record_error(provider.provider_id)
    finally:
        hub.remove_response_queue(request_id)


async def _collect_response(
    request_id: str, model: str, queue: asyncio.Queue, hub, provider, consumer_id: str,
    input_token_estimate: int,
) -> dict:
    """Collect all tokens into a single non-streaming response."""
    tokens: list[str] = []
    start_time = time.time()
    outcome = "success"
    try:
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=120.0)
            except asyncio.TimeoutError:
                outcome = "timeout"
                # Record reputation before raising
                reputation = get_reputation_tracker()
                reputation.record_timeout(provider.provider_id)
                raise ProviderTimeout()

            if isinstance(msg, InferenceResponseChunk):
                tokens.append(msg.token)
                if msg.finish_reason:
                    break
            elif isinstance(msg, InferenceDone):
                break
            elif isinstance(msg, InferenceError):
                outcome = "error"
                # Record reputation before raising
                reputation = get_reputation_tracker()
                reputation.record_error(provider.provider_id)
                raise ProviderError(msg.error)
    finally:
        hub.remove_response_queue(request_id)

    # Bill the request
    billing = get_billing()
    billing.charge_request(
        request_id=request_id,
        consumer_id=consumer_id,
        provider_id=provider.provider_id,
        model=model,
        input_tokens=input_token_estimate,
        output_tokens=len(tokens),
        price_per_mtok_input=provider.capabilities.price_per_mtok_input,
        price_per_mtok_output=provider.capabilities.price_per_mtok_output,
    )

    # Publish billing event
    bus = get_event_bus()
    if bus is not None:
        bus.publish({
            "type": "billing",
            "request_id": request_id,
            "consumer_id": consumer_id,
            "provider_id": provider.provider_id,
            "model": model,
            "cost_usd": round(
                (len(tokens) * provider.capabilities.price_per_mtok_output) / 1_000_000, 6
            ),
            "tokens": len(tokens),
        })

    # Record TPS
    elapsed = time.time() - start_time
    if len(tokens) > 0 and elapsed > 0:
        tps_tracker = get_tps_tracker()
        tps_tracker.record_request(
            provider_id=provider.provider_id,
            model=model,
            tokens=len(tokens),
            seconds=elapsed,
            hardware=provider.capabilities.hardware,
        )

    # Record reputation — success
    reputation = get_reputation_tracker()
    elapsed_ms = int((time.time() - start_time) * 1000)
    reputation.record_success(provider.provider_id, tokens=len(tokens), latency_ms=elapsed_ms)

    content = "".join(tokens)
    return {
        "id": f"chatcmpl-{request_id[:8]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": input_token_estimate,
            "completion_tokens": len(tokens),
            "total_tokens": input_token_estimate + len(tokens),
        },
    }
