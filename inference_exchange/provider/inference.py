"""Inference engine abstraction — wraps llama-cpp-python."""

import logging
import time
from collections.abc import Generator
from pathlib import Path

from llama_cpp import Llama

logger = logging.getLogger(__name__)


class InferenceEngine:
    """Wraps llama-cpp-python for local model inference."""

    def __init__(self, model_path: str, n_ctx: int = 4096, n_gpu_layers: int = -1):
        logger.info(f"Loading model: {model_path}")
        start = time.time()

        self._llm = Llama(
            model_path=model_path,
            n_ctx=n_ctx,
            n_gpu_layers=n_gpu_layers,
            verbose=False,
        )

        elapsed = time.time() - start
        logger.info(f"Model loaded in {elapsed:.1f}s")

    @property
    def model_name(self) -> str:
        """Return a model identifier based on the loaded file."""
        metadata = self._llm.metadata
        name = metadata.get("general.name", "unknown")
        return name

    def generate_stream(
        self,
        messages: list[dict],
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> Generator[str, None, None]:
        """Stream tokens from the model. Yields individual token strings."""
        output = self._llm.create_chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            stream=True,
        )

        for chunk in output:
            delta = chunk["choices"][0].get("delta", {})
            content = delta.get("content")
            if content:
                yield content

    def generate(
        self,
        messages: list[dict],
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> str:
        """Generate a complete response (non-streaming)."""
        output = self._llm.create_chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            stream=False,
        )
        return output["choices"][0]["message"]["content"]


def find_model_path() -> str | None:
    """Find a GGUF model file in the default models directory."""
    from inference_exchange.config import MODELS_DIR

    if not MODELS_DIR.exists():
        return None

    gguf_files = list(MODELS_DIR.glob("*.gguf"))
    if not gguf_files:
        return None

    # Return the first one found
    return str(gguf_files[0])
