# Browser Preview post-base audit, 2026-10-14

Scope: PR #4 (`arena/b0d84ccc-app` vs `draft/mega-absorb-all`) after the base
moved from `764f135` to `0994615`. Review protocol: `FULL-REVIEW.md` Part I,
evidence levels E0 to E5.

## Mistakes recorded

1. Edit-tool phantom edits. `edit_file` reported success while nothing
   changed, and one CodeAnt-round edit mangled `lib/preview/tauri-mock.ts`
   (505 lines became 508 with an orphaned fragment). Root cause: trusting
   the tool response instead of the file. Corrected behaviour: grep the
   edited lines after every edit, and for multi-line or stubborn edits use
   python with replacement-count assertions. Smoke-test runtime behaviour;
   `node --check` alone missed a bad edit once.

2. Routine fetches missed base movement. The local remote-tracking ref for
   `draft/mega-absorb-all` stayed stale because the checkout fetchspec only
   tracks `main` and `arena/b0d84ccc-app*`. A plain `git fetch origin` did
   not update it, so the base looked frozen while it had moved 17 commits.
   Root cause: trusting one fetch command. Corrected behaviour: fetch the
   base with an explicit refspec and cross-check against the GitHub branch
   API before planning work against a base.

3. Playwright server reuse assumptions. Two consecutive runs blocked each
   other when an externally started server already held port 48921:
   `reuseExistingServer` deliberately refuses reuse in static mode, because
   an unmocked page must never be served to the suite. Root cause: starting
   a server manually and expecting the config to adopt it. Corrected
   behaviour: let Playwright spawn the server, or stop the manual one
   before running the suite.

## Audit conclusions that still hold

- `shouldMockEvents` stays unset in the preview mock. The installed
  `@tauri-apps/api` 2.11.0 source intercepts `plugin:event|*` invokes only
  when that flag is set, and it installs `runCallback` unconditionally.
  Enabling it would hand the mock handler id back and break the tracked
  listener registry. Verified in `node_modules/@tauri-apps/api/mocks.js`
  and `event.js` (`listen` invokes `plugin:event|listen` and returns the
  id `unlisten` sends back as `eventId`).
- The trusted deployer stays a `workflow_run` subscriber in
  `.github/workflows/preview-deploy.yml`. GitHub resolves subscribers from
  the default branch, so the file activates only after it lands there.
  `preview.yml` stays secretless. This is the CodeAnt P1 root-cause fix,
  not a temporary shape.
- Screenshot baselines stay current. A full local run of 25 tests passed
  on Linux/Chromium after the base update, including the three `@visual`
  baselines against `dev:browser`.
- The a11y baseline gate in `e2e/helpers/audit.ts` fails only on new or
  increased critical/serious axe violations. Lower the counts in
  `e2e/a11y-baseline.json` as violations are fixed. Never raise them
  silently.

## Known blockers that are not code

- SonarCloud's remaining failure on this PR is the
  `preview-deploy.yml` fork-execution security hotspot. It needs a human
  review marked "Safe" in the SonarCloud UI. No code change can clear it.
- CodeRabbit answers "Review rate limited" on this repository. CodeAnt's
  approval agent reported `context_truncated` on head `74012b7` and
  approved nothing; it self-describes as shadow/advisory. Re-tag after
  every push, per `AGENTS.md`.

## Addendum, 2026-10-15

- The sandbox working tree was found reset to the branch cut point
  (`764f135`) with the pre-merge file state as uncommitted changes,
  while the remote branch already held the merged and audited head
  (`532f182`). Evidence: `git log origin/arena/b0d84ccc-app` showed
  `4d56402`, `252bd64`, `532f182`; local `HEAD` showed only `764f135`.
  Recovery: stashed the stale snapshot as `arena-snapshot-backup-pre-resync`
  and reset the tree to the remote head. No work was lost. The stash
  tracked files differ from the new head only where the base merge
  superseded them (`AGENTS.md`, `eslint.config.mjs`, `package.json`,
  search index), and the untracked snapshot files are earlier versions
  of files the later commits extended.
- The base moved again after the merge, to `f1a43d6` (review policy
  tightening plus `.agents/PREFLIGHT.md`). Merged as `0e6b590` with no
  conflicts. The branch commit also records that the plain
  `git fetch origin` had silently kept the local base ref stale, so
  future base checks fetch the base refspec explicitly and cross-check
  the branch API.

## Principles audit, 2026-10-15 (second base move)

A self-review pass against `REVIEW.md` and `FULL-REVIEW.md` Part I ran
on head `16fe0c1` (after merging the base at `f1a43d6`). The evidence
ledger, all at E3 on the local head unless noted:

- Mock IPC contract (seeded project, plugin fallback, event delivery,
  git log paging): `tests/preview/tauri-mock.test.ts`, 15 of 15 pass.
- Whole-renderer regression surface: `npm run test`, 106 files and
  853 tests pass.
- Type and style gates: `npx tsc --noEmit` clean; full-repo
  `npm run lint` exit 0 with 157 warnings (baseline class, none from
  this change).
