# Product Critique — Where the Webapp Lies, Hand-Waves, or Is Sloppy

A Google/Apple-level product review of the Inference Exchange webapp.
Not "what features are missing" but "where does the product mislead the
user, skip the hard details, or ship something half-thought-through."

---

## 1. The Landing Page Makes Claims the Product Can't Back

### "Prompts and responses are encrypted end-to-end"

This is the hero subtitle. It's the first thing anyone reads.

**Reality per `e2e-encryption-status.md`:**
- Prompts (requests) are encrypted to the provider — true.
- Responses are plaintext unless the consumer uses the IE SDK with
  `ocip_consumer_public_key`. Standard OpenAI SDK users get plaintext
  responses. The coordinator CAN read them. Network observers CAN read them.
- There's no TLS yet, so everything is HTTP, not HTTPS.

The landing page says "end-to-end" with no asterisk. A user reading this
reasonably concludes: "My data is private." For the default experience
(standard OpenAI SDK, no special config), responses are wide open. That's
not E2E. That's half-E2E at best.

**What Apple would do:** "Prompts are encrypted to the provider. Responses
are encrypted when using the IE SDK." Separate line explaining the OpenAI
SDK compatibility tradeoff. A "Learn more" link to a page that explains
exactly what's encrypted, what's not, and why.

### "The coordinator never sees your data"

**Reality:** The coordinator encrypts the prompt TO the provider key. It
has the plaintext briefly during the encryption step (it's the one doing
the encrypting, per `routes_inference.py` line `encrypt_json(encrypt_payload,
provider.encryption_public_key)`). For responses, the coordinator sees
every token in plaintext unless the consumer opted into IE SDK mode.

"Never sees your data" is false. The coordinator handles your plaintext
prompt in memory before encrypting it. It sees every response token. A more
honest statement: "The coordinator encrypts your prompts before routing.
It cannot decrypt them after encryption."

### "Inference runs privately — inside a hardened process the machine owner cannot observe"

**Reality per threat model:**
- Only true at L2 (Hardened). L0 and L1 providers CAN observe prompts.
- The default is now L2, but nothing on the landing page says "this depends
  on which provider you're matched to" or "this requires a hardened provider."
- Attestation is still self-reported. A provider claiming L2 could be lying,
  and the coordinator can't cryptographically verify it.

### "X25519 per-request forward secrecy. Nobody in the middle can read your data."

Feature card in the "Built for developers" section.

**Reality:** Forward secrecy applies to request encryption. Responses
have no forward secrecy in standard mode. "Nobody in the middle" is
false for responses — the coordinator IS in the middle and reads them.

### Live stats bar showing "0 Providers, 0 Models, 0 Requests, $0 Volume"

When the exchange is empty (which it often is during alpha), the landing
page proudly displays zeros. This is worse than showing nothing. It
screams "dead product." Every marketplace startup hides empty stats.

**What Apple would do:** Don't show the stats bar until there's something
to show. Or show a friendly "Opening soon" state instead of four zeros.

---

## 2. Trust Level Descriptions Are Sloppy

### Landing page trust level section

```
L0 Open:        "No isolation. Fast and cheap. Good for non-sensitive work."
L1 Contained:   "Requests encrypted in transit. Provider runs any engine."
L2 Hardened:    "Hardened binary. Debugger blocked. Requires kernel exploit."
L3 Confidential: "Hardware memory encryption. Even the hypervisor cannot read."
```

Problems:

**L0:** "No isolation" is vague. What does the user give up? Say it plainly:
"The provider can read your prompts and responses." The product design doc
says this should be explicit. The landing page doesn't do it.

**L1:** "Requests encrypted in transit" — encrypted to what standard? TLS?
NaCl? In transit where? And "provider runs any engine" is a technical detail
that means nothing to consumers. What they care about: "The provider process
is isolated, but the operator could access it with effort."

**L2:** "Requires kernel exploit" — this is marketing, not engineering. The
threat model says macOS kernel exploits cost "$500k+". That's in a tooltip
somewhere in the product design doc, not on the landing page. But the
landing page is where someone evaluates whether to use the product. Saying
"requires kernel exploit" without explaining what that means in practice
is hand-waving.

**L3:** "Even the hypervisor cannot read" — L3 doesn't exist yet. There
are zero L3 providers. The ARM CCA spec says "expected 2026+." The product
shows L3 as if it's a choice you can make today. That's misleading.

**What Apple would do:**
- L0: "Open — the provider can see your prompts. Best for non-sensitive tasks."
- L1: "Contained — your prompts are encrypted to the provider. The provider
  operator has standard access to the process."
- L2: "Hardened — your prompts are encrypted and the provider process is
  protected against debugging, memory inspection, and code injection. This
  is the default." (with a "Learn more" link to the threat model)
- L3: "Confidential — hardware-level memory encryption. Coming soon." Make
  it visually distinct (grayed out, "Coming soon" badge).

