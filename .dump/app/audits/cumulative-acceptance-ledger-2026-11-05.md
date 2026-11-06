# Cumulative acceptance ledger

## Verdict

Not fully accepted. Working baseline is `2afbe550996c99a7c872910714baba3e5e540f1d`, PR 57 into `mega/absorb-all`. The user authorized reconciliation, analyzer investigation, completion of the research and adversarial audit, fixes and final verification. This ledger covers the requests retained in conversation context and repository records. It does not reconstruct unavailable verbatim messages.

## Acceptance criteria and evidence

Statuses distinguish implementation from verified acceptance. A historical report is not a fresh execution result. Passing tests do not establish subjective visual fidelity or native installed behavior.

| ID | Requirement | Evidence located | Status | Closure condition |
| --- | --- | --- | --- | --- |
| A01 | Comprehensive chat composer polish | `.dump/app/research/chat-ux-choreography-and-workbench-refinement-2026-10-24.md`; `features/chat/ui/composer/input.tsx`; composer tests | Historically implemented, current visual acceptance open | Exercise empty, multiline, long-token, attachment, provider setup, stop and failure states on current head |
| A02 | Scroll behavior and streamed content | Same report; `features/chat/ui/chat.tsx`; streaming and resilience tests | Historical implementation and regression coverage | Verify follow latch, user scroll, disclosure interaction and approval jump with live streamed fixtures |
| A03 | Loader/header/motion fidelity | `engineering/motion-design.md`, motion reports and shared tokens | Not yet reconciled against every requested state | Inspect current animation recordings, reduced-motion and keyboard behavior |
| A04 | Preserve animated logo and minimal empty stage | Composer and shell implementations; earlier chat report | Source trace incomplete | Inspect welcome and empty project stages in rendered app, including reduced motion |
| A05 | Restore rotating hints | `RotatingComposerHint` in `features/chat/ui/composer/input-controls.tsx`; use in `input.tsx` | Implementation located | Verify interval, resets, unconfigured-provider state and preference changes at runtime |
| A06 | Accessible configuration actions | `Open Providers` named control; settings labeling report; current-head browser CI | Implemented with scoped automated evidence | Review keyboard access and focus return in current visual campaign |
| A07 | 150+ research sources | `.dump/app/research/workbench-accessibility-and-bidi-research-2026-11-05.md` records 165 sources read on 2026-11-05 and 2026-11-06 (standards, APG, MDN, axe-core, library sources, analyzer docs, 55 upstream issues), each with what it settles; `engineering/motion-research-sources.md` keeps the 72 motion sources | Met for this scope | Every link in the new ledger resolved through the GitHub API on 2026-11-05; package sources name the installed version |
| A08 | 240+ adversarial/upstream scenarios | Current head: 249 scenarios (212 adversarial, 37 reproductions of 55 upstream issues), then a panel-state sweep of every workbench tab kind, the terminal dock, 20 settings sections, the command palette and Git diff states; see the sections below | Run on current head, defects fixed and locked | Harness output stays outside Git; the locks are the specs and tests named below |
| A09 | Graph arrival and commit interaction bug-class fixes | `.dump/app/reports/graph-arrival-hold-and-settings-a11y-2026-10-30.md`; graph and commit-row tests | Implemented, current CI green | Include behavior and keyboard/menu boundary checks in final audit |
| A10 | Safe destructive hold interactions | `components/ui/hold-button.tsx`; 20 focused tests; current-head full CI | Implemented, automated verification present | Preserve pointer cancellation, async exclusion, release suppression, disabled transitions and accessible fallback in final review |
| A11 | Root-safe skill discovery and path handling | Shared `lib/path/verbatim.ts`, discovery/path tests and graph report | Implemented, automated verification present | Review Windows verbatim joins, POSIX double slash, symlink confinement and storage-failure coverage |
| A12 | Fix reviews and conflicts | Prior inspection: 41/41 inline threads resolved; PR mergeable at 2afbe550 | Verified at baseline | Recheck after final changes; do not treat an old bot summary as a fresh approval |
| A13 | Correct supported macOS runners | `macos-runner-selection-2026-11-05.md`; CI 42025351513; installers 42025351348 | Verified at baseline | macOS static checks and arm64/x64 artifacts passed; pinning is not a capacity guarantee |
| A14 | All platform installers | Run 42025351348 uploaded all six native platform/architecture artifacts | Build verification complete at baseline | Installed smoke tests still separate; do not equate an artifact with a successful native install |
| A15 | Zero Sonar issues/duplication and clean DeepScan | SonarCloud comment 6657737888 reports zero new issues, zero accepted issues, zero security hotspots and 0.0% new-code duplication; DeepScan status green | Verified for new-code metrics at baseline, not whole-project zero issues | Recheck measures on final code revision |
| A16 | DeepSource A and valid findings addressed | JavaScript run 42caf930-9226-49cd-9dbc-af4af5b7a033 failed with 573 introduced issues and baseline warning | Not satisfied | Complete issue inventory, effective configuration verification and adjudication; dashboard grade not yet verified |
| A17 | Repository protocols, full review and local checks before push | Final tree: `npm run test` 308 files / 3,130 tests, `typecheck` and `lint:strict` clean, `build:preview` and the full static Playwright suite 64/64, `cargo fmt --check` clean | Local gates run; clippy and cargo test not rerun | `cargo metadata --locked` resolved the current lockfile offline from the vendored crates, then an environment restore removed the toolchain. No Rust changed since `2afbe550`, where CI passed `Rust Lints (fmt, clippy)` and `Test Rust (Cargo)` |
| A18 | Plain-language reporting, descriptive names, no unauthorized merge | Current branch remains arena/0de22628-app, PR open | Ongoing constraint | Keep names domain-specific, report limitations and leave merge to explicit authorization |

