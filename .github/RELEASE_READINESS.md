# Release readiness

A snapshot of what is verified green, what this branch fixed, and what is still
open. Regenerate the evidence with the commands at the bottom; every claim here
was produced by one of them, not by reading code and hoping.

## Verified green

| Check | Command | Result |
| --- | --- | --- |
| Rust unit tests | `cargo test --all-features` | **313 passed, 0 failed** |
| Rust formatting | `cargo fmt --all -- --check` | clean |
| Rust lints | `cargo clippy --all-targets --all-features` | clean |
| TypeScript | `npm run typecheck` | clean |
| ESLint | `npx eslint --quiet` | clean |
| JS/TS tests | `npx vitest run` | 89 files, all passing |

Rust is compiled and tested on CI only: the sandbox cannot reach `crates.io`, so
`scripts/dev/rust-toolchain.sh` installs `rustc`/`cargo`/`rustfmt` from npm for
local `cargo fmt` (see that script's header for what it can and cannot do).

## Fixed on this branch

1. **`resolve_model` broke its own documented contract** — three Rust tests
   failed in CI. An unconfigured prefix (`qwen/qwen3-coder` on a self-hosted
   gateway) had its prefix stripped, so the provider was asked for a model that
   does not exist, and `auto` with no default model returned an empty slug
   instead of using the connection's first declared model. Both paths now share
   `no_model_selected_error()`.
2. **OpenCode Zen** — the free models are listed in the `zen` preset, the
   gateway receives the documented identity headers (`x-opencode-session` per
   conversation, our own user agent), refusals name the Console-key fix, and
   "Test connection" no longer trusts `/models` (which OpenCode's gateways serve
   to anyone) — it sends one real completion and reports the gateway's verdict.
   Evidence and the anonymous-probe transcript: `.github/ONLINE_RECON.md`.
3. **File explorer clipboard** — `Ctrl+X/C/V` in the tree dispatched
   `bettershape-explorer-action` to nobody while Settings ▸ Shortcuts advertised
   the keys. `lib/workspace/file-clipboard.ts` now implements cut/copy/paste over
   the existing `copy_path`/`rename_path` commands: never overwrites, refuses to
   paste a folder into itself, clears a cut once it lands. 11 unit tests.
4. **Editor selection context** — chat listened for
   `bettershape-editor-selection` and nothing published it, so selecting code and
   asking about it attached nothing. The editor now publishes the selection
   (capped at 8000 characters) on selection changes and on file attach.
5. **Vestigial events removed** — `bettershape-chat-incognito` (the
   `subscribeIncognito` channel is the real interface) and
   `bettershape-workspace-trust-required` (trust is asked for through the native
   dialog before a workspace opens) had no listeners and looked like interfaces.

## Provider / BYOK state

- Runtime dependency on the Shape website: none. Keys live in the OS keychain,
  requests go from the machine straight to the provider.
- Native adapters: OpenAI-compatible, Anthropic Messages, Google generateContent.
  Every other provider in the presets is one of those three wires.
- Presets cover the OpenAI, Anthropic and Google endpoints plus the
  OpenAI-compatible gateways (OpenRouter, Groq, NVIDIA NIM, OpenCode Zen and Go,
  local runtimes, and a custom base URL).
- Account layer (login, credits, tiers, telemetry, update feed): removed.

## Known gaps (verified dead event wiring)

These are hooks whose other half does not exist. They are *listed*, not hidden,
because each one is either a missing producer or a leftover from a removed
feature. None of them breaks a flow that is otherwise complete; the two that
would have (explorer shortcuts, chat selection context) are fixed above.

Produced, never consumed:

- `bettershape-chat-pins-changed` (`lib/sidebar/chat-list-meta.ts`)
- `bettershape-composer-insert-mention` (`features/preview/design/shell.tsx`)
- `bettershape-editor-search-count` (`features/editor/ui/codemirror/editor.tsx`)
- `bettershape-set-panel-tab` (`lib/ui/shortcut-actions.ts`)
- `bettershape-swap-sidebars` (`features/panels/ui/sidebar-panel-menu.tsx`)
- `bettershape-workspace-folders-changed` (`lib/workspace/folders.ts`)

Consumed, never produced:

- `bettershape-chat-fork`, `bettershape-chat-restore-last`
- `bettershape-editor-edit-action`, `bettershape-editor-search`,
  `bettershape-editor-split`
- `bettershape-open-browser`, `bettershape-open-preview`,
  `bettershape-open-subagents-for`
- `bettershape-terminal-run-restart`, `bettershape-terminal-run-stop`,
  `bettershape-terminal-view`
- `bettershape-toggle-design-mode`, `bettershape-toggle-browser-design-mode`
- `bettershape-typescript-version`
- `open-folder-request` (`components/layout/main.tsx`)

Two more known items, not yet re-verified on this branch:

- the agent-workbench status bar is reported as unmounted in earlier recon;
- docs reference `.shape/agent-out/` and a plans path that `meta.rs` spells
  differently.

## Reproducing the checks

```bash
npm ci
npm run typecheck
npx eslint --quiet
npx vitest run

bash scripts/dev/rust-toolchain.sh          # rustc + cargo + rustfmt from npm
. /tmp/rust-toolchain/env.sh
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
# cargo test / clippy need the crates.io index: run them on CI.
```

CI (`.github/workflows/ci.yml`) runs the full set: lint + typecheck, Vitest,
`cargo test --all-features`, `cargo fmt --check`, clippy, Next.js build, version
sync and the security audit.
