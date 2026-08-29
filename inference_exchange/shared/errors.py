"""Structured OCIP error types per spec §06.4."""

from fastapi import HTTPException


class OCIPError(HTTPException):
    """Base OCIP error with structured type field."""

    def __init__(self, status_code: int, error_type: str, message: str):
        detail = {"type": error_type, "message": message}
        super().__init__(status_code=status_code, detail=detail)


class NoProviderAvailable(OCIPError):
    def __init__(self, message: str = "No provider available for this model"):
        super().__init__(503, "no_provider_available", message)


class ConfidenceUnavailable(OCIPError):
    def __init__(self, level: str, model: str):
        super().__init__(
            503,
            "confidence_unavailable",
            f"No provider with confidence level '{level}' available for model '{model}'",
        )


class InsufficientBalance(OCIPError):
    def __init__(self):
        super().__init__(402, "insufficient_balance", "Insufficient account balance")


class ProviderTimeout(OCIPError):
    def __init__(self):
        super().__init__(504, "provider_timeout", "Provider did not respond in time")


class ProviderError(OCIPError):
    def __init__(self, detail: str = "Provider returned an error"):
        super().__init__(502, "provider_error", detail)


class QueueFull(OCIPError):
    def __init__(self, depth: int):
        super().__init__(503, "queue_full", f"Request queue full ({depth} pending)")


class QueueTimeout(OCIPError):
    def __init__(self, seconds: float):
        super().__init__(
            503, "queue_timeout", f"No provider available after {int(seconds)}s wait"
        )


class RateLimitExceeded(OCIPError):
    def __init__(self):
        super().__init__(
            429, "rate_limit_exceeded", "Rate limit exceeded. Try again in a few seconds."
        )
