# Future Polish and Hardening Report

Date: 2026-10-30
Branch: `arena/186eaa44-app`
Base: `mega/absorb-all` at `b7a307a83aafc414bd9050c94b982cf08bab879e`

## Scope Completed

1. Compositor hold-to-confirm destructive action control in `components/ui/hold-button.tsx` and `app/transitions.css` with linear `clip-path` fill, `200ms` release snap-back, `scale(0.97)` press feedback, `DrawnCheck` completion, WebKit-safe blur handling, Escape cancellation, and a two-step accessible armed fallback. Wired across `features/agent/workspace/file-diff.tsx`, `features/agent/workspace/multi-diff.tsx`, and `features/git/ui/actions/console.tsx`. Connected changed-file rows inside `features/agent/workspace/commit-menu.tsx` to `openFileDiffTab`.
2. Terminal unread persistence and closed-dock indicator in `features/terminal/session.ts` and `features/chat/ui/shell/titlebar.tsx` so reopening the dock clears visible unread tabs and background output surfaces a subtle `.t-tab-dot` while the dock is closed.
3. Git-graph newest branch arrival stroke draw in `features/git/ui/graph/graph.tsx`, `features/git/ui/graph/commit-row.tsx`, and `features/git/ui/graph/svg-row.tsx` using `pathLength={100}` and `.t-graph-line-draw` while keeping historical lanes steady.
4. Momentary `DrawnCheck` feedback wired across copy and remote actions in `features/settings/ui/sections/providers/inputs.tsx`, `features/settings/ui/sections/providers/provider-card.tsx`, `features/preview/design/deploy.tsx`, `features/chat/ui/md/diff.tsx`, and `features/git/ui/source/source.tsx`.
5. Unified `Collapse` primitive in `components/ui/collapse.tsx` supporting `reveal`, `spring`, and `menu` variants, composed into `components/ui/collapsible.tsx` and `components/ui/dropdown.tsx`.
6. Removed orphaned reasoning, stream-word, and onboarding-orb CSS selectors and stale comments in `app/transitions.css`, `app/globals.css`, and `tests/ui/reduced-motion.test.ts` while preserving active `.t-think` tokens.
7. First-run and workspace empty-state polish in `app/welcome-screen.tsx`, `components/ui/state-message.tsx`, `features/git/ui/problems/panel.tsx`, `features/git/ui/search/panel.tsx`, `features/git/ui/blame/panel.tsx`, and `features/packages/panel.tsx`.
8. Accessible settings row labelling via `SettingRowLabelContext` in `features/settings/ui/shared/controls.tsx` and `features/settings/ui/sections/ai.tsx`, zeroed `/settings` violations in `e2e/a11y-baseline.json`, and modeled journal and window IPC commands in `lib/preview/tauri-mock.ts`.
9. Extracted and tested Ask-mode `OPENUI_MD` gating in `src-tauri/src/agent/commands/send_chat.rs`, consolidated status label helpers in `src-tauri/src/agent/commands/streaming.rs`, guarded unscoped `chat_complete` events in `features/chat/lib/chat-stream-store.tsx`, and returned canonical resolved paths from `ensure_path_within` to deduplicate symlinked skill roots and subfolders in `lib/chat/discover-skills.ts`.

## Verification Summary

- `npm run lint`: passed with zero errors and zero warnings.
- `npx tsc --noEmit`: passed with zero errors.
- `npm run test`: all 258 Vitest suites passed.
- `npm run skills:verify`: passed when skills validation ran.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test`: 445 Rust unit tests passed with zero warnings.
- `E2E_STATIC=1 npx playwright test`: 33 functional E2E specs and 3 `@visual` Linux baseline specs passed with zero unknown IPC commands across all routes.
- Recorded and inspected 30fps `ui-capture` storyboards covering `workbench-hold-and-menu`, `welcome-surface-hover`, and `settings-accessible-switches`.