## DeepSource investigation

Evidence obtained November 5, 2026:

1. The public run reports 573 introduced issues and 330 resolved. It warns that the parent branch has no PR and baseline analysis may be inaccurate. Neither count proves issue validity.
2. Visible occurrence examples include JS-D1001 on `isUncDisplayPath`, `isPosixDisplayPath`, display-parent helpers, `RecentProjectRow` and HoldButton helpers; JS-C1003 on the React namespace import; JS-0333 on `HoldConfirmResult`.
3. `.deepsource.toml` on this branch and `mega/absorb-all` already includes `arrow-function-expression` in `skip_doc_coverage`. The documented value is valid. Missing documentation for these arrow functions is inconsistent with the checked-in intended configuration.
4. GitHub repository metadata names `main` as default branch. Contents API returns 404 for `.deepsource.toml` on `main`, while the base branch has blob `51e0b04b308adac312ab31f9bdaf9bf245e237ca`.
5. DeepSource documents default-branch configuration activation and dashboard-managed configuration. Whether TOML is enabled and which effective settings the run used cannot be established through the public report.
6. The public rendered report exposes only a small subset of the 573 occurrences. No complete authenticated export has been obtained. Do not mark the unseen occurrences adjudicated.

Primary references:

- https://docs.deepsource.com/docs/platform/getting-started/configure-analyzers
- https://docs.deepsource.com/docs/platform/reference/core-analyzers
- https://deepsource.com/directory/javascript/issues/JS-D1001
- https://app.deepsource.com/gh/better-Shape/app/run/42caf930-9226-49cd-9dbc-af4af5b7a033/javascript/

Do not change the PR base to main, push to main, disable the analyzer, add blanket suppressions or pad functions with comments. Verify effective configuration and obtain the complete issue list first. Configuration ownership and baseline accuracy are separate from whether any particular code finding is valid.

## Execution plan

1. Reconcile the source/research and scenario records, preserving provenance and historical limits.
2. Verify effective DeepSource settings and obtain a full issue inventory. Triage against current code and diff ancestry, not just rule titles.
3. Build the reproducible current-head adversarial scenario manifest and upstream-source mapping. Load the design/skill set before UI review or edits.
4. Execute Chromium scenarios, inspect screenshots and recordings, and fix confirmed root causes with permanent regression coverage.
5. Run the final local verification gate, then push once the scoped fix batch is complete. Monitor current-head CI and reviews.
6. Re-evaluate each acceptance row. No overall completion claim while a required row remains open.

No new product feature, architecture change, native support claim or merge is authorized by this plan.

## Current-head browser baseline

The pinned vendor payload was downloaded and SHA-verified. `npm run build:preview` completed successfully. A fresh static Chromium run produced 37 expected tests, zero unexpected tests, zero flaky tests and no global errors in `test-results/results.json`. The tool invocation nevertheless returned exit code 1 with no failing-test diagnostic in its log. Do not describe the overall command as an unconditional successful gate until the exit discrepancy is understood.

