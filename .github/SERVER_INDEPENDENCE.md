# Server independence and BYOK depth

Internal engineering report, not user documentation. It records what BetterShape
still talks to on the network, how each remaining server-shaped feature is (or
will be) handled, and the BYOK surface that exists today. Every line was checked
against the tree; file references are the evidence.

Last verified: commit `71b776d` (BYOK depth + editor-status/spill fixes).

## Method

Three sweeps, all reproducible from the repo:

1. **External host audit** — every `https://…` literal in `src-tauri/src`, `lib`,
   `features`, `components`, `app`, grouped by host.
2. **Rust → frontend event audit** — every `app.emit("…")` name in Rust checked
   against frontend string literals. Result: 51 events emitted, 4 with no
   frontend mention (`agent-design-pick-pending`, `chat_renamed`,
   `dictation-text`, `dictation-error`).
3. **Shape-domain grep** — `useshape`, `shape.cloud`, `api.shape`, `shape.app`,
   `shape.dev` outside docs. Runtime hits: none.

## What the app talks to, and why that is fine

| Feature | Dependency | Status | Evidence |
| --- | --- | --- | --- |
| Chat, tools, titles, captions | The provider the user configured | BYOK, direct | `core/ai_providers.rs`, `agent/commands/provider_wire.rs` |
| Embeddings (semantic index) | User's OpenAI-wire provider | BYOK; off when no provider can embed | `agent/index/embeddings.rs`, `lib/ai/providers.ts` |
| Images / speech | User's OpenAI-wire provider | BYOK | `agent/tools/generate.rs` |
| Web search tool | Tavily or Brave, user's key | BYOK | `core/ai_providers.rs` `search_config` |
| Plugins (Composio) | `backend.composio.dev`, user's own key | BYOK | `features/settings/ui/sections/mcp.tsx`, `lib/plugins/api.ts` |
| MCP registry suggestions | `registry.modelcontextprotocol.io` | Public third-party index, best-effort; a failure returns an error string and the tool falls back to manual config | `mcp/registry.rs` header |
| MCP OAuth | Provider's own endpoints + localhost callback | Local callback, tokens in OS keychain | `mcp/oauth`, `mcp/credentials.rs` |
| GitHub | `gh` CLI / Git Credential Manager on this machine | Local tooling, no Shape involvement | `commands/github_auth/mod.rs` |
| Problem reports | Clipboard + prefilled GitHub issue | Nothing leaves the machine | `lib/feedback/report.ts` |
| Update feed | GitHub releases (`github.com`) | Intentionally inert today — see gap 1 | `lib/window/updater.ts` |
| Release automation | The repo's own GitHub Actions | Fixed: `GITHUB_REPOSITORY` decides the target repo | `scripts/release/{notes,upload}.mjs` |
| Icon / favicon lookups | `cdn.simpleicons.org`, `icons.duckduckgo.com`, `thesvg.org` | Cosmetic; see gap 2 | `lib/plugins/logos.ts`, file icons |
| Accounts, tiers, credits, telemetry, device ids | — | Removed. No login IPC, no credit checks, no analytics SDK | `lib/catalog/index.ts:4`, `docs/developing/client-trust.mdx` |

A local preview proxy (`__bettershape_proxy_token` in
`commands/preview/design_proxy.rs`) and the design sandbox serve the app's own
preview iframe from inside the app. They are not a remote service.

## Gaps, in the order they are worth closing

1. **In-app update check.** `checkForAppUpdates` was reduced to "You're on the
   latest version" and `downloadAndInstallUpdate` tells the user to visit
   GitHub, but nothing checks GitHub. Tackle by adding a Rust `check_app_update`
   (GET `api.github.com/repos/Owie6789/Shape/releases/latest`, compare with
   `app.package_info().version`) and offering "Open the release page" — no
   silent install, no Shape feed. The titlebar chip, dismissal state and
   `describeUpdateStatus` are already built and waiting for it.
2. **Icon CDNs.** Simple Icons / DuckDuckGo favicons are fetched for plugin and
   file icons. Offline they simply fail; cache them on first fetch so the app
   looks the same without a network.
3. **MCP registry offline.** Search needs the network every time. Cache the last
   response to disk and allow a custom registry URL (a company mirror), the same
   way provider base URLs are overridable.
4. **Composio self-hosting.** The base URL is hardcoded to `backend.composio.dev`.
   A user running their own Composio deployment should be able to point at it.
5. **Windows dictation is unreachable.** `core/mic.rs` implements local
   (PowerShell) speech recognition and emits `dictation-text` /
   `dictation-error`; nothing in the frontend calls `dictation_start` and nothing
   listens for the events. Wire it to the composer or delete the module.
6. **`agent-design-pick-pending` has no listener.** The design gallery renders
   inline and the pick is submitted through `select_design_preview`, so the flow
   works — but the turn is *blocked* while waiting and, if the user scrolled
   away, nothing says so. `lib/agent-preview/store.ts` records the pending pick
   and no component reads it: either drive a toast/status from it or drop it.
7. **`chat_renamed` is a duplicate of `chat_title`.** The sidebar already
   updates from `chat_title` (`use-chat-session.ts:1654`). Keep one.
8. **Status bar is never mounted.** `features/agent/workbench/status/*` is
   complete (line/column, git, python interpreter, notifications) and upstream
   does not mount it either. Now that the editor publishes
   `bettershape-editor-status`, mounting it is a one-line layout change plus a
   design pass.
9. **Editor menu items with no engine.** Go to Definition, References, Rename,
   Quick Fix, Organize Imports and Inline Edit dispatch
   `bettershape-editor-action` and the CodeMirror handler ignores them: there is
   no language server in the repo (no `lib/lsp`, no Rust LSP). Either hide them,
   or build the LSP client — do not leave them as silent no-ops.

## BYOK surface today

- **Wires**: OpenAI Chat Completions, Anthropic Messages, Google Gemini
  `generateContent` — each with native request/response translation so tool
  calling and streaming work (`agent/commands/provider_wire.rs`).
- **Providers**: OpenAI, Anthropic, Google, OpenRouter, xAI, DeepSeek, Groq,
  Mistral, plus any OpenAI-compatible base URL (Ollama, LM Studio, vLLM, a
  gateway). Model ids are `provider/model`, nested ids allowed.
- **Secrets**: OS keychain via `commands/ai_byok.rs`; settings files and
  cross-window events carry no keys; a missing keychain falls back to plaintext
  with a warning instead of losing the key.
- **Diagnostics**: `ai_test_provider` verifies a key/base URL and returns the
  models the account actually serves; Settings can import them.
- **Routing rules**: `auto` → configured default → first usable provider;
  embeddings only from providers that serve the endpoint; 429/5xx retried inside
  the turn with `Retry-After`; HTTP failures explain the fix before quoting the
  provider.
- **Not built yet** (candidates, roughly in value order): per-provider extra
  headers (OpenAI org/project, OpenRouter `HTTP-Referer`/`X-Title`, Azure
  `api-version`), a cheap "utility" model distinct from the agent model, a
  provider failover chain, request timeouts per provider, local token/cost
  accounting per conversation, and a proxy setting for corporate networks.
