"""Operator resource-safety controls (#112): inference pause, signup switch, per-account concurrency.

These protect a small provider pool from overload. They are not daily quotas.

Start-up values come from the environment. Admins can change them at runtime via
/v1/admin/controls; runtime changes are not persisted and reset on restart.

  IE_INFERENCE_PAUSED=1            reject new inference requests (503 inference_paused)
  IE_SIGNUP_DISABLED=1             refuse new accounts; existing users can still sign in
  IE_MAX_CONCURRENT_PER_ACCOUNT=N  simultaneous inference requests per account (default 2, 0 = no limit)
"""

import logging
import os
import threading

logger = logging.getLogger(__name__)


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "0").strip().lower() in ("1", "true", "yes", "on")


class OperatorControls:
    def __init__(self):
        self.inference_paused = _env_flag("IE_INFERENCE_PAUSED")
        self.signup_disabled = _env_flag("IE_SIGNUP_DISABLED")
        self.max_concurrent_per_account = int(os.environ.get("IE_MAX_CONCURRENT_PER_ACCOUNT", "2"))
        self._active: dict[str, int] = {}
        self._lock = threading.Lock()

    def try_acquire(self, account_id: str) -> bool:
        """Reserve an inference slot for this account. False if the account is at its limit."""
        with self._lock:
            current = self._active.get(account_id, 0)
            if self.max_concurrent_per_account > 0 and current >= self.max_concurrent_per_account:
                return False
            self._active[account_id] = current + 1
            return True

    def release(self, account_id: str) -> None:
        with self._lock:
            current = self._active.get(account_id, 0)
            if current <= 1:
                self._active.pop(account_id, None)
            else:
                self._active[account_id] = current - 1

    def active_for(self, account_id: str) -> int:
        return self._active.get(account_id, 0)

    def snapshot(self) -> dict:
        with self._lock:
            active = dict(self._active)
        return {
            "inference_paused": self.inference_paused,
            "signup_disabled": self.signup_disabled,
            "max_concurrent_per_account": self.max_concurrent_per_account,
            "active_requests_by_account": active,
            "active_requests_total": sum(active.values()),
        }

    def update(self, actor: str, **changes) -> dict:
        for key, value in changes.items():
            if value is None:
                continue
            old = getattr(self, key)
            setattr(self, key, value)
            if old != value:
                logger.warning(f"Operator control changed by {actor}: {key} {old} -> {value}")
        return self.snapshot()


_controls: OperatorControls | None = None


def get_controls() -> OperatorControls:
    global _controls
    if _controls is None:
        _controls = OperatorControls()
    return _controls


def reset_controls() -> OperatorControls:
    """Re-read the environment. Called once per app start."""
    global _controls
    _controls = OperatorControls()
    return _controls


async def run_guarded(account_id: str, handler):
    """Apply pause and per-account concurrency to one inference request (OPS-008, OPS-010).

    `handler` is an async callable that returns the response. The slot is released
    when a plain response returns, when a streaming response finishes or the client
    disconnects, or when the handler raises.
    """
    from fastapi.responses import StreamingResponse

    from inference_exchange.shared.errors import ConcurrencyLimit, InferencePaused

    controls = get_controls()
    if controls.inference_paused:
        raise InferencePaused()
    if not controls.try_acquire(account_id):
        raise ConcurrencyLimit(controls.max_concurrent_per_account)
    try:
        response = await handler()
    except BaseException:
        controls.release(account_id)
        raise

    if isinstance(response, StreamingResponse):
        inner = response.body_iterator

        async def body():
            try:
                async for chunk in inner:
                    yield chunk
            finally:
                controls.release(account_id)

        response.body_iterator = body()
        return response
    controls.release(account_id)
    return response