The route audit is not zero-defect despite all test assertions passing. Its existing `e2e/a11y-baseline.json` explicitly permits four serious target-size nodes on `/` and one on `/git`. The fresh audit reproduced exactly those allowances:

- `/`: Search, New chat, and two Radix controls require target-size investigation.
- `/git`: one `.size-7` control requires target-size investigation.
- `/settings`, `/popout`, `/branch`: no serious/critical axe violations in these default-route runs.
- All five routes: no recorded page errors, console errors or unknown IPC commands.

These are real audit findings to investigate, not evidence that every control is inaccessible. Identify stable control names, measure spacing and targets, and fix the shared sizing cause before lowering baseline allowances. Do not raise baseline counts or conflate this 37-test run with the required 240+ campaign.

The full DeepSource inventory request was delegated through PR comment 6658797465. Kilo replied in comment 6658798900 that its AI service returned Not Found. No inventory or effective-settings evidence came back. This path is currently blocked; retain the need for an authenticated export and settings verification rather than assume unseen findings are resolved.

Historical scope reconciliation also inspected PR 53's body. It records 265 cases and two 30fps GIFs but explicitly says the GIFs remained untracked because binary attachment upload was unavailable. That explains absent artifacts; it does not verify them on the current head.

## Target-size remediation

Current local change, based on `2afbe550`:

- Measured the exact five controls with axe before editing. Search, Filter, Sessions actions and New chat in the session header, plus Generate commit message in Git, rendered at 22.75 CSS pixels. Their spacing also failed the exception. The root cause was rem sizing against the app's 13px root, not missing labels.
- Added `--target-size-min: 24px` and its Tailwind spacing mapping in `app/globals.css`. Applied minimum width/height at shared session-header implementations and `GenerateStarButton`, retaining existing glyph sizes, colors and rem growth. No global button resize or invisible overlapping hit-area workaround.
- Updated DESIGN.md and the design-system baseline to state the pixel floor. W3C primary reference: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html. Its spacing exception was evaluated, not assumed.
- Added `e2e/toolbar-target-size.spec.ts` with six browser cases covering all five targets at 13px, 16px and 20px root sizes.
- Removed the four-plus-one target-size baseline allowances only after an independent axe probe returned zero occurrences on both affected routes.
- Full static browser suite passed with exit code 0: 43 tests, including the existing visual snapshots. Route audit has zero serious/critical axe violations, no page/console errors and no unknown IPC on all five routes. This fresh run removes the earlier baseline-run exit ambiguity for the current local tree, without retroactively changing that earlier result.
- Full npm test passed: runtime build, 300 suites and 3,103 tests. Strict lint, app/test typecheck and 53/53 locked skills passed. Rust was not rerun in this batch; no native code or native command changed.
- Direct screenshot inspection of audit-welcome.png and audit-git.png confirmed unclipped toolbars, unchanged glyph scale and preserved desktop hierarchy. These images are generated under ignored test-results and are not committed. The larger current-head 240+ campaign and motion capture remain open.

Skills applied: existing design baseline, antislop core/UI/human, impeccable craft floor, design-taste preflight, ui-ux-pro-max accessibility priorities and unslop. Repository direction takes priority over generic 44px mobile guidance; this change addresses the measured WCAG 24px minimum in dense desktop chrome. No skill launcher, image generation, package addition or design replacement was used.

This batch is local and unpushed. Overall acceptance remains open. Do not convert scoped zero serious/critical default-route axe results into a claim of complete accessibility, native-platform acceptance or all-scenario coverage.

## DeepSource reconciliation

