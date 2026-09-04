# Request Builder — Interactive Parameter Configuration

How consumers and providers configure their parameters through the web UI,
and get copy-pastable code for API/CLI use.

## The Problem

Both sides of the exchange face a matrix of parameters:

**Consumer parameters** (what goes into a request):
| Parameter | Type | Default | Impact |
|---|---|---|---|
| model | string | "default" | Which model |
| preference | enum | balanced | Optimization: cheapest/fastest/most_secure |
| min_confidence | enum | hardened | Privacy floor (L0-L3) |
| max_price | float | ∞ | Budget cap per Mtok |
| quantization | string | any | Weight format preference |
| verified_only | bool | false | Only hash-verified providers |
| encrypted_only | bool | false | Only E2E-capable providers |
| session_id | string | none | Session affinity for KV cache |
| max_context | int | 0 | Required context window |

**Provider parameters** (what goes into `ie-provider start`):
| Parameter | Type | Default | Impact |
|---|---|---|---|
| model | string | required | Which model to serve |
| price_input | float | auto | $/Mtok for input tokens |
| price_output | float | auto | $/Mtok for output tokens |
| engine | enum | auto-detect | Inference engine (ollama, llama.cpp, vllm) |
| quantization | string | auto | Weight quantization level |
| max_concurrent | int | 1 | Simultaneous request slots |
| hardened | bool | auto | Enable L2 hardening (if platform supports) |
| name | string | hostname | Display name on exchange |

These are documented across multiple pages and code snippets, but there's
no single place where someone can interactively configure them and get a
ready-to-use output.

## Design: Two Builders, One Pattern

Both builders follow the same visual pattern: a form on the left, a live
code preview on the right. Change any control, the code updates instantly.

### Consumer Request Builder

**Where it lives:** Keys page, replacing the current static "Quick Start" section.
Also linked from the Chat page's advanced controls ("Get API snippet →").

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Request Builder                                                │
├──────────────────────────┬──────────────────────────────────────┤
│                          │                                      │
│  Model  [dropdown    ▾]  │  ┌─ curl ─┬─ Python ─┬─ TypeScript ─┐│
│                          │  │                                   ││
│  Preference              │  │  curl https://api.inference...    ││
│  [⚖️ Balanced] [💰] [⚡]  │  │    -H "Authorization: Bearer..." ││
│                          │  │    -H "Content-Type: ..."         ││
│  ┌─ Privacy ───────────┐ │  │    -d '{                          ││
│  │ 🔒 L2 Hardened      │ │  │      "model": "llama-3-8b",      ││
│  │ Provider cannot read │ │  │      "messages": [...],           ││
│  │ your prompts.        │ │  │      "ocip_preference": "...",    ││
│  │                      │ │  │      "ocip_min_confidence": "..." ││
│  │ [L0 Open] [L1] [L2•]│ │  │    }'                             ││
│  │ [L3 Confidential]   │ │  │                                   ││
│  └──────────────────────┘ │  └───────────────────────────────────┘│
│                          │                                      │
│  ▸ More options          │  [Copy]                  [Try in Chat]│
│    Max price: [___]/Mtok │                                      │
│    ☐ Verified only       │                                      │
│    ☐ E2E encrypted only  │                                      │
│    Context: [___] tokens │                                      │
│                          │                                      │
└──────────────────────────┴──────────────────────────────────────┘
```

**Key UX decisions:**

1. **Privacy is NOT under "More options."** It's a primary control, always
   visible, with a clear explanation of what each level means. This matches
   the "privacy by default" change — trust level is a first-class decision.

2. **The default state produces a valid, private request.** Opening the
   builder with no changes gives you a curl/Python/TS snippet that uses
   L2 Hardened. You have to actively change it to get less privacy.

3. **Lowering trust shows a warning.** Selecting L0 or L1 shows an inline
   amber warning: "L0/L1 providers can read your prompts and responses."

4. **The code preview is the output.** Not a separate "generate" step.
   Every control change updates the preview instantly. The preview always
   shows a complete, runnable example.

5. **"Try in Chat" button.** Applies the builder's settings to the Chat page
   and navigates there. This connects the configuration experience to the
   actual usage.

6. **API key auto-fills.** If the user has a key, it appears in the snippet.
   If not, it shows `sk-ie-YOUR_KEY` with a link to create one.

### Provider Setup Builder

**Where it lives:** Providers page, replacing or augmenting the current
"Become a provider" section.

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Provider Setup                                                 │
├──────────────────────────┬──────────────────────────────────────┤
│                          │                                      │
│  Model  [search/select▾] │  ┌─ CLI ──┬─ Config ────────────────┐│
│  (shows demand/pricing)  │  │                                   ││
│                          │  │  ie-provider start \               ││
│  Pricing                 │  │    --model llama-3-8b \            ││
│  Input:  [$0.10] /Mtok   │  │    --price-output 0.15 \          ││
│  Output: [$0.15] /Mtok   │  │    --price-input 0.10 \           ││
│  Market avg: $0.12       │  │    --name "my-mac-studio" \        ││
│                          │  │    --max-concurrent 2              ││
│  Slots  [2]              │  │                                   ││
│                          │  │  # Hardening: auto-detected        ││
│  Name  [my-mac-studio ]  │  │  # Trust level: L2 (Apple Silicon) ││
│                          │  │  # Engine: ollama (detected)       ││
│  ┌─ Your Trust Level ──┐ │  │                                   ││
│  │ 🔒 L2 Hardened      │ │  └───────────────────────────────────┘│
│  │ Apple Silicon + our  │ │                                      │
│  │ hardened build = L2  │ │  [Copy]                              │
│  │                      │ │                                      │
│  │ To reach L3: needs   │ │                                      │
│  │ SEV-SNP / TDX        │ │                                      │
│  └──────────────────────┘ │                                      │
│                          │                                      │
│  ▸ Advanced              │                                      │
│    Engine: [auto ▾]      │                                      │
│    Quantization: [auto▾] │                                      │
│                          │                                      │
└──────────────────────────┴──────────────────────────────────────┘
```

