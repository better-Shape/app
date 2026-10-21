# Chat and streaming manual review progress

## Scope and baseline

- User request: begin a systematic manual review of relevant chat and streaming code toward the requested 95% coverage. Do not claim that threshold until the review universe and its denominator are established and the corresponding code has actually been reviewed.
- Base: `f2cefa62a37321e05d3277a208e5c47f4041d4b3` (`origin/draft/mega-absorb-all` at fetch time).
- The reviewed source is on `arena/ac8ade8f-app`, based directly on `draft/mega-absorb-all` at `f2cefa62a37321e05d3277a208e5c47f4041d4b3`. The review conclusions apply to this branch's source tree; publication state is tracked separately.
- Inventory discovery found 88 TypeScript/TSX files under `features/chat/`. This is a discovery count, not yet the review denominator: it includes non-streaming surfaces, while relevant Rust/backend and shared state files live outside that directory.

## Completed review tranche

Read or traced the changed OpenUI-to-chat path and the relevant stream-state code:

- `features/chat/ui/md/renderer.tsx`: top-level fence detection, source and block caps, embedded-block parser handoff, chronological renderer branch, and copy-text helper.
- `features/chat/ui/blocks/openui.tsx`: full local component allowlist, prop validation, child/table/chart limits, nesting bound, stream input and error fallback.
- `features/chat/ui/blocks/disable-openui-devtools.ts`: module-evaluation flag ordering for runtime telemetry and development inspector auto-mount.
- `features/chat/ui/message/item.tsx`: copy selection, rendered OpenUI text lookup, and existing message lifecycle context around the changed handler.
- `features/chat/lib/chat-stream-store.tsx`: full frontend listener/store file, including per-conversation live turns and `chat_started`, `chat_token`, `chat_complete`, approval, and status event handling.
- `features/chat/lib/use-chat-session.ts`: targeted transcript restore, conversation switching, send, queue, and request-ID sections; not a full-file review.
- `src-tauri/src/agent/commands/send_chat.rs`: command entry, mode selection, Ask prompt attachment, run-turn call, persistence and completion branches relevant to this change; not a full-file review.
- `src-tauri/src/agent/commands/streaming.rs`: event status/token emitters and their payload shapes.
- `src-tauri/src/agent/commands/approvals.rs`: targeted stop lifecycle, per-conversation cancellation, partial-history persistence, and chat-complete emission; not a full-file review.
- `src-tauri/src/agent/tools/dispatch/{terminal,meta,discover,files,common}.rs`: pending/resolved approval event producers and their `ToolCtx` identity; targeted sections only.
- Follow-up producer/consumer trace across every `emit_chat_status` call site, including stream retry, caption, tool dispatch, and run-turn model/tool transitions; confirmed the turn and conversation IDs are passed wherever the producer has them.
- Follow-up approval trace across all `PendingCommand`/`PendingEdit` constructors and command/edit resolution branches; rejected command/edit resolutions now restore a neutral `Thinking` label instead of briefly claiming the operation is running.
- `src-tauri/src/agent/prompts/mod.rs`, `src-tauri/src/agent/prompts/OPENUI.MD`, `tests/chat-renderer.test.ts`, and `tests/features/openui-chat.test.tsx`.
- `package.json`, relevant `package-lock.json` diff, `.npmrc` install-time telemetry guard, and CI/install call sites.
- `features/agent/workspace/{index.tsx,tabs.tsx,workspace-layout.module.css}` and the focused workbench E2E coverage for narrow-container and keyboard behavior.
- Rust formatting, clippy, and full all-features test gates using the repository-pinned vendor toolchain.

This remains a path-focused tranche, not 95% coverage of the broader chat subsystem.

## Evidence ledger

