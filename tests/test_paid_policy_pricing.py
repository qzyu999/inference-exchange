"""Pure routing policy and pricing bounds (#297 slice 3; design §4 rules 1-2).

Every function here is pure: same inputs, same output, no I/O. The hub's
immediate, queued and retry paths must all rank providers with one function.
"""

from dataclasses import replace

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from inference_exchange.coordinator.paid import policy, pricing
from inference_exchange.coordinator.paid.model import Candidate, Order, Rates, Usage

RATES = Rates(input="0.30", output="1.20", cache="0.10")


def cand(pid, *, price=1.0, trust=0, slots=1, used=0, models=("m",), tps=10.0, rep=1.0, supply="provider"):
    return Candidate(provider_id=pid, models=frozenset(models), price_output=price, trust=trust,
                     slots=slots, used=used, tps=tps, reputation=rep, supply=supply)


def order(**kw):
    base = dict(model="m", min_trust=0, max_price=None, preference="balanced",
                exclude=frozenset(), affinity="", hosted_consent=False)
    base.update(kw)
    return Order(**base)


# --- policy.eligible: every rejection has a reason (ROUTE-010) ---------------

def test_eligible_filters_with_a_named_reason():
    offers = [
        cand("ok"),
        cand("model", models=("other",)),
        cand("price", price=5.0),
        cand("trust", trust=0),
        cand("full", used=1),
        cand("tried"),
        cand("vendor", supply="vendor"),
    ]
    o = order(max_price=2.0, min_trust=0, exclude=frozenset({"tried"}))
    result = policy.eligible(o, offers)
    assert [c.provider_id for c in result.eligible] == ["ok", "trust"]
    assert result.rejected == {
        "model": "model_not_served", "price": "above_price_ceiling", "full": "no_capacity",
        "tried": "already_tried", "vendor": "hosted_not_consented",
    }


def test_trust_is_never_downgraded():
    offers = [cand("open", trust=0), cand("hardened", trust=2)]
    assert [c.provider_id for c in policy.eligible(order(min_trust=2), offers).eligible] == ["hardened"]
    assert policy.eligible(order(min_trust=3), offers).eligible == []


def test_vendor_needs_explicit_consent():
    offers = [cand("v", supply="vendor")]
    assert policy.eligible(order(), offers).eligible == []
    assert [c.provider_id for c in policy.eligible(order(hosted_consent=True), offers).eligible] == ["v"]


# --- policy.rank: deterministic, with a stable tie-break ---------------------

def test_rank_is_deterministic_and_breaks_ties_by_id():
    a, b = cand("b"), cand("a")
    assert [c.provider_id for c in policy.rank(order(), [a, b])] == ["a", "b"]
    assert [c.provider_id for c in policy.rank(order(), [b, a])] == ["a", "b"]


def test_rank_uses_reputation_and_affinity():
    good, bad = cand("good", rep=1.0), cand("bad", rep=0.0)
    assert policy.rank(order(), [bad, good])[0].provider_id == "good"
    assert policy.rank(order(affinity="bad"), [good, replace(bad, reputation=1.0)])[0].provider_id == "bad"


@settings(max_examples=200, deadline=None)
@given(st.lists(st.tuples(st.floats(0, 10), st.integers(0, 3), st.floats(0, 1), st.integers(1, 4)),
                min_size=1, max_size=6, unique_by=lambda t: t))
def test_rank_order_does_not_depend_on_input_order(rows):
    cands = [cand(f"p{i}", price=p, trust=t, rep=r, slots=s) for i, (p, t, r, s) in enumerate(rows)]
    first = [c.provider_id for c in policy.rank(order(), cands)]
    assert [c.provider_id for c in policy.rank(order(), list(reversed(cands)))] == first


# --- pricing.input_bound: no tokenizer needed (BILL-018) ---------------------

def test_input_bound_is_bytes_plus_message_overhead():
    msgs = [{"role": "user", "content": "héllo"}]  # 6 UTF-8 bytes
    assert pricing.input_bound(msgs) == 6 + pricing.MESSAGE_OVERHEAD_TOKENS