- Browser behaviour: `npm run build:preview` then the full Playwright
  suite in static mode, 25 of 25 pass including the three `@visual`
  baselines. Local sandbox only; CI runs the same suite without
  `@visual`.
- Skills: `npm run skills:verify`, 53 of 53 locked skills verified.
- Rust gates: not run locally, no Cargo toolchain in the sandbox. The
  change touches no path under `src-tauri/`; CI runs the Cargo jobs.

Two findings came out of the pass and were fixed before the next push,
under the rule that minor findings get fixed before bots post them:

1. Style drift against the writing rules in `AGENTS.md`: 48 added lines
   used em dashes, and 30 comments credited review bots by name
   (CodeAnt, Sourcery, Kilo). Comments must state the constraint, not
   the reviewer. Both classes were swept across the files this change
   owns; explanations were kept, attributions and em dashes removed.
2. Test names carried the same bot attributions
   (`describe("event delivery (CodeAnt)")` and similar). Renamed to
   plain behaviour names.

Checked and deliberately left alone:

- `preview-deploy.yml` runs deploy steps only in the trusted
  `workflow_run` context; PR code never executes there. Its substring
  rejection of `VERCEL_`/`DATABASE`/`TOKEN` variable names matches the
  Vercel CLI contract, so it is not the heuristic defect the review
  protocol warns about.
- The a11y gate in `e2e/helpers/audit.ts` fails only on new or
  increased critical/serious axe violations against
  `e2e/a11y-baseline.json`. That matches the baseline-ledger pattern,
  and the baseline moves in one direction only.
- The CI `test-e2e` job stays out of the `ci-success` gate. The job
  comment states the promotion condition: a few weeks of green history.
- SonarCloud still flags the fork-execution shape of
  `preview-deploy.yml` as a security hotspot. No code change resolves
  it, because the design is the fix: the workflow runs from the default
  branch, checks out no PR code, and re-stages a fixed static-only
  Build Output before deploying. A human must mark it Safe in the
  SonarCloud UI.

## Review wave on head 83ce964, 2026-10-15

The push of `83ce964` surfaced eight unresolved threads (six CodeAnt,
two CodeRabbit). Each was verified against the code before any fix:

1. `serve-static.mjs` containment was lexical only, so a symlink inside
   `out/` could serve a file outside the export. Verified real:
   `existsSync`/`statSync` follow symlinks. Fix: candidates are compared
   by `realpathSync` against the real export root. A planted symlink to
   `/tmp/secret.txt` inside `out/` now returns 404; normal routes still
   serve 200.
2. `createReadStream(file).pipe(res)` had no error handler, so a file
   deleted between stat and open would crash the server. Verified real.
   Fix: `stream.on("error", () => res.destroy())`.
3. Mock `delete_path`/`trash_path`/`rename_path`/`copy_path` returned
   success without touching the fake tree. Verified real. Fix: the four
   handlers now mutate `state.files`/`state.dirs` and the parent
   listings; delete closes an open tab whose file vanished (backend
   parity), rename retargets the open tab. Four contract tests added.
   First implementation had a self-inflicted bug: `removeTree` ran
   before the subtree snapshot, so renames moved nothing. Caught by
   reading the final order before running the tests, not by a failing
   test; the helper now snapshots, then deletes.
4. `preview-deploy.yml` could deploy an older run's artifact after the
   PR head advanced. Verified real in the resolve logic: a resolved PR
   was never compared with the run's head SHA. Fix: the resolver emits a
   `head-current` output and both the deploy and mark-stale jobs require
   it. The same gate also stops an old failed build from marking a newer
   preview stale.
5. Mock `git_log` dates were ISO strings. Verified real: Rust
   `GitLogEntry.date` is `commit.time().seconds().to_string()`
   (`src-tauri/src/commands/git/mod.rs:2602`), and the graph renders
   `parseInt(log.date) * 1000`. Preview commits would have rendered as
   1970 dates. Fix: emit Unix seconds as a string, with a contract test
   pinning the `^\d{10}$` shape.
6. Status bar split awareness. Verified true with a correction: Status
   renders in `features/agent/layout.tsx`, and `EditorSplitProvider`
   mounts only inside a file tab in `features/agent/workspace/index.tsx`,
   so the optional split hook is always null in Status and
   `pickStatusFile` always falls back to the backend active file. The
   base code called the throwing `useEditorSplit()` from the same
   position. Wiring split state into workbench chrome is a behaviour
   decision for the workbench owners and stays out of this change; the
   misleading comment in `status.tsx` now states the fallback plainly.
7. `.github/vercel-cli/package.json` described `preview.yml` as the CLI
   consumer. Verified real; now names `preview-deploy.yml`.
8. `docs/developing/ci-cd.mdx` credited `preview.yml` with deploying.
   Verified real; rewritten so `preview-deploy.yml` owns deployment, the
   sticky comment, and the default-branch activation note.

## Review wave on head 80f111d, 2026-10-15

Three CodeAnt threads, all verified real and fixed:

