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
        Path(path).unlink()

    def test_quantization_mapping(self):
        for ftype, expected in [(2, "Q4_0"), (7, "Q5_1"), (17, "Q5_K_M"), (18, "Q6_K")]:
            path = _make_gguf_file(file_type=ftype)
            identity = get_model_identity(path)
            assert identity["quantization"] == expected
            Path(path).unlink()
