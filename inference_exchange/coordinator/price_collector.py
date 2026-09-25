"""Background price collector — fetches live pricing from external sources.

Sources:
- OpenRouter (public API, no auth)
- Together AI (public API, no auth)
- Direct API providers (OpenAI, Anthropic, Google, Deepinfra, Groq, Fireworks)
  via versioned static dicts updated on pricing announcements.

Prices are normalized to $/Mtok (per million tokens) for input and output.
Each fetch cycle updates an in-memory cache and snapshots to SQLite.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field

import httpx

from .model_catalog import parse_model_info

logger = logging.getLogger(__name__)

FETCH_INTERVAL = 1800  # 30 minutes
PRUNE_DAYS = 90


def _ssl_context():
    """Return SSL verify setting for httpx.

    Tries certifi CA bundle first. If SSL verification is broken (common
    on macOS pyenv builds with no system CA store), falls back to
    verify=False for these non-sensitive public API price fetches.
    """
    try:
        import os
        import certifi
        ca_path = certifi.where()
        if "SSL_CERT_FILE" not in os.environ:
            os.environ["SSL_CERT_FILE"] = ca_path
        return ca_path
    except ImportError:
        return True


def _make_client(timeout: int = 15) -> httpx.AsyncClient:
    """Create an httpx async client with SSL configured.

    Tries certifi certs first. If that fails on first use, the fetcher
    catches the SSL error and retries with verify=False. These are
    public read-only pricing APIs — no credentials are sent.
    """
    return httpx.AsyncClient(timeout=timeout, verify=_ssl_context())


def _make_client_no_verify(timeout: int = 15) -> httpx.AsyncClient:
    """Fallback client that skips SSL verification."""
    return httpx.AsyncClient(timeout=timeout, verify=False)


# Initialize SSL certs at import time so all httpx calls benefit
_ssl_context()


@dataclass
class PriceEntry:
    """Normalized price from any source."""
    source: str
    model_id: str
    display_name: str
    family: str
    family_key: str
    input_per_mtok: float
    output_per_mtok: float
    cache_per_mtok: float = 0  # 0 = provider doesn't offer cache pricing
    context_length: int = 0
    quantization: str = ""
    fetched_at: float = field(default_factory=time.time)


# ─── Fetchers ─────────────────────────────────────────────────

class PriceFetcher:
    """Base class for price source fetchers."""
    source: str = ""
    ttl: int = 1800

    async def fetch(self) -> list[PriceEntry]:
        raise NotImplementedError


class OpenRouterFetcher(PriceFetcher):
    """Fetch live prices from OpenRouter's public API."""
    source = "openrouter"
    ttl = 1800  # 30 min

    async def fetch(self) -> list[PriceEntry]:
        entries = []
        try:
            # Try with certs first, fall back to no-verify for broken SSL
            data = None
            for client_fn in [_make_client, _make_client_no_verify]:
                try:
                    async with client_fn(timeout=15) as client:
                        resp = await client.get("https://openrouter.ai/api/v1/models")
                        if resp.status_code == 200:
                            data = resp.json()
                            break
                except Exception:
                    continue

            if not data:
                logger.warning("OpenRouter: all fetch attempts failed")
                return entries

            for m in data.get("data", []):
                model_id = m.get("id", "")
                pricing = m.get("pricing", {})
                prompt_price = float(pricing.get("prompt", "0") or "0")
                completion_price = float(pricing.get("completion", "0") or "0")
                if prompt_price <= 0 and completion_price <= 0:
                    continue

                info = parse_model_info(model_id)
                entries.append(PriceEntry(
                    source=self.source,
                    model_id=model_id,
                    display_name=m.get("name", model_id),
                    family=info["family"],
                    family_key=info["canonical_id"],
                    input_per_mtok=round(prompt_price * 1_000_000, 4),
                    output_per_mtok=round(completion_price * 1_000_000, 4),
                    context_length=m.get("context_length", 0),
                ))

            logger.info(f"OpenRouter: fetched {len(entries)} models")
        except Exception as e:
            logger.warning(f"OpenRouter fetch failed: {e}")
        return entries


