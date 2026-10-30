# Graph arrival lineage, HoldButton pointer capture, skill root paths, and settings accessibility

Date: 2026-10-30
Branch: `arena/0de22628-app`
Base: `mega/absorb-all` at `aeb992fa9b7bb1a8a7986823d470dbc13f270e24`

## Scope completed

1. Multi-commit and streamed Git-graph arrival tracking in `features/git/ui/graph/graph.tsx`: added `collectFreshGraphArrivals` and `useArrivingCommitHashes` to walk forward and reverse parent edges between the new head commit and previously known history, animating up to 12 contiguous newly arrived commits (including diamond merge batches while excluding unrelated or orphan branches), preserving pre-refresh baselines across streamed `initialLogs` + `appendLogs` batches (`pendingBaseline`), keeping `useArrivingCommitHash` compatible, and replacing `effectiveLogs[0]?.hash` with an explicit length check.
2. Root-slash containment and POSIX symlink resolution across `lib/chat/skill-paths.ts`, `lib/chat/discover-skills.ts`, and `tests/helpers/skill-fs.ts`: fixed `parent === "/"` and `baseKey === "/"` prefix handling (`"/"` instead of `"//"`) in `isInsideSkillPath`, `normalizeSkillPath`, `joinSkillPath`, `resolveSkillReadRoot`, and `resolveLinkTarget`, enforced leftmost path-prefix symlink substitution order up to 40 hops (`SYMLOOP_MAX`) in `serveSkillFs`, and tolerated broken or cyclic symlinks in `lsDir` (`is_dir: false` matching Rust `entry_is_dir`).
3. Touch pointer-capture release, document drag-out tracking, and synchronous `disabled` synchronization in `components/ui/hold-button.tsx`: released implicit pointer capture on both `event.target` and `event.currentTarget`, attached capture-phase `ownerDocument` `pointermove`, `pointerup`, and `pointercancel` listeners during active pointer presses (plus `onDragStart` cancellation) so touch drag-away cancels even when `pointerleave` never fires on the button, synchronized `disabledRef` and `onConfirmRef` in `useLayoutEffect`, and rechecked `isButtonDisabled()` before both synchronous and asynchronous confirmation transitions.
4. Accessible label and value composition across `features/settings/ui/shared/controls.tsx` and `features/settings/ui/sections/providers/inputs.tsx`: preserved selected-value announcement on `SettingSelect` when an explicit `aria-label` is supplied via a hidden label span combined with `valueId` in `aria-labelledby`, exported `useSettingRowLabels`, and wired `SettingRow` `titleId` and `descriptionId` onto `SettingMultiSelect` (`ExcludePatternsSelect`), `KeyInput`, and `TextInput`.

## Verification summary

- `npm run lint:strict`: passed with zero errors and zero warnings.
- `npm run typecheck`: passed across both app and test TypeScript configs.
- `npm run test`: all 258 Vitest suites (2,785 tests) passed.
- `npm run skills:verify` and `node scripts/ci/check-secrets.mjs`: passed.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test`: all 446 Rust unit tests passed with zero warnings.
- `npm run build:preview` and `E2E_STATIC=1 npx playwright test`: all 36 functional, `@audit`, `@smoke`, and `@visual` Playwright specs passed.
- Recorded and inspected animated GIFs and keyframe captures covering `hold-button`, `settings-controls`, and `git-graph`.
