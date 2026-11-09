"""GGUF general.file_type labels from llama.cpp's llama_ftype enum.

Source: https://github.com/ggml-org/llama.cpp/blob/master/include/llama.h
These are file-type values, not ggml tensor-type values.
Removed and unrecognized enum values remain unknown.
"""

GGUF_FILE_TYPE_MAP = {
    0: "FP32", 1: "FP16", 2: "Q4_0", 3: "Q4_1",
    7: "Q8_0", 8: "Q5_0", 9: "Q5_1",
    10: "Q2_K", 11: "Q3_K_S", 12: "Q3_K_M", 13: "Q3_K_L",
    14: "Q4_K_S", 15: "Q4_K_M", 16: "Q5_K_S", 17: "Q5_K_M", 18: "Q6_K",
    19: "IQ2_XXS", 20: "IQ2_XS", 21: "Q2_K_S", 22: "IQ3_XS", 23: "IQ3_XXS",
    24: "IQ1_S", 25: "IQ4_NL", 26: "IQ3_S", 27: "IQ3_M", 28: "IQ2_S",
    29: "IQ2_M", 30: "IQ4_XS", 31: "IQ1_M", 32: "BF16",
    36: "TQ1_0", 37: "TQ2_0", 38: "MXFP4_MOE", 39: "NVFP4", 40: "Q1_0", 41: "Q2_0",
}

KNOWN_QUANTIZATIONS = frozenset(GGUF_FILE_TYPE_MAP.values()) | {
    "Q8_1", "FP8", "INT4", "INT8", "AWQ", "GPTQ", "EXL2",
}
_LEGACY = {"F16": "FP16", "F32": "FP32"}


def quantization_from_file_type(value):
    return GGUF_FILE_TYPE_MAP.get(value) if type(value) is int else None


def normalize_quantization(value):
    if not isinstance(value, str):
        return None
    label = value.strip().upper()
    label = _LEGACY.get(label, label)
    return label if label in KNOWN_QUANTIZATIONS else None
