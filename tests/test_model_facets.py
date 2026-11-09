from dataclasses import asdict
import pytest
from inference_exchange.coordinator.model_facets import parse_facets, facets_from_identity

@pytest.mark.parametrize("name,display,total,active", [
    ("Qwen2.5 0.5B Instruct", "Qwen2.5 0.5B Instruct", 500_000_000, None),
    ("Llama 3.2 1B Instruct", "Llama 3.2 1B Instruct", 1_000_000_000, None),
    ("Qwen2.5 7B Instruct", "Qwen2.5 7B Instruct", 7_000_000_000, None),
    ("Qwen3 7B Instruct", "Qwen3 7B Instruct", 7_000_000_000, None),
    ("Qwen2.5-Coder-7B-Instruct", "Qwen2.5 Coder 7B Instruct", 7_000_000_000, None),
    ("Qwen2.5-VL-7B-Instruct", "Qwen2.5 VL 7B Instruct", 7_000_000_000, None),
    ("CodeLlama-7b-Instruct", "CodeLlama 7b Instruct", 7_000_000_000, None),
    ("Mixtral-8x7B-Instruct", "Mixtral 8x7B Instruct", 56_000_000_000, None),
    ("Qwen3-30B-A3B-Instruct", "Qwen3 30B A3B Instruct", 30_000_000_000, 3_000_000_000),
    ("claude-sonnet-4.5", "claude sonnet 4.5", None, None),
    ("claude-opus-4.5", "claude opus 4.5", None, None),
    ("NewFamily-2.1-Special-4B", "NewFamily 2.1 Special 4B", 4_000_000_000, None),
    ("Meta-Llama-3.1-8B-Instruct", "Meta Llama 3.1 8B Instruct", 8_000_000_000, None),
    ("DeepSeek-R1-Distill-Qwen-7B", "DeepSeek R1 Distill Qwen 7B", 7_000_000_000, None),
    ("gpt-4o-mini", "gpt 4o mini", None, None),
    ("Mistral-7B-Instruct-v0.3", "Mistral 7B Instruct v0.3", 7_000_000_000, None),
])
def test_names_produce_numeric_facets_without_rewriting_tokens(name, display, total, active):
    facets = parse_facets(name)
    assert facets.display_name == display
    assert facets.family is None
    assert facets.release is None
    assert facets.total_parameters == total
    assert facets.active_parameters == active
    assert facets.variant_tags is None
    assert "canonical_id" not in asdict(facets)
    assert "comparison_id" not in asdict(facets)

def test_variant_order_and_unknown_are_not_identity():
    first = facets_from_identity({"name": "Example-2-Coder-7B-Instruct"},
                                catalog_model={"variant_tags": ["coder", "instruct"]})
    second = facets_from_identity({"name": "Example-2-Instruct-7B-Coder"},
                                 catalog_model={"variant_tags": ["instruct", "coder"]})
    assert first.variant_tags == second.variant_tags == frozenset({"coder", "instruct"})
    assert parse_facets("Example-7B").variant_tags is None
    assert facets_from_identity({"name": "Example-7B", "gguf": {"finetune": "Base"}}).variant_tags == frozenset({"base"})
    assert facets_from_identity({"name": "Example-7B", "gguf": {"finetune": ""}}).variant_tags == frozenset()

@pytest.mark.parametrize("name,label,family", [
    ("Meta-Llama-3.1-8B-Instruct", "Llama 3.1 8B Instruct", "Llama"),
    ("DeepSeek-R1-Distill-Qwen-7B", "DeepSeek R1 Distill Qwen 7B", "DeepSeek"),
    ("gpt-4o-mini", "GPT-4o Mini", "GPT"),
    ("Mistral-7B-Instruct-v0.3", "Mistral 7B Instruct v0.3", "Mistral"),
])
def test_catalog_labels_and_structured_family_take_precedence(name, label, family):
    facets = facets_from_identity({
        "name": name, "gguf": {"basename": "Other", "version": "2"},
    }, catalog_model={"name": label, "family": family})
    assert facets.display_name == label
    assert facets.family == family.casefold()

def test_family_fallback_uses_supplied_labels_without_publisher_inference():
    assert facets_from_identity({"name": "Meta-Llama-3.1-8B-Instruct"}).family is None
    assert facets_from_identity({"name": "Meta-Llama-3.1-8B-Instruct"},
                                family_labels=["Llama"]).family == "llama"
    assert facets_from_identity({"name": "CodeLlama-7B"},
                                family_labels=["Llama", "CodeLlama"]).family == "codellama"

def test_qwen_gguf_releases_keep_one_normalized_reviewed_search_family():
    qwen25 = {"name": "Qwen2.5-7B-Instruct", "gguf": {"basename": "Qwen2.5"}}
    qwen3 = {"name": "qwen3-7B-Instruct", "gguf": {"basename": "Qwen3"}}
    labels = ["Qwen", "qwen", "QWEN", " Qwen ", ""]
    first = facets_from_identity(qwen25, family_labels=labels)
    second = facets_from_identity(qwen3, family_labels=labels)
    assert first.family == second.family == "qwen"
    assert first.display_name != second.display_name
    assert facets_from_identity(qwen25).family is None
    assert facets_from_identity(qwen3, catalog_model={"family": "QWEN"}).family == "qwen"
    assert facets_from_identity({"name": "Qwen-Llama"}, family_labels=["Qwen", "Llama"]).family is None