1. `mark-stale` in `preview-deploy.yml` keyed only on the PR build's
   conclusion, so a failed Vercel deploy after a green build left the
   previous live URL presented as current. The job now needs the deploy
   job as well and runs under `always()` when the build failed or
   `needs.deploy-preview.result == 'failure'`, while still requiring
   the `head-current` gate from the previous wave. A secrets-absent
   skipped deploy does not trigger it.
2. `playwright.config.ts` treated an existing bundled-Chromium file as
   usable. On a host without libnss3/libnspr4 the file exists but
   cannot start, so the fallback never engaged. `bundledChromiumUsable`
   now probes the binary with `--version` in a child process before
   accepting it.
3. The same fallback handed `@sparticuz/chromium`'s Amazon Linux binary
   to macOS or Windows when no bundled browser existed. `sandboxChromium`
   now returns no fallback off Linux, so Playwright reports the missing
   browser with its own actionable error.

Full local suite after these fixes: Playwright 25 of 25 including the
visual baselines, Vitest 857 of 857, `tsc` clean, ESLint 0 errors.

## Review wave on head c74a267, 2026-10-15

Four CodeAnt threads. Three were straightforwardly real (older-deploy
re-check window, IPC-quiet preceding the Git manager's 1.65s intro
mount, directory rename leaving descendant tabs behind), and the fourth
(smoke specs accepting any route shell) uncovered two facts the fix had
to respect:

- Smoke specs: each route now asserts its own shell. Writing the route
  map required reading `app/client-layout.tsx`: `/git` and `/branch`
  are secondary windows and render `#bettershape-settings`, not the
  workbench shell. The first run of the stricter map failed on exactly
  that assumption, which is the stricter test working as intended.
- Audit settle: the git routes moved into a project-seeded describe
  (the welcome seed leaves the Git manager on an empty state), and the
  audit waits for seeded content after IPC quiet before running axe.
  Scanning the populated Git UI then surfaced pre-existing violations
  the splash had hidden: `aria-toggle-field-name` on four staging
  checkboxes and one `target-size` node. The checkboxes are the shared
  `components/ui/checkmark.tsx` primitive rendered without an accessible
  name; it now takes a `label` prop defaulting to "Checkbox", and the
  Git source passes "Stage/Unstage <path>" and "Stage all in <title>".
  The remaining target-size node sits inside a 20px row affordance;
  enlarging it is a design decision, so `/git` records `target-size: 1`
  in `e2e/a11y-baseline.json` under the file's existing rule that a
  raise needs a reason in the PR.

## Review wave on head 44bf166, 2026-10-15

One CodeAnt thread: `existsSync`/`statSync` in `serve-static.mjs` could
throw uncaught if a file vanished between the two calls during a
rebuild. Verified real. The candidate loop now relies on
`realpathSync` inside the existing try/catch (a vanished candidate is
skipped), so the exists-then-stat window is gone rather than guarded.
Verified by serving the rebuilt export after the change: `/` and
`/git/` return 200, a missing asset returns 404.

## Review wave on head a56d310, 2026-10-15

Eleven unresolved threads: eight DeepSource (seven JS-D1001 plus a
complexity note on the edited `Checkmark` component), three CodeAnt.

- JS-D1001 stays wontfix under `AGENTS.md` (comments must explain, not
  decorate). One of the seven sits on `collectTimings` in
  `e2e/helpers/audit.ts`, which genuinely lacked the one-line comment
  its neighbours carry; that one line was added, the rest stand.
- The `Checkmark` complexity note (10) predates this change: the branch
  count comes from the tri-state rendering, and the edit adds one
  `aria-label` attribute with no new branch. Extracting subcomponents
  to satisfy the metric would churn a shared primitive for no behaviour
  gain; noted as wontfix with evidence.
- CodeAnt, `ChatRow` omits `label`: verified real. The sidebar chat
  selector now passes `Select <title>`, so screen readers announce the
  conversation, not a bare "Checkbox".
- CodeAnt, `afterAll` receives `WorkerInfo`: verified false by
  execution. Playwright passes `TestInfo` to `afterAll` (only
  `beforeAll`/`afterAll` worker fixtures differ), and the audit suite
  has produced `test-results/browser-audit.json` in every local run of
  this branch, which the hook writes.
- CodeAnt, the head re-check used `process.exit(0)`: verified real.
  Later steps gated only on secrets would still have run. The verdict
  is now a `stand-down` step output, and the download, stage, and
  deploy steps all require it to not be `true`.

## Review wave on head 2344506, 2026-10-15

Three CodeAnt threads, all verified real:

1. The optional Morph QA step could fail the deploy job after a
   successful deploy, skipping the preview-link comment and tripping
   the stale marker. It now runs with `continue-on-error: true`.
2. The stage-all checkbox label keyed on the section's `isAllStaged`
   prop while the handler (`handleToggleAllChanges`) acts on the global
   `changes` list, so with mixed staging the announced action and the
   performed action disagreed. The label now names the global action
   ("Stage all changes" / "Unstage all changes"), matching the handler.
   The underlying prop/handler impedance predates this PR; only the
   label introduced here was wrong.
