# Full review: animated Windows installer sidebar

`FULL-REVIEW.md` Part I applied to the change that adds `src-tauri/installer/`
and wires it through `src-tauri/tauri.conf.json`. Base branch
`draft/mega-absorb-all` at `0d795b1d820b85f59f946ad8932859248aff4ab0`. The
reviewed head is the commit this file lands in; the pull request body carries the
exact head SHA. Platform facts cited here are recorded with their sources in
`.dump/app/research/windows-nsis-animated-sidebar-2026-10-17.md`.

## Verdict

**Status:** Ready
**Confidence:** Medium
**Mergeable:** Unknown, the base branch is an integration branch and a human owns the merge
**CI verification:** Pending at review time. `build-installers.yml`, `ci.yml`, `pr.yml`, `pr-policy.yml` and `security.yml` run on the pushed head and the pull request body records the outcome.

Confidence is Medium, not High, because the changed behaviour is Windows
installer UI and this review had no Windows host and no Wine. Everything below
the runtime line is E3 evidence: commands that completed on the reviewed tree.
Playback itself is E1 and E2 only.

## Change inventory

| Area | Changed contract | Risk | Required verification | Result |
| --- | --- | --- | --- | --- |
| `src-tauri/tauri.conf.json` | `bundle.windows.nsis` gains `sidebarImage` and `installerHooks`; packaging only, no CSP, capability, asset-scope or updater key changed | High | Config parse, path resolution by the bundler, compile of the generated script | Passed: `dunce::canonicalize` in `nsis/mod.rs:346-359` fails the bundle if either path is wrong, and the rendered template compiles |
| `src-tauri/installer/hooks.nsh` | Defines the two callbacks MUI's welcome page consumes; paints an animated GIF over the sidebar static and stops on leave | High | Compile against the real CLI template, structural tests, negative test for hook consumption | Passed: makensis exit 0 with the CLI 2.10.0 template; a bogus SHOW callback fails inside `mui.WelcomePre_*`, proving the page consumes the hook |
| `src-tauri/installer/plugins/x86-unicode/AnimGif.dll` | Third-party native code loaded into the installer process | High | Integrity pin, PE header, provenance, licence | Passed: sha256 pinned, PE machine `0x14c` and subsystem 2, provenance and verbatim notices in `AnimGif.LICENSE.txt` |
| `src-tauri/installer/sidebar.gif` | Frame source for AnimGif; 164x314, 100 frames, 100 ms, full-canvas descriptors, no transparency, loop forever | High | Byte-level parse of the container against the plug-in's decoder | Passed: `tests/release/installer-art.test.ts` parses every descriptor |
| `src-tauri/installer/sidebar.bmp` | `MUI_WELCOMEFINISHPAGE_BITMAP` for the welcome and finish pages | Medium | Dimensions, bit depth, loadability at compile time | Passed: 164x314, 24-bit, `BI_RGB`; MUI's `!pragma verifyloadimage` ran against this exact file during the compile check |
| `src-tauri/installer/README.md`, `AnimGif.LICENSE.txt` | Operational instructions and licence terms | Low | Claim check against the repository and upstream | Passed: every path, version and command re-checked; sandbox-only paths removed |
| `tests/release/installer-art.test.ts` | New suite protecting the assets and the hook structure | Medium | Mutation testing | Passed: four mutations each fail the suite |

Modules selected under section 3.3: binary and asset, documentation, and test.
Security ran at supply-chain depth for the DLL. Not applicable: Tauri command and
IPC, capability and CSP, Rust filesystem, subprocess and PTY, provider output,
persistence and keyring, React component, renderer state, dependency and
lockfile, workflow and release config, and vendored skill tree. Reason: the diff
touches no renderer, Rust, capability, workflow, lockfile or skill file, and adds
no dependency. Design modules are not applicable because the surface is Windows
installer chrome drawn by MUI, not the app's UI; `DESIGN.md` and
`engineering/design-system-baseline.md` were read anyway and the prose rules were
applied to the new documentation.

### Threat model for the vendored DLL