- Run `42caf930-9226-49cd-9dbc-af4af5b7a033` on `2afbe550` lists 573 introduced issues: 228 documentation, 330 anti-pattern, 11 bug-risk, 4 style, 0 performance (category filters on the run page; per-issue pagination needs a DeepSource login).
- Root cause: GitHub's default branch `main` (`60d5bc74`) shares no history with the PR base `mega/absorb-all` (`7beb8c35`, 876 commits ahead). DeepSource docs (Settings > General > Default branch) say that branch is the baseline for pull request diffing, so whole files appear as new. Of 16 sampled issues, 15 already existed in the base. The repository's `.deepsource.toml` (arrow-helper doc exemption, test patterns, default complexity threshold `high`) is not applied: exempted arrow helpers and CC-6 functions are reported.
- A local ESLint parity scan (`complexity` 5, `no-invalid-void-type`, namespace imports, `require-await`, `no-array-index-key`, `no-duplicate-imports`, doc-comment rule) reproduced the style count exactly (4) and bug-risk closely (13 vs 11) in whole-file view. On lines this PR adds, it found 6 code findings and 136 doc findings on exempt constructs.
- Fixed: hold-button outcome type derived once (`HoldConfirmOutcome`), shared `resolveFieldLabelledBy` for switch and textarea labels, `referencedIds`/`referencedText` test helpers, merged duplicate imports in `graph.tsx` and `settings.tsx`, plugin action rows keyed by slug, non-throwing async mocks returned as `Promise.resolve`. Mutation check: inverting the label helper fails the two consumer tests.
- Skipped with reason: `async` mocks that throw (the rejection is load-bearing), separate `import type` blocks (repository convention), `serveSkillFs` complexity 8 (virtual filesystem test helper below the configured `high` threshold), doc comments on exempt internal arrow helpers (AGENTS.md forbids restating comments).
- Owner action needed: set DeepSource's default branch to `mega/absorb-all` (or align GitHub's default branch) and either enable `.deepsource.toml` or mirror it in the dashboard. DeepSource Rust and Secrets pass; DeepScan reports 0 new issues; Sonar reports 0 new issues and 0.0% new-code duplication; CodeAnt gates pass.

## Current-head visual stress campaign

- 249 scenarios (212 adversarial, 37 reproductions of 55 upstream issues), five viewports, three zoom levels, two root font sizes, reduced and full motion. Harness, fixtures, contact sheets, and results stay outside Git (`/tmp/qa-campaign`).
- First pass: 8 of 249 fully clean. Real defects fixed: six axe rules on the project-seeded workbench, three unmodeled IPC commands, right-to-left rendering, menu label contrast (4.36:1), task checkbox names, unfocusable wide-table scrollers, Git rows and session-row actions under the 24px target floor.
- Final pass: 196 of 249 fully clean, then 57 of 85 in the affected-group rerun with every remaining signal classified (third-party favicon requests blocked offline, intentional commit-message inline action, animated session-row reveal, transient Radix modal `aria-hidden`, viewports below native window minimums).
- Permanent locks: `workbench` audit route with an empty baseline and an unmodeled-IPC gate, `tests/ui/workbench-tab-close-semantics.test.tsx`, `tests/ui/bidi-and-list-semantics.test.tsx`, `tests/editor/editor-content-label.test.ts`, and the mock parity test.
- Upstream-issue sources (55) and the protocol notes are recorded in `engineering/visual-stress-and-upstream-issue-verification.md`.

## Regression audit of the batch and deeper fixes

Every change in the batch was re-read against current code, then probed in the browser beyond the
routes the crawl visits. Findings, each fixed with a test that fails when the fix is reverted:

