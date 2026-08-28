"""Configuration for coordinator and provider."""

from pathlib import Path

from pydantic import BaseModel


# Default model for local testing — small enough to run on any machine
DEFAULT_MODEL_REPO = "bartowski/Qwen2.5-0.5B-Instruct-GGUF"
DEFAULT_MODEL_FILE = "Qwen2.5-0.5B-Instruct-Q4_K_M.gguf"

# Where models are stored locally
MODELS_DIR = Path.home() / ".inference-exchange" / "models"


class CoordinatorConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8000
    # For local dev, no auth required
    require_auth: bool = False


class ProviderConfig(BaseModel):
    coordinator_url: str = "ws://localhost:8000/ws/provider"
    model_path: str | None = None  # Auto-detected if None
    provider_name: str = "local-provider"
    # Max concurrent requests this provider handles
    max_concurrent: int = 2
    # Context window size
    n_ctx: int = 4096
    # Number of GPU layers (-1 = all, 0 = CPU only)
    n_gpu_layers: int = -1
