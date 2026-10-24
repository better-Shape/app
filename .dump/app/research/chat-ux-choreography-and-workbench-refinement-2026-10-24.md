# Chat UX choreography, provider diagnostics, and workbench refinement, 2026-10-24

## Scope

This record documents the architecture, bug fixes, and measurements for the chat composer, empty-to-thread stage, streaming Markdown pipeline, tool-call blocks, provider connection checks, commit popover geometry, and cross-workbench bridges on `mega/absorb-all`.

## Root causes and fixes

### 1. Null crash on empty provider connection checks

- **Symptom.** Clicking `Check chat` in `Settings -> Providers` before entering an API key threw `Cannot read properties of null (reading 'ok')`.
- **Cause.** `lib/preview/tauri-mock.ts` lacked IPC handlers for `ai_provider_test_connection` and `ai_provider_check_chat`, so its fallback returned `null`. `features/settings/ui/sections/providers.tsx` dereferenced `res.ok` without guarding against an empty key or a malformed IPC payload.
- **Fix.** `providers.tsx` blocks empty-key checks for providers that require a key, sets a local `role="alert"` message (`Enter an API key for <Name> before checking chat.`), and validates `res && typeof res.ok === "boolean"` in both `runTest` and `checkConnection`. `src-tauri/src/commands/ai_byok.rs` trims optional `api_key` inputs so whitespace-only strings fall back to stored credentials or return an explicit missing-key diagnostic. `lib/preview/tauri-mock.ts` implements deterministic browser-preview handlers for both commands.

### 2. Composer layout jitter, leading-space wrap bug, and unset-provider affordance

- **Symptom.** Typing across single-line and multi-line states shifted horizontal text alignment when the right-rail controls switched containers. Lines starting with spaces before a long token wrapped onto line 2 and left a blank top row. When no provider was configured, the composer hid its rotating capability hints and kept `Auto` plus effort controls that could not route a turn.
- **Fix.** `features/chat/ui/composer/input.tsx` keeps one persistent three-column flex row (`+` on the left, mirror and `<textarea>` in the center, dictation and send or stop on the right) across single-line (`44px`) and multi-line (`66px` to `198px`, `302px` expanded) heights. `shouldComposerBreakAll` switches both the mirror overlay and `<textarea>` to `break-all` in lockstep when a line starts with whitespace before a token of 16 or more characters. When no usable provider has routable models, `RotatingComposerHint` stays active in the placeholder slot with a setup prompt first, and an `Open Providers` button with `BetterShapeLogo` (`marquee`) replaces `ModelMenu` and `ThinkingEffortControl` in the bottom-right composer bar until a provider with models is configured.

### 3. Provider icon resolution for gateway model slugs

- **Cause.** Three-segment gateway slugs such as `fireworks/accounts/deepseek-v3` or `together/meta-llama/Llama-3.3-70B` carry the gateway prefix in segment 0 rather than the model maker.
- **Fix.** `lib/ui/provider-icon.tsx` resolves known makers across all slash segments before falling back to segment 0, and maps 32 vendor slugs to bundled `thesvg` vector paths. `lib/catalog/store.ts` skips non-provider catalog buckets (`default`, `auto`, `models`, `catalog`) when checking whether a configured provider exposes models.

### 4. Titlebar commit popover inset and split-button height mismatch

- **Cause.** `features/agent/workspace/commit-menu.tsx` rendered `<Input variant="ghost">` directly against the popover edge, cramping the `Message` placeholder, and paired a `size="sm"` primary button with a `h-7` (`22.75px` at the `13px` root) split chevron button.
- **Fix.** Wrapped the `Message` input in a framed `rounded-lg border border-border bg-bg-primary` container with `pl-2.5 pr-8` (`10.8px` symmetric inset at `13px` root) and matched both halves of the split commit control at `h-9` (`29.25px`).

### 5. Streaming render isolation, scroll ownership, and HITL visibility

- **Streaming Markdown.** `lib/chat/markdown-blocks.ts` splits streaming Markdown outside open code fences so settled blocks stay memoized while only the active tail re-parses on each token chunk.
- **Context split.** `features/chat/lib/chat-stream-store.tsx` separates `ChatStreamLiveContext` from `ChatStreamStatusContext` and caps snapshot retention with a 24-chat LRU cache.
- **Scroll latch and approval stack.** `features/chat/ui/chat.tsx` pauses auto-follow when the user scrolls up or toggles a tool disclosure (`bettershape-chat-disclosure-toggle`), and shows a directional jump pill when a pending approval card leaves the scrollport. `features/chat/ui/blocks/approval.tsx` maintains `activeApprovalStack` so `Cmd+Enter` and `Escape` target only the newest pending approval card.

## Verification summary

- `npm ci`: passed, 858 packages, no lockfile drift.
- `npm run lint:strict`: passed, 0 errors, 0 warnings.
- `npm run typecheck`: passed across `tsconfig.json` and `tests/tsconfig.json`.
- `npm run build:runtime`: passed, `public/preview/bundle.js` and `src-tauri/runtime/` unchanged.
- `npm run skills:verify`: passed, 53 of 53 locked skills verified.
- `npx vitest run`: passed, 226 suites, 2,447 tests.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`: passed on `rustc 1.89.0`.
- `CARGO_BUILD_JOBS=1 cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`: passed, 0 warnings.
- `CARGO_BUILD_JOBS=1 cargo test --all-features --manifest-path src-tauri/Cargo.toml`: passed, 437 Rust unit tests.
- `npx playwright test`: passed, 25 of 25 browser E2E, axe accessibility, visual, git, settings, and workbench tests.
