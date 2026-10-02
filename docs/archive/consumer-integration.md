# Consumer Integration Guide — How Users Connect to Inference Exchange

## Overview

Inference Exchange is **OpenAI API compatible**. Any tool, SDK, or framework
that supports a custom OpenAI-compatible endpoint works with IE by changing one
URL. No partnerships, agreements, or special integrations needed.

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.inference.exchange/v1",
    api_key="sk-ie-...",
)
```

---

## Who Can Use This (Market Segments)

### 1. Developers Writing Code (Primary Market)

Any developer using the OpenAI Python/JS SDK can switch by changing one URL:

```python
# Before (OpenAI direct):
client = OpenAI(api_key="sk-...")

# After (Inference Exchange):
client = OpenAI(
    base_url="https://api.inference.exchange/v1",
    api_key="sk-ie-...",
)

# Their application code doesn't change at all.
```

Works with: Python, Node.js, Go, Rust, any language with an OpenAI SDK.

### 2. AI Coding Tools (Cursor, Continue, Cline, Aider)

| Tool | Custom endpoint? | Configuration |
|------|-----------------|---------------|
| **Cursor** | ✅ Yes | Settings → Models → OpenAI API Key + Custom Base URL |
| **Continue** (VS Code) | ✅ Yes | `.continue/config.json` → `apiBase` field |
| **Cline** (VS Code) | ✅ Yes | Extension settings → API Provider → Custom |
| **Aider** | ✅ Yes | `--openai-api-base https://api.inference.exchange/v1` |
| **Open Interpreter** | ✅ Yes | `interpreter --api_base https://api.inference.exchange/v1` |
| **LM Studio** (as client) | ✅ Yes | Server settings → remote endpoint |
| **Codex CLI** (OpenAI) | ⚠️ Limited | `OPENAI_BASE_URL` env var override |
| **Claude Code** | ❌ Locked | Hardcoded to Anthropic |
| **GitHub Copilot** | ❌ Locked | Hardcoded to Microsoft/GitHub |
| **ChatGPT** | ❌ Locked | Hardcoded to OpenAI |

**Configuration example (Cursor):**
```
Settings → Models:
  Provider: OpenAI Compatible
  API Base URL: https://api.inference.exchange/v1
  API Key: sk-ie-...
  Model: llama-3-8b
```

**Configuration example (Continue):**
```json
// .continue/config.json
{
  "models": [{
    "title": "Inference Exchange",
    "provider": "openai",
    "model": "llama-3-8b",
    "apiBase": "https://api.inference.exchange/v1",
    "apiKey": "sk-ie-..."
  }]
}
```

**Configuration example (Aider):**
```bash
export OPENAI_API_BASE=https://api.inference.exchange/v1
export OPENAI_API_KEY=sk-ie-...
aider --model llama-3-8b
```

### 3. Frameworks and Libraries

| Framework | Works? | How |
|-----------|--------|-----|
| **LangChain** | ✅ | `ChatOpenAI(base_url=..., api_key=...)` |
| **LlamaIndex** | ✅ | `OpenAI(api_base=..., api_key=...)` |
| **LiteLLM** | ✅ | `completion(model="openai/...", api_base=...)` |
| **Vercel AI SDK** | ✅ | `createOpenAI({ baseURL: ... })` |
| **Haystack** | ✅ | `OpenAIGenerator(api_base_url=...)` |
| **AutoGen** | ✅ | Config list with `base_url` |
| **CrewAI** | ✅ | Uses LiteLLM under the hood |
| **DSPy** | ✅ | `dspy.OpenAI(api_base=..., api_key=...)` |

```python
# LangChain
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(
    base_url="https://api.inference.exchange/v1",
    api_key="sk-ie-...",
    model="llama-3-8b",
)

# LiteLLM (universal router)
import litellm
response = litellm.completion(
    model="openai/llama-3-8b",
    api_base="https://api.inference.exchange/v1",
    api_key="sk-ie-...",
    messages=[{"role": "user", "content": "Hello"}],
)

# Vercel AI SDK (TypeScript)
import { createOpenAI } from '@ai-sdk/openai';
const ie = createOpenAI({
    baseURL: 'https://api.inference.exchange/v1',
    apiKey: 'sk-ie-...',
});
```

### 4. Self-Route Users (Provider = Consumer)

Run your own provider and use it for free:

```bash
# Start your provider (earns money from others, free for you)
ie-provider start --name "my-mac"

# In your app, self-route (free, goes to your own machine):
client = OpenAI(
    base_url="https://api.inference.exchange/v1",
    api_key="sk-ie-...",
    default_headers={"X-OCIP-Route": "self"},
)
```