| ID | Finding | Fix | Lock |
| --- | --- | --- | --- |
| F1 | Baseline rule 5 contradicted DESIGN.md | Rule aligned | Doc review |
| F2 | DESIGN.md surface rows named the wrong tokens | Rows corrected | Doc review |
| F3 | The smoke workbench case passed without a project open | Seeded-project describe | `e2e/smoke.spec.ts` |
| F4 | Plugin action rows keyed by slug collided on duplicate Composio slugs | `createOccurrenceKeyer` | `tests/settings/plugin-action-list-keys.test.tsx` |
| F5 | Right-to-left replies: inline code reordered, nested `dir="auto"` flipped lists, centred header cells, clipped markers, dropped `ol start`; headings 4 to 6 skipped the rule | Top-level blocks only carry `dir="auto"`, code is `dir="ltr"`, logical list padding, `start` passed, every heading level routed | `tests/ui/bidi-and-list-semantics.test.tsx`, `e2e/chat-reply-direction-and-tables.spec.ts` |
| F6 | Delete dropped focus to the page | Focus moves to the next tab, else the previous one | `tests/ui/workbench-tab-close-semantics.test.tsx`, `e2e/workbench-keyboard-focus.spec.ts` |
| F7 | The chat strip handed Enter and Space to drag-and-drop first | One shared key handler | Same unit file |
| F8 | The breadcrumb menubar role did not match what rendered | Predicate mirrors rendering | `tests/editor/breadcrumb-menubar-role.test.tsx` |
| F9 | Read-only diffs had no visible focus and split panes had no names | 2px inset ring, original and modified labels | `tests/editor/editor-content-label.test.ts`, `e2e/workbench-keyboard-focus.spec.ts` |
| C1 | Menu shortcut hints measured 4.35:1 | `text-secondary`, 5.46:1 | `tests/ui/menu-text-contrast.test.tsx` |
| C5 | The wide-table ring was clipped by its rounded frame | Inset outline | `e2e/chat-reply-direction-and-tables.spec.ts` |
| R1 | Regression from F9: focusable diff text made the All changes Stage and Restore actions (22.75px and 19.5px) fail target size | Both keep the 24px floor | `e2e/toolbar-target-size.spec.ts` |
| T1 | Terminal tabs had no tablist, nested a close button, and the New Terminal button had no name (1 critical, 2 serious, 1 serious target-size) | `TerminalStripTab` on the shared tab helpers, `role="tablist"`, named button | `tests/terminal/terminal-strip-tab-semantics.test.tsx`, `e2e/workbench-keyboard-focus.spec.ts` |
| G1 | The commit graph scroller was a listbox holding a list (critical), which also made six row targets fail | `role="group"` | `e2e/git.spec.ts` |
| N1 | 30 icon-only buttons had no name and 13 were named only by a `title` the app strips on hover and focus | `aria-label` matching the tooltip | `e2e/panel-state-accessibility.spec.ts` |
| P1 | The command palette delete button was nested in a `role="button"` row, and rows ignored Enter and Space | The row acts on the delete glyph; Enter and Space run the row; Delete stays in the context menu because it cannot be undone | `e2e/panel-state-accessibility.spec.ts` |
| S1 | The Legal links in Data Control settings were under the 24px floor | Floor applied | `e2e/panel-state-accessibility.spec.ts` |
| P2 | After P1 made palette rows run on Enter, a row focused with Tab still showed nothing: the global button reset removes its outline | A focused row takes the selection highlight that arrow keys and hover already use | `e2e/panel-state-accessibility.spec.ts` (fails without the fix: the focused row keeps the unselected classes) |
| K1 | Keyboard focus was invisible on most buttons: the shared `Button` turned its ring off, and a rule in `app/globals.css` outside any cascade layer removed the outline from every button (WCAG 2.4.7, baseline rule 4). The owner chose the app-wide fix | A base-layer rule draws a 2px `--accent-text` ring inside the edge of any keyboard-focused `button` or `[role="button"]`; `Button` sets no focus style of its own; controls that style their own focus keep it | `e2e/keyboard-focus-visibility.spec.ts`: Tab walks of the welcome screen, the workbench, settings and the Git window reach 14, 43, 158 and 28 buttons, all with an indicator. With the old rules the same walks report 14, 42, 131 and 27 buttons without one |
| D1 | Five dialogs that open without a trigger button (command palette, quick pick, New file prompt, attachment preview, shortcuts sheet) dropped focus to the page body on close, so the next Tab started at the window's Minimize button (WCAG 2.4.3). Radix returns focus to a `Dialog.Trigger`, and these have none. Found while recording the focus clips; the owner chose the shared fix for all five | `lib/ui/use-dialog-focus-return.ts` keeps a short history of focused elements and, as each dialog's `onCloseAutoFocus`, focuses the most recent one still on the page: the opener, the menu button when a menu item opened the dialog, or wherever the dialog's action sent focus | `e2e/dialog-focus-return.spec.ts` opens each dialog from a keyboard-focused control (shortcut, palette command, menu item, attachment) and checks that Escape returns focus with its ring; all five fail with the restore disabled. `tests/ui/dialog-focus-return.test.tsx` covers the opener, a removed menu item and a focus move by the dialog's action |

A full WCAG 2.x A and AA axe scan is now clean in every workbench tab kind, the terminal dock, all 20
settings sections, the command palette and the Git diff states, apart from the item below.

### Second review pass

All 52 modified and 15 new files were read again as a diff after the environment restore, against
the code each change calls. P2 is the only new defect; K1 followed from the delivery gate, and D1
turned up while recording the capture clips. Two notes from that pass:

- The commit graph's shortcuts listen on the window, so the role change does not alter them for
  sighted keyboard users. A screen reader that used to switch to focus mode on the listbox stays in
  browse mode on a group, where it reads the rows but takes letters such as H for its own
  navigation. The old listbox owned no options, so its navigation was silent anyway; the grid or
  treegrid model below is the real fix.
