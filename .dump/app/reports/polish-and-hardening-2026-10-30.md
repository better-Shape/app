# Future polish and hardening report

Date: 2026-10-30
Branch: `arena/186eaa44-app`
Base: `mega/absorb-all` at `b7a307a83aafc414bd9050c94b982cf08bab879e`

## Scope completed

1. Compositor hold-to-confirm destructive action control in `components/ui/hold-button.tsx` and `app/transitions.css` with linear `clip-path` fill, `200ms` release snap-back, `scale(0.97)` press feedback, `1px` inset danger ring when armed, `DrawnCheck` completion after synchronous or async `onConfirm` resolution (returning `data-state` to `idle` with `aria-busy="true"` while an async callback settles), touch implicit-capture release and bounding-box drag-out cancellation, reactive `disabled` abort across both `holding` and `armed` states, `pointercancel` click-guard reset, reduced-motion static holding tint, WebKit-safe blur handling, Escape cancellation, and a two-step accessible armed fallback that confirms on pointer or key release (`WCAG 2.5.2`). Wired with `Tooltip` labels across `features/agent/workspace/file-diff.tsx`, `features/agent/workspace/multi-diff.tsx`, and `features/git/ui/actions/console.tsx`. Connected changed-file rows inside `features/agent/workspace/commit-menu.tsx` to `DropdownMenuItem` and `openFileDiffTab` for arrow-key and click navigation.
2. Terminal unread persistence and closed-dock indicator in `features/terminal/session.ts`, `features/terminal/ui/terminal.tsx`, and `features/chat/ui/shell/titlebar.tsx`, sharing `projectPathKey`, `sameProjectPath`, and `lookupByProjectPath` across Windows drive, slash, and UNC path variations alongside case-sensitive POSIX path matching.
3. Git-graph newest branch arrival stroke draw in `features/git/ui/graph/graph.tsx`, `features/git/ui/graph/commit-row.tsx`, and `features/git/ui/graph/svg-row.tsx` keyed by `cacheKey` and checked-out `HEAD` ref over active cache-synchronized logs (`activeLogs`) and verified against parent lineage so cache switches, branch checkouts, and virtualized scroll recycling keep existing history static.
4. Momentary `DrawnCheck` feedback wired across copy and remote actions in `features/settings/ui/sections/providers/inputs.tsx`, `features/settings/ui/sections/providers/provider-card.tsx`, `features/preview/design/deploy.tsx`, `features/chat/ui/md/diff.tsx`, and `features/git/ui/source/source.tsx` with exact URL confirmation and failure tracking via `copiedText`, failed-copy feedback (`Couldn't copy`), and disabled empty-URL guard on `RemoteRow`.
5. Unified `Collapse` primitive in `components/ui/collapse.tsx` supporting `reveal`, `spring`, and `menu` variants, composed into `components/ui/collapsible.tsx` and `components/ui/dropdown.tsx`.
6. Removed orphaned reasoning, stream-word, and onboarding-orb CSS selectors and stale comments in `app/transitions.css`, `app/globals.css`, and `tests/ui/reduced-motion.test.ts` while preserving active `.t-think` tokens.
7. First-run and workspace empty-state polish in `app/welcome-screen.tsx` (including Windows `C:\`, Windows UNC `\\server\share`, and POSIX `/` parent formatting plus inset `:focus-visible` rings), `components/ui/state-message.tsx` (with `role="alert"` and default error iconography on failed states), `features/git/ui/problems/panel.tsx`, `features/git/ui/search/panel.tsx`, `features/git/ui/blame/panel.tsx`, and `features/packages/panel.tsx`.
8. Accessible settings row labelling via `SettingRowLabelContext` in `features/settings/ui/shared/controls.tsx` (combining row title and selected option value IDs on `SettingSelect`) and `features/settings/ui/sections/ai.tsx` (preserving at least one active concrete model so toggling off models never resets all models back on), zeroed `/settings` violations in `e2e/a11y-baseline.json`, and modeled journal and window IPC commands in `lib/preview/tauri-mock.ts`.
9. Extracted and tested Ask-mode `OPENUI_MD` gating in `src-tauri/src/agent/commands/send_chat.rs`, consolidated status label helpers in `src-tauri/src/agent/commands/streaming.rs`, guarded unscoped `chat_complete` events without redundant constant conditions in `features/chat/lib/chat-stream-store.tsx`, followed directory symlinks in Rust `ls_dir` (`src-tauri/src/commands/fs/mod.rs`), and returned canonical resolved paths from `ensure_path_within` to discover and deduplicate symlinked skill roots and subfolders in `lib/chat/discover-skills.ts` across both POSIX and case-insensitive Windows paths without probing extensionless files.

## Verification summary

- `npm run lint:strict`: passed with zero errors and zero warnings.
- `npm run typecheck`: passed across both app and test TypeScript configs.
- `npm run test`: all 258 Vitest suites (2,772 tests) passed.
- `npm run skills:verify`: passed across all 53 skill references.
- `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo test --all-features`: all Rust lints and 446 unit tests passed with zero warnings.
- `E2E_STATIC=1 npx playwright test`: all 36 functional E2E specs and `@visual` Linux baseline specs passed with zero unknown IPC commands across all routes.
- Recorded and inspected 30fps `ui-capture` storyboards covering `workbench-hold-and-menu`, `welcome-surface-hover`, and `settings-accessible-switches`.