3. The mock kept one `logStreamOffset` for all callers. The Rust
   backend keys streamers by `callerId` (`STREAMERS` map in
   `src-tauri/src/commands/git/mod.rs`), so the mock now keeps a
   per-caller offset map, deletes it on `git_log_stream_stop`, and a
   contract test covers interleaved streams. While in this code, the
   `git_branch_graph` fixture still emitted an ISO date; it now emits
   Unix seconds to match the same `GitLogEntry` contract fixed earlier.

## Loop status on head 6ea2724, 2026-10-15

After the third consecutive fix round, the thread audit reads 167 total,
0 unresolved, and the bare `@codeant-ai review` tag on `6ea2724` produced
no new threads after a full wait. SonarCloud lists exactly two open
issues on the PR: the known `preview-deploy.yml` fork-execution
security hotspot (human "Safe" marking in the SonarCloud UI, unchanged)
and one maintainability item, "refactor this function to not always
return the same value" on `pty_available_shells: () => []` in the mock.
That constant return is the contract: no PTY exists in a browser
preview, the handler must report an empty shell list, and the command
is deliberately modeled. Same wontfix class as the doc-comment metric.
CI workflow runs for this branch stop at `532f182` in the Actions list:
the Actions API itself works (external bots post statuses on every
push), so the gap is on the GitHub side and is recorded here rather
than guessed at. Local gates stand in for it: Vitest 859 of 859,
Playwright 25 of 25 including visuals, `tsc` clean, ESLint 0 errors.

## Ratings and gate remediation, 2026-10-15

The user rejected stopping while external gates still failed. State at
that point, measured rather than assumed:

- SonarCloud quality gate ERROR has exactly one failing condition,
  `new_security_rating` = 3 (C) against a threshold of A. The API
  (`api/issues/search?pullRequest=4`) shows two open issues total: the
  `githubactions:S7631` fork-execution item on `preview-deploy.yml`
  (type VULNERABILITY, the driver of the C rating) and the
  `typescript:S3516` constant-return item on `pty_available_shells`.
  `api/hotspots/search` returns zero hotspots.
- DeepSource JavaScript fails with 145 "introduced" issues. The run
  page itself carries a warning that the parent-branch baseline is
  inaccurate, and the visible catalogue is JS-D1001 doc comments plus
  the JS-R1005 complexity note on `Checkmark`. Documentation Coverage
  moved 3.4% to 10.5%. No letter grades appear anywhere on the run or
  repo pages; "grade" in DeepSource is the repo-level code health
  computed from roughly 10k pre-existing issues on `main`, which this
  PR cannot move. What this PR controls is its introduced-issue count.
- GitHub Actions has created no workflow runs for this branch since
  head `532f182` (22:20), although the same pushes produced CodeAnt,
  DeepSource, Sonar, and Socket results. Cause not identifiable from
  the API available here (actions permissions endpoints return 403
  for this token). Local gates substitute until CI runs again.

Actions taken in response:

1. `.deepsource.toml` added: declares test patterns and disables
   JS-D1001 for the JavaScript analyzer with the AGENTS.md rationale
   recorded in the file. Whether DeepSource honors branch-level config
   before the file lands on the default branch is verifiable only from
   the next run; the run result after this push decides.
2. Three new CodeAnt findings on head `9291d94` verified real and
   fixed: closed-PR acceptance in the deploy resolver (open PRs only),
   directory delete leaving descendant tabs behind, conversation
   messages leaking to unknown IDs. The message list is now a single
   `PREVIEW_MESSAGES` constant shared by both handlers so the two
   copies cannot drift.

Correction to the remediation note above: the shipped DeepSource
analyzer reference (fetched this session) documents
`analyzers.meta` options for JavaScript, so the `.deepsource.toml`
now uses them: `module_system = "es-modules"` for the .mjs parse
errors, and `skip_doc_coverage` for the internal construct classes
(arrows, function expressions, method definitions, class expressions)
where JS-D1001 would force boilerplate. Exported declarations keep
the documentation requirement. `eslint.config.mjs` also gained the
`// skipcq: JS-0833` first line its sibling scripts already carry.
The next DeepSource run on the pushed head arbitrates whether branch
config is honored before default-branch landing.


## Addendum 2026-10-15 (second wave on cdd0144): Sonar + DeepSource forensics

DeepSource run `49a50bdd` on `cdd0144` still failed JavaScript with
147 introduced, and the issue set was identical to the previous run,
including JS-D1001 on arrow functions and the five JS-0833 parse
messages. The branch `.deepsource.toml` therefore has no observable
effect on PR analysis: neither the earlier `[[analyzers.rules]]`
disable nor the documented `analyzers.meta` options changed a single
issue. Per the vendor reference (fetched this session), configuration
is dashboard-first (Settings > Code Review) and TOML can be disabled
under Settings > Preferences; PR runs also warn that the baseline is
inaccurate because the parent branch has no pull request of its own.
Conclusion: the JavaScript gate cannot be turned green from the PR
branch alone. The remaining introduced findings are JS-D1001 doc
boilerplate, which AGENTS.md forbids adding, plus one real
JS-R1005 complexity finding, fixed in code. The human-side action
that matches the repo rules is to deactivate JS-D1001 (or set the
documented skip classes) under Settings > Code Review.

