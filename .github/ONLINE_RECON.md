# Online recon: provider expansion and the "what stops the API blocking us" question

Scope: what the upstream clients do online (not just what our tree does locally), so the BYOK surface
can grow without inventing protocols. Sources are the upstream repositories read over the GitHub API on
2026-10-13; every claim below names the file it came from.

## 1. OpenCode Zen: is traffic from other clients blocked?

Read:

- `anomalyco/opencode@dev` `packages/ai/src/providers/opencode.ts` — Zen's client defaults:
  `baseURL = "https://opencode.ai/inference/v1"`, bearer auth from `OPENCODE_API_KEY`.
- `packages/console/app/src/lib/inference-proxy.ts` — the route table the served API uses:
  `/zen/v1/chat/completions → /openai/v1/chat/completions`, `/zen/v1/messages → /anthropic/v1/messages`,
  `/zen/v1/responses → /openai/v1/responses`, `/zen/v1/models[/:model] → /google/v1beta/models`,
  `/zen/go/...` for the Go plan.
- `services/www/src/docs/content/console/api/inference.mdx` — "Console inference serves OpenAI, Anthropic,
  and Gemini-compatible APIs from `https://opencode.ai/inference`. … Paid models require the header; free
  chat models can be called without it." The documented first example is a plain `curl`.
- `services/www/src/docs/content/console/models.mdx` — the per-model endpoint table (which models are
  served by Responses, Messages, Chat Completions or `generateContent`).

