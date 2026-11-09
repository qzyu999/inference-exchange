import pytest

from inference_exchange.shared.model_quantization import (
    GGUF_FILE_TYPE_MAP, normalize_quantization, quantization_from_file_type,
)
from inference_exchange.provider.model_identity import get_model_identity
from inference_exchange.coordinator.model_catalog import parse_model_info
from inference_exchange.coordinator.comparison_identity import clean_identity
from test_model_identity import _write_gguf_header


@pytest.mark.parametrize("file_type,label", GGUF_FILE_TYPE_MAP.items())
def test_each_shared_file_type_reaches_provider_and_facets(tmp_path, file_type, label):
    path = tmp_path / "model.gguf"
    with path.open("wb") as stream:
        _write_gguf_header(stream, {
            "general.name": (8, "Example 7B"),
            "general.architecture": (8, "example"),
            "general.file_type": (4, file_type),
        })
    assert get_model_identity(str(path))["quantization"] == label
    facets = parse_model_info("Example 7B", file_type=file_type)
    assert facets["quantization"] == label
    assert "canonical_id" not in facets


@pytest.mark.parametrize("file_type,label", [
    (7, "Q8_0"), (8, "Q5_0"), (9, "Q5_1"), (19, "IQ2_XXS"), (32, "BF16"),
])
def test_file_types_use_llama_ftype_values_not_tensor_type_values(file_type, label):
    assert quantization_from_file_type(file_type) == label


@pytest.mark.parametrize("reported,canonical", [("F16", "FP16"), ("F32", "FP32"), ("fp16", "FP16")])
def test_legacy_spelling_keeps_reported_value_and_normalizes_facets(reported, canonical):
    identity = clean_identity({"quantization": reported})
    assert identity["quantization"] == canonical
    assert identity["reported_quantization"] == reported
    assert normalize_quantization(canonical) == canonical


def test_missing_invalid_and_removed_file_types_are_unknown(tmp_path):
    path = tmp_path / "model-F16.gguf"
    with path.open("wb") as stream:
        _write_gguf_header(stream, {"general.name": (8, "Example F16")})
    assert get_model_identity(str(path))["quantization"] is None
    for value in (None, True, "15", 6, 999, -1):
        assert quantization_from_file_type(value) is None
    assert normalize_quantization("not-a-known-quantization") is None
