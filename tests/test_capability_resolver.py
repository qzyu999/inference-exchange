"""Tests for the capability resolver — three-source merge and cache logic."""

from unittest.mock import patch

import pytest

from inference_exchange.coordinator.capability_resolver import (
    ModelCapabilityCache,
    _capabilities_from_gguf_identity,
    _merge_capabilities,
)
from inference_exchange.shared.protocol import ModelCapabilities, ProviderCapabilities


class TestMergeCapabilities:
    """Test the three-source merge: provider > HF > GGUF."""

    def test_provider_wins_over_hf_and_gguf(self):
        provider = ModelCapabilities(context_length=2048, supports_tool_calling=True)
        hf = ModelCapabilities(context_length=32768, supports_tool_calling=False)
        gguf = ModelCapabilities(context_length=4096)
        result = _merge_capabilities(provider, hf, gguf)
        assert result.context_length == 2048
        assert result.supports_tool_calling is True

    def test_hf_fills_gaps_from_provider(self):
        provider = ModelCapabilities(context_length=0, supports_tool_calling=False)
        hf = ModelCapabilities(context_length=32768, supports_tool_calling=True, architecture="Qwen2ForCausalLM")
        result = _merge_capabilities(provider, hf, None)
        assert result.context_length == 32768
        assert result.supports_tool_calling is True
        assert result.architecture == "Qwen2ForCausalLM"

    def test_gguf_fills_gaps_from_provider_and_hf(self):
        provider = ModelCapabilities()
        hf = ModelCapabilities()
        gguf = ModelCapabilities(context_length=4096, architecture="llama")
        result = _merge_capabilities(provider, hf, gguf)
        assert result.context_length == 4096
        assert result.architecture == "llama"

    def test_all_empty_returns_defaults(self):
        result = _merge_capabilities(ModelCapabilities(), None, None)
        assert result.context_length == 0
        assert result.supports_vision is False
        assert result.supports_tool_calling is False
        assert result.architecture == ""

    def test_vision_from_hf(self):
        provider = ModelCapabilities()
        hf = ModelCapabilities(supports_vision=True, architecture="Qwen2_5_VLForConditionalGeneration")
        result = _merge_capabilities(provider, hf, None)
        assert result.supports_vision is True

    def test_format_from_provider(self):
        provider = ModelCapabilities(model_format="gguf")
        hf = ModelCapabilities()
        result = _merge_capabilities(provider, hf, None)
        assert result.model_format == "gguf"

    def test_repo_id_from_hf(self):
        provider = ModelCapabilities(model_repo_id="")
        hf = ModelCapabilities(model_repo_id="Qwen/Qwen2.5-0.5B-Instruct")
        result = _merge_capabilities(provider, hf, None)
        assert result.model_repo_id == "Qwen/Qwen2.5-0.5B-Instruct"

    def test_provider_repo_id_wins(self):
        provider = ModelCapabilities(model_repo_id="my-org/my-model")
        hf = ModelCapabilities(model_repo_id="Qwen/Qwen2.5-0.5B-Instruct")
        result = _merge_capabilities(provider, hf, None)
        assert result.model_repo_id == "my-org/my-model"


class TestCapabilitiesFromGGUF:
    def test_extracts_context_and_arch(self):
        identity = {"context_length": 4096, "architecture": "llama"}
        caps = _capabilities_from_gguf_identity(identity)
        assert caps.context_length == 4096
        assert caps.architecture == "llama"

    def test_missing_fields_default_to_zero(self):
        caps = _capabilities_from_gguf_identity({})
        assert caps.context_length == 0
        assert caps.architecture == ""


class TestModelCapabilityCache:
    """Test cache behavior without real HF calls."""

    def test_resolve_with_provider_only(self):
        """When HF lookup fails, provider-reported caps are used."""
        cache = ModelCapabilityCache()
        caps = ProviderCapabilities(
            models=["test-model"],
            context_length=8192,
            supports_tool_calling=True,
            model_format="gguf",
        )
        result = cache.resolve(caps, model_identity=None)
        assert result.context_length == 8192
        assert result.supports_tool_calling is True
        assert result.model_format == "gguf"

    def test_resolve_with_gguf_metadata(self):
        """GGUF metadata fills gaps when provider doesn't report."""
        cache = ModelCapabilityCache()
        caps = ProviderCapabilities(models=["test-model"])
        identity = {"context_length": 32768, "architecture": "qwen2"}
        result = cache.resolve(caps, model_identity=identity)
        assert result.context_length == 32768
        assert result.architecture == "qwen2"

    def test_resolve_provider_overrides_gguf(self):
        """Provider-reported context wins over GGUF metadata."""
        cache = ModelCapabilityCache()
        caps = ProviderCapabilities(models=["test-model"], context_length=2048)
        identity = {"context_length": 32768, "architecture": "llama"}
        result = cache.resolve(caps, model_identity=identity)
        assert result.context_length == 2048

    @patch("inference_exchange.coordinator.capability_resolver._detect_capabilities_from_hf")
    @patch("inference_exchange.coordinator.capability_resolver._resolve_base_model")
    def test_hf_result_is_cached(self, mock_resolve, mock_detect):
        """Second call with same repo_id should use cache, not call HF again."""
        mock_resolve.return_value = None  # no base model resolution needed
        mock_detect.return_value = ModelCapabilities(
            context_length=32768,
            supports_tool_calling=True,
            model_repo_id="Qwen/Qwen2.5-0.5B-Instruct",
        )

        cache = ModelCapabilityCache()
        caps = ProviderCapabilities(
            models=["test-model"],
            model_repo_id="Qwen/Qwen2.5-0.5B-Instruct",
        )

        result1 = cache.resolve(caps)
        result2 = cache.resolve(caps)

        assert result1.context_length == 32768
        assert result2.context_length == 32768
        # HF was called only once
        assert mock_detect.call_count == 1

    @patch("inference_exchange.coordinator.capability_resolver._detect_capabilities_from_hf")
    @patch("inference_exchange.coordinator.capability_resolver._resolve_base_model")
    def test_failed_lookup_is_cached(self, mock_resolve, mock_detect):
        """Failed HF lookups are cached to avoid hammering the API."""
        mock_resolve.return_value = None
        mock_detect.return_value = None  # HF lookup failed

        cache = ModelCapabilityCache()
        caps = ProviderCapabilities(
            models=["test-model"],
            model_repo_id="private/gated-model",
        )

        result1 = cache.resolve(caps)
        result2 = cache.resolve(caps)

        assert result1.context_length == 0
        # HF was called only once despite two resolve() calls
        assert mock_detect.call_count == 1

    @patch("inference_exchange.coordinator.capability_resolver._detect_capabilities_from_hf")
    @patch("inference_exchange.coordinator.capability_resolver._resolve_base_model")
    def test_base_model_resolution(self, mock_resolve, mock_detect):
        """GGUF repos resolve to base model before HF lookup."""
        mock_resolve.return_value = "Qwen/Qwen2.5-0.5B-Instruct"
        mock_detect.return_value = ModelCapabilities(
            context_length=32768,
            supports_tool_calling=True,
        )

        cache = ModelCapabilityCache()
        caps = ProviderCapabilities(
            models=["test-model"],
            model_repo_id="bartowski/Qwen2.5-0.5B-Instruct-GGUF",
        )

        result = cache.resolve(caps)
        assert result.context_length == 32768
        # Looked up the base model, not the GGUF repo
        mock_detect.assert_called_once_with("Qwen/Qwen2.5-0.5B-Instruct")