class TogetherFetcher(PriceFetcher):
    """Fetch live prices from Together AI's public model listing."""
    source = "together"
    ttl = 1800

    async def fetch(self) -> list[PriceEntry]:
        entries = []
        try:
            data = None
            for client_fn in [_make_client, _make_client_no_verify]:
                try:
                    async with client_fn(timeout=15) as client:
                        resp = await client.get("https://api.together.xyz/v1/models")
                        if resp.status_code == 200:
                            data = resp.json()
                            break
                except Exception:
                    continue

            if not data:
                logger.warning("Together: all fetch attempts failed")
                return entries

            for m in data if isinstance(data, list) else data.get("data", data.get("models", [])):
                model_id = m.get("id", "")
                pricing = m.get("pricing", {})
                if not pricing:
                    continue

                # Together uses per-token pricing
                input_price = float(pricing.get("input", pricing.get("prompt", "0")) or "0")
                output_price = float(pricing.get("output", pricing.get("completion", "0")) or "0")
                if input_price <= 0 and output_price <= 0:
                    continue

                info = parse_model_info(model_id)
                entries.append(PriceEntry(
                    source=self.source,
                    model_id=model_id,
                    display_name=m.get("display_name", m.get("name", model_id)),
                    family=info["family"],
                    family_key=info["canonical_id"],
                    input_per_mtok=round(input_price * 1_000_000, 4),
                    output_per_mtok=round(output_price * 1_000_000, 4),
                    context_length=m.get("context_length", m.get("context_window", 0)),
                ))

            logger.info(f"Together: fetched {len(entries)} models")
        except Exception as e:
            logger.warning(f"Together fetch failed: {e}")
        return entries