@settings(max_examples=300, deadline=None)
@given(st.lists(st.text(max_size=200), min_size=1, max_size=8))
def test_input_bound_is_never_below_any_byte_level_token_count(contents):
    """Each token covers at least one UTF-8 byte, so bytes bound the token count."""
    msgs = [{"role": "user", "content": c} for c in contents]
    tokens_at_most = sum(len(c.encode("utf-8")) for c in contents)
    assert pricing.input_bound(msgs) >= tokens_at_most + len(msgs) * pricing.MESSAGE_OVERHEAD_TOKENS


# --- pricing.bound and pricing.charge ---------------------------------------

def test_bound_is_input_bound_plus_max_output_and_at_least_the_minimum():
    b = pricing.bound(input_tokens=1000, max_tokens=500, rates=RATES)
    assert b == pricing.cost(1000, "0.30") + pricing.cost(500, "1.20")
    assert pricing.bound(input_tokens=1, max_tokens=1, rates=RATES) == pricing.MIN_CHARGE_MICRO


@settings(max_examples=400, deadline=None)
@given(prompt=st.integers(0, 200_000), cached=st.integers(0, 200_000), completion=st.integers(0, 50_000),
       max_tokens=st.integers(1, 50_000), slack=st.integers(0, 1000))
def test_charge_never_exceeds_the_bound(prompt, cached, completion, max_tokens, slack):
    """ChargeWithinAuthorization: valid usage always charges at most the hold."""
    cached = min(cached, prompt)
    completion = min(completion, max_tokens)
    hold = pricing.bound(input_tokens=prompt + slack, max_tokens=max_tokens, rates=RATES)
    charged = pricing.charge(Usage(prompt, completion, cached), RATES, hold)
    assert pricing.MIN_CHARGE_MICRO <= charged.amount <= hold
    assert charged.excess == 0


def test_charge_above_the_hold_is_capped_and_the_excess_recorded():
    hold = pricing.bound(input_tokens=10, max_tokens=8, rates=RATES)
    charged = pricing.charge(Usage(10, 1_000_000, 0), RATES, hold)
    assert charged.amount == hold
    assert charged.excess == pricing.raw_cost(Usage(10, 1_000_000, 0), RATES) - hold


def test_cached_tokens_use_the_cache_rate():
    u = Usage(prompt_tokens=1000, completion_tokens=0, cached_tokens=600)
    assert pricing.raw_cost(u, RATES) == pricing.cost(400, "0.30") + pricing.cost(600, "0.10")


# --- pricing.parse_usage: invalid usage is never charged (BILL-017) ----------

@pytest.mark.parametrize("raw,reason", [
    ({"prompt_tokens": -1, "completion_tokens": 1}, "negative"),
    ({"prompt_tokens": 1.5, "completion_tokens": 1}, "not_integer"),
    ({"prompt_tokens": True, "completion_tokens": 1}, "not_integer"),
    ({"prompt_tokens": "3", "completion_tokens": 1}, "not_integer"),
    ({"completion_tokens": 1}, "missing"),
    ({"prompt_tokens": 2, "completion_tokens": 1, "cached_tokens": 3}, "cached_above_prompt"),
    ({"prompt_tokens": 2, "completion_tokens": 9}, "completion_above_max_tokens"),
    ({"prompt_tokens": 999, "completion_tokens": 1}, "prompt_above_input_bound"),
])
def test_parse_usage_rejects_by_reason(raw, reason):
    result = pricing.parse_usage(raw, max_tokens=8, input_bound=100)
    assert result == pricing.InvalidUsage(reason)


def test_parse_usage_accepts_valid_counts():
    assert pricing.parse_usage({"prompt_tokens": 7, "completion_tokens": 8, "cached_tokens": 2},
                               max_tokens=8, input_bound=100) == Usage(7, 8, 2)


# --- pricing.interrupted_charge: client ended the stream (BILL-019) ----------

