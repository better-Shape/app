# Release readiness

A snapshot of what is verified green, what this branch fixed, and what is still
open. The green table and the commands at the bottom were produced by running
them; the event wiring section records what each call site showed.

## Verified green

Re-measured in a restricted sandbox on 2026-11-01. The vendored toolchain is Rust 1.89.0, which meets
the lockfile's MSRV, so the cargo rows need no `--ignore-rust-version`; `CARGO_BUILD_JOBS=1` is
explained below the table.

| Check | Command | Result |
| --- | --- | --- |
| Rust unit tests | `CARGO_BUILD_JOBS=1 cargo test --all-features` in `src-tauri/` | **453 passed, 0 failed** |
| Rust formatting | `cargo fmt --all -- --check` | clean |
| Rust lints | `cargo clippy --all-targets --all-features -- -D warnings` | clean, 0 warnings |
| TypeScript | `npx tsc --noEmit` | clean |
| Test typing | `npx tsc --noEmit -p tests/tsconfig.json` | clean |
| ESLint | `npm run lint:strict` | clean, 0 warnings |
| JS/TS tests | `npm run test:all` | 295 files, 3035 tests, all passing |
| Skill lock | `npm run skills:verify` | 53 of 53 locked skills verified |
| Browser suite, CI mode | `npm run build:preview && E2E_STATIC=1 npx playwright test` | 37 passed |
| Secret scan | `git diff <base>...HEAD --unified=0 \| node scripts/ci/check-secrets.mjs` | no obvious secret values in added lines |

The vendored toolchain is Rust 1.89.0, matching the `src-tauri/Cargo.toml` pin and
`notify-rust@4.18.0`'s `rust-version = "1.89.0"`, so the cargo rows run unmodified. `CARGO_BUILD_JOBS=1`
keeps parallel test linking inside a small sandbox's memory. The Rust rows in this table were
measured against the current payload (`7c4c878`), whose sysroot is usr-merged with no absolute or
dangling library symlinks. The cargo rows run from `src-tauri/`, because the repository has no root
manifest; the reproducing commands below keep the `--manifest-path` spelling for a root shell.

Rust runs in the sandbox as well, against the vendor branch: the orphan branch
`vendor/sandbox-toolchain` carries the 1.89.0 components, the crate registry and a Debian 12 dev
sysroot for the GTK and WebKit stack, so `cargo fmt`, `cargo clippy` and `cargo test` all pass
offline. `scripts/dev/rust-toolchain.sh` remains the npm-only path for `cargo fmt`. See
`engineering/rust-toolchain.md` for the cargo flags and
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

## Event wiring

`node scripts/qa/audit-glue.mjs` scans 553 modules and reports orphan modules,
module-level dead ends, and event channels that only one side names. Its event
matcher is literal (`new Event("name")`, `addEventListener("name")`), so a name
dispatched through a helper, or listened to from an array of names, is invisible
to it. Every channel it listed was read at its call site before it was believed,
and the ones it reported as one-sided all have both halves:

- `bettershape-chat-pins-changed`, `-unread-changed`, `-collections-changed`,
  `-colors-changed`: dispatched by `announce()` in
  `lib/sidebar/chat-list-meta.ts`, listened to by `ensureCrossWindowSync` in the
  same file.
- `mcp-servers-changed`: a Tauri event. The Rust side emits it
  (`mcp_cmds.rs`, `meta.rs`); `lib/chat/mention-warm-cache.ts` and the MCP
  settings page listen.
- `bettershape-terminal-open`: dispatched by `features/agent/terminal-dock.tsx`,
  read by the titlebar through `useStoredFlag`.
- `bettershape-workspace-opened`, `-trusted`, `-untrusted`: dispatched by
  `lib/workspace/trust.ts`, listened to from the event list in
  `features/settings/ui/settings.tsx`.
- `bettershape-editor-edit-action`, `bettershape-editor-search`,
  `bettershape-editor-split`, `bettershape-terminal-run-restart`,
  `bettershape-terminal-run-stop`, `bettershape-toggle-browser-design-mode` and
  `bettershape-workspace-folders-changed`: a dispatcher and a listener each, some
  named in an array or through a stored-flag helper.

Four names the earlier audit listed have no occurrence in the tree at all, so
nothing is waiting on them: `bettershape-terminal-view`,
`bettershape-toggle-design-mode`, `bettershape-typescript-version` and
`open-folder-request`.

Removed by this branch, so no longer on either list: `bettershape-chat-fork`,
`bettershape-chat-incognito`, `bettershape-chat-restore-last`,
`bettershape-composer-insert-mention` (replaced by
`bettershape-chat-attach-element`), `bettershape-editor-search-count`,
`bettershape-open-browser`, `bettershape-open-preview`,
`bettershape-open-subagents-for`, `bettershape-set-panel-tab`,
`bettershape-swap-sidebars` and `bettershape-workspace-trust-required`.

Two earlier recon items were re-checked here and were wrong:

- the agent-workbench status bar is mounted: `features/agent/layout.tsx` imports
  `./workbench/status`;
- the plan and spill paths in the docs did not match the code. Plans are written
  under the app data folder (`BetterShape/plans/<project>/`,
  `plan_storage_dir` in `agent/tools/dispatch/meta.rs`), not into the project,
  and tool spill goes to `.bettershape/agent-out/`
  (`agent/tools/spill.rs`). Both docs pages now say what the code does.

## Reproducing the checks

```bash
npm ci
npx tsc --noEmit
npx tsc --noEmit -p tests/tsconfig.json
npm run lint:strict
npm run test:all
npm run skills:verify
npm run build:preview && E2E_STATIC=1 npx playwright test

# Rust. In a restricted sandbox prefix the cargo commands with the environment
# from vendor/sandbox-toolchain and add CARGO_BUILD_JOBS=1 for the linker
# headroom, plus the vendored source replacement in $CARGO_HOME/config.toml.
# The vendored toolchain is Rust 1.89.0 and matches the pin, so no
# --ignore-rust-version is needed. See engineering/rust-toolchain.md.
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
CARGO_BUILD_JOBS=1 cargo test --manifest-path src-tauri/Cargo.toml --all-features
```

CI (`.github/workflows/ci.yml`) runs the full set: lint + typecheck, Vitest,
`cargo test --all-features`, `cargo fmt --check`, clippy, Next.js build, version
sync and the security audit.