**Key UX decisions:**

1. **Model selector shows market context.** When you pick a model, you see
   how many consumers want it, what the going rate is, and how many
   competitors exist. This helps providers make informed pricing decisions.

2. **Trust level is informational, not configurable.** Providers don't
   choose their trust level — it's determined by their platform and setup.
   The builder detects what level is achievable and explains why. It shows
   what they'd need to reach the next level.

3. **Pricing has market context.** Input fields for price, with the market
   average shown alongside. Helps providers price competitively without
   checking the Exchange page separately.

4. **Two output formats.** CLI command (for quick start) and a config file
   (for persistent setup). The config tab shows a YAML/TOML snippet for
   `~/.ie-provider/config.yaml`.

## How They Differ

| Aspect | Consumer Builder | Provider Builder |
|---|---|---|
| Primary output | API request (curl/Python/TS) | CLI command / config file |
| Trust level | Configurable (it's a preference) | Detected (it's a capability) |
| Model | Optional (can use "default") | Required (must pick one) |
| Pricing | Max price cap (budget) | Set price (earnings) |
| Market context | Shows available providers for config | Shows demand for model choice |
| Location | Keys page | Providers page |
| Action button | "Try in Chat" | "Copy" / "Start provider" |

## What They Share

Both builders:
- Live-update the code preview as controls change
- Show the user's API key (if they have one) in the output
- Explain every parameter on hover/focus (tooltip or inline text)
- Have a "More options" section for power-user controls
- Default to sensible values that work without changes
- Show trust level prominently with clear plain-English explanations

## Implementation Plan

### Phase 1: Consumer Builder on Keys page

Replace the static Quick Start section with the interactive builder.
This is highest value because:
- The Keys page is where developers go to integrate
- The current snippets are static and don't include OCIP params
- It reinforces the L2 default by showing it in every snippet

Components needed:
- `RequestBuilder.tsx` — the full builder component
- `CodePreview.tsx` — tabbed code display with syntax highlighting and copy
- `TrustLevelPicker.tsx` — reusable trust level selector with explanations
- `PreferencePills.tsx` — reusable preference selector (already exists in Chat)

### Phase 2: Chat page integration

- Change Chat page default `minTrust` from `'open'` to `'hardened'`
- Move trust level out of "Advanced" into the primary controls bar
- Add "Get API snippet" link that opens the builder with current settings
- Show trust level badge on each message response (next to model/cost/tokens)

### Phase 3: Provider Builder on Providers page

Replace the static setup CTA with the interactive builder.
Components needed:
- `ProviderSetup.tsx` — the builder component
- `ModelDemand.tsx` — shows demand/competition for selected model
- `PricingHelper.tsx` — market context for price setting
- `TrustLevelInfo.tsx` — detected trust level with upgrade path

### Phase 4: Settings page (account-level defaults)

A Settings page where consumers save their default preferences:
- Default trust level (saved to account, applied to all requests)
- Default preference
- Default max price
- These become the new defaults for Chat and the builder

This means a consumer who always wants L2+ only configures it once.

## The Trust Level Picker (shared component)

This is the most important UI element across both builders and the Chat page.
It needs to be clear, not clever.

```
┌─ Privacy Level ──────────────────────────────────────────────┐
│                                                              │
│  ○ L0 Open          Provider CAN see your prompts.           │
│                     No encryption, no process isolation.     │
│                                                              │
│  ○ L1 Contained     Prompts encrypted in transit.            │
│                     Provider process is isolated.            │
│                                                              │
│  ● L2 Hardened      Provider CANNOT read your prompts.       │
│    (default)        Anti-debug + hardened runtime.            │
│                     Requires kernel exploit to breach.        │
│                                                              │
│  ○ L3 Confidential  Hardware-level isolation (TEE).          │
│                     Even kernel access can't read prompts.   │
│                     Limited availability.                     │
│                                                              │
│  ⚠ Fewer providers at L3. You may wait longer for a match.   │
└──────────────────────────────────────────────────────────────┘
```

When L0 or L1 is selected:
```
│  ⚠ L0/L1 providers can read your prompts and responses.     │
│    Only use this if privacy is not a concern for this task.  │
```

## URL Scheme

The builder state is reflected in URL params so links are shareable:

```
/keys?model=llama-3-8b&preference=cheapest&trust=hardened
/keys?model=default&trust=open    (shows the privacy warning)
/providers/setup?model=llama-3-8b&price=0.15
```

This means someone can share "here's how to use IE for cheap Llama 3 inference"
as a single link that pre-fills the builder.

## Relationship to Chat Page Controls

The Chat page already has preference pills and trust level controls.
After this work:

- Chat page uses the same `TrustLevelPicker` and `PreferencePills` components
- Chat page defaults to L2 (not open)
- Trust level is promoted out of "Advanced" to always-visible
- Chat page adds a small "API" icon that opens `/keys` with current settings
- The builder on Keys page adds a "Try in Chat" button that navigates to
  `/chat` with the builder's settings as query params

The two pages share state through URL params, not global state. Simple,
bookmarkable, shareable.