| Field | Content |
| --- | --- |
| Asset | The end user's machine during install. `installMode` is `currentUser`, so the installer runs with the invoking user's privileges |
| Attacker control | Anyone who can write `src-tauri/installer/plugins/x86-unicode/AnimGif.dll` in this repository, or a future maintainer swapping it for a different build |
| Trust boundary | Committed binary, to makensis, to `$PLUGINSDIR`, to `LoadLibrary` inside the installer when the welcome page shows |
| Required property | The bytes that ship are the bytes that were reviewed, and their origin is permissively licensed upstream source |
| Enforcement point | sha256 pin in `tests/release/installer-art.test.ts`, plus provenance and the verbatim copyright notices in `AnimGif.LICENSE.txt` |
| Test or evidence | The pin fails the suite on any byte change. Source read at `nsis-community/plugin-animgif` commit `e3b6084f`, and the binary is byte-identical to `nsis-dev/plugin-corpus` `tree/Plugins/x86-unicode/animgif.dll` |

Network: the hook adds no outbound call and no telemetry. The WebView2
bootstrapper download in the template is pre-existing and untouched.

## Findings

All four were found in this review pass and fixed on the branch before it was
pushed. They are recorded because the fix is part of the diff.

### [Medium] The page callback clobbered registers it did not own

**Location:** `src-tauri/installer/hooks.nsh`, `BetterShapeSidebarShow`
**Diff cause:** The new function wrote `$R0` to `$R3` for the child-window walk without saving them.
**Evidence:** MUI calls the SHOW callback with `Call` from inside its own welcome page function (`Welcome.nsh:162`), and NSIS has no callee-save convention. nsDialogs macros use the same register block, for example `__NSD_ControlCase` writes `$R3` to `$R9`.
**Reachable scenario:** Any install that reaches the welcome page. Whether it breaks depends on what the caller held in those registers, which is exactly why it cannot be left to chance.
**Impact:** Silent corruption of MUI or nsDialogs state on the welcome page, with no diagnostic.
**Required change:** Push the four registers on entry and pop them in reverse on the single exit label every path already reaches.
**Verification:** `tests/release/installer-art.test.ts` now asserts the push and pop sets balance in LIFO order and cover every register the body touches. Dropping one `Push` fails the suite. makensis still exits 0.

### [Low] The licence notice was transcribed loosely

**Location:** `src-tauri/installer/plugins/x86-unicode/AnimGif.LICENSE.txt`
**Diff cause:** The new file rewrote the two upstream copyright headers instead of copying them, normalising the copyright symbol to `(c)` and dropping the author's email address.
**Evidence:** `Contrib/AnimGif/animgif.cpp` and `Contrib/AnimGif/winimage.h` at commit `e3b6084f` both require that "the above copyright notice and this permission notice appear in all copies". The repository publishes no top-level `LICENSE`, so the per-file notices are the only terms.
**Reachable scenario:** Shipping the DLL inside a published installer.
**Impact:** Non-compliance with the redistribution condition of the only licence that covers the binary.
**Required change:** Reproduce both notices verbatim and state why they apply.
**Verification:** Diffed against the upstream files fetched from the GitHub contents API at the pinned commit.

### [Low] The hook tests restated the implementation

**Location:** `tests/release/installer-art.test.ts`
**Diff cause:** The new suite asserted literal source lines from `hooks.nsh`, such as one exact `SendMessage` string.
**Evidence:** `FULL-REVIEW.md` section 7.4 lists an expected value copied from the production source as an anti-pattern, and section 7.2 asks whether the expected value comes from an independent source.
**Reachable scenario:** Any future edit to the hook that preserves behaviour but rewords a line fails the suite, and any edit that breaks behaviour but keeps the wording passes it.
**Impact:** A test that generates noise on refactors and misses real regressions.
**Required change:** Assert structure instead: both callback defines name functions the file defines, `play` is in the show callback and `stop` in the leave callback, the register AnimGif targets is the register `FindWindow` wrote, the same register is cleared, the pushes and pops balance, and both asset paths are anchored to `${__FILEDIR__}`.
**Verification:** Four mutations were applied to `hooks.nsh` in turn and each failed the suite: drop a `Push`, retarget `/HWND` to a different register, rename the leave function, and make `!addplugindir` relative. The file was restored byte-identical afterwards.