---

## 3. The Chat Page Doesn't Tell You What's Happening

### No provider attribution

The message footer shows: model name, token count, cost. It does NOT show:
- Which provider served the request
- What trust level that provider has
- Whether encryption was used
- Whether the response was from cache

The user sends a message and gets a response. They have no idea if it went
to a hardened L2 provider or an open L0 provider. The API returns
`X-OCIP-Provider` and `X-OCIP-Trust-Level` in response headers, but the
Chat page doesn't parse or display them.

**What Apple would do:** Every response shows a small trust badge. "Served
by alpha-node · L2 Hardened · E2E" or "Served by beta-node · L0 Open."
If the response came from an L0 provider (because the consumer chose to
allow it), the badge is amber with a warning color.

### No cost preview

The Chat page shows cost AFTER the response. There's no way to know how
much a message will cost before sending it. The billing doc proposes an
`estimate_only` flag but it's not built.

For a $10 credit account, this matters. A user in a long conversation
might drain their balance in one message if the context is huge. There's
no warning, no "this will cost approximately $X, proceed?"

### No balance warning

The Chat page doesn't show the user's balance. The Layout header shows it
(small text in the nav), but during an active conversation, there's no
"you have $2.31 remaining" or "low balance" indicator. The user discovers
they're out of money when a request returns 402.

### Session affinity is invisible

The billing doc describes session affinity and KV cache benefits at length.
The Chat page sends `ocip_session_id` nowhere. There's no session ID in
the request body. Multi-turn conversations don't benefit from caching
because the feature isn't wired up.

The matching algorithm doc says session affinity gives a 20% scoring bonus.
The Chat page doesn't send the field that triggers it.

---

## 4. Pricing Is Confusing or Missing

### Exchange page: no input pricing

The Exchange model cards show "per Mtok output" pricing prominently. Input
pricing is hidden inside provider rows (small text). But the billing model
is `cost = T_in × P_in + T_out × P_out`. For a conversation with a lot of
context (common for coding, analysis), input tokens can dominate the cost.

Showing only output price is like a phone plan advertising "$5/month"
but the data charges are separate and larger. It's technically not wrong
but it's designed to look cheaper than it is.

**What Apple would do:** Show both prices clearly. "Input $0.05 / Output
$0.20 per Mtok" as the primary display. Or show an "effective cost" for
a typical request (e.g., "~$0.00003 for a typical message").

### Models page: no cost comparison

The Models page shows per-model pricing but doesn't compare to reference
APIs (OpenAI, Anthropic). The Exchange page has reference comparison. The
Models page doesn't. If a user is deciding "should I use IE for Llama or
just use OpenAI for GPT-4," the Models page doesn't help them decide.

### Billing page: no cost breakdown

Transaction history shows total cost per request. It doesn't break down
input vs output tokens, doesn't show the provider's rate, and doesn't
show the platform fee. The user sees "$0.000030" but doesn't know if
that's mostly input or output, or how much went to the provider vs the
platform.

**What Apple would do:** Expandable transaction rows. Click a transaction →
see input tokens, output tokens, input rate, output rate, provider name,
platform fee, subtotals.

---

## 5. The Provider Experience Is an Afterthought

This was covered in the platform audit, but from a product quality lens:

### "Become a provider" leads to a dead end

Landing page → "Become a provider" button → Providers page → static card
with `pip install ie-provider` → nothing. No explanation of:
- How much they'll earn
- What hardware they need
- What models are in demand
- How pricing works from the provider side
- What trust levels they can achieve on their hardware
- How to get paid

Compare to how Uber, Airbnb, or Stripe onboard their supply side. There's
a dedicated flow, earnings calculator, FAQ, setup guide. Here it's two
lines of shell commands.

### Provider cards don't distinguish "this is you"