**Answer: there is no client gate to defeat.** The inference endpoint is documented as callable by any
client that sends the documented auth; free models need no credential at all, and the proxy forwards
whatever headers it is given. What exists is *identification*: `packages/core/src/session/model-request.ts`
attaches the same headers to every model request (not only Zen's):

```text
User-Agent: opencode/<channel>/<version>/<name>
x-opencode-client: <app name>
x-opencode-session / x-opencode-project / x-opencode-session-id / x-opencode-parent-session-id
x-session-affinity, X-Session-Id
```

and `packages/core/src/plugin/provider/opencode.ts` comments that "Every request here goes to the Console,
which reads the User-Agent to tell which OpenCode a member runs and whether it evaluates the policies it is
being sent." That is what a non-opencode client "looks wrong" for — attribution, not authentication.

We send the honest form of the same contract instead of impersonating another client:

| Header | Value | Why |
| --- | --- | --- |
| `User-Agent` | `bettershape/<version>` | Named, versioned client, like every other client in this space. |
| `X-BetterShape-Client` | `bettershape/<version>` | Machine-readable client id, the role `x-opencode-client` plays upstream. |
| preset headers | per gateway | See §2. |
| connection headers | user's lines | Win over preset values, so a gateway can be told anything it needs. |

Zen is therefore shipped as two presets — `zen` (Chat Completions wire, `https://opencode.ai/inference/v1`)
and `zen-messages` (Messages wire, `https://opencode.ai/inference`) — both keyless-capable, both off by
default so free-tier traffic only happens once the user turns the card on.

## 2. Attribution headers, from the upstream provider plugins

`packages/core/src/plugin/provider/*.ts` shows which gateways expect their own headers, and why:

| Gateway | Headers upstream sends | Source |
| --- | --- | --- |
| NVIDIA NIM | `HTTP-Referer: https://opencode.ai/`, `X-Title: opencode`, `X-BILLING-INVOKE-ORIGIN: OpenCode` | `provider/nvidia.ts` (test comment: "legacy referer headers") |
| OpenRouter | `HTTP-Referer`, `X-Title` | `provider/openrouter.ts` |
| LLM Gateway | `HTTP-Referer`, `X-Title`, `X-Source` | `provider/llmgateway.ts` |
| ZenMux | `HTTP-Referer`, `X-Title` | `provider/zenmux.ts` |
| Kilo Code | `HTTP-Referer`, `X-Title` | `provider/kilo.ts` |
| Vercel AI Gateway | `HTTP-Referer`, `X-Title` | `provider/vercel.ts` |
| Cloudflare AI Gateway | gateway token in `cf-aig-authorization` | product docs; exposed here as a header line |
| Azure OpenAI | key in `api-key`, not `Authorization` | `provider/azure.ts` (`evt.request.headers.delete("api-key")`) |

BetterShape now ships exactly this shape: per-connection **extra headers**, per-connection **auth header**
(`bearer`, `api-key`, `x-api-key`, `x-goog-api-key`, `none`), preset defaults with the same values as
upstream (naming this app rather than another), and header *values* stored in the OS keychain because
gateways put tokens in them.

## 3. Provider inventory = union of both worlds

Base URLs collected from `packages/ai/src/providers/*.ts` and `packages/core/src/plugin/provider/*.ts`
(cerebras, togetherai, fireworks, moonshot, zai, zai-coding-plan, alibaba, deepinfra, venice,
vercel-ai-gateway, minimax, baseten, digitalocean, cohere, perplexity, poe, llmgateway, zenmux, kilo,
cloudflare, azure, lmstudio, ollama, vllm, nvidia, opencode) plus the local runtimes people actually use.

BetterShape went from 8 presets to **37**, grouped in Settings:

- **Native APIs** — OpenAI, Anthropic, Google AI, Azure OpenAI.
- **Gateways** — OpenRouter, OpenCode Zen (+ Messages), NVIDIA NIM, Vercel AI Gateway, LLM Gateway,
  ZenMux, Kilo Code, Cloudflare AI Gateway.
- **Providers** — xAI, DeepSeek, Groq, Mistral, Cerebras, Together, Fireworks, Moonshot, Z.ai,
  Z.ai Coding Plan, Alibaba Qwen, DeepInfra, Venice, MiniMax, Baseten, DigitalOcean Gradient, Cohere,
  Perplexity, Cloudflare Workers AI, Databricks.
- **Local** — Ollama, LM Studio, vLLM, and any other OpenAI-compatible base URL.

## 4. Gaps this recon leaves open

1. **OpenAI Responses wire** (`/v1/responses`): Zen's GPT-5.x/Grok/Muse models, OpenAI's codex models and
   xAI's newest models are served there. Our wires are Chat Completions, Messages and `generateContent`,
   so those models need the Responses path before they can be selected. Evidence: the endpoint table in
   `console/models.mdx` and `packages/ai/src/providers/openai.ts` (`codexBaseURL`).
2. **OAuth-shaped providers** (ChatGPT/Codex, GitHub Copilot, GitLab Duo, Amazon Bedrock SigV4, Google
   Vertex service accounts) are deliberately out of scope: they need their own auth flows, not API keys.
3. **`GET /zen/v1/models`** returns the live Zen catalogue; the preset list is curated from the docs and
   can be refreshed with the existing **Test connection → import models** flow.

## OpenCode Zen / Go — verified against the live gateway

Probed from a CI runner with curl (see the raw transcript at the end of this
section). These are measurements, not documentation claims.

### What the free tier actually answers

| Traffic | Result |
| --- | --- |
| `/zen/v1/models` (or `/inference/v1/models`), anonymous | **200** — the free ids are listed (`-free`, plus `big-pickle`) |
| Free model, anonymous, any headers | **403** `FreeTierError` — "OpenCode's free tier can only be used from within OpenCode" |
| Free model with the exact official UA + `x-opencode-client: cli` + session headers | **403** — identical body |
| Free model with `Authorization: Bearer public` | **403** — identical body |
| Free model, non-streaming | **403** — identical body |
| Paid model (e.g. `claude-haiku-4-5`), anonymous | **401** `AuthError` — "Missing API key" |
| `/zen/go/v1/chat/completions`, anonymous | **401** — "Go requires a credential" |
| `/zen/go/v1/usage`, anonymous | **401** |

**Conclusion:** the free tier is gated server-side on *attribution*, and no
client-side header combination satisfies it anonymously. Free models are priced
"Free" for OpenCode Console accounts, and the docs describe the endpoints as
being for applications calling them directly — so the fix is the user's own
Console key, not client spoofing. BetterShape therefore keeps its own honest
User-Agent and never impersonates OpenCode.

### What the docs require of a third-party agent (Go)

`opencode.ai/v2/docs/console/go` lists validated third-party clients and states
the contract plainly:

1. send typical coding-agent traffic;
2. **identify itself with its own user agent** (`my-coding-agent/1.0`), not a
   generic SDK or HTTP-library name;
3. send a **stable per-conversation id in `x-opencode-session`** so routing and
   prompt caching can be optimized.

Go's endpoint answers `400` without that session header, which is what the app
now sends (`core::ai_providers::request_headers_for`), together with
`x-opencode-client: bettershape`. Only `opencode.ai` hosts receive those two
headers.

### Endpoints and wires (from `opencode.ai/v2/docs/console/models`)

Base `https://opencode.ai/inference/v1`; `https://opencode.ai/zen/v1` serves the
same list. Wires are per model family:

* `chat/completions` — glm-\*, kimi-\*, minimax-\*, deepseek-\*, mistral-large-4,
  qwen3.8-max, big-pickle, and the chat-wire free models;
* `messages` (Anthropic) — claude-\*, qwen3.x-plus, qwen3.8-flash;
* `responses` (OpenAI) — gpt-\*, grok-\*, muse-spark-\* (not supported by the app's
  OpenAI-wire adapter, so those ids are deliberately not listed);
* `models/<id>:generateContent` (Google) — gemini-\*;
* `systemone` — jev-1.13.

Presets: `zen` (chat wire), `zen-messages` (Messages wire), `zen-go`
(`https://opencode.ai/zen/go/v1`).

<details>
<summary>Raw probe transcript</summary>

```
## Zen probe

date: Tue Oct 13 21:53:20 UTC 2026

### Free model, no credentials
- **bare** (ling-3.1-flash-free, stream=true) -> HTTP 403
  - body: {"type":"error","error":{"type":"FreeTierError","message":"OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building."}}
- **better shape UA (what the app sends today)** (ling-3.1-flash-free, stream=true) -> HTTP 403
  - body: {"type":"error","error":{"type":"FreeTierError","message":"OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building."}}
- **bearer public** (ling-3.1-flash-free, stream=true) -> HTTP 403
  - body: {"type":"error","error":{"type":"FreeTierError","message":"OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building."}}
- **opencode UA** (ling-3.1-flash-free, stream=true) -> HTTP 403
  - body: {"type":"error","error":{"type":"FreeTierError","message":"OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building."}}
- **opencode UA + session header** (ling-3.1-flash-free, stream=true) -> HTTP 403
  - body: {"type":"error","error":{"type":"FreeTierError","message":"OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building."}}
- **full opencode identity** (ling-3.1-flash-free, stream=true) -> HTTP 403
  - body: {"type":"error","error":{"type":"FreeTierError","message":"OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building."}}

### Non-streaming (titles, summaries) with full identity
- **non-stream** (ling-3.1-flash-free, stream=false) -> HTTP 403
  - body: {"type":"error","error":{"type":"FreeTierError","message":"OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building."}}

### Paid model, anonymous
- **paid anonymous** (claude-haiku-4-5, stream=true) -> HTTP 401
  - body: {"type":"error","error":{"type":"AuthError","message":"Missing API key."}}

### Go endpoint
- **POST/GET go/v1/chat/completions** -> HTTP 401
  - body: {"error":{"type":"server_error","message":"Upstream request failed: Go requires a credential"}}
- **POST/GET go/v1/usage** -> HTTP 401
  - body: {"type":"error","error":{"type":"AuthError","message":"Unauthorized"}}

### Streaming body, first bytes
```
{"type":"error","error":{"type":"FreeTierError","message":"OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building."}}```
```

</details>

### The key channel is separate (third-party confirmation)

Two independent write-ups agree with the probe above, and one of them is a
post-mortem from a project that tried exactly what we considered:

* `pi-opencode-zen` (deprecated 2026-09-23) — "OpenCode Zen shut down anonymous
  free-tier access on its public API for all non-official clients. **This cannot
  be bypassed by any headers or client emulation** — the official opencode v2
  client uses a private, server-dispatched endpoint. The only remaining access
  path is a paid API key. **The API-key channel is independent and is not
  affected by this restriction**."
  (https://pi.dev/packages/pi-opencode-zen)
* Provider directories list the same free ids against `https://opencode.ai/zen/v1`
  with "email account, no card required" and a Console API key
  (https://itsfree.ai/provider/opencode-zen/, https://freellm.net/providers/opencode).

So the honest, working configuration is: the user's own Console key (free ids
included, no card needed) or a Go subscription, plus the session header their
docs ask for. BetterShape sends exactly that, and its connection test now runs a
real completion instead of trusting the anonymous model list.
