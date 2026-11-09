import pytest
from inference_exchange.coordinator.comparison_identity import ExactCatalog, provider_identity
from inference_exchange.coordinator.model_facets import parse_facets, facets_from_identity

def registry(*, alias=False):
    return ExactCatalog([{
        "id": "meta-llama/llama-3.2-1b-instruct",
        # A reviewed relation between two namespaces, not a slug heuristic.
        "source_ids": [
            ("openrouter", "meta-llama/llama-3.2-1b-instruct"),
            ("huggingface", "meta-llama/Llama-3.2-1B-Instruct"),
        ],
        "aliases": ["Llama 3.2 1B Instruct"] if alias else [],
    }], generation=7)

@pytest.mark.parametrize("identity,use_alias", [
    ({"gguf": {"conversion_source_repository": "meta-llama/Llama-3.2-1B-Instruct"}}, False),
    ({"gguf": {"conversion_source_url": "https://huggingface.co/meta-llama/Llama-3.2-1B-Instruct"}}, False),
    ({"repo_id": "meta-llama/Llama-3.2-1B-Instruct"}, False),
    ({"repo_id": "bartowski/Llama-3.2-1B-Instruct-GGUF"}, True),
])
def test_artifact_joins_only_with_an_exact_source_or_reviewed_alias(identity, use_alias):
    catalog = registry(alias=use_alias)
    local_name = "Llama 3.2 1B Instruct"
    claim = {**identity, "quantization": "Q4_K_M", "file_hash": "unverified-claim"}
    before = dict(claim)
    assert catalog.local("provider", local_name, claim) == "meta-llama/llama-3.2-1b-instruct"
    assert claim == before
    assert "verified" not in claim
    assert claim["quantization"] == "Q4_K_M"

def test_similar_publisher_names_and_quantizations_do_not_join():
    catalog = registry()
    local = "bartowski/Llama-3.2-1B-Instruct-Q4_K_M.gguf"
    upstream = "meta-llama/Llama-3.2-1B-Instruct"
    a = parse_facets(local, quantization="Q4_K_M")
    b = parse_facets(upstream)
    assert a.total_parameters == b.total_parameters
    assert a.quantization != b.quantization
    assert catalog.local("provider", local) != catalog.local("provider", upstream)
    assert catalog.local("provider", local, {"repo_id": "bartowski/Llama-3.2-1B-Instruct-GGUF"}).startswith("ie/")
    # Identical text in two source namespaces does not establish a relation.
    unreviewed = ExactCatalog([{
        "id": "meta-llama/llama-3.2-1b-instruct",
        "source_ids": [("openrouter", "meta-llama/llama-3.2-1b-instruct")],
    }])
    assert unreviewed.local("provider", upstream, {"repo_id": upstream}).startswith("ie/")

def test_conversion_source_priority_and_base_lineage_never_selects_identity():
    catalog = ExactCatalog([
        {"id": "catalog/a", "source_ids": [("huggingface", "org/base")]},
        {"id": "catalog/b", "source_ids": [("huggingface", "org/artifact")]},
        {"id": "catalog/c", "aliases": ["Local"]},
        {"id": "catalog/d", "source_ids": [("huggingface", "org/conversion")]},
    ])
    identity = {"repo_id": "org/artifact", "gguf": {
        "conversion_source_repository": "org/conversion",
        "base_models": [{"repo_url": "https://huggingface.co/org/base"}],
    }}
    assert catalog.local("provider", "Local", identity) == "catalog/d"
    identity["gguf"].pop("conversion_source_repository")
    assert catalog.local("provider", "Local", identity) == "catalog/b"
    assert catalog.local("provider", "Local", identity, provider_repo="org/conversion") == "catalog/d"
    assert catalog.local("provider", "Local") == "catalog/c"
    identity["gguf"]["base_models"].append({"repo_url": "https://huggingface.co/org/other"})
    assert catalog.local("provider", "Local", identity) == "catalog/b"
    identity.pop("repo_id")
    assert catalog.local("provider", "Local", identity) == "catalog/c"
    assert catalog.local("provider", "No alias", identity).startswith("ie/")

