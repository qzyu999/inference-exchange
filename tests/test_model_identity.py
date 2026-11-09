"""Tests for GGUF model identity parsing."""

import struct
import tempfile
from pathlib import Path

import pytest

from inference_exchange.provider.model_identity import (
    compute_file_hash,
    get_model_identity,
    read_gguf_metadata,
)


GGUF_MAGIC = 0x46554747  # b'GGUF'


def _write_gguf_header(f, kv_pairs: dict, tensor_count: int = 0):
    """Write a minimal GGUF header with the given key-value pairs."""
    f.write(struct.pack("<I", GGUF_MAGIC))  # magic
    f.write(struct.pack("<I", 3))  # version 3
    f.write(struct.pack("<Q", tensor_count))  # tensor count
    f.write(struct.pack("<Q", len(kv_pairs)))  # kv count

    for key, (vtype, value) in kv_pairs.items():
        # Write key string
        key_bytes = key.encode("utf-8")
        f.write(struct.pack("<Q", len(key_bytes)))
        f.write(key_bytes)
        # Write type
        f.write(struct.pack("<I", vtype))
        # Write value based on type
        if vtype == 8:  # string
            val_bytes = value.encode("utf-8")
            f.write(struct.pack("<Q", len(val_bytes)))
            f.write(val_bytes)
        elif vtype == 4:  # uint32
            f.write(struct.pack("<I", value))
        elif vtype == 5:  # int32
            f.write(struct.pack("<i", value))
        elif vtype == 10:  # uint64
            f.write(struct.pack("<Q", value))


def _make_gguf_file(name="TestModel", arch="llama", file_type=15) -> str:
    """Create a minimal GGUF file with metadata. Returns path."""
    tmp = tempfile.NamedTemporaryFile(suffix=".gguf", delete=False)
    kv = {
        "general.name": (8, name),
        "general.architecture": (8, arch),
        "general.file_type": (4, file_type),
        f"{arch}.context_length": (4, 4096),
        f"{arch}.block_count": (4, 32),
        f"{arch}.embedding_length": (4, 4096),
    }
    _write_gguf_header(tmp, kv)
    # Add some padding to make it a real file
    tmp.write(b"\x00" * 1024)
    tmp.close()
    return tmp.name


class TestComputeFileHash:
    def test_hash_is_deterministic(self):
        path = _make_gguf_file()
        h1 = compute_file_hash(path)
        h2 = compute_file_hash(path)
        assert h1 == h2
        assert len(h1) == 64  # SHA-256 hex digest
        Path(path).unlink()

    def test_different_files_different_hashes(self):
        p1 = _make_gguf_file(name="Model A")
        p2 = _make_gguf_file(name="Model B")
        assert compute_file_hash(p1) != compute_file_hash(p2)
        Path(p1).unlink()
        Path(p2).unlink()


class TestReadGGUFMetadata:
    def test_reads_model_name(self):
        path = _make_gguf_file(name="Qwen2.5 0.5B Instruct")
        meta = read_gguf_metadata(path)
        assert meta.get("general.name") == "Qwen2.5 0.5B Instruct"
        Path(path).unlink()

    def test_reads_architecture(self):
        path = _make_gguf_file(arch="qwen2")
        meta = read_gguf_metadata(path)
        assert meta.get("general.architecture") == "qwen2"
        Path(path).unlink()

    def test_reads_context_length(self):
        path = _make_gguf_file(arch="llama")
        meta = read_gguf_metadata(path)
        assert meta.get("llama.context_length") == 4096
        Path(path).unlink()

    def test_non_gguf_returns_empty(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".bin", delete=False)
        tmp.write(b"not a gguf file")
        tmp.close()
        meta = read_gguf_metadata(tmp.name)
        assert meta == {} or "_gguf_version" not in meta
        Path(tmp.name).unlink()


