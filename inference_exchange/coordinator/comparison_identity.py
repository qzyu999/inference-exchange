"""One exact comparison resolver for catalog, market, and reference prices."""
import os
from dataclasses import dataclass
from urllib.parse import quote
from inference_exchange.shared.model_sources import hf_repo_from_url, clean_gguf_identity
from inference_exchange.shared.model_quantization import normalize_quantization

@dataclass(frozen=True)
class Resolution:
    comparison_id: str
    identity_source: str
    identity_trust: str

class ExactCatalog:
    """A reviewed publication maps namespaced source IDs to catalog IDs."""

    def __init__(self, models, *, generation=1, allow_repository_reports=True):
        models = list(models)
        self.generation = generation
        self.allow_repository_reports = allow_repository_reports
        self.ids = set()
        self.sources = {}
        self.aliases = {}
        self.models = {}
        self.family_labels = frozenset(
            model["family"].strip().casefold() for model in models
            if isinstance(model.get("family"), str) and model["family"].strip()
        )
        for model in models:
            if model['id'] in self.ids:
                raise ValueError('Duplicate catalog ID')
            self.ids.add(model['id'])
            self.models[model["id"]] = model
            for item in model.get("source_ids", []):
                namespace, raw_id = (item["source"], item["model_id"]) if isinstance(item, dict) else item
                self._add(self.sources, (namespace, raw_id.casefold()), model['id'])
            for alias in model.get('aliases', []):
                self._add(self.aliases, alias.casefold(), model['id'])
            # Compatibility with publications made by the original OR factory.
            # This is the factory's exact native ID contract, not a name heuristic.
            if not model.get("source_ids") and any(
                offer["id"] == "openrouter/" + model["id"] for offer in model.get("offers", [])
            ):
                self._add(self.sources, ("openrouter", model["id"].casefold()), model["id"])

    @staticmethod
    def _add(index, key, model):
        if key in index and index[key] != model:
            raise ValueError('Ambiguous exact mapping')
        index[key] = model

    def source(self, namespace, raw_id):
        if not isinstance(raw_id, str):
            return None
        return self.sources.get((namespace, raw_id.casefold()))

    def external(self, namespace, raw_id):
        return self.source(namespace, raw_id) or source_key(namespace, raw_id)

    def history_group(self, source, model_id):
        exact = self.source(source, model_id)
        return ("catalog", exact) if exact else ("source", source, model_id)

    def history_sources(self, sources, *, model=None, raw_source=None, legacy_sources=None):
        if raw_source is not None:
            return [raw_source]
        if legacy_sources is not None:
            groups = {self.history_group(*raw) for raw in legacy_sources}
            if len(groups) > 1:
                raise AmbiguousHistory(sorted(groups))
            target = next(iter(groups), None)
        else:
            target = ("catalog", model)
        return [raw for raw in sources if self.history_group(*raw) == target]

    def local_resolution(self, provider, name, identity=None, *, provider_repo=None):
        identity = identity or {}
        if self.allow_repository_reports:
            metadata = identity.get('gguf', {})
            conversion_repos = {repo.casefold() for repo in (metadata.get('conversion_source_repository'), hf_repo_from_url(metadata.get('conversion_source_url'))) if repo}
            if len(conversion_repos) > 1:
                return Resolution(self.standalone(provider, name), 'standalone', 'unmapped')
            if conversion_repos:
                match = self.source('huggingface', next(iter(conversion_repos)))
                if match:
                    return Resolution(match, 'conversion_source', 'reported')
            repo = provider_repo or identity.get('repo_id')
            match = self.source('huggingface', repo) if repo else None
            if match:
                return Resolution(match, 'provider_repository', 'reported')
        match = self.aliases.get(name.casefold())
        if match:
            return Resolution(match, 'reviewed_alias', 'reviewed')
        return Resolution(self.standalone(provider, name), 'standalone', 'unmapped')

    def local(self, provider, name, identity=None, *, provider_repo=None):
        return self.local_resolution(provider, name, identity, provider_repo=provider_repo).comparison_id

    @staticmethod
    def standalone(provider, name):
        return 'ie/' + quote(provider, safe='') + '/' + quote(name, safe='')


def source_key(namespace, raw_id):
    """Stable unresolved source listing. No model-name parsing."""
    return "source/" + quote(namespace, safe="") + "/" + quote(raw_id, safe="")


class AmbiguousHistory(ValueError):
    def __init__(self, choices):
        self.choices = choices
        super().__init__("Select an exact catalog model or raw source ID")


def clean_identity(identity):
    if not isinstance(identity, dict):
        return {}
    result = {key: value for key, value in identity.items()
              if key in ("name", "repo_id", "quantization", "architecture")
              and isinstance(value, str) and len(value) <= 512}
    result["gguf"] = clean_gguf_identity(identity.get("gguf"))
    reported = result.get("quantization")
    result["reported_quantization"] = reported
    result["quantization"] = normalize_quantization(reported)
    return result


def provider_identity(provider, name):
    """Scope one identity claim to its advertised model, never to all models."""
    identity = getattr(provider, "model_identity", None) or {}
    if not isinstance(identity, dict):
        return {}, None, False
    per_model = identity.get("models")
    if isinstance(per_model, dict) and isinstance(per_model.get(name), dict):
        record = clean_identity(per_model[name])
        # The existing verifier has one provider-level artifact result.
        # Do not apply that result to an arbitrary per-model claim.
        return record, record.get("repo_id"), False
    names = [n for n in provider.capabilities.models if n != "default"]
    applies = len(names) == 1 or (
        isinstance(identity.get("name"), str) and identity["name"].casefold() == name.casefold()
    )
    if not applies:
        return {}, None, False
    record = clean_identity(identity)
    return record, getattr(provider.capabilities, "model_repo_id", "") or record.get("repo_id"), True


def configured_catalog(data):
    return ExactCatalog(data["models"], generation=data["generation"],
                        allow_repository_reports=os.getenv("IE_REPOSITORY_COMPARISON", "1") != "0")
