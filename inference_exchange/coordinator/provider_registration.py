"""Provider registration admission policy (#147).

Only validated, bounded registration messages may enter ProviderHub.
Hardware labels are provider claims, not proof of platform or trust.
"""

import json
import math
import re
import time
import unicodedata
from collections import deque

from pydantic import ValidationError

from inference_exchange.config import is_production
from inference_exchange.shared.protocol import ProviderCapabilities, RegisterMessage

MAX_REGISTRATION_BYTES = 64 * 1024
MAX_WS_FRAME_BYTES = 1_000_000
REGISTER_TIMEOUT_SECONDS = 10
MAX_INCOMPLETE_REGISTRATIONS = 32
MAX_ATTEMPTS_PER_CREDENTIAL_PER_MINUTE = 20
MAX_CREDENTIAL_BUCKETS = 1024

_APPLE_HARDWARE = re.compile(r"apple-(?:silicon(?:-arm64)?|m[1-9][0-9]{0,2}(?:-[a-z0-9]+)*)\Z")


class RegistrationRejected(ValueError):
    """A provider registration cannot be admitted. The public error is generic."""


def _reject(_message: str = ""):
    raise RegistrationRejected("Invalid provider registration")


def _reject_constant(_value: str):
    _reject()


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            _reject()
        result[key] = value
    return result


def _bounded_text(value: object, maximum: int, *, allow_empty: bool = False) -> None:
    if not isinstance(value, str) or len(value) > maximum:
        _reject()
    if not allow_empty and (not value or not value.strip()):
        _reject()
    # Reject control/format characters and HTML markup in public labels.
    if any(unicodedata.category(ch).startswith("C") or ch in "<>&" for ch in value):
        _reject()


def _bounded_number(value: object, maximum: float) -> None:
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= maximum:
        _reject()


def _bounded_integer(value: object, minimum: int, maximum: int) -> None:
    if type(value) is not int or not minimum <= value <= maximum:
        _reject()


def _identity(value: object) -> None:
    if value is None:
        return
    if not isinstance(value, dict) or len(value) > 32:
        _reject()
    for key, field in value.items():
        _bounded_text(key, 64)
        if isinstance(field, str):
            _bounded_text(field, 512, allow_empty=True)
        elif type(field) is bool:
            continue
        elif type(field) in (int, float):
            _bounded_number(field, 1_000_000_000_000_000)
        else:
            # The current GGUF identity contains only scalar metadata.
            _reject()


def parse_provider_registration(raw: str) -> RegisterMessage:
    """Validate raw wire JSON before it can change routing or billing state."""
    if not isinstance(raw, str) or len(raw.encode("utf-8")) > MAX_REGISTRATION_BYTES:
        _reject()
    try:
        data = json.loads(raw, parse_constant=_reject_constant, object_pairs_hook=_reject_duplicate_keys)
    except (ValueError, TypeError, RecursionError):
        _reject()
    if not isinstance(data, dict):
        _reject()
    if set(data) - set(RegisterMessage.model_fields):
        _reject()
    if data.get("type") != "register" or data.get("protocol_version", "0.1.0") != "0.1.0":
        _reject()

    _bounded_text(data.get("provider_name"), 64)
    caps = data.get("capabilities")
    if not isinstance(caps, dict) or set(caps) - set(ProviderCapabilities.model_fields):
        _reject()

    models = caps.get("models")
    if not isinstance(models, list) or not 1 <= len(models) <= 8:
        _reject()
    for model in models:
        _bounded_text(model, 128)
    if len(set(models)) != len(models):
        _reject()

    _bounded_integer(caps.get("max_concurrent", 2), 1, 16)
    _bounded_integer(caps.get("context_length", 0), 0, 1_048_576)
    for field in ("price_per_mtok_input", "price_per_mtok_output", "price_per_mtok_cache"):
        defaults = {"price_per_mtok_input": 0.05, "price_per_mtok_output": 0.20,
                    "price_per_mtok_cache": 0}
        _bounded_number(caps.get(field, defaults[field]), 100)
    _bounded_number(caps.get("measured_tps", 0), 10_000)
    _bounded_number(caps.get("memory_gb", 0), 1_024)
    for field in ("supports_vision", "supports_tool_calling"):
        if type(caps.get(field, False)) is not bool:
            _reject()
    for field, limit in (("hardware", 128), ("model_format", 32), ("model_repo_id", 255)):
        _bounded_text(caps.get(field, "unknown" if field == "hardware" else ""), limit,
                      allow_empty=field != "hardware")

    _identity(data.get("model_identity"))
    for field in ("encryption_public_key", "app_attest_key_id", "app_attest_app_id",
                  "app_attest_environment", "provider_artifact_hash",
                  "provider_identity_public_key"):
        _bounded_text(data.get(field, ""), 1024, allow_empty=True)

    try:
        reg = RegisterMessage.model_validate(data)
    except ValidationError:
        _reject()

    if is_production():
        # Private-alpha admission is L0 only. This is not a hardware verification.
        if reg.capabilities.trust_level.value != "open":
            _reject()
        if not _APPLE_HARDWARE.fullmatch(reg.capabilities.hardware.lower()):
            _reject()
        if reg.capabilities.model_format.lower() != "gguf":
            _reject()
    return reg


class RegistrationGuard:
    """Bound incomplete registrations and repeated attempts for known credentials.

    A single ingress IP may represent many clients behind the deployment proxy.
    Use credential IDs, not X-Forwarded-For, for the per-provider throttle.
    """

    def __init__(self):
        self.pending = 0
        self._attempts: dict[str, deque[float]] = {}

    def begin(self) -> bool:
        if self.pending >= MAX_INCOMPLETE_REGISTRATIONS:
            return False
        self.pending += 1
        return True

    def finish(self) -> None:
        if self.pending:
            self.pending -= 1

    def allow(self, token_id: str) -> bool:
        now = time.monotonic()
        if token_id not in self._attempts and len(self._attempts) >= MAX_CREDENTIAL_BUCKETS:
            # Keep memory bounded when an operator provisions many credentials.
            self._attempts.pop(next(iter(self._attempts)))
        attempts = self._attempts.setdefault(token_id, deque())
        while attempts and now - attempts[0] >= 60:
            attempts.popleft()
        if len(attempts) >= MAX_ATTEMPTS_PER_CREDENTIAL_PER_MINUTE:
            return False
        attempts.append(now)
        return True
