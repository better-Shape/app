# macOS runner selection

## Intent and scope

Keep macOS CI and installers on supported, explicitly selected native runners. The user requested research and the correct runner update. Scope covers CI, test installers, nightly and release workflows, with architecture regression tests. No application, permission, trigger, signing or publication changes.

## Code research gate

Pattern class: moving runner aliases at native build boundaries. Four instances used macos-latest. Intel rows already use macos-26-intel. Searches covered all .github workflows plus tests, scripts and engineering docs for macos-14, macos-15, macos-latest and macos-26.

Sources inspected on November 5, 2026:

- https://github.com/actions/runner-images lists macos-26 and macos-latest as arm64 and macos-26-intel as x64.
- https://github.com/actions/runner-images/issues/13518 confirms macOS 14 retirement on GitHub Actions on November 2. No affected workflow uses macOS 14.
- https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md confirms the current macOS 26 arm64 image and installed tooling. Setup already explicitly installs Node 22 and Rust.
- GitHub job 126867650190 had labels [macos-latest], no runner name and no steps. Both that job and 126876316100 have annotations saying no hosted runner acquired the jobs, alongside macOS arm64 capacity warnings. These are capacity failures, not deprecation or compile failures.

Decision: pin the four arm64 selections to macos-26. Keep Intel on macos-26-intel. Pinning removes future alias migration but does not bypass capacity limits or guarantee acquisition. Do not switch architecture, pay for larger runners, hide failures or downgrade images without evidence.

Failed research attempt: fetching issue 13518 through the page tool failed; GitHub REST returned the full announcement. Action log download hosts were inaccessible; job metadata and check annotations provided direct evidence instead.

## Verification gate

Tree based on f7d5724c8b228c237cd552e1f0b2a8346f02f75a:

- npm ci --ignore-scripts passed. npm reports eight moderate dependency advisories; no dependencies changed.
- npm run lint:strict passed.
- npm run typecheck passed.
- npm run test passed, including runtime generation and all 300 suites / 3,103 tests.
- Workflow-focused tests passed, 13 tests across three suites.
- Regression experiment: restoring the four original labels made all four new tests fail. Restoring the pins made all four pass.
- npm run skills:verify passed, 53/53 locked skills.
- git diff --check and added-line secret scan passed.
- Cargo tests, fmt and clippy not rerun. No Rust, native build command, dependency, runtime source or target changed. Native macOS execution is unavailable on this Linux host; fresh hosted CI is required to prove runner acquisition and packaging.
- UI/browser capture not applicable; no UI changes.

## Review ledger

| ID | Contract | Evidence | Result |
| --- | --- | --- | --- |
| R1 | Static macOS checks select arm64 macOS 26 | YAML parse and test | Passed locally |
| R2 | Three installer matrices pair arm64/x64 with native Rust targets | Exact two-row assertions and matrix.runner checks | Passed locally |
| R3 | Permissions, secrets, triggers, caches, timeouts and publication unchanged | Complete four-line workflow diff and setup consumer review | Confirmed |
| R4 | Existing packaging behavior and matrix entries preserved | Existing installer tests and full JS suite | Passed locally |
| R5 | Hosted machines acquire jobs and produce macOS artifacts | Cannot execute hosted macOS locally | Requires fresh CI |

Three review passes checked the diff, architecture/target boundary, then failure/cancellation and alias semantics. No validated findings. Pinning is configuration hardening, not a claimed capacity fix. Existing supported macOS versions and app deployment targets remain unchanged.
