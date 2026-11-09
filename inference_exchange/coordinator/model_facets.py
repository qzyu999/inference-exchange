"""Typed display facets. Facets never establish comparison identity."""
import re
from dataclasses import asdict, dataclass
from decimal import Decimal

@dataclass(frozen=True)
class Facets:
    family: str | None
    release: str | None
    total_parameters: int | None
    active_parameters: int | None
    variant_tags: frozenset[str] | None
    quantization: str | None
    display_name: str

def parse_facets(name, *, quantization=None):
    """Parse numeric facets only. Preserve mixed tokens and case for display."""
    label = re.sub(r"[-_/]+", " ", name)
    pattern = r"(?<![\w.])(\d+x\d+(?:\.\d+)?b|a\d+(?:\.\d+)?b|\d+(?:\.\d+)?b)(?![\w.])"
    total = active = None
    for match in re.finditer(pattern, label, flags=re.I):
        token = match.group(1).lower()
        if "x" in token:
            experts, per_expert = token[:-1].split("x")
            total = int(Decimal(experts) * Decimal(per_expert) * 1_000_000_000)
        elif token.startswith("a"):
            active = int(Decimal(token[1:-1]) * 1_000_000_000)
        else:
            total = int(Decimal(token[:-1]) * 1_000_000_000)
    total = total if total is None or total <= 9_007_199_254_740_991 else None
    active = active if active is None or active <= 9_007_199_254_740_991 else None
    return Facets(None, None, total, active, None, quantization, label)

def facets_from_identity(identity, *, catalog_model=None, family_labels=(), enriched_display=True):
    """Source labels determine display. Name parsing supplies numeric facets only."""
    catalog_model = catalog_model or {}
    parsed = parse_facets(identity.get("name", ""), quantization=identity.get("quantization"))
    metadata = identity.get("gguf", {})
    sizes = parse_facets(metadata["size_label"]) if metadata.get("size_label") else parsed
    finetune = metadata.get("finetune")
    tags = (frozenset(re.split(r"[-_/ ]+", finetune.lower())) - {""}
            if isinstance(finetune, str) else None)
    if catalog_model.get("variant_tags") is not None:
        tags = frozenset(catalog_model["variant_tags"])
    display = catalog_model.get("name")
    if not display and metadata.get("basename"):
        display = " ".join(metadata[field] for field in ("basename", "version", "size_label", "finetune")
                           if metadata.get(field))
    family = catalog_model.get("family")
    family = family.strip().casefold() if isinstance(family, str) else None
    if not family:
        # Reviewed labels classify advertised names; a basename is display only.
        labels = {label.strip().casefold() for label in family_labels
                  if isinstance(label, str) and label.strip()}
        text = identity.get("name", "").casefold()
        matches = {label for label in labels if re.search(
            rf"(?<!\w){re.escape(label)}(?=$|[\s/_-]|\d)", text)}
        family = next(iter(matches)) if len(matches) == 1 else None
    return Facets(
        family, catalog_model.get("release") or metadata.get("version"),
        catalog_model["total_parameters"] if catalog_model.get("total_parameters") is not None else sizes.total_parameters,
        catalog_model["active_parameters"] if catalog_model.get("active_parameters") is not None else sizes.active_parameters, tags,
        parsed.quantization, (display or parsed.display_name) if enriched_display else parsed.display_name,
    )


def public_facets(facets):
    result = asdict(facets)
    result["variant_tags"] = sorted(facets.variant_tags) if facets.variant_tags is not None else None
    result["parameter_count_source"] = "size_label" if facets.total_parameters is not None else None
    return result