class TestGetModelIdentity:
    def test_full_identity(self):
        path = _make_gguf_file(name="TestLlama", arch="llama", file_type=15)
        identity = get_model_identity(path)
        assert identity["name"] == "TestLlama"
        assert identity["architecture"] == "llama"
        assert identity["quantization"] == "Q4_K_M"  # file_type 15
        assert identity["context_length"] == 4096
        assert identity["file_hash"]  # non-empty
        assert identity["filename"].endswith(".gguf")
        assert "repo_id" in identity  # new field, may be empty for test files
        Path(path).unlink()

    def test_quantization_mapping(self):
        for ftype, expected in [(2, "Q4_0"), (7, "Q8_0"), (8, "Q5_0"), (9, "Q5_1"), (17, "Q5_K_M"), (18, "Q6_K")]:
            path = _make_gguf_file(file_type=ftype)
            identity = get_model_identity(path)
            assert identity["quantization"] == expected
            Path(path).unlink()

    def test_repo_id_from_hf_cache_path(self):
        """Files in the HuggingFace cache have a structured path."""
        # Simulate a HF cache path: models--org--name/snapshots/hash/file.gguf
        import os
        hf_dir = Path(tempfile.mkdtemp()) / "models--meta-llama--Llama-3.1-8B-Instruct" / "snapshots" / "abc123"
        hf_dir.mkdir(parents=True)
        src = _make_gguf_file(name="Llama-3.1-8B")
        dest = str(hf_dir / "model.gguf")
        os.rename(src, dest)
        identity = get_model_identity(dest)
        assert identity["repo_id"] == "meta-llama/Llama-3.1-8B-Instruct"
        Path(dest).unlink()

    def test_repo_id_empty_for_plain_paths(self):
        """Files not in HF cache and without GGUF metadata have no repo_id."""
        path = _make_gguf_file(name="SomeModel")
        identity = get_model_identity(path)
        assert identity["repo_id"] == ""
        Path(path).unlink()


def test_structured_gguf_fields_keep_variant_source_and_lineage_separate(tmp_path):
    from inference_exchange.coordinator.comparison_identity import ExactCatalog
    from inference_exchange.coordinator.model_facets import facets_from_identity
    path = tmp_path / "model.gguf"
    metadata = {
        "general.name": (8, "Local"),
        "general.basename": (8, "Example"),
        "general.version": (8, "2.1"),
        "general.size_label": (8, "30B-A3B"),
        "general.finetune": (8, "Instruct-Coder"),
        "general.source.huggingface.repository": (8, "org/instruct"),
        "general.base_model.count": (4, 1),
        "general.base_model.0.name": (8, "Base ancestor"),
        "general.base_model.0.repo_url": (8, "https://huggingface.co/org/base"),
        "general.file_type": (4, 15),
    }
    with path.open("wb") as stream:
        _write_gguf_header(stream, metadata)
    identity = get_model_identity(str(path))
    assert identity["repo_id"] == "org/instruct"
    assert identity["gguf"]["base_models"][0]["repo_url"] == "https://huggingface.co/org/base"
    facets = facets_from_identity(identity)
    assert facets.display_name == "Example 2.1 30B-A3B Instruct-Coder"
    assert facets.total_parameters == 30_000_000_000
    assert facets.active_parameters == 3_000_000_000
    assert facets.variant_tags == frozenset({"instruct", "coder"})
    assert facets.family is None
    resolver = ExactCatalog([
        {"id": "catalog/base", "source_ids": [{"source": "huggingface", "model_id": "org/base"}]},
        {"id": "catalog/instruct", "source_ids": [{"source": "huggingface", "model_id": "org/instruct"}]},
    ])
    resolution = resolver.local_resolution("p", "Local", identity)
    assert resolution.comparison_id == "catalog/instruct"
    assert resolution.identity_trust == "reported"
    assert "verified" not in identity
    assert identity["file_hash"] == compute_file_hash(str(path))
    identity["repo_id"] = ""
    identity["gguf"]["conversion_source_repository"] = None
    assert resolver.local("p", "Local", identity).startswith("ie/")


def test_source_url_and_metadata_limits_never_use_base_repository(tmp_path):
    path = tmp_path / "model.gguf"
    metadata = {
        "general.source.url": (8, "https://huggingface.co/org/instruct"),
        "general.basename": (8, "x" * 513),
        "general.version": (4, 7),
        "general.base_model.count": (4, 20),
        "general.base_model.0.repo_url": (8, "https://huggingface.co/org/base"),
    }
    with path.open("wb") as stream:
        _write_gguf_header(stream, metadata)
    identity = get_model_identity(str(path))
    assert identity["repo_id"] == "org/instruct"
    assert identity["gguf"]["basename"] is None
    assert identity["gguf"]["version"] is None
    assert len(identity["gguf"]["base_models"]) == 16
    assert identity["quantization"] is None


def test_unsupported_source_urls_cannot_supply_a_repository():
    from inference_exchange.shared.model_sources import hf_repo_from_url, hf_repo_id
    for value in (
        "http://huggingface.co/org/model", "https://example.com/org/model",
        "https://user:password@huggingface.co/org/model",
        "https://huggingface.co/org/model/resolve/main/file.gguf",
        "https://huggingface.co/org/model?redirect=other",
        "https://huggingface.co:invalid/org/model",
    ):
        assert hf_repo_from_url(value) is None
    assert hf_repo_id("../model") is None
    assert hf_repo_from_url("https://huggingface.co/org/model") == "org/model"