SonarCloud: the two PR issues were reproduced and fixed in code.
`typescript:S3516` on `pty_available_shells` was a misread on my part:
Sonar's flows point at `handleEventEmit` (lib/preview/tauri-mock.ts),
whose two `return null` statements are the invariant returns. The
open-source SonarJS rule `sonarjs/no-invariant-returns` reproduces
the finding locally (one error at the same function) and passes after
collapsing `handleEventEmit` to a single return point. A shell-list
experiment built on the misreading was reverted; the mock behavior is
unchanged. `githubactions:S7631` flagged the `actions/checkout` step
in `preview-deploy.yml` (rule flow starts at the `workflow_run`
trigger). The secrets job no longer checks out anything: it fetches
`.github/vercel-cli/{package.json,package-lock.json}` from the
default branch through the contents API and runs `npm ci` from the
committed lockfile, so no checkout of any ref happens under
`workflow_run`.

Checkmark JS-R1005 (complexity 10): the tri-state comparisons were
collapsing into one component. `ariaChecked` ("mixed" for
indeterminate) and `isOn` (true or indeterminate) are now computed
once before render; rendering behavior is unchanged (the two status
icon branches are untouched).


Correction to the Sonar note above: the shipped analyzer
reference confirms the S3516 fix location precisely. The finding
flagged `handleEventEmit` in `lib/preview/tauri-mock.ts` (Sonar's two
flow locations are the two `return null` statements). The
`pty_available_shells` line in my earlier wave notes was the mock's
own handler, not the flagged function; the shell-platform experiment
built on that misreading was reverted before landing, and the mock
behavior is unchanged. The S3516 fix that landed collapses
`handleEventEmit` to a single return point, validated locally with
`sonarjs/no-invariant-returns` (zero findings on the patched file,
one on the baseline).

CI state after this wave, with hard evidence: the manual dispatch
attempt returned HTTP 403 "Resource not accessible by integration"
from GitHub, and the actions-permissions API returns 403 for this
token. No workflow run exists for any head after `532f182`. The
token cannot create runs; enabling Actions runs on new heads is a
repository-settings action for the human (Settings > Actions >
General).

One more wart on the DeepSource side: the run page for `d62d631`
still quotes the OLD `components/ui/checkmark.tsx` source (the
pre-refactor comparisons at lines 22-26), so that run analyzed a
cached tree or started before the push fully propagated. The
JS-R1005 verdict needs the next run to arbitrate.


State check on the DeepSource JavaScript gate after the Sonar fixes
landed (run `7d626cef` on `3f56d59`): still Failed, still 147
introduced, byte-identical issue list, including the JS-R1005 entry
quoting the pre-refactor Checkmark source. Two separate facts follow.
First, the run's quoted code for Checkmark predates commit `d62d631`,
so that run did not analyze the pushed tree for this file; the next
run arbitrates the complexity fix. Second, even a perfect JS-R1005
fix leaves about 146 JS-D1001 findings, all "documentation comment
not found" on functions in files this PR mostly did not touch
(`app/welcome-screen.tsx` and friends), surfaced because DeepSource
itself warns the baseline is inaccurate (the parent branch has no
pull request of its own). The branch `.deepsource.toml` changed
nothing across three runs and two documented config forms, which
matches the vendor reference fetched this session: configuration is
dashboard-first (Settings > Code Review) and TOML can be disabled
under Settings > Preferences. Making the JavaScript check green
therefore needs one human dashboard action (deactivate JS-D1001, or
set the documented skip classes for arrows, function expressions,
methods, and class expressions), because the in-repo alternative is
146 restating doc comments, which AGENTS.md forbids. That decision
belongs to the human; the PR keeps the config file so the intent is
recorded either way.


## Addendum 2026-10-15 (third wave): JS-0833 parse alerts and module type

