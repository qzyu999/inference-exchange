"""Model identity — reads GGUF metadata and computes file hash for verification.

This is how a provider proves what model they're running:
1. Read embedded metadata from the GGUF file (name, architecture, params)
2. Compute SHA-256 of the file (unique fingerprint)
3. Report both to the coordinator
4. Coordinator verifies hash against HuggingFace's published hashes

The metadata is embedded in the GGUF binary — the provider can't fake it
without modifying the file, which would change the hash.
"""

import hashlib
import logging
import struct
from pathlib import Path

logger = logging.getLogger(__name__)


# GGUF magic and header constants
GGUF_MAGIC = 0x46554747  # b'GGUF' read as little-endian uint32


def compute_file_hash(filepath: str) -> str:
    """Compute SHA-256 hash of a model file.

    This is the primary identity proof. HuggingFace publishes the SHA-256
    of every file in LFS — if our hash matches, we know it's genuine.
    """
    h = hashlib.sha256()
    size = 0
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
            size += len(chunk)
    digest = h.hexdigest()
    logger.info(f"File hash: {digest[:16]}... ({size / 1e6:.1f} MB)")
    return digest


def read_gguf_metadata(filepath: str) -> dict:
    """Read metadata from a GGUF file header.

    GGUF format stores key-value metadata in the file header.
    We extract: model name, architecture, quantization, context length, etc.
    """
    metadata = {}

    try:
        with open(filepath, "rb") as f:
            # Read magic
            magic = struct.unpack("<I", f.read(4))[0]
            if magic != GGUF_MAGIC:
                logger.warning(f"Not a GGUF file (magic={hex(magic)})")
                return metadata

            # Read version
            version = struct.unpack("<I", f.read(4))[0]
            metadata["_gguf_version"] = version

            # Read tensor count and metadata kv count
            tensor_count = struct.unpack("<Q", f.read(8))[0]
            kv_count = struct.unpack("<Q", f.read(8))[0]
            metadata["_tensor_count"] = tensor_count

            # Read key-value pairs
            for _ in range(min(kv_count, 200)):  # Cap to avoid reading huge files
                try:
                    key = _read_string(f)
                    value_type = struct.unpack("<I", f.read(4))[0]
                    value = _read_value(f, value_type)
                    if key and value is not None:
                        metadata[key] = value
                except (struct.error, UnicodeDecodeError, ValueError):
                    break  # Malformed metadata — stop reading

    except Exception as e:
        logger.error(f"Failed to read GGUF metadata: {e}")

    return metadata


def _read_string(f) -> str:
    """Read a GGUF string (length-prefixed)."""
    length = struct.unpack("<Q", f.read(8))[0]
    if length > 10000:  # Sanity check
        raise ValueError(f"String too long: {length}")
    return f.read(length).decode("utf-8", errors="replace")


