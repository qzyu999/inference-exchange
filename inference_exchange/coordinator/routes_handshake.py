"""Consumer-facing confidential provider discovery and session bootstrap metadata."""

from fastapi import APIRouter

from inference_exchange.shared.handshake import ProviderOffer

from .dependencies import get_hub

router = APIRouter()


@router.get("/v1/exchange/confidential/providers")
async def list_confidential_provider_offers():
    """Return only providers that are admitted and identity-bound for #25.

    This endpoint intentionally returns no inference content.  A confidential
    provider is not advertised until both App Attest admission and the
    long-lived provider identity binding have succeeded.
    """
    hub = get_hub()
    offers: list[dict] = []
    for provider in hub._providers.values():
        if provider.capabilities.trust_level.value != "confidential":
            continue
        if not provider.handshake_ready:
            continue
        offer = ProviderOffer(
            provider_id=provider.provider_id,
            provider_identity_public_key=provider.provider_identity_public_key,
            app_attest_key_id=provider.app_attest_key_id,
            security_profile="L2",
            protocol_version="0.1.0",
            models=tuple(provider.capabilities.models),
            expires_at=int(provider.admission_expires_at),
            admission_id=getattr(provider, "admission_id", ""),
            artifact_or_build_hash=provider.provider_artifact_hash,
        )
        offer.validate()
        offers.append(offer.to_dict())
    return {"providers": offers}