- Sortable tabs keep `aria-roledescription="sortable"` from the drag-and-drop library, so a screen
  reader says "sortable" where it would say "tab". Space still picks a tab up as the library's
  instructions say, so the description is accurate. It predates this batch and is left as is.
- The first full run on the final code failed the new right-to-left reply test once: it read the
  layout as soon as the table appeared, while the streamed reply was still revealing the table's
  last cell. It now waits for that cell (18 of 18 repeated runs pass). The tab-close test now reads
  focus with a retrying assertion instead of one read.

Gates on the final code: unit tests 308 files and 3,130 tests, both typecheck configurations,
`lint:strict` with no warnings, `build:runtime`, the static preview build, the full Playwright
suite, 64 of 64, and `skills:verify` (53 of 53 locked skills), with the browser tree from the vendor
branch (96 of 96 manifest entries verified).

## Motion capture

Three clips with the `ui-capture` skill against the branch's preview build, each under fifteen
seconds, artifacts in `.qa-artifacts/capture/` (ignored): `workbench-tab-keyboard-close`,
`all-changes-floating-actions`, `composer-right-to-left-input`. All three pass the mechanical checks
(motion, 30fps moving frames, captions on every frame). An environment restore later removed
`.qa-artifacts/`, so the clips are not retained. The inspect sheets and caption strips were read first: each frame matches its caption, the cursor lands on the control it acts on, the focus ring moves
to README.md and then Graph, and mixed Arabic and English text keeps reading order. The first composer
take typed into the middle of a word because the storyboard's second `type` step re-clicked the field;
the storyboard was fixed and re-captured. `ffmpeg` came from the `imageio-ffmpeg` wheel with a scratch
`ffprobe` stand-in; `gifsicle` and `tesseract` are not installable here, so GIFs are unoptimized and
the caption OCR check was skipped.

A second round after K1 and D1, on the final build, same tools: `keyboard-focus-ring`,
`palette-focus-and-return` and `terminal-tab-delete`. All three pass the mechanical checks; the
host captured 25.6, 20.8 and 24.7 frames a second, encoded at 30. Read frame by frame: Tab puts the
ring on Account, Hide sidebar, New Chat, Settings, Search and Filter; a mouse click on Copy message
focuses it with no ring, and the next Tab draws the ring on Restore to this checkpoint. In the
palette, Tab moves the selection highlight and the ring together down the rows, and Escape puts
focus and its ring back on Hide sidebar. In the terminal, Tab from the composer reaches the first
terminal tab, and each Delete closes the focused tab and moves focus to the next one. Two things
the clips show that are not app defects of this batch: the capture overlay draws its click ring
and ripple in the window's top-left corner instead of under the cursor (see Still open), and in a
narrow dock the newest terminal tab sits partly past the strip's right edge, because the strip
never scrolls the active tab into view; both predate the batch.

## Delivery gate

Run against this batch, per `engineering/design-skills.md`.

1. antislop Delivery Gate.
   - Block 1. R-02 PASS: no added string holds an em dash (grep of added lines, 0). R-03 PASS: the
     only layout change is the 24px floor, checked across the 249 scenarios and the panel sweep.
     R-17, R-18, R-23, R-24, R-28, R-36, R-38 PASS: no statistic, testimonial, asset, link, FAQ or
     claim added. R-25 PASS: menu hints and labels moved to `text-secondary` (5.46:1, unit test).
     R-26 PASS: every changed control acts, palette rows on Enter, Space and click, tab and terminal
     glyphs on click and Delete. R-27 PASS: no state removed. R-33 PASS: all changes are in source.
     R-34 N/A: dark only (DESIGN.md). R-35 PASS: build, the full browser suite, captures.
     R-37 PASS: the work follows DESIGN.md. R-32 PASS after K1: Tab, Enter and Escape reach and run
     every changed control, the focus walk finds no button without an indicator in the four
     windows it covers, and closing any of the five dialogs D1 covers returns focus with its ring. The first run of this gate failed R-32 for every shared and plain button;
     that failure led to K1.
   - Block 2 PASS: no gradient, icon, typeface, grid, arrow, badge, glass, shadow, glow, card,
     animation or illustration added.
   - Block 3 N/A: no new screen; the product's direction in DESIGN.md applies unchanged.
   - Block 4 PASS: the only new copy is accessible names, each taken from the control's tooltip or
     title, and the one visual decision, the focus ring, has a written reason (contrast and
     clipping). C-4 PASS: every surface the walk covers works without a mouse.