def test_unparseable_and_unmatched_models_stay_distinct():
    catalog = registry()
    assert parse_facets("???").family is None
    assert catalog.local("p", "???") != catalog.local("p", "!?!")
    assert catalog.local("p", "") != catalog.local("other", "")
    assert catalog.local("p", "a/b") != catalog.local("p/a", "b")
    assert catalog.local("p", "Qwen2.5 0.5B Instruct").startswith("ie/p/")
    assert catalog.local("p", "Llama 3.2 1B Instruct v2").startswith("ie/p/")

def test_ambiguous_reviewed_sources_are_rejected():
    with pytest.raises(ValueError, match="Ambiguous"):
        ExactCatalog([
            {"id": "catalog/a", "source_ids": [("huggingface", "org/model")]},
            {"id": "catalog/b", "source_ids": [("huggingface", "org/model")]},
        ])

def test_reported_and_reviewed_identity_sources_remain_separate_from_verification():
    catalog = registry(alias=True)
    identity = {"repo_id": "meta-llama/Llama-3.2-1B-Instruct",
                "artifact_verification": "unverified", "file_hash": "claim"}
    reported = catalog.local_resolution("provider", "Llama 3.2 1B Instruct", identity)
    reviewed = catalog.local_resolution("provider", "Llama 3.2 1B Instruct")
    assert reported.comparison_id == reviewed.comparison_id
    assert (reported.identity_source, reported.identity_trust) == ("provider_repository", "reported")
    assert (reviewed.identity_source, reviewed.identity_trust) == ("reviewed_alias", "reviewed")
    assert identity["artifact_verification"] == "unverified"
    assert identity["file_hash"] == "claim"

def test_conflicting_conversion_sources_do_not_select_a_model():
    catalog = registry()
    identity = {"gguf": {
        "conversion_source_repository": "meta-llama/Llama-3.2-1B-Instruct",
        "conversion_source_url": "https://huggingface.co/other/model",
    }}
    assert catalog.local("provider", "Local", identity).startswith("ie/")


def make_provider(provider_id="p", models=None):
    from types import SimpleNamespace as S
    from inference_exchange.shared.protocol import ProviderCapabilities, ModelCapabilities
    return S(provider_id=provider_id, name="Local", admitted=True, quarantined=False,
             model_identity={}, model_verified=False, encryption_public_key="",
             load_factor=0, active_requests=0,
             capabilities=ProviderCapabilities(models=models or ["Qwen2.5 0.5B Instruct"]),
             model_capabilities=ModelCapabilities(context_length=4096))


def publication(generation=1, family="qwen"):
    return {"schema_version": 1, "generation": generation, "generated_at": 1000 + generation,
            "models": [{"id": "qwen/qwen3.5-9b", "name": "Qwen3.5 9B", "family": family,
                        "aliases": [], "offers": [{
                            "id": "openrouter/qwen/qwen3.5-9b", "provider": "OpenRouter catalog",
                            "route": "OpenRouter", "source_url": "https://openrouter.ai/qwen/qwen3.5-9b",
                            "observed_at": 1000, "input": "0", "output": "0.2",
                        }]}]}


