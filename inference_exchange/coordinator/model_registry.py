"""Model registry — discovers models from HuggingFace and tracks provider availability.

Provides:
- Search HuggingFace for GGUF models
- Track which providers have which models (with file hashes for verification)
- Map model aliases to canonical names
- Estimate expected TPS for a given hardware + model combination
"""

import hashlib
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class ModelInfo:
    """A known model in the registry."""

    model_id: str  # e.g. "meta-llama/Llama-3.1-8B-Instruct"
    name: str  # Short display name, e.g. "llama-3.1-8b-instruct"
    repo_id: str  # HuggingFace repo, e.g. "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF"
    filename: str  # e.g. "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
    size_bytes: int = 0
    quantization: str = ""  # e.g. "Q4_K_M"
    parameter_count: str = ""  # e.g. "8B"
    sha256: str = ""  # File hash for verification
    hf_downloads: int = 0
    last_updated: float = field(default_factory=time.time)


@dataclass
class ProviderModel:
    """A model instance on a specific provider."""

    provider_id: str
    model_id: str
    file_hash: str = ""  # SHA-256 reported by provider
    verified: bool = False  # Hash matches known good hash
    loaded: bool = False  # Currently in memory (warm)


class ModelRegistry:
    """Tracks available models across the provider fleet.

    Two data sources:
    1. Provider self-reports (on registration + heartbeat)
    2. HuggingFace API (for model metadata and hash verification)
    """

    def __init__(self):
        self._models: dict[str, ModelInfo] = {}  # model_id → info
        self._provider_models: dict[str, list[ProviderModel]] = {}  # provider_id → models
        self._aliases: dict[str, str] = {}  # alias → model_id

    def register_model_from_hf(self, repo_id: str, filename: str) -> ModelInfo | None:
        """Fetch model info from HuggingFace and register it.

        Requires: pip install huggingface_hub
        """
        try:
            from huggingface_hub import hf_hub_url, HfApi

            api = HfApi()
            repo_info = api.repo_info(repo_id)

            # Find the specific file
            file_info = None
            for sibling in repo_info.siblings:
                if sibling.rfilename == filename:
                    file_info = sibling
                    break

            if not file_info:
                logger.warning(f"File {filename} not found in {repo_id}")
                return None

            # Extract metadata
            model_id = f"{repo_id}/{filename}"
            name = filename.replace(".gguf", "").lower().replace("-", " ")

            # Parse quantization from filename
            quant = ""
            for q in ["Q2_K", "Q3_K_S", "Q3_K_M", "Q3_K_L", "Q4_0", "Q4_K_S",
                      "Q4_K_M", "Q5_0", "Q5_K_S", "Q5_K_M", "Q6_K", "Q8_0", "F16"]:
                if q in filename:
                    quant = q
                    break

            info = ModelInfo(
                model_id=model_id,
                name=name,
                repo_id=repo_id,
                filename=filename,
                size_bytes=file_info.size or 0,
                quantization=quant,
                sha256=file_info.lfs.sha256 if file_info.lfs else "",
                hf_downloads=repo_info.downloads or 0,
            )

            self._models[model_id] = info
            logger.info(f"Registered model from HF: {name} ({quant}, {info.size_bytes / 1e9:.1f}GB)")
            return info

        except ImportError:
            logger.warning("huggingface_hub not installed — cannot fetch model info")
            return None
        except Exception as e:
            logger.error(f"Failed to fetch model info from HF: {e}")
            return None

    def search_hf_models(self, query: str, limit: int = 20) -> list[dict]:
        """Search HuggingFace for GGUF models matching a query.

        Returns lightweight metadata (no download, just API lookup).
        """
        try:
            from huggingface_hub import HfApi

            api = HfApi()
            results = api.list_models(
                search=query,
                filter="gguf",
                sort="downloads",
                limit=limit,
            )

            models = []
            for model in results:
                models.append({
                    "repo_id": model.id,
                    "author": model.author,
                    "downloads": model.downloads,
                    "last_modified": str(model.last_modified) if model.last_modified else None,
                    "tags": model.tags[:10] if model.tags else [],
                    "pipeline_tag": model.pipeline_tag,
                })
            return models

        except ImportError:
            logger.warning("huggingface_hub not installed")
            return []
        except Exception as e:
            logger.error(f"HF search failed: {e}")
            return []

    def register_provider_model(
        self, provider_id: str, model_name: str, file_hash: str = ""
    ) -> ProviderModel:
        """Register that a provider has a specific model available."""
        pm = ProviderModel(
            provider_id=provider_id,
            model_id=model_name,
            file_hash=file_hash,
        )

        # Verify hash if we have a known good hash
        if file_hash and model_name in self._models:
            known_hash = self._models[model_name].sha256
            if known_hash and file_hash == known_hash:
                pm.verified = True
                logger.info(f"Model hash verified: {model_name} on {provider_id}")

        if provider_id not in self._provider_models:
            self._provider_models[provider_id] = []
        self._provider_models[provider_id].append(pm)

        return pm

    def get_providers_for_model(self, model_name: str) -> list[str]:
        """Get all provider IDs that have a given model."""
        providers = []
        for pid, models in self._provider_models.items():
            for pm in models:
                if pm.model_id == model_name or model_name == "default":
                    providers.append(pid)
                    break
        return providers

    def resolve_alias(self, name: str) -> str:
        """Resolve a model alias to its canonical ID."""
        return self._aliases.get(name, name)

    def add_alias(self, alias: str, model_id: str):
        """Add a model alias (e.g. 'llama-3' → 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/...')"""
        self._aliases[alias] = model_id

    def list_available_models(self) -> list[dict]:
        """List all models with at least one provider."""
        available = {}
        for pid, models in self._provider_models.items():
            for pm in models:
                if pm.model_id not in available:
                    available[pm.model_id] = {
                        "model_id": pm.model_id,
                        "providers": 0,
                        "verified": 0,
                    }
                available[pm.model_id]["providers"] += 1
                if pm.verified:
                    available[pm.model_id]["verified"] += 1
        return list(available.values())

    def remove_provider(self, provider_id: str):
        """Remove a provider's models when they disconnect."""
        self._provider_models.pop(provider_id, None)


def compute_file_hash(filepath: str, algorithm: str = "sha256") -> str:
    """Compute SHA-256 hash of a model file (for verification)."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()