class DirectAPIFetcher(PriceFetcher):
    """Static prices from providers without public pricing APIs.

    Updated manually when providers announce pricing changes.
    Separate "same-model" (open-weight) vs "alternative" (closed-source)
    comparisons via the `comparison_type` field.
    """
    source = "direct"
    ttl = 86400  # 24h (prices are static, just re-snapshot daily)

    # Last manually updated: 2026-09-24
    LAST_UPDATED = "2026-09-24"

    PRICES = [
        # ─── Closed-source APIs (alternative comparisons) ─────
        # OpenAI — cache = 50% of input (4.1 series: 75% discount)
        {"source": "openai", "model_id": "gpt-4o-mini", "display_name": "GPT-4o Mini",
         "input": 0.15, "cache": 0.075, "output": 0.60, "context": 128000,
         "comparison_type": "alternative", "open_weight": False},
        {"source": "openai", "model_id": "gpt-4o", "display_name": "GPT-4o",
         "input": 2.50, "cache": 1.25, "output": 10.00, "context": 128000,
         "comparison_type": "alternative", "open_weight": False},
        {"source": "openai", "model_id": "gpt-4.1-mini", "display_name": "GPT-4.1 Mini",
         "input": 0.40, "cache": 0.10, "output": 1.60, "context": 1047576,
         "comparison_type": "alternative", "open_weight": False},
        {"source": "openai", "model_id": "gpt-4.1", "display_name": "GPT-4.1",
         "input": 2.00, "cache": 0.50, "output": 8.00, "context": 1047576,
         "comparison_type": "alternative", "open_weight": False},

        # Anthropic — cache read = 10% of input
        {"source": "anthropic", "model_id": "claude-3.5-haiku", "display_name": "Claude 3.5 Haiku",
         "input": 0.80, "cache": 0.08, "output": 4.00, "context": 200000,
         "comparison_type": "alternative", "open_weight": False},
        {"source": "anthropic", "model_id": "claude-sonnet-4", "display_name": "Claude Sonnet 4",
         "input": 3.00, "cache": 0.30, "output": 15.00, "context": 200000,
         "comparison_type": "alternative", "open_weight": False},
        {"source": "anthropic", "model_id": "claude-opus-4", "display_name": "Claude Opus 4",
         "input": 15.00, "cache": 1.50, "output": 75.00, "context": 200000,
         "comparison_type": "alternative", "open_weight": False},

        # Google — cache = 25% of input (for prompts > 32k tokens)
        {"source": "google", "model_id": "gemini-2.0-flash", "display_name": "Gemini 2.0 Flash",
         "input": 0.10, "cache": 0.025, "output": 0.40, "context": 1048576,
         "comparison_type": "alternative", "open_weight": False},
        {"source": "google", "model_id": "gemini-2.5-pro", "display_name": "Gemini 2.5 Pro",
         "input": 1.25, "cache": 0.3125, "output": 10.00, "context": 1048576,
         "comparison_type": "alternative", "open_weight": False},

        # DeepSeek — cache = 10% of input (via their API)
        {"source": "deepseek", "model_id": "deepseek-chat", "display_name": "DeepSeek V3",
         "input": 0.27, "cache": 0.07, "output": 1.10, "context": 65536,
         "comparison_type": "alternative", "open_weight": True},
        {"source": "deepseek", "model_id": "deepseek-reasoner", "display_name": "DeepSeek R1",
         "input": 0.55, "cache": 0.14, "output": 2.19, "context": 65536,
         "comparison_type": "alternative", "open_weight": True},

        # Alibaba Cloud (Qwen via DashScope)
        {"source": "alibaba", "model_id": "qwen-max", "display_name": "Qwen Max",
         "input": 1.60, "cache": 0.40, "output": 6.40, "context": 32768,
         "comparison_type": "alternative", "open_weight": False},
        {"source": "alibaba", "model_id": "qwen-plus", "display_name": "Qwen Plus",
         "input": 0.40, "cache": 0.10, "output": 1.20, "context": 131072,
         "comparison_type": "alternative", "open_weight": False},
        {"source": "alibaba", "model_id": "qwen-turbo", "display_name": "Qwen Turbo",
         "input": 0.05, "cache": 0.01, "output": 0.20, "context": 131072,
         "comparison_type": "alternative", "open_weight": False},

        # ─── Open-weight hosting providers (same-model comparisons) ─
        # Deepinfra — no published cache pricing
        {"source": "deepinfra", "model_id": "meta-llama/Llama-3.1-8B-Instruct", "display_name": "Llama 3.1 8B",
         "input": 0.06, "output": 0.06, "context": 131072,
         "comparison_type": "same_model", "open_weight": True},
        {"source": "deepinfra", "model_id": "meta-llama/Llama-3.1-70B-Instruct", "display_name": "Llama 3.1 70B",
         "input": 0.35, "output": 0.40, "context": 131072,
         "comparison_type": "same_model", "open_weight": True},
        {"source": "deepinfra", "model_id": "Qwen/Qwen2.5-7B-Instruct", "display_name": "Qwen 2.5 7B",
         "input": 0.06, "output": 0.06, "context": 32768,
         "comparison_type": "same_model", "open_weight": True},
        {"source": "deepinfra", "model_id": "deepseek-ai/DeepSeek-R1", "display_name": "DeepSeek R1",
         "input": 0.55, "output": 2.19, "context": 65536,
         "comparison_type": "same_model", "open_weight": True},

        # Groq — no published cache pricing
        {"source": "groq", "model_id": "llama-3.1-8b-instant", "display_name": "Llama 3.1 8B",
         "input": 0.05, "output": 0.08, "context": 131072,
         "comparison_type": "same_model", "open_weight": True},
        {"source": "groq", "model_id": "llama-3.1-70b-versatile", "display_name": "Llama 3.1 70B",
         "input": 0.59, "output": 0.79, "context": 131072,
         "comparison_type": "same_model", "open_weight": True},
        {"source": "groq", "model_id": "deepseek-r1-distill-llama-70b", "display_name": "DeepSeek R1 Distill 70B",
         "input": 0.75, "output": 0.99, "context": 131072,
         "comparison_type": "same_model", "open_weight": True},

        # Fireworks — no published cache pricing
        {"source": "fireworks", "model_id": "accounts/fireworks/models/llama-v3p1-8b-instruct", "display_name": "Llama 3.1 8B",
         "input": 0.10, "output": 0.10, "context": 131072,
         "comparison_type": "same_model", "open_weight": True},
        {"source": "fireworks", "model_id": "accounts/fireworks/models/llama-v3p1-70b-instruct", "display_name": "Llama 3.1 70B",
         "input": 0.90, "output": 0.90, "context": 131072,
         "comparison_type": "same_model", "open_weight": True},
        {"source": "fireworks", "model_id": "accounts/fireworks/models/qwen2p5-72b-instruct", "display_name": "Qwen 2.5 72B",
         "input": 0.90, "output": 0.90, "context": 32768,
         "comparison_type": "same_model", "open_weight": True},

        # Together
        {"source": "together", "model_id": "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo", "display_name": "Llama 3.1 8B",
         "input": 0.18, "output": 0.18, "context": 131072,
         "comparison_type": "same_model", "open_weight": True},
        {"source": "together", "model_id": "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", "display_name": "Llama 3.1 70B",
         "input": 0.88, "output": 0.88, "context": 131072,
         "comparison_type": "same_model", "open_weight": True},
        {"source": "together", "model_id": "Qwen/Qwen2.5-72B-Instruct-Turbo", "display_name": "Qwen 2.5 72B",
         "input": 1.20, "output": 1.20, "context": 32768,
         "comparison_type": "same_model", "open_weight": True},
    ]

    async def fetch(self) -> list[PriceEntry]:
        entries = []
        for p in self.PRICES:
            info = parse_model_info(p["model_id"])
            entries.append(PriceEntry(
                source=p["source"],
                model_id=p["model_id"],
                display_name=p["display_name"],
                family=info["family"],
                family_key=info["canonical_id"],
                input_per_mtok=p["input"],
                output_per_mtok=p["output"],
                cache_per_mtok=p.get("cache", 0),
                context_length=p.get("context", 0),
            ))
        logger.info(f"Direct API prices: loaded {len(entries)} entries (as of {self.LAST_UPDATED})")
        return entries


