# Release readiness

A snapshot of what is verified green, what this branch fixed, and what is still
open. Regenerate the evidence with the commands at the bottom; every claim here
was produced by one of them, not by reading code and hoping.

## Verified green

Re-measured in a restricted sandbox against the vendor branch on 2026-10-16. The two flags on the
cargo rows are explained below the table.

| Check | Command | Result |
| --- | --- | --- |
| Rust unit tests | `CARGO_BUILD_JOBS=1 cargo test --ignore-rust-version --all-features --manifest-path src-tauri/Cargo.toml` | **313 passed, 0 failed** |
| Rust formatting | `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | clean |
| Rust lints | `cargo clippy --ignore-rust-version --all-targets --all-features --manifest-path src-tauri/Cargo.toml -- -D warnings` | clean, 0 errors |
| TypeScript | `npx tsc --noEmit` | clean |
| ESLint | `npx eslint --quiet` | clean, 0 errors |
| JS/TS tests | `npx vitest run` | 106 files, 864 tests, all passing |
| Skill lock | `npm run skills:verify` | 53 of 53 locked skills verified |
| Browser suite | `PLAYWRIGHT_BROWSERS_PATH=<vendored> PLAYWRIGHT_SANDBOX_LIBS=<vendored closure> npx playwright test e2e/smoke.spec.ts` | 6 of 6 passed |

`--ignore-rust-version` is needed because `notify-rust@4.18.0` declares `rust-version = "1.89.0"`
while `src-tauri/Cargo.toml` pins 1.88.0. `CARGO_BUILD_JOBS=1` keeps parallel test linking inside a
small sandbox's memory. Run without the first flag, `cargo test` and `cargo clippy` exit 101 before
compiling anything. The Rust rows were measured after the sysroot repair recorded in section 7.1 of
`engineering/sandbox-vendored-toolchain.md`; the delivered payload needs that repair once, before
any link step. Every Cargo row runs from the repository root and carries
`--manifest-path src-tauri/Cargo.toml`, because the repository has no root manifest. The rows are
the measured results with the flags spelled out; the plain commands exit 101 and are never reported
as passing.

Rust runs in the sandbox as well, against the vendor branch: the orphan branch
`vendor/sandbox-toolchain` carries the 1.88.0 components, the crate registry and a Debian 12 dev
sysroot for the GTK and WebKit stack, so `cargo fmt`, `cargo clippy` and `cargo test` all pass
offline. `scripts/dev/rust-toolchain.sh` remains the npm-only path for `cargo fmt`. See
`engineering/rust-toolchain.md` for the flags every Rust gate needs and
`engineering/sandbox-vendored-toolchain.md` for the fetch recipe and the measured results.

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
npx tsc --noEmit
npx eslint --quiet
npx vitest run

# Rust. In a restricted sandbox prefix the cargo commands with the environment
# from vendor/sandbox-toolchain and add the two flags: the vendored source
# replacement in $CARGO_HOME/config.toml, and --ignore-rust-version because
# notify-rust@4.18.0 declares rust-version 1.89.0 against the 1.88.0 pin.
# See engineering/rust-toolchain.md.
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --ignore-rust-version --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
CARGO_BUILD_JOBS=1 cargo test --ignore-rust-version --manifest-path src-tauri/Cargo.toml --all-features
```

CI (`.github/workflows/ci.yml`) runs the full set: lint + typecheck, Vitest,
`cargo test --all-features`, `cargo fmt --check`, clippy, Next.js build, version
sync and the security audit.