The five JS-0833 "Parsing error" alerts (eslint.config.mjs and
scripts/qa/*.mjs) persisted unchanged across every run since
`.deepsource.toml` gained the documented `module_system` option,
which settles it: DeepSource does not apply branch TOML to PR
analysis (its reference documents dashboard-first configuration,
with TOML disable-able under Settings > Preferences). The repo-side
fix that does not depend on their settings: declare the package
ESM with `"type": "module"` in package.json, so their parser stops
defaulting the `.mjs` entry points to CommonJS. The codebase had no
CommonJS files to break (every config is .mjs or TypeScript), but
three latent `__dirname`/`require` uses were relying on CommonJS
treatment and were converted honestly: `e2e/audit.spec.ts` and
`playwright.config.ts` now derive `__dirname` from `import.meta.url`
(playwright.config.ts also builds `require` through
`createRequire`), and `vitest.config.ts` resolves the `@` alias the
same way. Full local gates after the change: tsc clean, Vitest 861
passed, Playwright 25/25, build:preview written, lint 0 errors.

Also closed this wave, each verified on the live run
`1a482d46` (head `f2fa938`): the three DeepSource majors in
`features/git/ui/source/source.tsx` (JS-0437 index key, JS-0331
inferred boolean, JS-0357 handleSync ordering) took the count
147 to 144, and the stronger Checkmark branch reduction took it
to 143 with JS-R1005 gone from the list. The remainder is JS-D1001
doc-comment boilerplate on code this PR mostly did not touch,
behind DeepSource's own inaccurate-baseline warning, plus the five
JS-0833 alerts above. Both clear only through the dashboard:
deactivate JS-D1001 (or set its documented skip classes) under
Settings > Code Review, and enable `.deepsource.toml` under
Settings > Preferences if the repo wants file-based config.


Correction to the addendum above: the run on `16d96c1`
(`69cad82e`) still lists the same five JS-0833 parse alerts, so
`"type": "module"` did not move DeepSource either. Their parser
evidently does not consult the package type or the `.mjs`
extension when choosing sourceType for these files; the knob that
controls it is the analyzer configuration the dashboard owns.
The ESM conversion work stays on its own merits (three latent
CommonJS assumptions were real and the suite passes on the
declared module system), but it is not the fix for these alerts.
Repo-side options are exhausted: branch TOML (two documented
forms), package type, and per-file skipcq all show zero effect
across six runs. The five alerts and the JS-D1001 bulk both clear
only in Settings > Code Review / Settings > Preferences.


Addendum 2026-10-15: five CodeAnt nitpicks pasted by the user, all
five verified against code and dependencies before any edit.
1) preview-deploy.yml mark-stale: the append-once guard
(`!existing.body.includes("Latest preview build")`) froze the first
failure note forever; the job now replaces the stale note (split on
the note prefix, keep the base comment, append the fresh note, skip
the write when unchanged).
2) e2e/audit.spec.ts: consoleErrors from e2e/fixtures.ts (benign
DevTools/Fast Refresh/favicon filtered, requestfailed included) were
report-only. The prior test-results/browser-audit.json shows 0
console and 0 page errors on all five routes, so the audit now asserts
consoleErrors empty next to the existing pageErrors assertion.
3) e2e/settings.spec.ts: getByText("Editor").first() matches the
inert group heading div in features/settings/ui/settings.tsx (group
labels render as plain divs; leaves render as buttons that set
activeLeafId and conditionally mount the panel). ProvidersSettingsView
contains SettingSwitch controls, so the switch-visible assertion
false-passed on a no-op click. The spec now clicks the leaf button
inside #bettershape-settings nav and asserts the Editor-only
#settings-editor-font section mounts. Verified three ways: HEAD
version passes (baseline), new version passes, negative control
(old selector with the new Editor-only assertion) fails.
4) lib/preview/tauri-mock.ts git_status returned full words
("modified"); the Rust backend src-tauri/src/commands/git/mod.rs
emits single letters ("A"/"M"/"D"/"R"/"C") and
features/git/ui/source/source.tsx keys colors off those letters and
renders the code itself. Mock now returns "M" entries, and
tests/preview asserts every seeded status is a single-letter code.
5) scripts/qa/serve-static.mjs ran realpathSync(root) before the
missing-out/index.html check, so a fresh checkout threw ENOENT
instead of the documented build instruction. The existence check now
runs first; verified by hiding out/ (prints the instruction, exit 1)
and restoring it.

Mistake recorded: the first settings patch (a python rewrite) split
the "a switch control toggles" test at the first closing of its body
and dropped the toggle assertions; caught by reading the diff before
running anything, restored from HEAD, suite re-run. The patch script
also carried a stray unrelated string replacement against
preview-deploy.yml from a clipboard mix-up; git showed the file
unmodified (the garbage target strings never matched), the workflow
change was then made deliberately and reviewed.

Verification on this wave: tsc clean, Vitest 861 passed / 106 files
(tests/preview 23/23 incl. the new status-code assertion), Playwright
full suite 25/25 (settings 3/3 new version, audit 5/5 with the new
console gate), eslint on touched files clean, serve-static negative
check above, workflow YAML parses.


## Addendum 2026-10-15 (fourth wave): DeepSource code remediation and the six CodeAnt majors

The user superseded the earlier JS-D1001 position and directed a full
code fix for the 143 JavaScript issues in DeepSource run `7b6bac82`.
The wave adds the missing documentation comments in the production
files the run lists, converts the remaining module-scope function
declarations in the split editor context to arrow functions, and
finishes the complexity decompositions in `source.tsx`,
`sections.tsx`, `split-context.tsx`, and `tauri-mock.ts`. Each
extraction keeps the original markup, handlers, condition order, and
props. The local Sonar probe (cognitive complexity 15, cyclomatic
complexity 10, JSX depth 5) is clean on every touched code and test
file, and a stricter JSX depth 4 probe is clean after extracting the
chat actions trigger in `sections.tsx`.

The six unresolved CodeAnt majors on `e24b2e1` are fixed in the same
tree. `e2e/helpers/audit.ts` now requests the WCAG 2.2 A and AA tag
sets, with the pinned axe-core limitation recorded next to the tag
list. `ChangeSection` renders change rows in windows of 400 with a
Show more control, so files past the first window stay reachable for
diff, stage, unstage, and discard. The no-changes Push button in
`CommitActionsRow` calls `handlePush`; `handleSync` keeps the Commit
and Sync paths. `preview-deploy.yml` prefers an open PR whose head
still matches the triggering commit when several open PRs share it,
and the sticky-comment step re-reads the PR head after the deploy and
stands down when it advanced. The preview mock returns the seeded
conversation and its current id only while the fake project is open,
including after `set_project_path` opens it in a welcome-seeded page;
three tests in `tests/preview/tauri-mock.test.ts` pin the welcome,
project, and transition states.

Mistake recorded: the `Source` decomposition changed the status
refresh callback to depend on the whole extracted args object. The
call site builds that object inline, so the callback identity changed
on every render, the mount effect re-ran after every render, and the
uncached `git_has_remote` and `git_log` commands looped at about one
pair per millisecond. The 8 second git cache in
`lib/backend/commands.ts` masked the other three refresh commands in
the invoke log. Root cause: a `useCallback` dependency on an inline
object is a dependency on every render, not on the values inside it.
Corrected understanding: extracted hooks must depend on the primitive
values the original callback listed. Behaviour change:
`useGitStatusRefresh` now destructures its args and depends on
`projectPath`, `scmRepoPath`, `repoKey`, `reposCount`,
`reposLoading`, the loading callbacks, the state setters, and the
repo-key ref, and it rebuilds the stale check from `repoKey` at call
time exactly as the pre-extraction callback did. The Playwright audit
caught the regression as an IPC-quiet timeout on `/git` and
`/branch`; both routes pass after the fix.

Verification on this wave: `npm ci` pass; `npm run lint` pass with 0
errors and 157 warnings; `npx tsc --noEmit` pass;
`npm run build:runtime` pass; full Vitest 864 passed in 106 files;
targeted shelf, chat-list, and preview mock tests 59 passed;
Playwright full suite 25 passed, including the audit crawl on `/git`
and `/branch`; `npm run build:preview` pass; serve-static checks pass
for `/`, `/settings/`, missing paths, encoded traversal, null bytes,
a symlink escape, and the missing `out/` instruction with exit 1;
`npm run skills:verify` pass with 53 of 53 locked skills verified.
`npm run test:rust` could not run in this sandbox because Cargo is
not installed; no Rust source changed.

## Fifth wave addendum: DeepSource 48 and Sonar reliability (2026-10-15)

DeepSource run bf6c29e2 on 665e931: 48 introduced JavaScript issues, down
from 143. Enumerated by exact-code dashboard queries: JS-R1005 x29,
JS-C1002 x2 (variable g, split-context 76 and 96), JS-0415 x2 (sections
445, source 1007), JS-D1001 x1 (playwright resolveChromium), JS-0833 x4
(scripts/qa .mjs files), JS-0357 x2 (ChangeRowMenu and promptSyncNow used
before defined), JS-W1041 x1 (checkCommitPreconditions boolean return),
JS-0045 x2 (consistent-return in two source effects). Five issues remain
unenumerated; the dashboard renders only ten issues per filtered view and
ignores offset parameters. SonarCloud gate ERROR comes from eight
typescript:S9383 floating promises in source.tsx (lines 346, 903, 910,
919, 931, 943, 955, 1711). Plan: reduce every flagged function to
cyclomatic complexity at most 5 by verbatim extraction, rename g, move
the two use-before-define declarations earlier, simplify the boolean
return, give both effects a single return point, mark the eight floating
promises with void, document resolveChromium, and rename the four QA
scripts from .mjs to .js so the DeepSource parser reads them as modules
under the package type field. Behaviour preservation is verified per file
with tsc, the threshold-5 probe, ESLint, and the test suites.

Correction recorded during the fifth wave: two scripted splices in
lib/preview/tauri-mock.ts used stale string indexes after an earlier
replacement changed the file length, which truncated remapActiveFile and
duplicated part of removePath. Root cause: reusing offsets computed
before a length-changing edit instead of recomputing them. Corrected
understanding: recompute every index against the current text before
each splice, and run tsc immediately after each scripted edit. Behaviour
change: none; both regions were restored verbatim and tsc, the
threshold-5 probe, and ESLint pass on the file.

Fifth wave verification note: in dev-server mode the Playwright audit
spec for /settings fails with a React hydration mismatch (title versus
data-native-title on a provider card button, mutated by
components/ui/suppress-native-tooltips.tsx). The identical failure
reproduces on the unmodified 665e931 head in dev mode, so this wave did
not introduce it; the same spec passes in E2E_STATIC=1 mode, which is
what the PR preview workflow runs. No behaviour change was made for it
in this wave.

Fifth wave verification on the working tree before commit: npx tsc
--noEmit pass; npm run lint 0 errors and 157 warnings (same warning
count as 665e931); threshold-5 cyclomatic and JSX-depth-4 probes clean
on split-context, sections, source, tauri-mock, playwright.config,
checkmark, welcome-screen, and status; doc-coverage probe zero
undocumented named functions on the same files; npm run build:runtime
and npm run build:preview pass; full Vitest 864 passed in 106 files;
Playwright 25 passed in E2E_STATIC=1 mode; serve-static smoke check
returns 200 for / under the renamed serve-static.js; npm run
skills:verify 53 of 53; npm ci pass. Cargo is unavailable in the
sandbox and no Rust source changed.

Correction recorded during the Sonar duplication fix: a scripted edit
removed `name,` lines by substring match across the whole of
features/git/ui/source/source.tsx instead of only inside the SourceBody
destructure, which dropped `hasRemote` from the runPostCommit call in
commitNow. Root cause: global substring replacement without a scoped
range. Corrected understanding: scope scripted replacements to an
explicit index range and re-run tsc plus ESLint immediately after.
Behaviour change: none; the line was restored, and tsc and ESLint pass.
The Sonar duplication fix itself shares prop types (PanelSyncHandlers,
MoreActionsHandlers, EmbeddedSourceBodyProps, SourceBodyProps) and
spreads props into EmbeddedSourceBody instead of repeating the lists.

## Mistake record: parallel same-file edits (2026-10-15, sixth wave)

What happened: several `edit_file` calls targeting the same files
(`lib/preview/tauri-mock.ts`, `scripts/qa/serve-static.cjs`,
`scripts/qa/run-qa.cjs`) were issued in one parallel batch. The calls raced:
some applied, some silently overwrote siblings, one left
`lib/preview/tauri-mock.ts` with a dangling `deleteDescendants` reference and
hundreds of TypeScript syntax errors, and `scripts/qa/run-qa.cjs` gained a
duplicated helper block.

Root cause: treating same-file edits as independent. They are read-modify-write
cycles on shared state; parallel calls read the same starting bytes.

Corrected understanding: edits to one file must be strictly sequential, and
the file state after each edit must be verified with a targeted grep or a
type/syntax check before the next edit lands.

Behaviour change: batch replacements on one file now go through a single
Python script with exact-count assertions (`count == 1` per replacement) or
one `edit_file` call followed by verification. Recovery evidence: file
restored with `git checkout HEAD -- lib/preview/tauri-mock.ts`, changes
reapplied via the asserted replacement script, `npx tsc --noEmit` clean and
`tests/preview/tauri-mock.test.ts` green afterwards.

## Sandbox recovery record: HEAD reset between turns (2026-10-15)

What happened: at the start of the follow-up session the local checkout had
HEAD at the branch point `764f135`, no `node_modules`, and no `/tmp` probe
scripts, while `origin/arena/b0d84ccc-app` still held the pushed head
`241412d`. All session work was present only as working-tree changes.

Root cause: the sandbox snapshot excludes `node_modules` and `/tmp`, and the
local branch pointer did not survive the restore. No pushed work was lost.

Recovery: `git fetch origin arena/b0d84ccc-app`, then
`git reset --mixed 241412d`, which restored HEAD and the index to the pushed
head while keeping the working tree. `git status` afterwards showed exactly
the five files edited for the CodeAnt nitpicks round, confirming the tree is
the pushed head plus that batch. Dependencies were reinstalled with
`npm ci`. Behaviour change: after any session restart, confirm
`git log --oneline -1` matches the last pushed head before editing.

## Completion check correction (2026-10-15)

What happened: after head `241412d` the loop was reported complete on the
strength of a green Sonar quality gate and zero unresolved review threads.
Both signals were real and both were insufficient. A CodeAnt nitpicks block
with five items was still open, and it lives in an issue comment, not in a
review thread, so the thread sweep never saw it. The Sonar quality gate was
OK while the issues API still held one OPEN BLOCKER (`typescript:S3516` in
`features/git/ui/source/source.tsx`). A CodeRabbit review requested later
then added five inline findings, four of them valid.

Corrected understanding: completion requires four separate checks, and no
one of them implies the others. The checks are the commit statuses, the
GraphQL unresolved-thread sweep, the CodeAnt issue-comment bodies
(nitpicks and PR Risk blocks), and the Sonar issues API with
`resolved=false`. Bot reviews that arrive after a push also reopen the
loop until their threads are answered.

Behaviour change: before any completion claim, fetch all four signals on
the current head and record each result. The fixes from this round are the
`RUN_URL` workflow_run link, audit JSON record-before-assert, the `R`
rename status color, `ensureStagedForAmend` returning `Promise<void>`, the
persistent unknown-command set in the preview mock, the dev-browser null
exit mapping, and the CodeRabbit set: dead `stand-down` output removal,
stage/unstage-all error reporting, per-section stage toggles, and the
unmount guard on `latestRepoKeyRef`.