### [Low] Committed documentation carried a sandbox path

**Location:** `src-tauri/installer/README.md`
**Diff cause:** The regeneration recipe redirected the source GIF to an absolute temporary path.
**Evidence:** `AGENTS.md` under Repo preferences: keep paths in repository docs repository-relative and do not write a sandbox or home-directory path into a committed file.
**Reachable scenario:** Anyone following the recipe on their own machine.
**Impact:** The instruction does not run as written outside this sandbox, and it leaks a path that means nothing to the reader.
**Required change:** Use a repository-relative scratch file and say to delete it, since at 5.4 MB it is above the `pr.yml` limit.
**Verification:** A recursive grep for absolute temporary, home and root prefixes over every changed file returns nothing.

## Missing test coverage

- Actual playback: no test can cover it here. The smallest real evidence is the
  Windows job in `build-installers.yml` compiling the installer, then a human
  running it and watching the welcome page animate for 10 s, the finish page show
  the static frame, Back and Next replay it, and Cancel leave nothing running.
- MUI version drift: nothing fails if a future Tauri CLI moves the hook include
  point or changes the welcome page image control. The compile in
  `build-installers.yml` is the guard, and `src-tauri/installer/README.md` names
  the three template facts to re-check on a CLI upgrade.

## Verification performed

| Check | Status | Evidence |
| --- | --- | --- |
| makensis compile of the generated installer | Passed | The CLI 2.10.0 `installer.nsi` rendered with the real config values, hook included by absolute path, exit 0, warnings identical to the pre-change baseline apart from an 8-line code offset shift |
| Hook is consumed by the welcome page | Passed | Replacing the SHOW callback name with an undefined function fails compilation inside `mui.WelcomePre_*` |
| Plug-in and asset resolution from a foreign working directory | Passed | A probe script in one directory including the hook from a second directory, compiled from a third, still packed `AnimGif.dll` and the GIF, which is the layout Tauri produces |
| Asset container structure | Passed | 9 tests in `tests/release/installer-art.test.ts` |
| Test validity | Passed | Four mutations, four failures, file restored byte-identical |
| Lint, typecheck, unit tests, skills | Passed | Recorded per command in the pull request body |
| Cargo tests, fmt, clippy | Passed | Recorded per command in the pull request body, with the sandbox flag AGENTS.md requires to be named |
| Runtime playback | Not run | No Windows host and no Wine in this environment |

## Correct behaviour confirmed

- The hook include point, the welcome page ordering and the uninstaller callbacks
  were read in the CLI 2.10.0 template rather than assumed: the include is at line
  29 inside `{{#if installer_hooks}}`, `MUI_PAGE_WELCOME` follows at line 145 with
  its own `PRE` callback, and the uninstaller's `SHOW` and `LEAVE` defines come
  later and cannot collide with symbols MUI already undefined.
- `${NSD_ClearImage}` expands to the same `SendMessage` the hook previously wrote
  by hand, and the compile log shows `__NSD_ClearImage` producing
  `SendMessage:($R2,0x0172,0,0)`.
- Clearing the image cannot collapse the control, so `GetClientRect` inside
  `play` still sees the real 164x314 slot and `/FIT=BOTH` scales correctly.
- `FindWindow` positional argument order and the empty-string to NULL conversion
  were read in the compiler and the exehead, so the child enumeration is the
  documented idiom and not a guess.
- Re-extracting the GIF over the same `$PLUGINSDIR` name after a previous
  playback cannot hit a sharing violation, because `LoadGIF` closes its handle on
  the success path and the only early return that leaks it is an invalid-signature
  branch this GIF cannot reach.
- Passive and silent installs never start the animation, because the template
  aborts the welcome page before SHOW.
- The 3.93 MB GIF is below the 5 MB committed-file limit in `pr.yml`, and no
  generated file (`public/preview/`, `src-tauri/runtime/`) was touched.

## Assumptions and unknowns

- That NSIS 3.11's `Welcome.nsh` matches the copy read here. It was fetched at tag
  `v311`, which is the release Tauri's toolset URL names, so this is close to
  verified, but the compile CI runs is the authority.
