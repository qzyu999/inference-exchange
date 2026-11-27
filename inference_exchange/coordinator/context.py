"""The services of the app that serves the current context.

A leaf module: it imports nothing from the coordinator, so any module can
read the bound services without an import cycle.
"""

import contextvars
from typing import Any

_current: contextvars.ContextVar[Any] = contextvars.ContextVar("ie_services")


def current() -> Any:
    try:
        return _current.get()
    except LookupError:
        raise RuntimeError("No coordinator app is bound to this context") from None


def bind(services: Any) -> contextvars.Token:
    """Bind services outside an ASGI scope, for scripts and tests."""
    return _current.set(services)


def unbind(token: contextvars.Token) -> None:
    _current.reset(token)
