"""Mock inference engine: canned responses, no model or llama-cpp needed.

Used for UI development, CI, and load tests. Speaks the same interface as InferenceEngine.
"""

import time
from collections.abc import Generator

DEFAULT_MOCK_MODEL = "mock-model"


class MockEngine:
    """Returns a deterministic reply, paced to roughly *tps* tokens per second."""

    def __init__(self, model_name: str = DEFAULT_MOCK_MODEL, tps: float = 50.0):
        self._model_name = model_name
        self._delay = 1.0 / tps if tps > 0 else 0.0

    @property
    def model_name(self) -> str:
        return self._model_name

    def _reply(self, messages: list[dict]) -> str:
        last = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "")
        preview = last[:80].replace("\n", " ")
        return f"[mock:{self._model_name}] You said: {preview}. This is a canned response from a mock provider."

    def generate_stream(
        self,
        messages: list[dict],
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> Generator[str, None, None]:
        words = self._reply(messages).split(" ")
        for i, word in enumerate(words[:max_tokens]):
            if self._delay:
                time.sleep(self._delay)
            yield word if i == 0 else " " + word

    def generate(self, messages: list[dict], max_tokens: int = 1024, temperature: float = 0.7) -> str:
        return "".join(self.generate_stream(messages, max_tokens, temperature))
