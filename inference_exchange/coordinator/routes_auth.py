"""Auth endpoints — API key management and consumer identity."""

from fastapi import APIRouter, Request

from .dependencies import get_auth, get_billing

router = APIRouter()


@router.post("/v1/auth/keys")
async def create_api_key(request: Request):
    """Create a new API key. Returns the key (shown only once)."""
    auth = get_auth()
    billing = get_billing()
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    name = body.get("name", "API Key")

    raw_key, consumer_id = auth.create_key(name=name)

    # Create billing account with $10 free credit
    billing.get_or_create_consumer(consumer_id, name)

    return {
        "api_key": raw_key,
        "consumer_id": consumer_id,
        "name": name,
        "balance_usd": 10.0,
        "note": "Save this key — it won't be shown again.",
    }


@router.get("/v1/auth/keys")
async def list_api_keys():
    """List all API keys (metadata only, no raw values)."""
    auth = get_auth()
    return {"keys": auth.list_keys()}


@router.get("/v1/auth/me")
async def get_current_user(request: Request):
    """Get the current authenticated consumer's info."""
    auth = get_auth()
    billing = get_billing()
    consumer_id = auth.resolve_consumer(request.headers.get("authorization"))
    account = billing.get_or_create_consumer(consumer_id)
    # account may be a dict (SQLite) or an object — handle both
    if isinstance(account, dict):
        return {
            "consumer_id": consumer_id,
            "balance_usd": round(account["balance_micro"] / 1_000_000, 6),
            "total_spent_usd": round(account["total_spent_micro"] / 1_000_000, 6),
            "requests_made": account["requests_made"],
            "tokens_consumed": account["tokens_consumed"],
        }
    return {
        "consumer_id": consumer_id,
        "balance_usd": round(account.balance_usd, 6),
        "total_spent_usd": round(account.total_spent_usd, 6),
        "requests_made": account.requests_made,
        "tokens_consumed": account.tokens_consumed,
    }