---

## Comparison: How Other Routers Work

| | OpenRouter | Together.ai | Groq | Inference Exchange |
|---|---|---|---|---|
| API format | OpenAI ✅ | OpenAI ✅ | OpenAI ✅ | OpenAI ✅ |
| Backend | Centralized (OpenAI, Anthropic, etc.) | Their own GPUs | Their own LPUs | Decentralized provider fleet |
| Models | 200+ (all providers) | 100+ (open-weight) | 10+ (fast) | Community-contributed |
| Privacy | Provider sees prompts | They see prompts | They see prompts | L2 Hardened by default (provider can't read prompts); E2E encryption available |
| Self-hosting | ❌ | ❌ | ❌ | ✅ (run your own node) |
| Pricing | Markup over provider | Per-token | Per-token | Market-driven (providers compete) |
| Lock-in | None (standard API) | None | None | None |

**Key differentiator:** IE is the only one where:
- Providers are decentralized (anyone can run a node)
- L2 Hardened is the default — providers cannot read your prompts out of the box
- Prompts can be E2E encrypted for full confidentiality (IE SDK)
- You can self-route to your own hardware for free
- Pricing is market-driven (providers set their own rates)

---

## No Agreements Needed

We don't need partnerships with any tool or framework because:

1. **OpenAI's API format is a de facto standard** — every tool supports it
2. **Users configure the endpoint themselves** — we don't need tool vendors to do anything
3. **Standard HTTP + JSON** — no proprietary protocols or SDKs required

What we DO need:
- A public URL with TLS (coordinator deployed to cloud)
- Reliable uptime and model availability
- Clear documentation for each tool's configuration
- Competitive pricing (cheaper than alternatives)

---

## Go-to-Market Phases

### Phase 1: Developer SDK Users (Current)

Target: Developers using `openai` Python/JS SDK who want cheaper or private inference.

What they do:
1. Sign up on console (get API key)
2. Change `base_url` in their code
3. Choose a model from available providers

### Phase 2: Tool Configuration Guides

Write specific guides:
- "How to use Inference Exchange with Cursor"
- "How to use Inference Exchange with Continue"
- "How to use Inference Exchange with LangChain"
- "How to use Inference Exchange with Aider"

Publish on docs site + community forums.

### Phase 3: Local Proxy (Universal Compatibility)

For tools that don't support custom endpoints (locked to OpenAI):

```bash
# Run a local proxy that intercepts OpenAI API calls
ie-proxy start --port 4000

# Set environment variable (works with most tools):
export OPENAI_API_BASE=http://localhost:4000/v1
export OPENAI_API_KEY=sk-ie-...

# Now even tools hardcoded to "api.openai.com" go through IE
# (via DNS override or local proxy)
```

This is how tools like LiteLLM Proxy work — a local server that translates
requests between formats.

### Phase 4: Browser Extension / Desktop App

For non-developer consumers:
- Browser extension that routes web-based AI tools through IE
- Desktop app with built-in chat + coding assistant

---

## API Surface (What Consumers See)

### Standard OpenAI Endpoints (compatible)

```
POST /v1/chat/completions    — chat inference (streaming + non-streaming)
GET  /v1/models              — list available models
```

### OCIP Extensions (optional, backwards-compatible)

```json
// Added to the request body (ignored by standard OpenAI servers):
{
  "model": "llama-3-8b",
  "messages": [...],
  "ocip_preference": "cheapest",         // routing: cheapest | fastest | most_secure
  "ocip_min_confidence": "contained",    // minimum trust: open | contained | hardened | confidential
                                         //   default: "hardened" (L2) — provider cannot read prompts
                                         //   set to "open" to include all providers (cheaper, but NO privacy)
  "ocip_max_price": 0.30,               // max $/Mtok output
  "ocip_session_id": "chat-abc123"       // session affinity (cache benefit)
}
```

### Response Headers (OCIP metadata)

```
X-OCIP-Provider: alpha-node           // which provider served this
X-OCIP-Trust-Level: hardened           // their verified trust level
X-OCIP-Price-Output: 0.15             // price charged per Mtok
X-OCIP-Encrypted: true                // was E2E encryption used
```

---

## Sign-Up Flow

```
1. Visit console.inference.exchange
2. Create account (email or OAuth)
3. Get API key: sk-ie-...
4. $10 free credit (enough for ~50M tokens at $0.20/Mtok)
5. Change base_url in your app/tool
6. Done.
```

No credit card required for the free tier. Stripe deposits when credit runs out.
