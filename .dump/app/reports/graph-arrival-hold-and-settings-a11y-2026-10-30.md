# Graph arrival lineage, HoldButton pointer capture, skill root paths, and settings accessibility

Date: 2026-10-30
Branch: `arena/0de22628-app`
Base: `mega/absorb-all` at `aeb992fa9b7bb1a8a7986823d470dbc13f270e24`

## Scope completed

1. `features/git/ui/graph/graph.tsx`: `collectFreshGraphArrivals` and `useArrivingCommitHashes` resolve the `HEAD`-decorated commit across date-ordered `--all` slices and walk parent edges to known commits to mark up to 12 new commits, including diamond merges, while `combineActiveArrivals` caps overlapping active sets at 12 with the newest head first. `pendingBaseline` retains the pre-refresh baseline and records all confirmed fresh commits (including capped overflow beyond 12) across streamed `initialLogs` and `appendLogs` chunks and same-branch `HEAD` advances whenever any reachable fresh parent is still missing, so delayed side-branch commits animate once appended without replaying settled or overflow rows. `hasArrivalContextShifted` clears active hashes when `cacheKey` or `HEAD` ref changes or when `HEAD` resets to an already-known commit.
2. `lib/chat/skill-paths.ts`, `lib/chat/discover-skills.ts`, and `tests/helpers/skill-fs.ts`: `normalizeSkillPath` and `joinSkillPath` keep POSIX literal backslashes, `/`, and Windows `X:/` drive roots intact while leaving bare `X:` drive-relative. `isCaseInsensitiveSkillPath` treats Windows drives, backslash paths, and Windows-host `//server` UNC paths as case-insensitive while keeping POSIX `//...` paths case-sensitive, and `dismissedFiles`, `dismissDiscoveredFile`, and `restoreDismissedFiles` reconcile legacy mixed-case UNC storage keys. `isInsideSkillPath`, `isKeyWithinBase`, and `resolveLinkTarget` guard trailing-slash boundaries on root prefixes. `serveSkillFs` resolves symlinks left-to-right up to 40 hops (`SYMLOOP_MAX`) and returns `is_dir: false` for broken or cyclic links in `lsDir`.
3. `components/ui/hold-button.tsx`: pointer presses release implicit touch capture on both `event.target` and `event.currentTarget`, then watch capture-phase `ownerDocument` `pointermove`, `pointerup`, and `pointercancel` events plus `onDragStart` to cancel outside drags while suppressing synthetic clicks if a pointer returns inside before release. `useLayoutEffect` updates `disabledRef` and `onConfirmRef` during commit, `isButtonDisabled()` blocks both synchronous and asynchronous confirmations once disabled, and `invalidateInFlightConfirm()` bumps `confirmEpochRef` when `disabled` becomes `true` so an already in-flight async confirmation clears `pending`/`aria-busy` and ignores stale settlement even if re-enabled first.
4. `features/settings/ui/shared/controls.tsx`, `features/settings/ui/sections/providers/inputs.tsx`, `features/settings/ui/sections/providers/provider-card.tsx`, and `features/settings/ui/sections/providers/providers-view.tsx`: `SettingSelect` pairs explicit `aria-label` text in a hidden span with `valueId` inside `aria-labelledby`. `SettingMultiSelect`, `KeyInput`, and `TextInput` read `SettingRow` `titleId` and `descriptionId`, `KeyInput` appends a hidden `API key` label when a row title omits `key`, `ProvidersSettingsView` and `ProviderCard` supply provider-scoped `aria-label` strings, and `ExcludePatternsSelect` persists seen custom comma-separated globs in `localStorage` across preset changes, unmounts, and uncheck/re-check cycles.
5. `e2e/polish-interactions.spec.ts` and `e2e/workbench.spec.ts`: settings accessibility scans include `aria-toggle-field-name` for `role="switch"` controls, Commit menu keyboard selection waits for Radix menu focus and frame commits between `ArrowDown` presses, in-page `HoldButton` pointer dispatch waits for React `data-state` commits with non-zero touch geometry (`width: 4, height: 4`) and verifies `aria-busy` is unset and `git_discard_changes` is uninvoked, and `@dnd-kit` keyboard tab reordering waits for both `KeyboardSensor`'s macrotask listener registration and `Files`'s negative displacement (`setOver` commit) before dropping.

## Verification summary

Verified at commit `da6ab57253f6654237db91ef9ae819ce852821ac` and re-checked on the PR #57 branch tip.

- `npm run lint:strict`: 0 errors, 0 warnings.
- `npm run typecheck`: passed for both app and test TypeScript configs.
- `npm run test`: 258 Vitest suites (2,796 tests) passed.
- `npm run skills:verify` and `node scripts/ci/check-secrets.mjs`: 53/53 skills verified, 0 secret hits.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test`: 446 Rust unit tests passed, 0 warnings.
- `npm run build:preview` and `E2E_STATIC=1 npx playwright test`: 36 Playwright specs passed.
- Visual captures inspected locally under gitignored `.qa-artifacts/followup/` (`hold-button.gif`, `settings-controls.gif`, `git-graph.gif`; ignored via `/.qa-artifacts/` in `.gitignore`).
