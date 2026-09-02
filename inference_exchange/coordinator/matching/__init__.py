"""Matching engine -- pairs inference requests with providers."""

from .models import InferenceOrder, MatchResult, ProviderOffer, RoutingPreference
from .strategy import BatchAuctionStrategy, GreedyStrategy, MatchingStrategy, compute_score

__all__ = [
    "MatchingStrategy",
    "GreedyStrategy",
    "BatchAuctionStrategy",
    "InferenceOrder",
    "ProviderOffer",
    "MatchResult",
    "RoutingPreference",
    "compute_score",
]
