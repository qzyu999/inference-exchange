"""Provider credential transport and log redaction (#125, PROV-011).

Provider agents send the IE provider token in the WebSocket upgrade
``Authorization: Bearer`` header. They never put it in the URL, because
proxies, tunnels, and servers log URLs.
"""

from __future__ import annotations

import logging
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

PROVIDER_TOKEN_ENV = "IE_PROVIDER_TOKEN"
REDACTED = "[REDACTED]"

# Query parameters that can carry a credential, and IE credential formats.
_SECRET_QUERY = re.compile(r"(?i)([?&](?:token|api_key|access_token)=)[^&\s\"']+")
_SECRET_VALUE = re.compile(r"\b(pt-ie-|sk-ie-)[A-Za-z0-9_\-]+")


def redact(text: str) -> str:
    """Remove credential values from a log line or URL."""
    text = _SECRET_QUERY.sub(lambda m: m.group(1) + REDACTED, text)
    return _SECRET_VALUE.sub(lambda m: m.group(1) + REDACTED, text)


def split_token_from_url(url: str) -> tuple[str, str]:
    """Return (url without ``token`` query parameter, token found in it or "")."""
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    token = ""
    kept = []
    for key, value in query:
        if key == "token":
            token = token or value
        else:
            kept.append((key, value))
    return urlunsplit(parts._replace(query=urlencode(kept))), token


def _websockets_major() -> int:
    import websockets

    try:
        return int(websockets.__version__.split(".")[0])
    except (AttributeError, ValueError):
        return 0


def provider_connect(url: str, token: str = "", logger: logging.Logger | None = None, **kwargs):
    """Open a provider WebSocket. The token goes in the Authorization header only.

    If an operator still puts ``?token=`` in the coordinator URL, the token is
    moved to the header and the URL is cleaned. The token value is never logged.
    """
    import websockets

    clean_url, url_token = split_token_from_url(url)
    if url_token:
        if logger:
            logger.warning(
                "The coordinator URL contains a provider token. The agent sends it in the "
                "Authorization header instead. Remove ?token= from the URL (#125)."
            )
        token = token or url_token
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    if headers:
        # websockets>=14 renamed the client argument.
        key = "additional_headers" if _websockets_major() >= 14 else "extra_headers"
        kwargs[key] = headers
    return websockets.connect(clean_url, **kwargs)


class RedactSecretsFilter(logging.Filter):
    """Logging filter that removes credential values from each record."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True
        cleaned = redact(message)
        if cleaned != message:
            record.msg = cleaned
            record.args = ()
        return True


_REDACTED_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access", "websockets")


def install_log_redaction() -> None:
    """Add RedactSecretsFilter to server loggers and root handlers. Idempotent."""
    targets: list[logging.Filterer] = [logging.getLogger(n) for n in _REDACTED_LOGGERS]
    targets += logging.getLogger().handlers
    for target in targets:
        if not any(isinstance(f, RedactSecretsFilter) for f in target.filters):
            target.addFilter(RedactSecretsFilter())


def uvicorn_log_config() -> dict:
    """Uvicorn's default log config with redaction on every handler."""
    import copy

    from uvicorn.config import LOGGING_CONFIG

    config = copy.deepcopy(LOGGING_CONFIG)
    config.setdefault("filters", {})["redact_secrets"] = {"()": RedactSecretsFilter}
    for handler in config.get("handlers", {}).values():
        handler.setdefault("filters", []).append("redact_secrets")
    return config
