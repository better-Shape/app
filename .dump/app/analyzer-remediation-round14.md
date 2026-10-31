# Analyzer remediation, round 14

Base: `aeb992fa` on `mega/absorb-all`. Source of findings: the CodeAnt JSON and
`security-audit-report.md` on `better-shape/security-audit-report-clean` (tip `100de4b7`),
which compile SonarCloud, CodeAnt, Socket.dev, DeepSource, DeepScan and Sourcery results
against `main` on 2026-10-15.

This record states what changed, what was already fixed, what is a false positive, what is an
accepted architectural risk, and what cannot be verified from the artifacts. It does not claim
that every reported row is a real defect or that every row is closed.

## Changed in this round

| Area | Change | Evidence |
| --- | --- | --- |
| Sonar S2245 | `features/chat/ui/quote-selection.tsx` uses `crypto.randomUUID()` with a counter fallback instead of `Math.random()` | `tests/features/quote-selection-dispatch.test.ts` asserts distinct ids |
| Sonar S7767 | `features/preview/lib/project-warm.ts`, `features/chat/lib/proposed-edits.ts`, `lib/agent-preview/store.ts` replace `| 0` with an int32 helper | `tests/features/proposed-edits-paths.test.ts` pins the existing hash values |
| Sonar S6848 | `features/git/ui/graph/commit-row.tsx` clickable row is a real `role="button"` with `tabIndex`, `aria-expanded` and Enter/Space handling; `features/chat/ui/prs/list.tsx` drops a JSX `onClickCapture` guard for a native capture listener in `close-sweep.ts` | `tests/git/commit-row-activation.test.tsx`, `tests/prs/close-sweep.test.tsx` |
| CodeAnt infra / workflow permissions | `.github/workflows/auto-merge.yml` gets top-level `contents: read`; the job keeps only `contents: write`, `pull-requests: write`, `checks: read` | file diff |
| CodeAnt CSS antipatterns | `app/globals.css` removes a duplicated drag-region selector trio and merges two `html` blocks | file diff |

## SonarCloud, 268 rows

The snapshot line numbers are from `main` on 2026-10-15 and no longer map to this tree. Each rule
was re-checked semantically at the current head.

| Rule | Rows | Disposition |
| --- | --- | --- |
| S8786 super-linear regex | 109 | 30 remain under a local `sonarjs/super-linear-regex` run; every one is an anchored, line-scoped pattern with no nested quantifier or ambiguous alternation. The other 79 rows no longer match. Classified false positive, no rewrite. |
| S6848 non-native interactive | 35 | Non-test scan found no clickable element without an interactive role. The two real cases (`commit-row.tsx`, `prs/list.tsx`) are fixed. Remaining rows are stale or already had a role. |
| S9383 floating promises | 28 | Typed `@typescript-eslint/no-floating-promises` over all flagged files: 0 findings. A planted `Promise.resolve(1);` produced the expected error, so the check has teeth. Addressed. |
| S2819 postMessage origin | 24 | 18 addressed. Six wildcard senders remain, all child-to-parent or parent-to-child across an opaque-origin (`"null"`) sandboxed frame: `runtime/entry.ts:123`, `features/preview/design/bridge.ts:74` and `:95`, `features/chat/ui/blocks/gallery.tsx:93`, `lib/agent-preview/sandbox.ts:66` and `:140`. Receivers validate `event.source`, and the design path validates origin with `acceptsDesignMessage`. Accepted architectural risk; the parent origin cannot be named from an opaque frame without injecting it. |
| S2245 `Math.random` | 12 | Addressed. The only remaining mention is a comment. |
| S7773 `Number.parseFloat` | 10 | Addressed; `image-edit-session.ts` uses `Number.parseFloat`. |
| S7637 actions pinned to SHA | 6 | Addressed; no `@vN` action refs remain. |
| S6324 control chars in regex | 5 | Addressed; none remain. |
| S6845 `tabIndex` on non-interactive | 5 | Scan leaves one `tabIndex={-1}` on a programmatic focus target in `questions.tsx`; benign. |
| S6505 `npm ci --ignore-scripts` | 4 | Addressed at every `npm ci`. |
| S4036 PATH fixed directories | 4 | Stale; the rule scan reports nothing and the release scripts do not set `PATH`. |
| S6852 tab role not focusable | 3 | Addressed or stale; no matching markup remains. |
| S7767 `| 0` | 3 | Fixed with an int32 helper, hash values preserved. |
| S9379 `autoFocus` | 3 | Addressed. |
| S3516 invariant return | 2 | Stale; `sonarjs/no-invariant-returns` reports nothing. |
| S4657 shorthand order | 2 | False positive. The remaining `border` after `border-radius` does not reset the radius. |
| S2871 sort without compare | 2 | Addressed; both sites have comparators. |
| S2137 missing React import | 2 | One renamed to `RouteError`; the other file is gone. |
| S3923 identical branches | 2 | Stale; `sonarjs/no-identical-conditions` reports nothing. |
| S6544 Promise in boolean condition | 2 | False positive; the values are booleans from `.some()` and an awaited helper. |
| S6853 label without control | 2 | Stale; the settings labels have `htmlFor`. |
| S1523 dynamic code execution | 1 | Accepted. `runtime/entry.ts` compiles user React with `new Function` inside a `sandbox="allow-scripts"` frame after `stripTauriIpc()`. There is no safe alternative that keeps the preview runtime working. |
| S8233 workflow write permission | 1 | Addressed; writes are job-level. |
| S6825 `aria-hidden` on focusable | 1 | Stale; no `aria-hidden` in the settings surface. |