- That the animation looks right. Frame pacing, colour and the stretch to the DPI
  scaled slot are reasoned from the decoder source, not observed.
- That `TerminateThread` inside AnimGif's `stop` never races a GDI call badly. It
  is upstream behaviour this change does not alter and cannot fix from a hook.
- Whether a human wants a 3.9 MB asset in the repository for a 10 s animation. The
  size is a deliberate trade against the 5 MB CI limit and is stated in the pull
  request.

## Review round 1

Head `9cc6d23`. Sourcery filed 7 inline comments, DeepSource 7 inline comments
with an overall grade B and Reliability D, CodeAnt a passed quality gate plus 2
nitpicks and a medium risk rating, Kilo Code "no issues, merge", SonarCloud 0
new issues, CodeRabbit skipped because the base is not `main`, Buoy "no new
design drift". Everything below was answered on the follow-up commit.

### Fixed

- A truncated GIF killed the test worker instead of failing a test. Sourcery
  `4304143096` and CodeAnt nitpick 1 were right, and the real failure was worse
  than either described. `readSubBlocks` looped on `buffer[offset] !== 0`; past
  the end that reads `undefined`, `size` becomes `undefined`, `offset` becomes
  `NaN`, and `subarray(NaN, NaN)` allocates until the fork dies. Reproduced with
  a 31-byte fixture: vitest reports `Worker exited unexpectedly`, no test fails,
  and it prints its own warning that the run may contain false positives. Every
  read in the parser is now bounds-checked through `requireBytes`, and a test
  feeds it the truncated stream.
- A skipped extraction left a blank sidebar. Sourcery `4304143088` and
  `4304143091`. `File` offers abort, retry and ignore when it cannot create its
  target (`Source/exehead/exec.c:562-573`, ignore as the default button per
  `Source/script.cpp:5445-5449`, allowskipfiles on by default per
  `Source/build.cpp:196`). Ignore continued the install into a hook that had
  already detached MUI's bitmap, so the welcome page showed nothing at all. An
  `IfFileExists` guard on the staged path now bails to the register cleanup with
  MUI's bitmap still attached.
- `$PLUGINSDIR` was assumed live. Found while writing that guard. `$PLUGINSDIR`
  is empty until something creates it (`Source/build.cpp:3805-3846`), and a
  `File /oname=$PLUGINSDIR\...` against an empty variable falls back to
  `$OUTDIR` (`Source/exehead/exec.c:520-524`). It happens to be live on this
  page, because MUI's `mui.WelcomePage.GUIInit` calls `InitPluginsDir` before it
  stages its own bitmap (`Pages/Welcome.nsh:44-45`) and `nsDialogs::Create` runs
  before the show callback, so this was a latent dependency rather than a live
  bug. The hook now calls `InitPluginsDir` itself, which is the documented
  pattern, costs one comparison and a return once the directory exists, and
  saves `$0` and `$1` when it has to create it.
- Four hook tests were weaker than they read. Sourcery `4304143102`,
  `4304143104`, `4304143109` and CodeAnt nitpick 2. Callback slots are now
  resolved through their `!define` to the `Function` they name, so swapping SHOW
  and LEAVE fails, and a prefix-only target fails instead of passing because
  some longer name contains it. Instructions are matched against
  comment-stripped text, so a commented out `play` fails. New invariants: no
  `Return`, `Abort` or `Quit` in the show callback, the pops are its last
  instructions, every branch target is a label inside the function,
  `InitPluginsDir` precedes the first use of `$PLUGINSDIR`, and the guard tests
  the staged path and bails to the label the pops follow.
- `parseGif` was split. DeepSource `4304145552` reported cyclomatic complexity
  11. The extension and descriptor branches are now helpers over a cursor, which
  is also what made the bounds checks readable.

All eight changes were mutation-tested: dropping `InitPluginsDir`, dropping the
guard, swapping the callback targets, commenting out `play`, inserting an early
`Return`, naming a prefix-only target, pointing the guard at the wrong label,
and reverting `readSubBlocks` to the unchecked loop. Seven of the eight failed at
least one named test. The eighth failed nothing, which is the whole point of the
finding: reverting `readSubBlocks` takes the vitest worker down, so the run
reports `Worker exited unexpectedly` with `Tests (12)` and no failing test, plus
vitest's own warning that the run may contain false positives.