def _read_value(f, value_type: int):
    """Read a GGUF value based on its type."""
    # Type constants from GGUF spec
    GGUF_TYPE_UINT8 = 0
    GGUF_TYPE_INT8 = 1
    GGUF_TYPE_UINT16 = 2
    GGUF_TYPE_INT16 = 3
    GGUF_TYPE_UINT32 = 4
    GGUF_TYPE_INT32 = 5
    GGUF_TYPE_FLOAT32 = 6
    GGUF_TYPE_BOOL = 7
    GGUF_TYPE_STRING = 8
    GGUF_TYPE_ARRAY = 9
    GGUF_TYPE_UINT64 = 10
    GGUF_TYPE_INT64 = 11
    GGUF_TYPE_FLOAT64 = 12

    if value_type == GGUF_TYPE_UINT8:
        return struct.unpack("<B", f.read(1))[0]
    elif value_type == GGUF_TYPE_INT8:
        return struct.unpack("<b", f.read(1))[0]
    elif value_type == GGUF_TYPE_UINT16:
        return struct.unpack("<H", f.read(2))[0]
    elif value_type == GGUF_TYPE_INT16:
        return struct.unpack("<h", f.read(2))[0]
    elif value_type == GGUF_TYPE_UINT32:
        return struct.unpack("<I", f.read(4))[0]
    elif value_type == GGUF_TYPE_INT32:
        return struct.unpack("<i", f.read(4))[0]
    elif value_type == GGUF_TYPE_FLOAT32:
        return struct.unpack("<f", f.read(4))[0]
    elif value_type == GGUF_TYPE_BOOL:
        return struct.unpack("<B", f.read(1))[0] != 0
    elif value_type == GGUF_TYPE_STRING:
        return _read_string(f)
    elif value_type == GGUF_TYPE_UINT64:
        return struct.unpack("<Q", f.read(8))[0]
    elif value_type == GGUF_TYPE_INT64:
        return struct.unpack("<q", f.read(8))[0]
    elif value_type == GGUF_TYPE_FLOAT64:
        return struct.unpack("<d", f.read(8))[0]
    elif value_type == GGUF_TYPE_ARRAY:
        # Read array type and length, skip the data
        arr_type = struct.unpack("<I", f.read(4))[0]
        arr_len = struct.unpack("<Q", f.read(8))[0]
        # For simplicity, skip arrays (they can be huge)
        # Just read and discard
        items = []
        for _ in range(min(arr_len, 10)):
            items.append(_read_value(f, arr_type))
        # Skip remaining
        for _ in range(arr_len - min(arr_len, 10)):
            _read_value(f, arr_type)
        return items if arr_len <= 10 else f"[array of {arr_len}]"
    else:
        return None


def get_model_identity(filepath: str) -> dict:
    """Get complete model identity from a GGUF file.

    Returns a dict with:
    - name: human-readable model name
    - architecture: model architecture (llama, qwen2, etc.)
    - file_hash: SHA-256 of the file
    - quantization: quantization type
    - context_length: max context window
    - parameters: estimated parameter count
    - filename: basename of the file
    """
    path = Path(filepath)

    # Read metadata from GGUF header
    metadata = read_gguf_metadata(filepath)

    # Compute file hash (can be slow for large files — do it in background later)
    # For now, skip hash for files > 2GB (too slow for POC)
    file_size = path.stat().st_size
    if file_size < 2_000_000_000:
        file_hash = compute_file_hash(filepath)
    else:
        file_hash = f"skipped-{file_size}"
        logger.info(f"Skipping hash for large file ({file_size / 1e9:.1f} GB)")

    # Extract useful fields
    name = metadata.get("general.name", path.stem)
    architecture = metadata.get("general.architecture", "unknown")

    # Determine quantization from file_type
    file_type = metadata.get("general.file_type", 0)
    quant_map = {
        0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 6: "Q5_0",
        7: "Q5_1", 8: "Q8_0", 9: "Q8_1", 10: "Q2_K", 11: "Q3_K_S",
        12: "Q3_K_M", 13: "Q3_K_L", 14: "Q4_K_S", 15: "Q4_K_M",
        16: "Q5_K_S", 17: "Q5_K_M", 18: "Q6_K", 19: "Q8_K",
    }
    quantization = quant_map.get(file_type, f"type_{file_type}")

    # Context length
    ctx_key = f"{architecture}.context_length"
    context_length = metadata.get(ctx_key, 0)

    # Estimate parameters from tensor count and architecture
    block_count = metadata.get(f"{architecture}.block_count", 0)
    embed_length = metadata.get(f"{architecture}.embedding_length", 0)

    identity = {
        "name": name,
        "architecture": architecture,
        "quantization": quantization,
        "file_hash": file_hash,
        "file_size_bytes": file_size,
        "filename": path.name,
        "context_length": context_length,
        "block_count": block_count,
        "embedding_length": embed_length,
    }

    logger.info(
        f"Model identity: {name} ({architecture}, {quantization}, "
        f"{file_size / 1e6:.0f}MB, ctx={context_length})"
    )

    return identity