| ID | Contract | Evidence and result |
| --- | --- | --- |
| C-01 | Only top-level `openui-lang` fences become visual chunks; ordinary/nested code and fences inside BetterShape structural payloads remain outside the OpenUI renderer; source and count are bounded. | Parser implementation plus direct regression tests for closed/incomplete fences, nesting, tilde/CRLF, 32,000-character cap, fourth-block overflow, copy, embedded-tag isolation, and a `tool_result` payload regression. The targeted renderer test file passed 31/31 after the payload fix. |
| C-02 | Model output can select only the local static presentation components and cannot create actions or arbitrary React elements. | `createLibrary` registers eight local components; Zod props reject wrong shapes; number of children, chart rows/columns, table rows/columns, and layout depth are bounded; unknown component test checks a fallback and absence of `script`, `iframe`, and `img`. Static and test evidence only; deeper upstream parser review remains open. |
| C-03 | OpenUI instructions are attached only to Ask turns and stay in the per-turn context. | Frontend passes `selectedModeRef.current`; Rust defaults missing mode to Ask, uses case-insensitive Ask matching, and appends `OPENUI_MD` to `turn_context`, not to unrelated mode prompts. Consumer and command sections inspected; no dedicated Rust test for this branch was reviewed yet. |
| C-04 | OpenUI telemetry and inspector do not make runtime network calls. | Runtime helper sets the documented disable flag and the auto-mount symbol before importing the renderer; renderer passes `publishObservability={false}`. Transitive package source shows runtime telemetry is opt-in and inspector loading is behind the auto-mount flag. |
| C-05 | npm dependency lifecycle scripts do not send OpenUI installation telemetry in this project. | Manual source audit found `@openuidev/lang-core@1.0.1` install telemetry runs unless disabled. Added root `.npmrc` Node preload. `npm config get node-options` returned the configured value; `npm exec` child saw `OPENUI_TELEMETRY_DISABLED=1`; executing the package postinstall through `npm exec` left the pre-existing telemetry-state file hash unchanged. Earlier postinstall execution is confirmed by its state file and notice flag, but whether its swallowed network request was delivered is unknown. See `decisions/openui-install-telemetry.md`. |
| C-06 | Chat and approval lifecycle events are routed to their owning conversation and released on completion/cancel. | Tokens/completion carry identity. The `chat_status` fix stamps each emission with producer conversation/turn IDs, updates persisted activity only for the matching in-flight turn, and drops missing, foreign, stale, or non-live status events. After the user's follow-up approval, command/edit/ask/design-pick pending events and command/edit resolution events now carry identity; frontend activity updates use the same exact-live-turn guard. Added concurrent-chat status and approval regressions plus Rust payload/serialization unit tests. Frontend regressions pass. Rejected command/edit resolutions return the owning turn's label to `Thinking`, rather than falsely showing `Running command` or `Editing file`. Stop/cancel is traced through per-conversation cancellation, partial-history persistence, and `chat_complete`; runtime multi-window races and remaining restore/shutdown paths remain pending. |

## Findings and caveats

