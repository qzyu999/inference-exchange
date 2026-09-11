# coordinator/api.py — backward compatibility re-exports
#
# The original api.py has been split into focused route modules. This file
# re-exports the public API and assembles the coordinator router.

from .dependencies import (  # noqa: F401
    MAX_TRACES,
    _add_trace,
    _rate_limiter,
    _request_traces,
    get_auth,
    get_billing,
    get_event_bus,
    get_hub,
    get_reputation_tracker,
    get_tps_tracker,
    set_auth,
    set_billing,
    set_event_bus,
    set_hub,
    set_reputation,
    set_tps_tracker,
)
from .routes_inference import (  # noqa: F401
    ChatCompletionRequest,
    ChatMessage,
    ModelInfo,
    _collect_response,
    _estimate_input_tokens,
    _stream_response,
    chat_completions,
)

from fastapi import APIRouter

from .routes_admin import router as _admin_router
from .routes_auth import router as _auth_router
from .routes_exchange import router as _exchange_router
from .routes_handshake import router as _handshake_router
from .routes_inference import router as _inference_router

router = APIRouter()
router.include_router(_auth_router)
router.include_router(_exchange_router)
router.include_router(_admin_router)
router.include_router(_handshake_router)
router.include_router(_inference_router)