### Rejected, with evidence

- `AnimGif::stop` uses `TerminateThread`. Sourcery `4304143082` is right about
  the mechanism (`winimage.cpp:236-240`) and wrong that the hook can stop
  cooperatively and wait: the plug-in exports no cooperative stop, and the
  shipped GIF's loop count is 0, so the worker condition is literally
  `while true` (`winimage.cpp:130`). Not calling `stop` would leave that thread
  painting into a destroyed window for the rest of the process. Fixing the
  termination means forking and rebuilding the DLL, which trades a hash-pinned
  vendored binary for a standing build obligation. Recorded in
  `installer/README.md` as a maintainer decision.
- Top-level `function` declarations in the test file. DeepSource `4304145547`,
  `4304145555`, `4304145558`, `4304145559`, `4304145562`. The file is an ES
  module, so none of it reaches the global scope, and 28 of the 104 `.ts` files
  under `tests/` declare helper functions the same way. `npm run lint` reports 0
  errors on this file. Wrapping them in IIFEs would make it the only test in the
  repository written that way.
- `${BETTERSHAPE_SIDEBAR_GIF}` inside a string literal. DeepSource `4304145565`
  reads NSIS syntax as a broken JS template literal. The assertion that carried
  it is gone regardless: the tests expand the hook's own defines and match the
  path as a regular expression.
- A runtime playback check, which CodeAnt's medium risk rating asks for. It
  needs Windows or Wine and this sandbox has neither. Still open, still named in
  the pull request.

### Mistakes made while reviewing, not in the diff

- The mutation harness printed `PASS (mutation NOT caught)` for all eight
  mutations because it read `$?` after `out=$(timeout ... | tr -d '\r')`, which
  is the exit code of `tr`. The per-mutation summaries were right and the
  verdicts were inverted. AGENTS.md already states that a piped command reports
  the exit code of the pipe. The interesting case was re-run with the redirect
  outside the pipeline before any of it was believed.
- `npx prettier --write` rewrote 619 lines of the test file to 2-space indent
  and 80 columns. Prettier is not a dependency of this repository and has no
  config here, so `npx` fetched a fresh copy and applied its defaults. Reverted
  by rewriting the file in the repository's own style. Do not format anything in
  this repository with a tool that is not in `package.json`.
- The pull request body and the installer README both said
  `build-installers.yml` compiles the installer for this pull request. It did
  not run. No Actions run has started in this repository since
  `2026-10-14T22:20Z`, none for this branch, and `actions/permissions` returns
  403 with this token, so whether Actions is disabled or out of budget is a
  human question. Answered the same day: Actions had been disabled for the
  repository and was re-enabled, so the workflows ran on the follow-up commit.
  The lesson stands. A check run that never appears is not evidence that a gate
  passed, and the difference between "no run" and "no failure" has to be
  reported to a human rather than assumed away. The README now describes the evidence that exists, a local
  makensis build of the generated script, and the pull request body was
  corrected to match.

## Review round 2

Head `38ec6bc`. A human requested CodeRabbit, which AGENTS.md otherwise reserves
for substantially critical pull requests, so the classification stayed `No` and
the agent did not request it. CodeRabbit filed 2 inline comments, both minor,
both about prose that overstated what the evidence showed. Both were valid and
both were fixed.

- The mutation summary claimed every mutation failed a named test. It did not.
  Seven did, and the eighth killed the vitest worker with no failing test at
  all, which is the exact behaviour the finding it answered was about. The same
  overstatement had been copied into the pull request body and into the roll-up
  comment, so all three were corrected.
- The residual risks section said none of the three failure modes was reachable
  from a hook. The hook runs `File`, `AnimGif::play` and `AnimGif::stop`, so all
  three are reachable through it. What it cannot do is recover from them. The
  distinction matters to whoever debugs an installer failure later.

The pattern in both is the same, and it is worth naming: a sentence written to
summarise evidence drifted further from that evidence than the evidence itself
did. The claims were checked against the mutation output and the hook source
before they were rewritten, not against the earlier draft.