## CodeAnt

- SAST 17: 16 addressed. The remaining item is the accepted `new Function` execution boundary.
  `rehypeRaw` is paired with `rehypeSanitize` in both markdown renderers, `search.tsx` routes
  hrefs through `safeHref()`, the CSP interpolation in `mentions.ts` is gone, and the wildcard
  senders outside the opaque-frame set are gone.
- Infrastructure 1: addressed by the workflow permission change.
- SCA 4: `sprintf-js` is absent. `braces 3.0.3` has no published fix and is dev-only through
  `eslint-config-next`. `glib 0.18.5` needs a gtk 0.20 / tauri upgrade. `rand 0.7.3` is a
  build-dependency of `selectors` through `kuchikiki`. All three are blocked upstream.
- Antipatterns 119: two duplicate-selector cases fixed. The rest are Tailwind v4 `@theme` /
  `@utility`, CSS Borders 4 `corner-shape`, stale empty blocks, or shorthand orderings that do
  not override anything. Style noise, not security.
- Docstrings absent 800: quality backlog, not changed.
- SBOM 58 non-permissive: licence policy (MPL-2.0, LGPL, OFL, EPL), not a code defect.

## Socket.dev, 76 alerts

62 resolved by the current lockfile versions, 6 packages are absent, 1 deprecation
(`eslint 9.39.2`), and 7 remain: four `brace-expansion 1.1.21` rows below Socket's listed 2.x
patched versions (1.1.21 is at or above every patched 1.x release, so the 2.x rows do not apply),
`braces 3.0.3` with no fix, `rand 0.7.3` and `glib 0.18.5` blocked upstream as above.

`npm audit` reports 16 moderate findings, all in the dev toolchain; `npm audit --omit=dev`
reports zero. A global `minimatch` override to 11.0.1 would break ESLint plugins that call
`require('minimatch')` as a function, so it was not applied.

## DeepSource, DeepScan, Sourcery

- DeepSource: the artifact contains 106 rule definitions and no occurrence rows, so the claimed
  10,230 occurrences cannot be enumerated. Spot checks still find `var` in the two injected
  preview scripts (deliberate ES5), `console.*` on error paths, and `dangerouslySetInnerHTML`
  only on trusted or sanitized content. Cannot be claimed closed.
- DeepScan: 108 findings, never retrievable (the report is an authenticated SPA). Not verifiable.
- Sourcery: no API or CLI output in the artifact. Not verifiable.

## Verification at this tree

- `npx tsc --noEmit`: clean.
- `npx tsc --noEmit -p tests/tsconfig.json`: clean.
- `npm run lint:strict`: clean.
- `npm run test`: 261 files, 2788 tests passed.
- `npm run skills:verify`: 53 of 53 locked skills verified.
- `cargo test --locked`: 446 passed. Run with `CARGO_INCREMENTAL=0` and `profile.*.package.app.debug=0`
  because the sandbox had under 2 GB free; the setting changes debug info only.
- `cargo fmt --check`: clean.
- `cargo clippy --all-targets --all-features`: not run. The attempt rebuilt the dependency graph
  for the `--all-features` set and hit `No space left on device`; the target directory was then
  cleared to recover the disk. CI remains the clippy evidence for this tree.
- `cargo audit` / `cargo deny`: not installed.
- `npm run qa`: not run this round. The `/settings` hydration-audit mismatch in `e2e/README.md`
  is pre-existing.