If a provider visits the site while their node is running, they see their
card in a list of other cards with no indication of which one is theirs.
There's no "Your Node" section, no highlight, no link to their dashboard
(which doesn't exist).

### Providers can't see their earnings ANYWHERE in the UI

The `GET /v1/exchange/provider-earnings` endpoint exists. Nothing in the
webapp calls it. A provider running hardware and earning money cannot see
how much they've earned through the product they're earning money on.

---

## 6. Error States Are Unfinished

### 503 errors are generic

When no provider is available, the Chat page shows "No providers available
right now." The matching algorithm doc specifies rich error responses with
alternative suggestions, price adjustments, and trust level fallbacks.
None of that is built. The UI just shows a string.

### No offline state

If the coordinator is down, the webapp loads and shows empty data
everywhere. The WebSocket status shows "Offline" in the header but
nothing prevents the user from typing a message that will fail. There
should be a clear "The exchange is offline" state that disables the
chat input and explains what's happening.

### Rate limit errors have no countdown

The 429 response shows "Rate limit reached. Please wait a moment." No
indication of how long to wait. The rate limiter is 30 requests per
minute per key. Tell the user: "Rate limit reached. Try again in 45
seconds."

---

## 7. Security UX Is Non-Existent

### API key shown in plaintext

The Keys page shows the full API key as plaintext, always. Once created,
the key is visible in the page forever (well, until page reload). There's
no "show/hide" toggle, no masking after initial display.

The signup flow shows the key once — good. But the "Active API Key"
section shows it permanently.

### No API key rotation

There's no way to revoke or rotate an API key. If a key is compromised,
the user has to... create a new account? There's no "Revoke this key"
button. The backend doesn't have a delete key endpoint.

### No "who's using my key" visibility

No logs of which IPs used a key, what models they accessed, or when.
If someone suspects their key is compromised, they can't verify it.

### Password requirements are minimal

The signup requires minimum 6 characters. No strength indicator, no
warning about weak passwords. The auth endpoints have basic rate
limiting (10 attempts per 5 minutes) but no account lockout.

---

## 8. Data Integrity and Edge Cases

### Balance can go negative

The billing code checks `if account["balance_micro"] <= 0` before a
request, but the check happens before inference starts. During a long
streaming response, the balance could drain past zero. There's no
mid-stream balance check. A user with $0.01 remaining could rack up
$0.10 in a long response.

### Token counting is approximate

The billing code uses `total_chars // 4 + overhead` as an input token
estimate. This is wrong for non-English text, code (which has lots of
short tokens), and structured data. The billing doc acknowledges this
("approximate: ~4 chars per token for English"). But the product doesn't
tell the user their bill is approximate. They see "$0.000030" and
assume it's precise.

### No idempotency on key creation

Clicking "Create" twice fast could create two keys. No request dedup.

### localStorage for chat history

Chat history is stored in localStorage keyed by user ID. If the user
clears their browser, they lose all history. There's no server-side
persistence. For a product handling potentially sensitive conversations,
this is both a feature (less data stored) and a bug (no recovery). It
should be an explicit choice, not a silent behavior.

---

## 9. The Exchange Page Tries to Be Finance Without the Rigor

### "Fills" and "Volume" vocabulary

The Exchange uses finance vocabulary — "fills," "volume," "depth,"
"order book." But the actual matching is a simple greedy scorer, not
a real order book with bids and asks. There's no price-time priority,
no partial fills, no limit orders. Using finance terminology for a
system that doesn't work like finance is confusing for users who know
finance and meaningless for users who don't.

### Depth chart data is coarse

The depth endpoint groups providers into $0.05 price buckets. With a
small number of providers, this means the entire "depth chart" might be
one or two buckets. Showing an order book for a market with 3 providers
is like showing a stock chart for a company with 3 shareholders.

### Real-time WebSocket updates for a low-frequency market

The Exchange page maintains a live WebSocket connection with ping
animations and a live feed. When the exchange has 0-5 providers and
single-digit requests per minute, this creates a "dead ticker" effect.
The live feed says "Waiting for activity..." most of the time. The
pulsing green dot says "Real-time" next to an empty feed.

---

## 10. Mobile / Responsive Gaps

The Layout has a mobile hamburger menu (good), but:
- The Exchange page's model cards are dense data tables that don't
  wrap well on small screens
- The Chat page's preference pills + trust level pills + advanced
  controls are a LOT of horizontal content for mobile
- The code snippets on the Keys page overflow horizontally
- No touch-optimized interactions anywhere

---

## Summary: What Would Make This "Apple Quality"

### Honesty first
- Every claim on the landing page matches the current state of the code.
  If responses aren't encrypted by default, don't say "end-to-end encrypted"
  without qualification.
- Trust levels that don't exist yet (L3) are shown as "Coming soon," not
  as a choice.
- Approximate billing is labeled approximate. Exact numbers earn exact
  labels.

### Both sides feel served
- Provider onboarding is as polished as consumer onboarding.
- Providers see their earnings, their market position, and what the
  market needs from them.
- Every screen answers the question: "What should I do next?"

### Transparency over simplicity
- Show what's happening: which provider, what trust level, was it
  encrypted, was it cached, how much did it cost and why.
- Don't hide complexity — explain it. A user who understands the tradeoffs
  trusts the product more than one who's shielded from them.

### Edge cases handled
- Empty states, offline states, error states, balance exhaustion,
  key compromise — all handled with clear user-facing messaging and
  recovery paths.
- Financial data is precise or labeled as approximate.
- Security features (key rotation, usage logs, revocation) exist.

### The product knows what it is
- If it's a marketplace, act like one: serve both sides equally,
  show supply and demand, enable price discovery.
- If it's a privacy product, act like one: every claim is verifiable,
  every limitation is disclosed, every default is the safe choice.
- Right now it tries to be both but executes neither with the rigor
  either claim demands.
