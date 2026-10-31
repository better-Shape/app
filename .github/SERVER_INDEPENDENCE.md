# Server independence and BYOK depth

Internal engineering report, not user documentation. It records what BetterShape
still talks to on the network, how each remaining server-shaped feature is (or
will be) handled, and the BYOK surface that exists today. Every line was checked
against the tree; file references are the evidence.

Last verified: commit `47d6be3` (editor-surface pass: minimap, clipboard, action contract,
design-pick notice). Gaps 5-9 were re-checked against the tree; each line below
says what closed it.

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
5. ~~**Windows dictation is unreachable.**~~ **Closed.** The composer's
   `dictation-button.tsx` drives the whole cycle: `dictation_start` /
   `dictation_push` / `dictation_stop` (`lib/backend/commands.ts:1136-1139`),
   capture and WAV encoding in `lib/editor/dictation.ts`, and a `dictation-text`
   listener that hands the phrase to the composer through
   `bettershape-dictation-text` (`features/chat/ui/composer/input.tsx:605`).
6. ~~**`agent-design-pick-pending` has no listener.**~~ **Closed.** The chat
   session listens for the event and raises a notification when no gallery is on
   screen (`features/chat/lib/use-chat-session.ts`, decision in
   `lib/agent-preview/pending-notice.ts`, which reads the gallery's own
   `data-pending-approval-kind` marker).
7. ~~**`chat_renamed` is a duplicate of `chat_title`.**~~ **Not a duplicate any
   more.** `chat_renamed` is an inline transcript marker the backend writes into
   the message (`src-tauri/src/agent/commands/titles.rs:432`), parsed in
   `features/chat/ui/message/item.tsx:267` and hidden from search; the sidebar
   title comes from the separate `chat_title` event.
8. ~~**Status bar is never mounted.**~~ **Closed.** `features/agent/layout.tsx:1002`
   renders it for any project, and it carries line/column, git, the python
   interpreter, run status and the notifications menu.
9. **Editor menu items with no engine.** Go to Definition, References, Rename,
   Quick Fix, Organize Imports and Inline Edit dispatch
   `bettershape-editor-action` and the CodeMirror handler ignores them: there is
   no language server in the repo (no `lib/lsp`, no Rust LSP). Either hide them,
   or build the LSP client — do not leave them as silent no-ops.
   **Hidden, and enforced:** `lib/editor/action-contract.ts` declares the ids
   with the reason, the command palette filters against it, and
   `tests/editor/action-dispatch-coverage.test.ts` fails if any surface
   dispatches an id that is neither answered nor declared. Building the client
   is still the way to bring the rows back.

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
