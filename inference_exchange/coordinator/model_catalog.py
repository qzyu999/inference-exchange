"""Model catalog -- normalize model identities into a canonical format.

Handles:
- GGUF metadata (from the agent's model_identity)
- HuggingFace repo IDs (meta-llama/Llama-3.1-8B-Instruct)
- Plain model names (llama-3.1-8b, qwen2.5-0.5b)
- Engine-reported names (from /v1/models)

Produces a structured ModelInfo with: family, size, variant, format, quantization.
"""

import re
import logging

logger = logging.getLogger(__name__)


# Known model families with canonical names
FAMILIES = {
    "llama": "Llama",
    "qwen": "Qwen",
    "mistral": "Mistral",
    "gemma": "Gemma",
    "phi": "Phi",
    "deepseek": "DeepSeek",
    "yi": "Yi",
    "codellama": "CodeLlama",
    "starcoder": "StarCoder",
    "falcon": "Falcon",
    "vicuna": "Vicuna",
    "command": "Command-R",
    "mpt": "MPT",
    "olmo": "OLMo",
}

# Parameter size patterns
SIZE_PATTERNS = [
    (r"(\d+\.?\d*)b\b", lambda m: f"{m.group(1)}B"),  # 8b, 0.5b, 70b
    (r"(\d+)x(\d+)b", lambda m: f"{m.group(1)}x{m.group(2)}B"),  # 8x7b (MoE)
]

# Variant patterns
VARIANT_KEYWORDS = {
    "instruct": "Instruct",
    "chat": "Chat",
    "code": "Code",
    "base": "Base",
    "coder": "Coder",
    "math": "Math",
    "vision": "Vision",
}

# Quantization patterns (from GGUF file_type or filename)
QUANT_PATTERNS = {
    "q4_k_m": "Q4_K_M", "q4_k_s": "Q4_K_S", "q4_0": "Q4_0", "q4_1": "Q4_1",
    "q5_k_m": "Q5_K_M", "q5_k_s": "Q5_K_S", "q5_0": "Q5_0", "q5_1": "Q5_1",
    "q6_k": "Q6_K", "q8_0": "Q8_0", "q8_k": "Q8_K",
    "q2_k": "Q2_K", "q3_k_s": "Q3_K_S", "q3_k_m": "Q3_K_M", "q3_k_l": "Q3_K_L",
    "f16": "FP16", "f32": "FP32", "fp16": "FP16", "bf16": "BF16",
    "awq": "AWQ", "gptq": "GPTQ", "exl2": "EXL2",
}

# GGUF file_type to quantization name
GGUF_FILE_TYPE_MAP = {
    0: "FP32", 1: "FP16", 2: "Q4_0", 3: "Q4_1", 6: "Q5_0",
    7: "Q5_1", 8: "Q8_0", 9: "Q8_1", 10: "Q2_K", 11: "Q3_K_S",
    12: "Q3_K_M", 13: "Q3_K_L", 14: "Q4_K_S", 15: "Q4_K_M",
    16: "Q5_K_S", 17: "Q5_K_M", 18: "Q6_K", 19: "Q8_K",
}


def parse_model_info(
    name: str,
    architecture: str = "",
    quantization: str = "",
    file_type: int | None = None,
    context_length: int = 0,
) -> dict:
    """Parse a model name/identity into structured fields.

    Returns: {family, size, variant, quantization, format, display_name, canonical_id}
    """
    name_lower = name.lower().replace("-", " ").replace("_", " ").replace("/", " ")

    # Detect family
    family = ""
    family_display = ""
    for key, display in FAMILIES.items():
        if key in name_lower:
            family = key
            family_display = display
            break

    # Detect size
    size = ""
    for pattern, formatter in SIZE_PATTERNS:
        match = re.search(pattern, name_lower)
        if match:
            size = formatter(match)
            break

    # Detect variant
    variant = ""
    for key, display in VARIANT_KEYWORDS.items():
        if key in name_lower:
            variant = display
            break

    # Detect quantization
    quant = quantization
    if not quant and file_type is not None:
        quant = GGUF_FILE_TYPE_MAP.get(file_type, "")
    if not quant:
        for key, display in QUANT_PATTERNS.items():
            if key in name_lower:
                quant = display
                break

    # Detect format
    fmt = ""
    if "gguf" in name_lower or quant in GGUF_FILE_TYPE_MAP.values():
        fmt = "GGUF"
    elif "awq" in name_lower:
        fmt = "AWQ"
    elif "gptq" in name_lower:
        fmt = "GPTQ"
    elif "safetensors" in name_lower:
        fmt = "SafeTensors"

    # Build display name
    parts = [family_display or family or name.split()[0]]
    if size:
        parts.append(size)
    if variant:
        parts.append(variant)
    display_name = " ".join(parts) or name

    # Canonical ID for grouping (family + size + variant, ignoring quantization)
    canonical_id = f"{family or 'unknown'}-{size or 'unknown'}-{variant or 'base'}".lower()

    return {
        "family": family,
        "family_display": family_display,
        "size": size,
        "variant": variant,
        "quantization": quant,
        "format": fmt,
        "context_length": context_length,
        "display_name": display_name,
        "canonical_id": canonical_id,
        "original_name": name,
    }


def parse_from_gguf_identity(identity: dict) -> dict:
    """Parse from a model_identity dict (from GGUF metadata)."""
    return parse_model_info(
        name=identity.get("name", ""),
        architecture=identity.get("architecture", ""),
        quantization=identity.get("quantization", ""),
        context_length=identity.get("context_length", 0),
    )


def parse_from_hf_repo(repo_id: str) -> dict:
    """Parse from a HuggingFace repo ID like 'meta-llama/Llama-3.1-8B-Instruct'."""
    # Take the model name part (after the /)
    name = repo_id.split("/")[-1] if "/" in repo_id else repo_id
    return parse_model_info(name=name)
