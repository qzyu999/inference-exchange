"""Compatibility wrappers for typed display facets. No parsed grouping keys."""
from inference_exchange.shared.model_quantization import normalize_quantization, quantization_from_file_type
from .model_facets import facets_from_identity, public_facets


def parse_model_info(name, architecture="", quantization="", file_type=None, context_length=0):
    quant = normalize_quantization(quantization) or quantization_from_file_type(file_type)
    facets = facets_from_identity({"name": name, "quantization": quant})
    return {**public_facets(facets), "context_length": context_length, "architecture": architecture}


def parse_from_gguf_identity(identity):
    return public_facets(facets_from_identity(identity))


def parse_from_hf_repo(repo_id):
    return parse_model_info(repo_id.rsplit("/", 1)[-1])
