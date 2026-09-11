"""Consumer-facing confidential provider discovery metadata."""

from fastapi import APIRouter

from inference_exchange.shared.handshake import ProviderOffer

from .dependencies import get_hub

router = APIRouter()


@router.get("/v1/exchange/confidential/providers")
async def list_confidential_provider_offers():
    """Return only cryptographically admitted, identity-bound providers.

    The current coordinator does not yet populate a verified identity binding
    on ConnectedProvider, so confidential providers remain undiscoverable until
    the admission integration supplies all required fields. This is deliberate
    fail-closed behavior rather than a placeholder security claim.
    """
    hub = get_hub()
    offers: list[dict] = []
    for provider in hub._providers.values():
        if provider.capabilities.trust_level.value != "confidential":
            continue
        app_attest_verified = bool(getattr(provider, "app_attest_verified", False))
        identity_key = getattr(provider, "provider_identity_public_key", "")
        identity_bound = bool(getattr(provider, "provider_identity_bound", False))
        admission_expires_at = float(getattr(provider, "admission_expires_at", 0.0))
        admission_id = str(getattr(provider, "admission_id", ""))
        artifact_hash = str(getattr(provider, "provider_artifact_hash", ""))
        app_attest_key_id = str(getattr(provider, "app_attest_key_id", ""))
        if not (app_attest_verified and identity_key and identity_bound):
            continue
        if admission_expires_at <= __import__("time").time():
            continue
        if not admission_id or not app_attest_key_id or not artifact_hash:
            continue
        offer = ProviderOffer(
            provider_id=provider.provider_id,
            provider_identity_public_key=identity_key,
            app_attest_key_id=app_attest_key_id,
            security_profile="L2",
            protocol_version="0.1.0",
            models=tuple(provider.capabilities.models),
            expires_at=int(admission_expires_at),
            admission_id=admission_id,
            artifact_or_build_hash=artifact_hash,
        )
        offer.validate()
        offers.append(offer.to_dict())
    return {"providers": offers}
