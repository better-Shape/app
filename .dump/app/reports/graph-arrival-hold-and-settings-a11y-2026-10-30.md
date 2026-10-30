# Graph arrival lineage, HoldButton pointer capture, skill root paths, and settings accessibility

Date: 2026-10-30
Branch: `arena/0de22628-app`
Base: `mega/absorb-all` at `aeb992fa9b7bb1a8a7986823d470dbc13f270e24`

## Scope completed

1. `features/git/ui/graph/graph.tsx`: `collectFreshGraphArrivals` and `useArrivingCommitHashes` walk parent edges between the current head and known commits to mark up to 12 new commits, including diamond merges. `pendingBaseline` retains the pre-refresh baseline across streamed `initialLogs` and `appendLogs` chunks whenever any reachable fresh parent is still missing, so side-branch commits in streamed merge slices animate once appended. `hasArrivalContextShifted` clears active hashes when `cacheKey`, `HEAD`, or the top commit changes.
2. `lib/chat/skill-paths.ts`, `lib/chat/discover-skills.ts`, and `tests/helpers/skill-fs.ts`: `normalizeSkillPath` and `joinSkillPath` keep both `/` and Windows `X:/` drive roots intact while leaving bare `X:` drive-relative. `isInsideSkillPath`, `isKeyWithinBase`, and `resolveLinkTarget` guard trailing-slash boundaries on root prefixes. `serveSkillFs` resolves symlinks left-to-right up to 40 hops (`SYMLOOP_MAX`) and returns `is_dir: false` for broken or cyclic links in `lsDir`.
3. `components/ui/hold-button.tsx`: pointer presses release implicit touch capture on both `event.target` and `event.currentTarget`, then watch capture-phase `ownerDocument` `pointermove`, `pointerup`, and `pointercancel` events plus `onDragStart` to cancel outside drags. `useLayoutEffect` updates `disabledRef` and `onConfirmRef` during commit, and `isButtonDisabled()` blocks both synchronous and async confirmations once disabled.
4. `features/settings/ui/shared/controls.tsx`, `features/settings/ui/sections/providers/inputs.tsx`, `features/settings/ui/sections/providers/provider-card.tsx`, and `features/settings/ui/sections/providers/providers-view.tsx`: `SettingSelect` pairs explicit `aria-label` text in a hidden span with `valueId` inside `aria-labelledby`. `SettingMultiSelect`, `KeyInput`, and `TextInput` read `SettingRow` `titleId` and `descriptionId`, `KeyInput` appends a hidden `API key` label when a row title omits `key`, `ProvidersSettingsView` and `ProviderCard` supply provider-scoped `aria-label` strings, and `ExcludePatternsSelect` keeps custom comma-separated globs when presets change.

## Verification summary

Verified at commit `da6ab57253f6654237db91ef9ae819ce852821ac` and re-checked on the PR #57 branch tip.

- `npm run lint:strict`: 0 errors, 0 warnings.
- `npm run typecheck`: passed for both app and test TypeScript configs.
- `npm run test`: 258 Vitest suites (2,789 tests) passed.
- `npm run skills:verify` and `node scripts/ci/check-secrets.mjs`: 53/53 skills verified, 0 secret hits.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test`: 446 Rust unit tests passed, 0 warnings.
- `npm run build:preview` and `E2E_STATIC=1 npx playwright test`: 36 Playwright specs passed.
- Visual captures inspected locally under gitignored `.qa-artifacts/followup/` (`hold-button.gif`, `settings-controls.gif`, `git-graph.gif`; ignored via `/.qa-artifacts/` in `.gitignore`).
