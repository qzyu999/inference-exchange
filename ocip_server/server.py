"""OCIP Inference Server — isolated inference process.

Listens on a local TCP port (localhost only) or named pipe.
Serves OpenAI-compatible chat completions.
In production: hardened (PT_DENY_ATTACH on macOS, mitigation policies on Windows).

This process:
- Has NO network access to the outside world
- Only accepts connections from localhost (the OCIP agent)
- Runs llama-cpp-python for actual inference
- Reports model identity (GGUF metadata + hash) on a /identity endpoint
"""

import argparse
import json
import logging
import time
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from inference_exchange.provider.model_identity import get_model_identity

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [ocip-server] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    messages: list[dict]
    max_tokens: int = 1024
    temperature: float = 0.7
    stream: bool = True


def create_app(model_path: str, n_ctx: int = 4096, n_gpu_layers: int = -1) -> FastAPI:
    """Create the isolated inference FastAPI app."""
    from llama_cpp import Llama

    app = FastAPI(title="OCIP Inference Server (isolated)")

    # Load model
    logger.info(f"Loading model: {model_path}")
    start = time.time()
    llm = Llama(model_path=model_path, n_ctx=n_ctx, n_gpu_layers=n_gpu_layers, verbose=False)
    logger.info(f"Model loaded in {time.time() - start:.1f}s")

    # Read identity
    identity = get_model_identity(model_path)
    logger.info(f"Model: {identity['name']} ({identity['architecture']}, {identity['quantization']})")
    logger.info(f"Hash:  {identity['file_hash'][:16]}...")

    @app.get("/identity")
    async def get_identity():
        """Return model identity (GGUF metadata + hash). Used by OCIP agent."""
        return identity

    @app.get("/health")
    async def health():
        return {"status": "ok", "model": identity["name"], "server": "ocip-inference-server"}

    @app.post("/v1/chat/completions")
    async def chat_completions(request: ChatRequest):
        """OpenAI-compatible completions — local only."""
        if request.stream:
            return StreamingResponse(
                _stream(llm, request),
                media_type="text/event-stream",
            )
        else:
            output = llm.create_chat_completion(
                messages=request.messages,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
                stream=False,
            )
            return output

    return app


def _stream(llm, request: ChatRequest):
    """Generate SSE stream."""
    output = llm.create_chat_completion(
        messages=request.messages,
        max_tokens=request.max_tokens,
        temperature=request.temperature,
        stream=True,
    )
    for chunk in output:
        yield f"data: {json.dumps(chunk)}\n\n"
    yield "data: [DONE]\n\n"


def main():
    parser = argparse.ArgumentParser(description="OCIP Inference Server (isolated process)")
    parser.add_argument("--model", required=True, help="Path to GGUF model file")
    parser.add_argument("--port", type=int, default=9999, help="Local port (localhost only)")
    parser.add_argument("--n-ctx", type=int, default=4096, help="Context window")
    parser.add_argument("--n-gpu-layers", type=int, default=-1, help="GPU layers")
    args = parser.parse_args()

    logger.info("=" * 50)
    logger.info("  OCIP INFERENCE SERVER (isolated process)")
    logger.info("  Listening on: localhost:%d ONLY", args.port)
    logger.info("  No external network access")
    logger.info("=" * 50)

    app = create_app(args.model, args.n_ctx, args.n_gpu_layers)
    # CRITICAL: bind to 127.0.0.1 ONLY — not 0.0.0.0
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