def test_catalog_family_fallback_comes_from_each_publication_generation(tmp_path):
    import json
    from inference_exchange.coordinator.ticker_catalog import SnapshotCache
    cache = SnapshotCache(tmp_path / "catalog.json")
    provider = make_provider()
    cache.install(json.dumps(publication()).encode(), None, now=2000)
    local = cache.catalog([provider], ie_only=True, now=2000)["models"][0]
    assert local["family"] == "qwen"
    assert local["id"] == "ie/p/Qwen2.5%200.5B%20Instruct"
    assert local["total_parameters"] == 500_000_000
    assert cache.catalog([provider], query="qwen", ie_only=True, now=2000)["total"] == 1
    cache.install(json.dumps(publication(2, "llama")).encode(), None, now=2000)
    assert cache.catalog([provider], ie_only=True, now=2000)["models"][0]["family"] is None
    cache.install(json.dumps(publication(3, "QWEN")).encode(), None, now=2000)
    assert cache.catalog([provider], ie_only=True, now=2000)["models"][0]["family"] == "qwen"


def test_multi_model_identity_and_artifact_state_are_not_copied():
    provider = make_provider(models=["A", "B"])
    provider.model_identity = {"name": "A", "repo_id": "org/a", "quantization": "Q4_K_M"}
    assert provider_identity(provider, "A")[0]["repo_id"] == "org/a"
    assert provider_identity(provider, "B") == ({}, None, False)
    provider.model_identity = {"models": {"B": {"repo_id": "org/b"}}}
    identity, repo, artifact_scope = provider_identity(provider, "B")
    assert identity["repo_id"] == repo == "org/b"
    assert not artifact_scope


def test_market_and_reference_routes_never_merge_parser_collisions(tmp_path, monkeypatch):
    from types import SimpleNamespace as S
    from fastapi.testclient import TestClient
    from inference_exchange.coordinator.main import create_app
    from inference_exchange.coordinator import dependencies
    p1 = make_provider("p1", ["Qwen2.5 7B Instruct"])
    p2 = make_provider("p2", ["Qwen3 7B Instruct"])
    client = TestClient(create_app())
    monkeypatch.setattr(dependencies, "_hub", S(_providers={"p1": p1, "p2": p2}))
    response = client.get("/v1/exchange/market")
    assert response.status_code == 200
    models = response.json()["models"]
    assert len(models) == 2
    assert len({m["canonical_id"] for m in models}) == 2
    assert {p["original_model"] for m in models for p in m["providers"]} == {"Qwen2.5 7B Instruct", "Qwen3 7B Instruct"}
    refs = client.get("/v1/exchange/reference-prices").json()["models"]
    assert len(refs) == 2
    assert {r["family_key"] for r in refs} == {m["canonical_id"] for m in models}


def test_repository_rollback_keeps_exact_aliases_and_source_maps():
    models = [{"id": "catalog/checkpoint", "name": "Source label",
               "source_ids": [{"source": "huggingface", "model_id": "org/checkpoint"}],
               "aliases": ["Reviewed"]}]
    normal = ExactCatalog(models)
    rollback = ExactCatalog(models, allow_repository_reports=False)
    report = {"repo_id": "org/checkpoint"}
    assert normal.local("p", "Local", report) == "catalog/checkpoint"
    assert rollback.local("p", "Local", report).startswith("ie/")
    assert rollback.local("p", "Reviewed", report) == "catalog/checkpoint"
    assert rollback.source("huggingface", "org/checkpoint") == "catalog/checkpoint"
    assert facets_from_identity({"name": "Local-Name"}, catalog_model=models[0],
                                enriched_display=False).display_name == "Local Name"


def test_namespace_validation_and_duplicate_source_ids_are_atomic(tmp_path):
    from copy import deepcopy
    import json
    from inference_exchange.coordinator.ticker_catalog import SnapshotCache
    cache = SnapshotCache(tmp_path / "catalog.json")
    cache.install(json.dumps(publication()).encode(), None, now=2000)
    bad = publication(2)
    bad["models"][0]["source_ids"] = [{"source": "huggingface", "model_id": "org/model"}]
    second = deepcopy(bad["models"][0])
    second["id"] = "other/model"
    second["offers"] = []
    bad["models"].append(second)
    with pytest.raises(ValueError):
        cache.install(json.dumps(bad).encode(), None, now=2000)
    assert cache.data["generation"] == 1
