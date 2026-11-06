"""Optional country-only activity. No IPs, prompts, or per-request public geography."""
import asyncio
import hashlib
import hmac
import os
import secrets
import time
from contextvars import ContextVar
from datetime import datetime, timezone

# ISO 3166-1 alpha-2. Cloudflare's XX (unknown) and T1 (Tor) are not locations.
COUNTRIES = frozenset('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split())
consumer_country: ContextVar[str | None] = ContextVar('consumer_country', default=None)
DAY = 86400
MAX_COMPLETIONS_PER_DAY = 30000
MAX_ROUTES_PER_DAY = 1024
MIN_REQUESTS = 5
MIN_CONSUMERS = 3


def enabled() -> bool:
    return os.getenv('IE_COUNTRY_ACTIVITY_ENABLED', '0') == '1' and len(os.getenv('IE_GEO_INGRESS_SECRET', '')) >= 32


def trusted_country(headers) -> str | None:
    """Ingress must overwrite the marker. Client country assertions are not trusted."""
    if not enabled() or headers.get('x-ie-exclude-geography', '').lower() in ('1', 'true'):
        return None
    marker = headers.get('x-ie-geo-secret', '')
    # Bound attacker-controlled input before a constant-time comparison.
    if len(marker) > 256 or not hmac.compare_digest(marker.encode(), os.environ['IE_GEO_INGRESS_SECRET'].encode()):
        return None
    country = headers.get('cf-ipcountry', '')
    return country if country in COUNTRIES else None


def count_band(count: int) -> str:
    for low, high in [(5, 9), (10, 24), (25, 49), (50, 99), (100, 249), (250, 499), (500, 999)]:
        if count <= high:
            return f'{low}–{high}'
    return '1,000+'


class CountryActivity:
    """Bounded ephemeral counters. Publish yesterday, never a sliding live window.

    Daily salted HMACs support deduplication and a minimum distinct-account
    threshold. They never leave this object and expire with the counters.
    This is suppression, not a claim of formal anonymity or Sybil resistance.
    """
    def __init__(self):
        self._key = secrets.token_bytes(32)
        self._days: dict = {}

    def _prune(self, today: int):
        self._days = {day: value for day, value in self._days.items() if today - 1 <= day <= today}

    def expire(self):
        self._prune(int(time.time() // DAY))
        if not enabled():
            self._days.clear()

    def _hash(self, day, kind, value):
        return hmac.new(self._key, f'{day}:{kind}:{value}'.encode(), hashlib.sha256).digest()

    def record(self, provider_country, caller_country, consumer_id, request_id, *, now=None):
        now = time.time() if now is None else now
        today = int(now // DAY)
        self._prune(today)
        if not enabled() or provider_country not in COUNTRIES or caller_country not in COUNTRIES:
            return
        if not consumer_id or consumer_id in ('anonymous', 'default', 'default-consumer') or not request_id:
            return
        state = self._days.setdefault(today, {'seen': set(), 'routes': {}})
        request_hash = self._hash(today, 'request', request_id)
        prior = self._days.get(today - 1, {}).get('seen', set())
        if self._hash(today - 1, 'request', request_id) in prior:
            return
        if request_hash in state['seen'] or len(state['seen']) >= MAX_COMPLETIONS_PER_DAY:
            return
        route = (provider_country, caller_country)
        if route not in state['routes'] and len(state['routes']) >= MAX_ROUTES_PER_DAY:
            return
        state['seen'].add(request_hash)
        counter = state['routes'].setdefault(route, {'count': 0, 'consumers': set()})
        counter['count'] += 1
        if len(counter['consumers']) < MIN_CONSUMERS:
            counter['consumers'].add(self._hash(today, 'consumer', consumer_id))

    def snapshot(self, *, now=None):
        today = int((time.time() if now is None else now) // DAY)
        self._prune(today)
        if not enabled():
            self._days.clear()
            return {'enabled': False, 'period': None, 'routes': []}
        routes = self._days.get(today - 1, {}).get('routes', {})
        released = [{'provider_country': source, 'caller_country': target, 'count_band': count_band(data['count'])}
                    for (source, target), data in sorted(routes.items())
                    if data['count'] >= MIN_REQUESTS and len(data['consumers']) >= MIN_CONSUMERS]
        period = datetime.fromtimestamp((today - 1) * DAY, timezone.utc).date().isoformat()
        return {'enabled': True, 'period': period, 'routes': released}


activity = CountryActivity()


async def cleanup_loop():
    while True:
        await asyncio.sleep(60)
        activity.expire()
