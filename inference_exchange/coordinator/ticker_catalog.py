"""Read-only market data replica. No inference requests or consumer credentials."""
import asyncio
import hashlib
import json
import logging
import os
import re
import tempfile
import time
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from .comparison_identity import configured_catalog, provider_identity
from .model_facets import facets_from_identity, public_facets
from inference_exchange.shared.model_quantization import normalize_quantization

log = logging.getLogger(__name__)
MAX_BYTES = 64 * 1024 * 1024
FRESH_SECONDS = 12 * 3600
EMPTY = {'schema_version': 1, 'generation': 0, 'generated_at': 0, 'models': []}


def price(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError('Prices must be decimal strings or null')
    try:
        d = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError('Invalid price') from exc
    if not d.is_finite() or d < 0 or d > 1_000_000:
        raise ValueError('Invalid price')
    return d


class _Record(BaseModel):
    # Strip fields outside the public contract. In particular, a publisher cannot
    # inject the coordinator-owned `ie` flag or arbitrary fields into the API.
    model_config = ConfigDict(strict=True, extra="ignore")


class _Point(_Record):
    at: int | float
    input: str | None = None
    cache_read: str | None = None
    output: str | None = None


class _Offer(_Record):
    id: str = Field(min_length=1, max_length=1000)
    provider: str = Field(min_length=1, max_length=300)
    route: str = Field(min_length=1, max_length=100)
    source_url: str = Field(max_length=2000)
    source_type: str = "api"
    quote_kind: Literal["catalog", "endpoint"] = "endpoint"
    observed_at: int | float
    input: str | None = None
    cache_read: str | None = None
    output: str | None = None
    cache_write: str | None = None
    quantization: str | None = Field(default=None, max_length=100)
    context_length: int | None = Field(default=None, ge=0)
    comparable: bool = False
    conditions: str = ""
    history: list[_Point] = Field(default_factory=list, max_length=90)


class _SourceID(_Record):
    source: str = Field(min_length=1, max_length=100, pattern=r"^[a-z][a-z0-9_.-]*$")
    model_id: str = Field(min_length=1, max_length=1000)


class _Model(_Record):
    id: str = Field(min_length=1, max_length=500)
    name: str = Field(min_length=1, max_length=500)
    aliases: list[str] = Field(default_factory=list, max_length=100)
    source_ids: list[_SourceID] = Field(default_factory=list, max_length=100)
    family: str | None = Field(default=None, max_length=100)
    release: str | None = Field(default=None, max_length=100)
    total_parameters: int | None = Field(default=None, ge=0, le=9_007_199_254_740_991)
    active_parameters: int | None = Field(default=None, ge=0, le=9_007_199_254_740_991)
    variant_tags: list[str] | None = Field(default=None, max_length=100)
    offers: list[_Offer] = Field(max_length=256)


class _Snapshot(_Record):
    schema_version: int
    generation: int = Field(ge=1)
    generated_at: int | float
    models: list[_Model] = Field(max_length=20000)


def validate_snapshot(data, now=None):
    now = time.time() if now is None else now
    try:
        data = _Snapshot.model_validate(data).model_dump()
    except ValidationError as exc:
        raise ValueError('Invalid snapshot structure') from exc
    if data['schema_version'] != 1:
        raise ValueError('Unsupported schema')

    def stamp(value):
        if not 0 < value <= now + 300:
            raise ValueError('Invalid timestamp')

    stamp(data['generated_at'])
    configured_catalog(data)  # Reject ambiguous namespaced exact mappings.
    aliases = set()
    source_ids = set()
    offer_ids = set()
    for model in data['models']:
        if model["family"] is not None and not model["family"].strip():
            raise ValueError("Empty family")
        for source in model["source_ids"]:
            key = (source["source"], source["model_id"].casefold())
            if key in source_ids:
                raise ValueError("Duplicate source ID")
            source_ids.add(key)
        if model["variant_tags"] is not None:
            if any(not isinstance(tag, str) or not 0 < len(tag) <= 100 for tag in model["variant_tags"]):
                raise ValueError("Invalid variant tag")
            model["variant_tags"] = sorted(set(model["variant_tags"]))
        if (model["active_parameters"] is not None and model["total_parameters"] is not None
                and model["active_parameters"] > model["total_parameters"]):
            raise ValueError("Active parameters exceed total")
        for alias in [model['id'], *model['aliases']]:
            if not alias or alias.casefold() in aliases:
                raise ValueError('Ambiguous alias')
            aliases.add(alias.casefold())
        for offer in model['offers']:
            offer["reported_quantization"] = offer["quantization"]
            offer["quantization"] = normalize_quantization(offer["quantization"])
            if offer['id'] in offer_ids:
                raise ValueError('Duplicate offer')
            offer_ids.add(offer['id'])
            from urllib.parse import urlsplit
            url = urlsplit(offer['source_url'])
            if url.scheme != 'https' or not url.hostname or url.username or url.password:
                raise ValueError('Unsafe source URL')
            stamp(offer['observed_at'])
            if offer['observed_at'] > data['generated_at']:
                raise ValueError('Future observation')
            for key in ('input', 'cache_read', 'output', 'cache_write'):
                price(offer[key])
            previous = 0
            for point in offer['history']:
                stamp(point['at'])
                if not previous < point['at'] <= offer['observed_at']:
                    raise ValueError('Unordered history')
                previous = point['at']
                for key in ('input', 'cache_read', 'output'):
                    price(point[key])
    return data


def savings(ie, external, *, fresh, comparable):
    if not fresh or not comparable: return None
    a, b = price(ie), price(external)
    if a is None or b is None or b == 0: return None
    return round((b - a) * 100 / b)


class SnapshotCache:
    def __init__(self, path):
        self.path = Path(path)
        self.data = dict(EMPTY)
        self.error = None
        try:
            if self.path.stat().st_size <= MAX_BYTES:
                self.data = validate_snapshot(json.loads(self.path.read_bytes()))
        except (OSError, ValueError, KeyError, TypeError):
            pass

    def install(self, raw, digest, now=None):
        if len(raw) > MAX_BYTES: raise ValueError('Oversized snapshot')
        if digest and hashlib.sha256(raw).hexdigest() != digest: raise ValueError('Checksum mismatch')
        data = validate_snapshot(json.loads(raw), now)
        if data['generation'] <= self.data['generation']: return False
        if data['generated_at'] < self.data['generated_at']: raise ValueError('Timestamp regression')
        self.path.parent.mkdir(parents=True, exist_ok=True)
        name = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.path.parent, delete=False) as f:
                name = f.name
                f.write(raw); f.flush(); os.fsync(f.fileno())
            os.replace(name, self.path)
        finally:
            if name and os.path.exists(name): os.unlink(name)
        self.data = data
        return True

    async def sync(self, client, repo):
        if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
            raise ValueError('Invalid repository')
        # Resolve once. Both files are downloaded from the same immutable commit.
        r = await client.get(f'https://api.github.com/repos/{repo}/commits/main')
        r.raise_for_status()
        commit = r.json()['sha']
        if not re.fullmatch(r'[0-9a-f]{40}', commit): raise ValueError('Invalid commit')
        root = f'https://raw.githubusercontent.com/{repo}/{commit}/data/exchange/'
        r = await client.get(root + 'manifest.json'); r.raise_for_status()
        manifest = r.json()
        if (not isinstance(manifest, dict) or manifest.get('schema_version') != 1
                or type(manifest.get('generation')) is not int
                or not isinstance(manifest.get('sha256'), str)
                or not re.fullmatch(r'[0-9a-f]{64}', manifest['sha256'])):
            raise ValueError('Invalid manifest')
        if manifest['generation'] <= self.data['generation']: return
        chunks = bytearray()
        async with client.stream('GET', root + 'snapshot.json') as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes():
                chunks.extend(chunk)
                if len(chunks) > MAX_BYTES: raise ValueError('Oversized response')
        parsed = json.loads(chunks)
        if parsed['generation'] != manifest['generation']: raise ValueError('Mixed publication')
        self.install(bytes(chunks), manifest['sha256'])

    async def run(self, repo):
        while True:
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    await self.sync(client, repo)
                self.error = None
            except Exception as exc:
                self.error = type(exc).__name__
                log.warning('Ticker synchronization failed: %s', self.error)
            await asyncio.sleep(600)

    def resolver(self):
        return configured_catalog(self.data)

    def catalog(self, providers, *, query='', ie_only=False, offset=0, limit=100, now=None):
        now = now or time.time()
        resolver = self.resolver()
        enriched = os.getenv("IE_ENRICHED_MODEL_DISPLAY", "1") != "0"
        models = {}
        for m in self.data["models"]:
            facets = facets_from_identity({"name": m["name"]}, catalog_model=m,
                                         family_labels=resolver.family_labels)
            models[m["id"]] = {**m, **public_facets(facets), "name": facets.display_name,
                              "offers": [{k: v for k, v in o.items() if k != "history"} for o in m["offers"]],
                              "ie_count": 0}
        for p in providers:
            if not getattr(p, 'admitted', True) or getattr(p, 'quarantined', False): continue
            for name in p.capabilities.models:
                if name == 'default': continue
                identity, repo, applies = provider_identity(p, name)
                resolution = resolver.local_resolution(p.provider_id, name, identity, provider_repo=repo)
                key = resolution.comparison_id
                facets = facets_from_identity({**identity, "name": name},
                    catalog_model=resolver.models.get(key), family_labels=resolver.family_labels,
                    enriched_display=enriched)
                m = models.setdefault(key, {'id': key, 'name': facets.display_name,
                    **public_facets(facets), 'offers': [], 'ie_count': 0})
                m['ie_count'] += 1
                m['offers'].append({'id': 'ie/' + p.provider_id + '/' + name, 'provider': p.name,
                    'provider_id': p.provider_id, 'original_model': name,
                    'display_name': facets.display_name,
                    'route': 'Inference Exchange', 'ie': True, 'observed_at': now,
                    'quote_kind': 'endpoint',
                    'input': str(p.capabilities.price_per_mtok_input),
                    'cache_read': str(p.capabilities.price_per_mtok_cache) if p.capabilities.price_per_mtok_cache > 0 else None,
                    'output': str(p.capabilities.price_per_mtok_output),
                    'quantization': identity.get('quantization'),
                    'reported_quantization': identity.get('reported_quantization'),
                    'identity_source': resolution.identity_source,
                    'identity_trust': resolution.identity_trust,
                    'artifact_verification': 'verified' if applies and getattr(p, 'model_verified', False) else 'unverified',
                    'context_length': p.model_capabilities.context_length,
                    'trust': p.capabilities.trust_level.value, 'source_url': '/keys'})
        result = []
        for m in models.values():
            if ie_only and not m['ie_count']: continue
            if query.casefold() not in (m['id'] + ' ' + m['name'] + ' ' + (m.get('family') or '')).casefold(): continue
            for o in m['offers']:
                o['stale'] = now - o['observed_at'] > FRESH_SECONDS
            m["provider_count"] = len({
                ("ie", o["provider_id"]) if o.get("ie") else ("external", o["provider"])
                for o in m["offers"] if o.get("quote_kind", "endpoint") == "endpoint"
            })
            result.append(m)
        result.sort(key=lambda m: m['name'].casefold())
        return {'generation': self.data['generation'], 'generated_at': self.data['generated_at'],
                'sync_error': self.error, 'total': len(result), 'models': result[offset:offset+limit]}

    def history(self, model):
        m = next((m for m in self.data['models'] if m['id'] == model), None)
        return {'model': model, 'generation': self.data['generation'], 'offers': [{'id': o['id'], 'name': o['provider'] + ' via ' + o['route'], 'points': o.get('history', [])} for o in m['offers']] if m else []}