2. Baseline mirror check: rules 4, 5 and 6 of `engineering/design-system-baseline.md`. The rings use
   `--accent-text`, not `--focus`, because `--focus` is 2.87:1 on `--surface-2`; rule 4 and DESIGN.md
   now say so. Not taken: `aria-pressed` on the diff layout buttons, whose label already changes
   with the state, and a toggle must not do both.
3. unslop pass on copy: 41 new accessible names, no ellipsis character, no em dash. Nine are title
   case because they repeat existing title-case tooltips (listed below). "Close Panel", which has no
   tooltip, was corrected to "Close panel".
4. Motion check PASS: no new motion. The focused palette row reuses the row's existing colour
   transition on the shared tap tokens.
5. Accessibility pass PASS: every button shows keyboard focus, icon-only buttons are named, the
   ring measures 6.63:1 to 8.55:1 against the app's surfaces, and closing a dialog puts focus back.
6. Skill report: antislop (this gate), antislop-code (comments), ui-capture (clips), the motion and
   design-system documents. None refused.
7. Capture gate PASS: the second round of clips covers the focus ring, the palette highlight with
   its ring and focus return, and terminal tab Delete; each was watched frame by frame.

## Still open

- **Keyboard focus cannot leave the terminal with Tab.** The terminal (xterm) sends Tab and Shift+Tab to the shell, as terminals do, and Escape belongs to programs such as vim. Ctrl+J does not close the terminal from inside it either, because the shortcut skips text fields and the terminal's input is one. The only way out is the command palette (Ctrl+Shift+P) and its Toggle Terminal Panel command, and nothing tells the user. This predates the batch and needs a design choice: let Ctrl+J and the palette chord pass through the terminal, add VS Code's Ctrl+M switch that makes Tab move focus, or both, and say so in the terminal's accessible description (WCAG 2.1.2).
- **The capture overlay draws its click marks in the wrong place.** In `.agents/skills/ui-capture/scripts/overlay.js`, the press ring is positioned with an inline `transform: translate()`, and its pulse keyframes animate `transform: scale()`, which replaces the translation while the pulse plays; the ripple is never positioned at all. Both appear in the window's top-left corner. Positioning both with the separate `translate` property, which composes with `transform`, would fix it. The file predates this pull request, so it was left alone.
- **The older 1px focus rings are low contrast.** Controls that drew their own ring before K1 keep it, as agreed: `ring-border-focus`, `ring-border-focus-ring` and `ring-accent` draw `#3946ff`, which measures 2.29:1 to 2.95:1 on the app's surfaces, below the 3:1 WCAG 1.4.11 asks of a focus indicator. Pointing `--border-focus` and `--color-border-focus-ring` at `--accent-text` would fix them in one place, and would also recolour text field focus borders. Tabs differ too: workspace tabs draw a 2px `--accent-text` ring, while terminal and chat tabs keep the browser's default focus ring, which is visible but does not match.
- Ten toolbar tooltips use title case, such as "Fetch From All Remotes" and "Split Terminal", where DESIGN.md asks for sentence case. The new accessible names repeat them, so both should change together.
- Radix modal menus report `aria-hidden-focus` while open, because the page behind is hidden and focus is trapped. Library model, left alone.
- Closing the active tab activates the last tab, while focus goes to the next one, as the tabs pattern allows. Closing the active terminal moves focus into the terminal that becomes active, because activating a terminal focuses it. Both follow existing activation rules; changing them is a product decision.
- macOS has no Delete key on laptop keyboards. VS Code adds Cmd+Backspace for closing terminal tabs; adding a second close chord is a product decision.
- The commit graph's keyboard shortcuts would be better served by a grid or treegrid model for screen readers; the `group` role fixes validity now.
- Session-title fade truncation masks the right edge even for right-to-left titles.
- Link-chip favicons are fetched from DuckDuckGo and Google services, which discloses linked domains; a product decision, unchanged here.
- `cargo clippy` and `cargo test` were not rerun locally. The vendored crates resolve the current lockfile offline (`cargo metadata --locked`), but an environment restore removed the toolchain first. No native code changed in this batch; `cargo fmt --check` passed, and CI passed clippy and the Rust tests at `2afbe550`.
