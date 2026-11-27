"""Prometheus metrics in text exposition format (no client library).

Request metrics are labelled by route template, not raw path, to keep cardinality bounded and avoid leaking ids.
"""

import os
import time
from collections import defaultdict

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

from inference_exchange.config import is_production

from .dependencies import get_hub, get_store

router = APIRouter()

LATENCY_BUCKETS = (0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60)

class Metrics:
    """HTTP request counters for one app."""

    def __init__(self):
        self.requests: dict[tuple[str, str, str], int] = defaultdict(int)
        self.latency_counts: dict[tuple[str, str], list[int]] = {}
        self.latency_sum: dict[tuple[str, str], float] = defaultdict(float)


def _metrics() -> Metrics:
    from .context import current
    return current().metrics


def _route_label(request: Request) -> str:
    route = request.scope.get("route")
    return getattr(route, "path", "unmatched")


def observe(request: Request, status: int, seconds: float) -> None:
    m = _metrics()
    route = _route_label(request)
    m.requests[(request.method, route, str(status))] += 1
    key = (request.method, route)
    counts = m.latency_counts.setdefault(key, [0] * (len(LATENCY_BUCKETS) + 1))
    for i, upper in enumerate(LATENCY_BUCKETS):
        if seconds <= upper:
            counts[i] += 1
    counts[-1] += 1
    m.latency_sum[key] += seconds


async def metrics_middleware(request: Request, call_next):
    start = time.perf_counter()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        return response
    finally:
        if request.url.path != "/metrics":
            observe(request, status, time.perf_counter() - start)


def _render() -> str:
    hub = get_hub()
    m = _metrics()
    summary = get_store().billing_summary()
    lines = [
        "# TYPE ie_providers_connected gauge",
        f"ie_providers_connected {hub.provider_count}",
        "# TYPE ie_queue_depth gauge",
        f"ie_queue_depth {hub.pending_queue_size}",
        "# TYPE ie_models_available gauge",
        f"ie_models_available {len(hub.available_models)}",
        "# TYPE ie_billed_requests_total counter",
        f"ie_billed_requests_total {summary.get('total_requests', 0)}",
        "# TYPE ie_billed_volume_usd_total counter",
        f"ie_billed_volume_usd_total {summary.get('total_volume_usd', 0)}",
        "# TYPE ie_http_requests_total counter",
    ]
    for (method, route, status), n in sorted(m.requests.items()):
        lines.append(f'ie_http_requests_total{{method="{method}",route="{route}",status="{status}"}} {n}')
    lines.append("# TYPE ie_http_request_duration_seconds histogram")
    for (method, route), counts in sorted(m.latency_counts.items()):
        labels = f'method="{method}",route="{route}"'
        for upper, n in zip(LATENCY_BUCKETS, counts):
            lines.append(f'ie_http_request_duration_seconds_bucket{{{labels},le="{upper}"}} {n}')
        lines.append(f'ie_http_request_duration_seconds_bucket{{{labels},le="+Inf"}} {counts[-1]}')
        lines.append(f"ie_http_request_duration_seconds_sum{{{labels}}} {m.latency_sum[(method, route)]:.6f}")
        lines.append(f"ie_http_request_duration_seconds_count{{{labels}}} {counts[-1]}")
    return "\n".join(lines) + "\n"


@router.get("/metrics")
async def metrics(request: Request):
    # Optional bearer token so the endpoint can be exposed without leaking ops data
    token = os.environ.get("IE_METRICS_TOKEN", "")
    if not token and is_production():
        # OPS-011: fail closed even if the proxy does not block /metrics
        return PlainTextResponse("not found\n", status_code=404)
    if token and request.headers.get("authorization", "") != f"Bearer {token}":
        return PlainTextResponse("unauthorized\n", status_code=401)
    return PlainTextResponse(_render(), media_type="text/plain; version=0.0.4")
