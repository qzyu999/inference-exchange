"""Keep request-side routing aliases separate from served-model evidence (#134)."""

from inference_exchange.shared.protocol import InferenceDone


def served_model_for_request(requested_model: str, provider, done_msg: InferenceDone | None = None) -> str | None:
    """Resolve only a compatible completion or unambiguous single-model provider."""
    advertised = list(dict.fromkeys(
        name for name in provider.capabilities.models if name and name != "default"
    ))
    confirmed = getattr(done_msg, "served_model", None)
    if confirmed:
        if confirmed in advertised and (requested_model == "default" or requested_model == confirmed):
            return confirmed
        return None  # Contradictory or unadvertised confirmation: never guess.
    if len(advertised) == 1 and (requested_model == "default" or requested_model == advertised[0]):
        return advertised[0]
    return None
