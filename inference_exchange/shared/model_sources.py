"""Bounded GGUF source/display claims. Lineage is never a comparison identity."""
import re
from urllib.parse import urlsplit

MAX_LABEL = 512
MAX_BASE_MODELS = 16


def bounded_text(value):
    return value if isinstance(value, str) and len(value) <= MAX_LABEL else None


def hf_repo_id(value):
    value = bounded_text(value)
    if value and re.fullmatch(r"[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+", value):
        if all(part not in (".", "..") for part in value.split("/")):
            return value
    return None


def hf_repo_from_url(value):
    value = bounded_text(value)
    if not value:
        return None
    try:
        url = urlsplit(value)
        port = url.port
    except ValueError:
        return None
    if (url.scheme != "https" or url.hostname != "huggingface.co" or port is not None
            or url.username or url.password or url.query or url.fragment):
        return None
    return hf_repo_id(url.path.strip("/"))


def clean_gguf_identity(value):
    if not isinstance(value, dict):
        value = {}
    result = {key: bounded_text(value.get(key)) for key in (
        "basename", "version", "size_label", "finetune",
        "conversion_source_repository", "conversion_source_url",
    )}
    bases = value.get("base_models", [])
    result["base_models"] = [
        {key: bounded_text(item.get(key)) for key in ("name", "basename", "version", "repo_url")}
        for item in (bases[:MAX_BASE_MODELS] if isinstance(bases, list) else [])
        if isinstance(item, dict)
    ]
    return result


def gguf_identity_fields(metadata):
    count = metadata.get("general.base_model.count", 0)
    bases = []
    if type(count) is int:
        for index in range(min(max(count, 0), MAX_BASE_MODELS)):
            bases.append({key: metadata.get(f"general.base_model.{index}.{key}")
                          for key in ("name", "basename", "version", "repo_url")})
    return clean_gguf_identity({
        **{key: metadata.get("general." + key) for key in ("basename", "version", "size_label", "finetune")},
        "conversion_source_repository": metadata.get("general.source.huggingface.repository"),
        "conversion_source_url": metadata.get("general.source.url"), "base_models": bases,
    })
