"""Matching engine — pairs inference requests with providers.

The matching engine is pluggable via the MatchingStrategy protocol.
Strategies range from simple greedy (immediate, O(n)) to batch auction
(periodic, globally optimal assignment).
"""

from .engine import MatchingEngine
from .models import InferenceOrder, MatchResult, ProviderOffer, RoutingPreference
from .strategy import BatchAuctionStrategy, GreedyStrategy, MatchingStrategy

__all__ = [
    "MatchingEngine",
    "MatchingStrategy",
    "GreedyStrategy",
    "BatchAuctionStrategy",
    "InferenceOrder",
    "ProviderOffer",
    "MatchResult",
    "RoutingPreference",
]