# ─── Collector ────────────────────────────────────────────────

class PriceCollector:
    """Manages all fetchers, in-memory cache, and SQLite persistence."""

    def __init__(self, store=None):
        self._fetchers: list[PriceFetcher] = [
            # OpenRouter and Together now require auth for their public APIs.
            # Static prices from DirectAPIFetcher cover the same providers
            # with manually verified pricing. Re-enable live fetchers when
            # we add API key support for these sources.
            # OpenRouterFetcher(),
            # TogetherFetcher(),
            DirectAPIFetcher(),
        ]
        self._cache: dict[tuple[str, str], PriceEntry] = {}  # (source, model_id) → PriceEntry
        self._store = store
        self._last_fetch: dict[str, float] = {}
        self._task: asyncio.Task | None = None

    @property
    def cache(self) -> dict[tuple[str, str], PriceEntry]:
        return self._cache

    def get_all_current(self) -> list[PriceEntry]:
        """Return all current cached prices."""
        return list(self._cache.values())

    def get_by_family(self, family_key: str) -> list[PriceEntry]:
        """Return prices matching a family key."""
        return [e for e in self._cache.values() if e.family_key == family_key]

    def get_by_source(self, source: str) -> list[PriceEntry]:
        """Return all prices from a specific source."""
        return [e for e in self._cache.values() if e.source == source]

    def get_sources_metadata(self) -> dict[str, str]:
        """Return last fetch timestamp per source."""
        return {src: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))
                for src, ts in self._last_fetch.items()}

    async def fetch_all(self):
        """Run all fetchers in parallel, update cache and store."""
        now = time.time()
        tasks = []
        for fetcher in self._fetchers:
            last = self._last_fetch.get(fetcher.source, 0)
            if (now - last) >= fetcher.ttl:
                tasks.append(self._run_fetcher(fetcher))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
            self._persist_snapshot()
            self._prune_old()

    async def _run_fetcher(self, fetcher: PriceFetcher):
        """Run a single fetcher and update cache."""
        try:
            entries = await fetcher.fetch()
            now = time.time()
            for entry in entries:
                entry.fetched_at = now
                self._cache[(entry.source, entry.model_id)] = entry
            self._last_fetch[fetcher.source] = now
        except Exception as e:
            logger.error(f"Fetcher {fetcher.source} failed: {e}")

    def _persist_snapshot(self):
        """Write current cache to SQLite."""
        if not self._store:
            return
        try:
            conn = self._store._conn
            for entry in self._cache.values():
                conn.execute(
                    """INSERT INTO reference_prices
                       (source, model_id, display_name, family, family_key,
                        input_per_mtok, output_per_mtok, cache_per_mtok, context_length, fetched_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (entry.source, entry.model_id, entry.display_name, entry.family,
                     entry.family_key, entry.input_per_mtok, entry.output_per_mtok,
                     entry.cache_per_mtok, entry.context_length, entry.fetched_at),
                )
            conn.commit()
            logger.info(f"Persisted {len(self._cache)} reference prices to SQLite")
        except Exception as e:
            logger.error(f"Failed to persist reference prices: {e}")

    def _prune_old(self):
        """Remove entries older than PRUNE_DAYS."""
        if not self._store:
            return
        try:
            cutoff = time.time() - (PRUNE_DAYS * 86400)
            self._store._conn.execute(
                "DELETE FROM reference_prices WHERE fetched_at < ?", (cutoff,)
            )
            self._store._conn.commit()
        except Exception as e:
            logger.warning(f"Failed to prune old reference prices: {e}")

    async def run_loop(self):
        """Background loop: fetch immediately, then every FETCH_INTERVAL."""
        # Immediate first fetch
        await self.fetch_all()

        while True:
            try:
                # Add jitter: ±10% of interval
                import random
                jitter = FETCH_INTERVAL * (0.9 + random.random() * 0.2)
                await asyncio.sleep(jitter)
                await self.fetch_all()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Price collector loop error: {e}")
                await asyncio.sleep(60)

    def start(self) -> asyncio.Task:
        """Start the background collector loop."""
        self._task = asyncio.create_task(self.run_loop())
        return self._task

    def stop(self):
        """Stop the background collector loop."""
        if self._task:
            self._task.cancel()