- **Install-documentation runtime mismatch corrected during dependency review.** The root docs said Node.js 18+, but the installed Next.js 16.4.0 package declares Node.js `>=20.9.0`; `.npmrc` also uses Node's `--import` preload. README and contributor setup now state Node 20.9 or later so the install instructions match the actual toolchain.
- **OpenUI fence-scan and sanitizer bypasses found and fixed during refinement.** The scanner first inspected raw assistant text before the legacy block parser ran, so a fenced example inside a structural payload could become a visual chunk. Its tag inventory now comes from the same `MESSAGE_BLOCK_TAGS` list, and it tracks multi-line opening tags so fences inside hidden blocks remain opaque. A second pass found that extracted OpenUI source and block-limit overflow skipped the existing `stripLeakedToolCode` sanitizer. The parser now applies that sanitizer to both paths, preserving visible prose/source while removing leaked tool markup. Regressions cover multi-line tool-result attributes, markup inside OpenUI strings, incomplete tags, quoted attributes and the overflow path. `npx vitest run tests/chat-renderer.test.ts` passed 31/31, and the latest full Vitest run passed 107 files / 895 tests. An explicit `string` annotation on the accumulated source resolves TypeScript 6's TS7022 inference cycle. This is a parser-boundary and untrusted-output sanitization class fix, not a special-case check for one tag.
- Corrected the install-time telemetry gap in the approved OpenUI integration. Runtime-only flags were insufficient because the transitive package also sends during `postinstall`; `.npmrc` now sets the documented opt-out for npm-spawned Node processes. The earlier delivery outcome is unknown and is not claimed either way.
- **Confirmed cross-chat status attribution defect; comprehensive status-only fix now applied on the approved scope.** Previously, `streaming::emit_chat_status` forwarded its payload unchanged and the store called `patchLive(undefined, ...)`, which could target the viewed live turn. The emitter now adds authoritative `turnId` and `conversationId`; every run-turn, stream, pre-caption, and tool-dispatch call site passes its owning context. `AgentState` activity labels are now updated only when both the conversation and turn still match. The store requires both IDs and an exact live-turn match, and ignores missing-ID, foreign, stale, or non-live status events. Added a concurrent-chat regression in `tests/features/chat-stream-store.test.tsx` and a pure Rust payload-envelope test in `streaming.rs`. Frontend and Rust tests pass; no runtime multi-window reproduction was performed.
- **Neighboring approval-event attribution gap found and fixed after the user's explicit scope expansion.** `agent-command-pending`, `agent-edit-pending`, `agent-ask-pending`, `agent-design-pick-pending`, `agent-command-resolved`, and `agent-edit-resolved` had no conversation/turn identity, and the store's approval listeners used `patchLive(undefined, ...)`. Pending command/edit structs and inline ask/design events now carry IDs; command/edit resolution payloads carry the same IDs; the store routes all activity changes through an exact conversation+turn guard. A follow-up review caught that rejected command/edit events were briefly labelled as if the operation were running. Resolution handlers now distinguish approval from rejection and restore `Thinking` for rejected actions. The regression covers both chats, approved/rejected transitions, missing IDs, and stale turns. UI card-specific listeners remain ID keyed; the new fields are additive.
- Cancellation tranche: `handleStopMessage` snapshots the viewed/draft conversation before calling `stopChatMessage`; `stopLiveTurn` immediately clears that view's local live state; Rust selects the per-conversation cancellation token, leaves the in-flight slot allocated until the turn unwinds, persists partial text to the matching conversation, and emits identity-bearing `chat_complete` with `Cancelled`. Background stops avoid tearing down the currently visible browser/PTY and use the background conversation's stored snapshot. Static trace only; no runtime stop race test was run.
- Focused ESLint reported zero errors and one existing `react-hooks/set-state-in-effect` warning at `features/chat/ui/message/item.tsx:311`; that line is outside this change's diff and was not altered.

## Verification on this tree

Final source tree verified on 2026-10-21, branch `arena/ac8ade8f-app`, base commit `f2cefa62a37321e05d3277a208e5c47f4041d4b3`:

- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci`: passed, 874 packages installed. npm reported 9 audit findings (4 moderate, 5 high); no audit fix was applied.
- `npm run lint`: passed with 0 errors and 157 existing warnings.
- `npx tsc --noEmit`: passed after adding an explicit type for the streaming source accumulator.
- `npm run build:runtime`: passed; also executed by `npm run test:all`. `NEXT_PUBLIC_SHAPE_RELEASE=ci DO_NOT_TRACK=1 npm run build`: passed, including Next.js production compilation, TypeScript, and static page generation.
- Latest `npm run test:all` with `CARGO_BUILD_JOBS=1`: passed; Vitest **107 files / 895 tests** and Cargo **317 tests**.
- `npm run test:rust` is included in that full gate; Cargo passed **317/317** on the pinned Rust 1.89.0 vendor toolchain. `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` both passed.
- `npm run skills:verify`: passed, 53/53 locked skills verified; three project-owned skills are intentionally unrecorded.
- Strict OpenSpec validation passed for `add-openui-chat-surfaces`.
- `npx playwright test e2e/workbench.spec.ts` with the pinned browser: **4/4 passed** against `npm run dev:browser` after the focus-ring correction.
- The broader `npm run qa` remains **25 passed / 1 failed**, with the one failure the existing `/settings` hydration-audit mismatch documented in `e2e/README.md`. It is not allowlisted and must not be described as green.
- UI capture `out.gif`: 362 frames at 30 fps, 12.06 seconds; visual inspection passed. Mechanical validation is `PASS_WITH_WARNINGS` because Tesseract OCR is unavailable. The captured workspace/tab/chart states were visually checked; assets remain ignored under `.qa-artifacts/`.
- One re-run of `npm run test:all` hit `ENOSPC` while Cargo archived `libapp_lib.a`; `df` showed 913 MB free and the ignored `.next/` cache accounted for 704 MB. After stopping the preview and removing that generated cache, free space returned to 1.6 GB; `npm run test:rust` and a complete `npm run test:all` then passed. The source tree was not changed by recovery.
- One initial workbench E2E run exposed that the global focus-outline reset overrode the new tab outline utility. The tab now uses the established focus ring token instead; the computed-style/active-focus E2E then passed 4/4.
- The preview was bound to `0.0.0.0:48921`; the process was stopped after E2E verification. `git diff --check` passed on the final tracked diff.

## Latest review follow-up

- A CodeAnt finding that assistant copy omitted visible structured blocks is addressed: when a message contains any non-text/non-OpenUI chunk, the copy action now uses the rendered message text. Unit integration checks cover both OpenUI labels and chart text; the static Playwright run also reads the clipboard and verifies visible text is copied instead of the DSL source.
- The macOS x86_64 installer previously cross-compiled OpenSSL from an arm64 host and lacked target OpenSSL/pkg-config. GitHub-hosted standard `macos-15` is arm64; the correct x86_64 runner label is `macos-15-intel`. The installer matrix now uses that label for the x86_64 DMG, leaving arm64 native on `macos-latest`. This workflow change awaits hosted CI confirmation.
- Kilo's Windows-only `get_webview_window` compile error is addressed by importing `tauri::Manager` in `src-tauri/src/browser/surface.rs`; Linux Rust tests/lints pass, while Windows compilation remains a CI/platform check.
- The keyboard reorder test now waits for drag activation and non-zero translation rather than racing the sensor. `npm run build:preview` plus `E2E_STATIC=1 npx playwright test --grep-invert @visual` passed **24/24**, including the copy regression.
- Latest production `npm run build` passed. Latest `npm run test` passed **107 files / 895 tests**; `npm run test:all` passed with Cargo **317/317**; lint/typecheck/runtime build/skills/fmt/clippy also passed. Lint still has 157 warnings, including one existing hook warning in the changed message-item file at line 311 outside this diff.

Three pre-push review passes were completed on the current changed paths: (1) contract, event identity, copy behavior, and failure handling; (2) untrusted OpenUI parsing, bounds, telemetry, and dev-origin trust; (3) accessibility, keyboard interaction, CI runner mapping, and platform-specific compile changes. No additional local-diff defect was confirmed in those passes. The broader chat/streaming manual review remains incomplete, and no 95% coverage claim is made.

## Next review tranche

1. Freeze an inclusion list and explicit unit of review for the chat/streaming lifecycle before calculating a percentage; the 88-file `features/chat` count is not a valid denominator.
2. Finish the lifecycle trace around `use-chat-session.ts`, active-turn restore/bootstrap, event-listener teardown, shutdown, and error completion; only targeted sections were reviewed so far.
3. Add a runtime multi-window or concurrent-background-turn reproduction for status and approval attribution, then compare the observed sequence with the new identity guards and persisted final transcript.
4. Continue through the remaining Markdown/block consumers and test surfaces after the lifecycle boundary is defined; report reviewed items, exclusions, denominator, and evidence without extrapolating from file counts.