def test_interrupted_charge_is_delivered_deltas_at_the_output_rate_plus_minimum_input():
    hold = pricing.bound(input_tokens=100, max_tokens=50, rates=RATES)
    amount = pricing.interrupted_charge(delivered_deltas=10, rates=RATES, hold=hold)
    assert amount == max(pricing.cost(10, "1.20") + pricing.cost(1, "0.30"), pricing.MIN_CHARGE_MICRO)
    assert pricing.interrupted_charge(delivered_deltas=10_000_000, rates=RATES, hold=hold) == hold


# --- the hub ranks with policy.rank on every path ----------------------------

async def test_immediate_queued_and_retry_paths_rank_identically():
    import random

    from inference_exchange.coordinator.provider_hub import ConnectedProvider, ProviderHub
    from inference_exchange.shared.protocol import InferenceRequest, ProviderCapabilities, TrustLevel

    class WS:
        async def send_json(self, data):
            pass

    rng = random.Random(7)
    for trial in range(30):
        hub = ProviderHub()
        reputations = {}
        for i in range(5):
            pid = f"p{i}"
            hub._providers[pid] = ConnectedProvider(
                provider_id=pid, name=pid, ws=WS(),
                capabilities=ProviderCapabilities(
                    models=["m"], trust_level=rng.choice([TrustLevel.OPEN, TrustLevel.CONTAINED]),
                    max_concurrent=2, price_per_mtok_output=round(rng.uniform(0.1, 3), 2),
                    measured_tps=round(rng.uniform(1, 50), 1)))
            reputations[pid] = round(rng.random(), 2)
        rep = reputations.get
        immediate = hub.select_provider("m", reputation_fn=rep)
        retry = hub.select_provider("m", reputation_fn=rep, exclude={"nobody"})
        pending = hub.enqueue_request(InferenceRequest(request_id=f"q{trial}", model="m", messages=[]), model="m")
        hub.reputation_fn = rep
        await hub._try_dispatch_queued()
        assert immediate.provider_id == retry.provider_id == pending.provider.provider_id, trial


@settings(max_examples=300, deadline=None)
@given(st.lists(st.tuples(st.floats(0.01, 10), st.integers(0, 3), st.floats(0, 1), st.integers(1, 4),
                          st.integers(0, 4), st.floats(0, 100)), min_size=1, max_size=6),
       st.sampled_from(["balanced", "cheapest", "fastest", "most_secure"]),
       st.integers(0, 3))
def test_policy_picks_what_the_old_greedy_matcher_picked(rows, preference, min_trust):
    """Slice 3 moves routing to paid/policy.py without changing which provider wins."""
    from inference_exchange.coordinator.matching.models import (
        ConfidenceLevel, InferenceOrder, ProviderOffer, RoutingPreference)
    from inference_exchange.coordinator.matching.strategy import GreedyStrategy, compute_score

    cands, offers = [], []
    for i, (price, trust, rep, slots, used, tps) in enumerate(rows):
        used = min(used, slots)
        cands.append(cand(f"p{i}", price=price, trust=trust, rep=rep, slots=slots, used=used, tps=tps))
        offers.append(ProviderOffer(
            provider_id=f"p{i}", provider_name=f"p{i}", models=["m"], price_per_mtok_input=0,
            price_per_mtok_output=price, confidence_level=ConfidenceLevel(trust),
            measured_throughput_tps=tps, total_slots=slots, used_slots=used, reputation_score=rep))
    old_order = InferenceOrder(order_id="o", consumer_id="", model="m",
                               min_confidence=ConfidenceLevel(min_trust), preference=RoutingPreference(preference))
    matches, _ = GreedyStrategy().match([old_order], offers)
    new = policy.choose(order(min_trust=min_trust, preference=preference), cands)
    if not matches:
        assert new is None
        return
    best = max(compute_score(old_order, o) for o in offers)
    # Same winner, unless the old matcher broke an exact tie by list order.
    tied = sorted(o.provider_id for o in offers if compute_score(old_order, o) == best)
    assert new.provider_id == (tied[0] if len(tied) > 1 else matches[0].provider_id)
