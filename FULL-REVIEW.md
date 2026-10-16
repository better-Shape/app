# BetterShape end-to-end review protocol

This document defines the required review process for `BetterShape`, the Tauri 2 and Next.js desktop coding agent.

The process applies to pull requests that change application code, tests, generated output, dependencies, build scripts, workflows, configuration, packaged assets, vendored skills, or documentation that changes an operational contract.

The review goal is to find defects the pull request introduced, exposed, or made reachable. Do not report pre-existing defects unless the pull request makes them worse, makes them reachable, or blocks a safe fix.

This protocol has four parts.

1. **Part I, review procedure**, defines the required review actions, the evidence rules, and the phase gates.
2. **Part II, project risk catalog**, defines conditional BetterShape checks for the Tauri shell, the Rust backend, the Next.js renderer, persistence and secrets, design work, CI and packaging.
3. **Part III, operational changes and automation backlog**, lists repository changes that would make this procedure repeatable.
4. **Part IV, external references**, lists the sources this protocol relies on. These are non-normative.

Part I is the sole normative process. Parts II through IV are conditional checks, a backlog, and reference material. If guidance conflicts, Part I and `AGENTS.md` take precedence.

A reviewer must not treat a catalog item as a finding on its own. A finding needs evidence that the pull request creates a reachable defect.

---

# Part I, review procedure

## 1. Terms, review contract, and evidence rules

### 1.1 Terms

| Term | Meaning |
| --- | --- |
| Contract | An observable promise to a caller, user, renderer, Rust command, provider, or test. |
| Boundary | A point where data, authority, lifecycle ownership, or failure ownership changes. In this app that is usually a Tauri command, an IPC payload, a capability grant, a CSP directive, a provider adapter, a subprocess, a filesystem path, or the SQLite or keyring layer. |
| Evidence | A code trace, test result, CI result, reproduction, or runtime observation. |
| Verification | A command, test, inspection, or manual scenario that checks a contract. |
| Risk | The review depth a changed area requires. Risk is not finding severity. |
| Finding | A confirmed defect the pull request introduced or made reachable. |
| Assumption | A statement you have not verified. |
| Unknown | A required fact you cannot obtain from the pull request, the repository, or CI. |

### 1.2 Review contract

A review must:

1. Compare the reviewed head SHA with the target branch.
2. Read the complete diff before you make any line-level finding.
3. Inventory the changed contracts before you select verification.
4. Identify every changed behaviour, contract, and operational surface.
5. Trace each changed boundary to its consumers, in both directions where the boundary is a protocol.
6. Review the success, failure, cancellation, retry, disconnect, and shutdown paths.
7. Inspect tests for coverage and for validity, independently from the implementation.
8. Run or inspect every relevant verification gate, record its status, and never claim an unrun check passed.
9. Report only findings that meet all five validation conditions in section 10.
10. Separate verified facts from assumptions and unknowns.
11. Stop only when every required phase gate has an explicit result.

A review must not:

- Report a style preference as a correctness finding.
- Claim a command passed when you did not run it.
- Require a named implementation pattern when another implementation keeps the same contract.
- Infer runtime behaviour from a type check, or from a mocked unit test alone.
- Infer packaging behaviour from a dev-mode run, or one platform from another.
- Treat a test as valid when it can pass while the changed contract is broken, or when it restates an implementation constant.
- Report a pre-existing issue unless this pull request makes it worse, reachable, or unfixable.
- Mark CI as passing while a required check is pending, unavailable, or inconclusive.

### 1.3 Evidence quality

Use the strongest evidence you can get.

| Level | Evidence | Allowed conclusion |
| --- | --- | --- |
| E0 | Intent in the PR text or comments | Intended behaviour only |
| E1 | Static inspection of the changed code | A plausible code path |
| E2 | A consumer trace or a focused test inspection | Reachability or contract coverage |
| E3 | A command or test completed on the reviewed head SHA | Verified behaviour within the test scope |
| E4 | A scenario run in the real app, either `npm run tauri:dev` or a packaged build | Verified user-visible runtime behaviour |
| E5 | A reproduction on the relevant platform and persisted state | A confirmed real defect |

Do not describe an E1 conclusion as an E4 conclusion. Treat PR text as intent, code and tests as implementation, and CI output as verification evidence.

---

## 2. Review inputs and the evidence ledger

Collect these before detailed analysis:

- Target branch and reviewed head SHA.
- PR title, description, linked issues, and prior discussion.
- The full diff, including renames, deletions, generated files, `package-lock.json`, `Cargo.lock`, workflows, config, vendored skill trees, and binary assets.
- Changed files and the symbols they changed.
- The tests nearest each changed behaviour.
- CI jobs, their status, and the exact commands they run, from `.github/workflows/`.
- The repository instructions that bind the area: `AGENTS.md`, `REVIEW.md`, `DESIGN.md`, `engineering/design-system-baseline.md`, `engineering/design-skills.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.coderabbit.yaml`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/`, and `eslint.config.cjs`.
- For any UI, design, motion, typography or copy change: the design set in `engineering/design-skills.md`, loaded before the diff is judged, and the antislop Delivery Gate report for the change.
- For skill vendoring changes: `skills-lock.json` and the result of `npm run skills:verify`.

Create the ledger before you write findings.

| ID | Contract or concern | Evidence source | Level | Result | Follow-up |
| --- | --- | --- | --- | --- | --- |
| E-01 | A renamed Tauri command still matches its TypeScript caller | Command signature and its `invoke` call site | E2 | Verified or unverified | Add a contract test |
| E-02 | A provider adapter kills its child process on cancel | Adapter module and its test | E3 | Verified or unverified | Run the adapter test |
| E-03 | A settings change leaves an existing install's settings readable | Settings loader and a copy of an old settings file | E4 | Verified or unverified | Manual scenario |

Keep one stable id when a concern spans several files.

---

## 3. Phase 0: scope, baseline, and change inventory

### 3.1 Establish the baseline

1. Identify the base branch and the head SHA.
2. Check for merge conflicts and whether an automated rebase is safe.
3. Identify which commits belong to this PR.
4. Identify generated files and vendored output, for example `public/preview/`, `src-tauri/runtime/`, `src-tauri/gen/`, `docs/generated/`, and `.agents/skills/`.
5. Identify dependency and lockfile changes, and whether `package-lock.json` and `src-tauri/Cargo.lock` were regenerated by the commands CI runs.
6. Identify deleted or disabled tests, weakened assertions, removed suppressions, and any new `eslint-disable`, `@ts-ignore`, `#[allow(...)]`, or `#[ignore]`.
7. Identify changed environment variables and build-time config, and the Tauri configuration in `src-tauri/tauri.conf.json`.
8. Identify config that behaves differently in dev, CI, packaging, and a user's machine.

Do not assume a file is generated from its name. Find the generator, script, or build step, or state that it is hand-written.

### 3.2 Build the change inventory

Write one record per changed contract. One file can produce several records.

| Field | Required content |
| --- | --- |
| File | Repository-relative path |
| Change type | Behaviour, API, persistence, security, UI, test, CI, dependency, docs, generated output, asset, vendored skill |
| Changed contract | What a caller, user, renderer, Rust command, or provider can observe |
| Entry points | Tauri command, event, capability, CSP directive, exported function, hook, listener, script, workflow |
| Consumers | Callers, renderer stores, Rust modules, the database or keyring reader, CI jobs |
| Risk level | Critical, high, medium, or low |
| Required verification | Commands, tests, manual scenario, inspection |

Use the highest applicable risk level.

| Risk | Examples in this repository | Minimum depth |
| --- | --- | --- |
| Critical | Capabilities and permissions in `src-tauri/capabilities/`, the CSP and asset protocol scope in `src-tauri/tauri.conf.json`, path containment in `src-tauri/src/agent/security/`, shell or browser launches, the OS keyring writes, the updater configuration, subprocess spawning with user-influenced arguments, and anything that widens what the renderer may reach | Full security, contract, test, and verification review |
| High | Tauri commands that read or write the filesystem, git operations, PTY sessions, provider adapters, MCP OAuth, SQLite or any persisted settings shape, the release workflow, and `package-lock.json` or `Cargo.lock` bumps of a runtime dependency | Contract, consumer trace, failure, cleanup, and tests |
| Medium | Stateful UI, IPC payload shapes, validation, error handling, a new dependency that is not on the runtime path, and settings persistence | Consumer trace, tests, and a scenario where the contract is user-visible |
| Low | Copy, comments, documentation, and tests that only restate existing behaviour | Read, and a check that claims hold |

### 3.3 Select the review modules

| Change type | Required modules |
| --- | --- |
| React component or hook | Contract, lifecycle, accessibility, tests, and the design set when the component is visible |
| Tauri command or IPC payload | Contract, consumer trace, validation, error shape, tests |
| Capability, CSP, or asset scope | Security, consumer named in the diff, and a scenario that proves the grant is needed |
| Rust module that touches the filesystem | Security, path and symlink analysis, cleanup, and tests |
| Subprocess, PTY, or provider adapter | Lifecycle, bounded output, kill and reap, protocol mapping, and tests against a mock peer |
| Provider or agent tool output | Event mapping, dropped events, error handling, and the renderer consumer |
| Persisted settings, keyring entry, or local data | Persistence, compatibility, recovery, tests |
| Download, binary, or asset | Network, integrity, cleanup, retry, packaging, and the size delta |
| Dependency or lockfile | Supply chain, consumer impact, build and CI verification |
| Workflow or release config | Trigger, permission, secret, cache key, platform matrix review |
| Vendored skill tree | `skills-lock.json` agreement, `npm run skills:verify`, and a check that nothing imports or runs the tree |
| Documentation | Command accuracy, contract accuracy, operational impact |
| Visual design, style, motion or copy on a UI surface | Baseline conformance, Delivery Gate, accessibility, focus and states, motion, and tests |

Record `Not applicable` with a reason for every module you skip. A docs-only change must not get the depth of a capability change, but the record and the reason must exist.

---

## 4. Phase 1: diff, symbol, and boundary trace

Read the complete diff before you read any line in isolation.

For every changed exported symbol, command, config key, schema, persisted shape, protocol field, workflow input, or environment variable:

1. Find its declaration or source of truth.
2. Find direct consumers and call sites.
3. Find indirect consumers through wrappers, hooks, stores, generated bindings, or config.
4. Find the tests that claim to cover it.
5. Find the adjacent contracts, types, and generated outputs.
6. Find the error, cancellation, cleanup, and rollback paths.
7. Find the persisted state and anything that depends on its shape.
8. Find the platform branches, since this app ships Windows, macOS, and Linux builds and the Rust code has `cfg` branches per platform.
9. Record the trace in the ledger.

### 4.1 Required boundary traces

| Changed boundary | Required trace |
| --- | --- |
| Renderer component to store to `invoke` | Props, ownership of state, effect lifecycle, pending, empty, error, and cancel states |
| Tauri command to Rust handler | Argument validation, capability needed, error type returned, and the caller that reads it |
| Capability or permission to window | Which windows receive the grant, and which feature needs it |
| Rust handler to subprocess or PTY | Executable selection, arguments, environment, bounded output, timeout, kill, reap, and temp cleanup |
| Agent event to renderer UI | Event coverage, ordering, coalescing, and teardown on unmount |
| Rust handler to keyring or local file | What is stored, where, its failure path, and whether a log line can carry it |
| Config or env to runtime behaviour | Dev, CI, packaged, and local-only differences, and which build target reads it |
| Workflow to build input | Trigger, permissions, cache key, install flags, platform job, path filters |
| `package.json` to `package-lock.json` | Declaration, resolution, consumer, and the CI install path |

### 4.2 Generated artifacts

`public/preview/` and `src-tauri/runtime/` are tracked in git. `npm run build:runtime` regenerates them. A PR that changes either one must also change its source, or the review finds a stale artifact.

1. Identify the source of truth.
2. Identify the generation command, for example `npm run build:runtime`, `npm run icons:generate`, or the Tauri build that writes `src-tauri/gen/`.
3. Verify the generated output matches the source.
4. Check that a generated-file change does not hide or replace a source change.
5. Do not recommend hand-editing generated output.
6. Report a stale artifact only when source and output disagree.

### 4.3 Dependency changes

For each changed dependency, identify the direct and transitive consumers, and whether the change reaches the app runtime, the build tooling, CI, or packaging. Confirm the lockfile matches the manifest. Check whether the change moves a security, network, filesystem, or serialization boundary. Record the verification that runs an affected consumer.

Do not report "dependency updated without tests" unless the update has a reachable contract impact and no relevant verification exists.

---

## 5. Phase 2: contract review

Define each changed behaviour before you judge its implementation.

```text
Given: [initial state, platform, persisted state, valid input]
When:  [user action, invoke call, event, retry, startup, or shutdown]
Then:  [observable result]
And:   [failure, cancellation, cleanup, rollback, and retry result]
```

For stateful behaviour, add:

```text
Invariant: [condition that must stay true]
Owner:     [component, command, module, or store responsible]
End state: [required state after success, failure, and cancellation]
```

### 5.1 Input and output review

Check what applies:

- The receiving boundary validates input that came from the renderer, a file, or a provider.
- Numbers survive JSON and IPC. Timestamps and byte counts must not lose precision.
- Empty, missing, `null`, `undefined`, malformed JSON, and unknown enum variants have defined behaviour.
- Error strings sent to the renderer do not carry tokens, key material, or absolute paths of other users' files.
- Each caller gets the result shape it expects.
- A default does not silently change behaviour for people who already have settings or local data.
- Field naming, optionality, and serialisation stay compatible with the Rust side.
- A change to a public type, a persisted shape, or user-visible state came with the consumer update it implies.
- Every state a user can see has explicit pending, success, empty, and error behaviour where each is possible.

### 5.2 Failure, recovery, and retry review

For each operation that can fail:

1. Name the failure owner.
2. Compare the state before and after failure, and check that failure leaves a valid state.
3. Check whether a partial operation rolls back, compensates, or recovers.
4. Check what retry does and whether it is idempotent, with no duplicate work, corrupt state, or leaked process.
5. Check whether the failure is logged, surfaced at the right layer, or deliberately swallowed.
6. Check whether failure blocks startup or allows degraded operation. The app must keep working when a provider, an MCP server, or a hosted service is unavailable.

A recovery path must keep the evidence the user needs. Never delete a project file, a settings file, or a local data directory as part of recovery without preserving the original.

### 5.3 Concurrency and lifecycle review

For async or long-lived work, name the start owner, cancellation owner, completion owner, cleanup owner, and resource owner. Also name how a stale result is rejected, what shutdown does, and what a replacement run does.

Check for:

- A stale async completion overwriting newer state.
- A callback that runs after unmount, cancellation, or replacement.
- An event listener that survives teardown.
- A timer, stream, child process, PTY, or file handle left open after failure or cancel.
- Shared mutable state without a session, request, or generation identity.
- More than one in-flight run for a session that can only carry one.
- A global cancel that crosses session or window boundaries.
- Duplicate work from double clicks, automatic retries, or an optimistic update plus a server echo.

### 5.4 Compatibility review

For persisted or platform-sensitive changes, check:

- Fresh install behaviour.
- Upgrade from the previous release, including existing app data under the app's data directory, existing project settings in `.bettershape/`, and cached provider configuration.
- Behaviour after an interrupted operation.
- Behaviour with corrupted or hand-edited persisted state.
- Behaviour when an optional asset is missing or a provider CLI is not installed, which must degrade instead of failing startup.
- Equivalent behaviour on macOS, Windows, and Linux where the contract is shared.
- `localStorage` shapes, and whether a versioned migration exists when the shape changed.

---

## 6. Phase 3: security and authority review

Run this phase for every critical and high risk record, and the relevant subsections for the rest.

### 6.1 Threat model record

For each critical or high record, write the threat model in a table.

| Field | Required content |
| --- | --- |
| Asset | Project files, keyring entries, provider keys, MCP tokens, settings, git credentials, the user's shell |
| Attacker control | A renderer payload, a file path, a repository string, a URL from chat or a tool result, provider output, an MCP server response, a download, a workflow event |
| Trust boundary | Renderer to Rust, Rust to subprocess, Rust to network, download to disk, CI event to secret |
| Required property | No traversal, no unvalidated launch, integrity preserved, bounded resource use |
| Enforcement point | A validation function, a capability, the CSP, a containment check, a transaction, a workflow permission |
| Test or evidence | A rejected-input test, a config trace, an integration test, a CI inspection |

### 6.2 Tauri process authority

- Check every new `#[tauri::command]` for the argument it accepts and the capability it needs. A command that is registered but not granted is unreachable from the renderer. A command that is granted to a window that does not need it widens the surface.
- Check `src-tauri/capabilities/default.json`. It currently grants the `main`, `settings`, `onboarding`, `branch`, `git`, `stats`, `popout-*` and `preview-*` windows the same set of permissions, including `process:default`, `dialog:default`, `deep-link:default`, webview creation, and `core:webview:allow-internal-toggle-devtools`. A change that adds a permission needs a named consumer in the diff and a reason it cannot be scoped to one window.
- Check the CSP in `src-tauri/tauri.conf.json`. It currently allows `'unsafe-inline'` in `script-src`, `https:` and `wss:` in `connect-src`, and `http://localhost:*` and `http://127.0.0.1:*` for several directives. A change that widens it further needs a stated reason and a named consumer. Never add a wildcard to a directive.
- Check the asset protocol scope. It currently allows `$HOME/**`, `$APPDATA/**`, `$LOCALAPPDATA/**`, and `$TEMP/**`. A change to that scope is critical risk.
- Renderer code uses relative URLs and Tauri commands. It never calls `localhost` or another origin to reach a service the user's machine hosts.
- Validate every URL before a launch. `open::that` in `src-tauri/src/mcp/oauth.rs` and the browser opens in `features/agent/workspace/browser.tsx` are the places to check first. A repository string, a provider's output, or a tool result that reaches a launcher unchecked is an arbitrary-URL launch.

### 6.3 Filesystem authority

Filesystem commands, agent file tools, and path containment are the main traversal risk in this app. The containment logic lives in `src-tauri/src/agent/security/paths.rs`, and the file commands live in `src-tauri/src/commands/fs/`.

1. Validate the shape of the path, then reject traversal and absolute paths where a project-relative path is required.
2. Resolve the intended project or worktree root.
3. Canonicalise the existing components before you compare.
4. Check symlink behaviour, including the final component.
5. Perform the operation on the validated absolute path, never on the raw input.
6. Clean up partial output on failure.
7. Test delete, overwrite, traversal, absolute path, and symlink escape where the change reaches them.

A string prefix check does not prove containment. A path the user chose from a folder picker is a grant for that folder, and it does not extend to its parent.

### 6.4 Subprocess, PTY, and provider config

- Executable selection comes from a known binary or a configured path, not from a free-form string in a request. Check where the path comes from.
- Bound captured stdout and stderr, drain both without deadlocking, and kill plus reap on timeout.
- Check the environment passed to a child process. Do not pass a keyring secret or an unrelated token to a tool that does not need it.
- Check how the PTY session ends. A closed tab must leave no orphan process.
- A provider or MCP response is untrusted text. Confirm it renders through the existing escaping path, and that a tool result cannot widen the agent's own permissions.
- Check the permission floor. A change that lets an agent action run without the confirmation the mode requires is a critical finding.

### 6.5 Secrets and credentials

- Provider keys are stored in the OS keyring through the `keyring` crate, in `src-tauri/src/commands/ai_byok.rs`. MCP OAuth tokens are stored the same way, in `src-tauri/src/mcp/credentials.rs`. A new credential must use one of these owners, or name a new owner in the PR.
- Nothing logs a token, a key, or a raw provider response that carries one. Check every new `log`, `println!`, `eprintln!`, and `console.log` added on a changed path.
- Check what a secret looks like in an error string sent to the renderer.
- Check that a deletion removes the keyring entry, and that a missing entry is treated as already deleted.

### 6.6 Network, downloads, and updates

- Validate each redirect target, cap hops, and enforce a byte limit while streaming rather than trusting `Content-Length`.
- Verify artifact integrity for any downloaded binary, and delete partial downloads on failure or cancellation.
- The updater configuration lives in `src-tauri/tauri.conf.json`. There is no `plugins.updater` key, and `bundle.createUpdaterArtifacts` is `false`. The updater plugin is not in the dependency tree, and `build-installers.yml` says so. A change that adds an updater plugin, an endpoint, a public key, or a signer is a release-trust change and needs review at critical depth.
- A change that adds a default host to the app, or that makes the app contact a new service on startup, violates the local-first rule in `AGENTS.md` unless the user asked for it and the request is visible.

### 6.7 CI, release, and secrets

- Job permissions use `contents: read` at job level, and write scope appears only where a step needs it.
- Fork-triggered runs get no privileged secrets.
- Signing keys, the updater private key, and tokens stay out of the repository. `src-tauri/.updater-keys/*.key` is ignored by git.
- Cache keys include the inputs that change compiled output.
- A new path filter must cover `src`, `app`, `components`, `features`, `lib`, `core`, `src-tauri`, `package-lock.json`, `Cargo.lock`, `tsconfig.json`, `eslint.config.cjs`, and `next.config.ts`. A filter that omits a build input is a finding.
- Release steps run only on the intended events and branches.
- A workflow file is a critical change. A permission wall on a workflow file is handled by a PR comment with a handoff prompt, as `AGENTS.md` requires.

---

## 7. Phase 4: test review and test validity

Review test quality separately from implementation correctness.

### 7.1 Evidence classification

| Class | Meaning |
| --- | --- |
| Direct test | Exercises the changed contract through its public boundary |
| Indirect test | Covers the contract inside a larger flow |
| Regression test | Fails before the change and passes after it |
| Negative test | Confirms rejected input or failure handling |
| Recovery test | Confirms a safe state after failure plus retry behaviour |
| Missing test | No evidence protects a contract that changed |
| Invalid test | Can pass while the required behaviour is broken |

### 7.2 Test validity questions

1. Would this test fail if the change were reverted?
2. Does it use the public contract rather than an implementation detail?
3. Does it mock the module that contains the behaviour under test?
4. Does the expected value come from an independent source, or does it restate a constant from the implementation?
5. Does it check failure as well as success?
6. Does it wait on readiness instead of elapsed time?
7. Does it restore global state, environment variables, temp directories, and any file in the user's home directory that it touched?
8. Could it pass only because the mock repeats the same bug?
9. Does it protect an existing user's state, not only a fresh one?
10. Does it distinguish a visible UI result from an internal helper call?
11. Does it separate the old behaviour from the new one, or would both pass?
12. For stream tests, does it assert the payload of a chunk, or only that a chunk exists?

### 7.3 Required test types

| Changed area | Minimum evidence |
| --- | --- |
| Pure deterministic function | Unit test with boundary and error cases |
| React hook or state transition | Test with mount, update, and cleanup behaviour |
| Tauri command or shared payload type | A test that decodes old and new payload shapes, or a typed contract check |
| Path containment | Rejected-input tests for traversal, absolute paths, and symlink escape |
| Subprocess or PTY management | Exit, timeout, cancellation, and output-bound tests, plus a cleanup check |
| Provider adapter turn handling | Test against a mock peer for text, tools, usage, cancel, non-zero exit, and a final line without a trailing newline |
| Persisted settings or local data | Fresh, upgrade, corrupt, and recovery tests |
| Bug fix with a reproducible failure | Regression test |
| Security boundary | Rejected-input tests |
| Vendored skill tree | `npm run skills:verify` on the head commit |
| CI or release config | Static workflow inspection plus the CI evidence itself |
| Renderer interaction | A Vitest behaviour test where one exists, otherwise a documented manual scenario |

Prefer the smallest test level that proves the contract. Use unit tests for pure logic, integration tests for persistence, process handling, and module boundaries, and a real app run for flows that only exist at runtime.

### 7.4 Test anti-patterns

Treat these as findings when they touch changed behaviour:

- An expected list copied from the production constant, so a rename passes silently.
- A mock that replaces the function under test.
- Assertions on which functions were called instead of what the user can observe.
- A fixed sleep where a readiness condition exists.
- A test that does not await async cleanup, so a leaked child process or socket goes unnoticed.
- A test that writes into a real user directory without restoring it.
- A test typed with `any`, a cast that makes the assertion unable to fail, or an `eslint-disable` line added to hide a warning.
- A test in `tests/` that passes because `passWithNoTests` is off and no file matches the pattern. Vitest is configured to fail in that case, so a passing run with zero tests is a defect in the config, not a green check.
- An existence check standing in for a content check on a stream chunk.

---

## 8. Phase 5: application scenarios

Unit tests do not replace running the app when a critical flow changed. Select scenarios from the inventory.

### 8.1 Startup and local data

1. A fresh profile starts and creates its local data.
2. An existing profile from the previous release starts and keeps its projects, settings and keys.
3. A corrupted or hand-edited settings file does not get silently deleted.
4. Missing optional binaries degrade to a clear message instead of a crash.
5. With no provider configured, the app opens and the empty state is usable.
6. Startup logs carry useful context and contain no token or key material.

### 8.2 Agent run lifecycle

1. A normal run streams text and tool calls, then finishes.
2. A cancel stops the run, releases its child process and temp files, and leaves the session reusable.
3. A provider error surfaces with the provider's message, not a silent empty answer.
4. A reconnect or resume after a restart reattaches or starts fresh, and reports which happened.
5. Two runs cannot write to one session at once, and a second send is handled explicitly.
6. A provider config that lacks the expected shape produces a readable state, not a stack trace in the UI.

### 8.3 Terminal, filesystem, and workspace

- A PTY resize, a full-screen program, and a closed tab leave no orphan process.
- File reads and writes honour the project root, and a symlink inside the project is handled deliberately.
- A large file, a binary file, and a deleted file all have defined rendering.

### 8.4 Packaging

- `npm run build` completes, and `npm run tauri:build` produces an installer on the platform under test.
- The installed app launches with the preview runtime present.
- Renderer asset weight moves in the expected direction. Record the before and after bytes when an asset changed.

### 8.5 Cross-platform

Record which platform and version you tested. Do not generalise one platform's result. Windows path handling, macOS signing, and Linux packaging each have their own CI job or deliberate absence. `build-installers.yml` produces test installers for Windows, macOS and Linux, and it never publishes.

---

## 9. Phase 6: verification matrix

Use the repository's own commands, the ones CI runs.

### Everything

```sh
npm ci
npm run lint
npm run typecheck
npm run skills:verify
```

### Application and renderer

```sh
npm run build:runtime        # builds the preview runtime that Vitest needs
npm run test                 # vitest, tests/**/*.test.ts(x)
npm run build                # next build, the renderer bundle
```

### Rust backend

```sh
npm run test:rust                                              # cargo test
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

On a host that cannot reach `crates.io` or the Tauri system libraries, fetch the orphan branch
`vendor/sandbox-toolchain` first, then add `--ignore-rust-version` and `CARGO_BUILD_JOBS=1` to the
cargo commands. `AGENTS.md` under Blocked sandbox toolchain has the recipe, and
`engineering/rust-toolchain.md` has the measured results.

### Full local gate

```sh
npm run test:all             # Vitest plus Cargo, the local gate AGENTS.md names
```

### Packaging and security

```sh
npm run tauri:build          # unsigned installer on the host platform
npm audit --audit-level=high # the npm half of the Security Audit job
```

Dependency review and CodeQL run from `security.yml` on the pull request. Read their results on the head SHA.

### Status vocabulary

Record one status per required check: `Passed`, `Failed`, `Not run`, `Not applicable`, or `Inconclusive`.

| Check | Applies when | Status | Evidence |
| --- | --- | --- | --- |
| Lint | Any source, style, or config change | one of the five | Exact command and head SHA |
| Typecheck | Any TypeScript contract change | one of the five | Exact command and head SHA |
| Unit tests | Changed deterministic logic | one of the five | Command and scope |
| Rust tests | Changed Rust code | one of the five | Command and scope |
| Build | Renderer or config change | one of the five | Command and output size |
| Packaging | Anything that ships | one of the five | Builder command and output |
| Skills verification | Any change under `.agents/` or `skills-lock.json` | one of the five | Command output |
| Workflow inspection | Workflow or release change | one of the five | Reviewed paths and permissions |
| Security review | Critical or high risk boundary | one of the five | Threat model record |

Do not call CI green while a required check is pending, unavailable, or inconclusive. A review with a required `Not run` or `Inconclusive` result is `Needs Verification`, not `Ready`.

---

## 10. Phase 7: finding validation and severity

A candidate finding needs all five conditions.

1. **Diff cause.** This pull request introduced the defect, changed its reachability, or blocks its safe repair.
2. **Reachable scenario.** A concrete input, state, event sequence, or platform condition reaches it.
3. **Concrete impact.** The correctness, security, data, lifecycle, performance, or user outcome is stated as a mechanism or a number.
4. **Minimal remediation.** A safe, small change preserves the intended contract.
5. **Verification path.** A test, scenario, or command can prove the fix.

Discard the candidate if one condition is missing.

| Severity | Meaning |
| --- | --- |
| Critical | Exploitable authority or security boundary failure, data loss, startup failure for everyone, or a release-blocking defect |
| High | Common correctness failure or crash, persistent corruption, a broken core flow, unsafe recovery, a serious leak, or a reachable security defect |
| Medium | Reachable defect with bounded impact, incomplete recovery or error handling, or missing behaviour that matters |
| Low | Uncommon defect or defensive gap with limited impact |
| Nitpick | No runtime or operational impact |

Report one finding per root cause. Do not split one defect into several comments, and do not merge unrelated defects into one. Never report a finding only because the implementation differs from a pattern you would have chosen.

---

## 11. Report format

Use this order.

```md
## Verdict

**Status:** Ready | Not Ready | Needs Verification
**Confidence:** High | Medium | Low
**Mergeable:** Yes | No | Unknown
**CI verification:** Passing | Failing | Pending | Inconclusive

## Change inventory

| Area | Changed contract | Risk | Required verification | Result |
| --- | --- | --- | --- | --- |

## Findings

### [Critical|High|Medium|Low] Title

**Location:** `path/to/file.ext`, line N
**Diff cause:** [what this pull request changed]
**Evidence:** [code trace, test result, CI output, or reproduction]
**Reachable scenario:** [input, persisted state, event sequence, or platform]
**Impact:** [consequence, as a mechanism or a number]
**Required change:** [minimal safe remediation]
**Verification:** [the test, scenario, or command that proves it]

## Missing test coverage

- [changed contract]: [the smallest test that proves it]

## Verification performed

| Check | Status | Evidence |
| --- | --- | --- |

## Correct behaviour confirmed

- [contract]: [evidence and scope]

## Assumptions and unknowns

- [what could not be verified, and why]
```

When no finding survives validation, write `No validated findings.` Do not add empty sections, and do not list an assumption as a finding.

---

## 12. Completion rules

A review is `Ready` only when:

- No unresolved critical, high, or medium finding remains.
- Every critical and high risk contract has direct evidence or a documented, justified indirect path.
- Required verification is `Passed` or explicitly `Not applicable`.
- Generated output matches its source of truth.
- Required boundary traces are complete.
- The report separates verified facts from assumptions and unknowns.

A review is `Needs Verification` when the analysis is complete but execution evidence is pending, unavailable, or inconclusive. A review is `Not Ready` when a validated finding blocks a safe merge.

Confidence measures evidence quality, not how sure you feel. Do not claim high confidence without completing every relevant verification step.

| Confidence | Meaning |
| --- | --- |
| High | Required traces and verification are complete |
| Medium | Analysis is complete, but verification or platform coverage is partial |
| Low | Important inputs, traces, or verification are unavailable |

### 12.1 Fast path for low-risk docs-only changes

When every inventory record is low risk and no changed file affects an operational contract, meaning no code, test, workflow, manifest, lockfile, config, generated output, or documented command changed, use this minimum form. If any record exceeds low risk, run the full procedure.

1. Read the complete diff.
2. Confirm the inventory holds only low-risk records, and write the reason.
3. Check that changed prose does not alter a documented command, path, contract, or security statement. A doc change that edits an operational instruction is not docs-only, so reclassify it and run the full procedure.
4. Verify the claims in the prose against the repository, since a stale instruction is how an agent relearns the same thing badly.
5. Record the formatting check as `Not applicable` if the change is Markdown only.

```md
## Verdict

**Status:** Ready | Not Ready
**Confidence:** High | Medium | Low
**Mergeable:** Yes | No | Unknown
**CI verification:** Passing | Failing | Pending | Inconclusive

## Change inventory

One line per file: path, `docs-only`, low, and the reason.

## Findings

`No validated findings.` or the standard format.

## Verification performed

| Check | Status | Evidence |
| --- | --- | --- |
```

The fast path never applies to changes touching `AGENTS.md`, `REVIEW.md`, this file, `eslint.config.cjs`, `tsconfig.json`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/`, `.github/workflows/`, `skills-lock.json`, or anything listed critical or high in section 3.2.

---

# Part II, project risk catalog

Use a module only after Phase 0 selects it. These checks distill the architecture, the security boundaries, and the review findings that recur in this repository. A catalog match is a review prompt, not a finding, so run whatever it surfaces through the Phase 7 validation gate.

## 13. Tauri shell and IPC boundaries

- The renderer is a static Next.js export inside a Tauri 2 webview. It reaches native behaviour only through `invoke`, the events the capabilities allow, and the plugins listed in `src-tauri/capabilities/default.json`.
- The Rust entry point is `src-tauri/src/lib.rs`, and command modules sit under `src-tauri/src/commands/`. Check that a new command is registered in the invoke handler and granted to the windows that call it.
- A secondary window (`settings`, `git`, `stats`, `popout-*`, `preview-*`) carries the same permissions as `main`. A change to one window's behaviour is a change to all of them.
- The error type returned to the renderer is `src-tauri/src/core/error.rs`. Match it. A new error that carries a raw system path or a token is a finding.
- Panics on a request path are defects. Check each new `unwrap`, `expect`, and index access on input that came from the renderer or from disk.

## 14. Rust backend, subprocesses, and agent tools

- The agent's tools and their permission floor live under `src-tauri/src/agent/`. Path containment for agent file access is in `src-tauri/src/agent/security/paths.rs`. Check every new tool for the path it reads or writes and the mode it runs in.
- Subprocess work uses `src-tauri/src/core/process.rs` and `portable-pty`. Check the cap on captured output, the kill and wait on timeout, and the cleanup of temp files.
- Git operations use `git2` and the git binary resolved in `src-tauri/src/core/git_bin.rs`. Check that a repository string from the user never reaches a shell.
- The browser surface (`src-tauri/src/browser/`) drives a webview and exposes a Chrome DevTools bridge. Treat any change there as critical. Check which origins it can load and what it can call.
- Tree-sitter parsers run over user files. Check that a malformed or huge input is bounded.
- A tool result or an MCP response is untrusted. It must not widen the agent's own authority.

## 15. Design and UI work

Every change that touches product UI loads the design set before it is judged.

- Read `DESIGN.md` and `engineering/design-system-baseline.md`. The committed values win over habit.
- Read `engineering/design-skills.md` for the load order, the routing table, the execution limits, and the six delivery gates.
- Check the shared primitives first. Shared controls live in `components/ui/`. A new one-off control that duplicates a primitive is a finding.
- Check tokens. Semantic tokens such as `text-text-primary`, `bg-panel` and `border-border-subtle` are the only accepted colour classes. `text-gray-*`, `text-zinc-*` and raw hex values in components are findings unless the design baseline names the value.
- Check the icon path. `@/components/ui/icon` renders Fluent glyphs. A Lucide import, a raw SVG, or a string icon name in a changed component is a finding.
- Check states. Every interactive control has hover, focus, active and disabled states, and every async surface has pending, empty and error states.
- Check copy. User-facing strings follow `unslop` and `antislop-copywriting`. A debug label, an environment name, or a cloud URL in shipped UI is a finding.
- Check the antislop Delivery Gate. A FAIL on any item means the work is not shippable.

## 16. Next.js renderer and state

- Renderer code uses relative URLs and Tauri commands. It never names an origin.
- The production build is a static export. `next.config.ts` sets `output: "export"` only when `isProd` is true, so a development build is not exported. A server-only API route in `app/` is a finding unless the static build still works without it.
- Check async work in components. A request that can resolve after a newer one needs a generation counter or an abort, so an older response cannot overwrite a newer one.
- Editable rows own stable ids. Do not key an editable input by array index or by its own content.
- A `<label>` can name a `<button>`, because a button is a labelable element (MDN, `<label>` reference). Use `aria-label` when a control has no visible label, and use `aria-pressed` on toggle buttons.
- Check the React hook rules. Six `react-hooks` rules are downgraded to `warn` in `eslint.config.cjs` with a TODO: `set-state-in-effect`, `refs`, `exhaustive-deps`, `purity`, `preserve-manual-memoization`, and `immutability`. A new warning from one of these in a changed file is a finding even though CI does not fail on it. The other `react-hooks` rules stay at error, including `rules-of-hooks`, so a violation there fails CI.
- Check bundle weight. A new large dependency on the renderer path needs its size recorded in the PR.

## 17. Persistence, keyring, and local data

- Local data lives under the app's data directory and in `.bettershape/` inside a project. Read `src-tauri/src/core/paths.rs` and `lib/workspace/rules.ts` before you change where a file goes.
- Provider keys and MCP tokens go to the OS keyring through the `keyring` crate. A new secret stored in a plain file is a critical finding.
- A settings file the app writes must keep the keys it does not own, and a failed write must leave the previous file intact.
- A migration of local data must keep an existing user's projects and settings readable.
- Recovery never deletes a project file or a settings file without keeping the original.

## 18. CI, release, and supply chain

- `ci.yml` runs `Lint & Typecheck`, `Test JS (Vitest)`, `Static Checks (macOS)`, `Test Rust (Cargo)`, `Rust Lints (fmt, clippy)`, `Build Next.js`, `Version Sync Check`, `Security Audit`, and the `CI Success` aggregate job. Read the job that a changed file affects.
- `security.yml` runs CodeQL for JavaScript and TypeScript and for Rust, dependency review, the audit, Zizmor, and the OpenSSF Scorecard.
- `pr.yml` checks the PR title, large files, secret patterns, and PR size. `pr-policy.yml` validates PR body evidence and conditional review tags from the default-branch definition using `pull_request_target`; it does not check out or run PR code. It is a separate status, so branch protection must require `PR Policy Check` directly. The workflow is active only after it reaches the default branch.
- `build-installers.yml` builds test installers and never publishes. `release.yml` publishes, so a change to it is critical.
- `auto-merge.yml` runs on `pull_request` into `main`, only when the actor is `dependabot[bot]`. It parses the PR title for a single `from X.Y.Z to X.Y.Z` bump. It skips the merge, and so requires manual review, for a major bump, a breaking `0.x` minor bump, a grouped update, or a title it cannot parse. For an eligible bump it waits for `CI Success` on the test-merge SHA, aborts if the PR head changed during the wait, and then runs `gh pr merge --auto --squash`. Check any change to these conditions as critical, since it can merge a dependency without a human.
- CodeRabbit auto-reviews non-draft pull requests whose base is `main`; wait for that review to complete regardless of criticality. Draft PRs are excluded by `.coderabbit.yaml`. For other bases, request a manual CodeRabbit review only for substantially critical PRs, as `AGENTS.md` defines.
- Vendored skills are checked by `npm run skills:verify`. CI does not run that command today. A change that adds a skill without a lock entry, or edits a locked skill, must say why.

## 19. Suggestions, nitpicks, and what the tooling checks

- ESLint runs with `eslint-config-next` and TypeScript rules. The React hook rules listed in `eslint.config.cjs` are warnings. The CI lint step fails only on errors.
- `tsc --noEmit` is the typecheck gate, and `strict` is on.
- `.claude/**` and `.agents/**` are excluded from ESLint and from the TypeScript project. Nothing under them is linted or typechecked.
- Vitest runs `tests/**/*.test.ts(x)` with the jsdom environment and `tests/setup.ts`.
- Cargo runs the Rust tests, and CI runs `fmt` and `clippy -D warnings`.
- A nitpick that a tool already reports is not a review finding. A nitpick that no tool checks may be a suggestion. Label it as a nitpick.

## 20. Anti-pattern checklist

Use this list as a prompt, then validate every hit through section 10.

- An `invoke` call whose argument shape does not match the Rust struct, with no test that decodes it.
- A new permission in `src-tauri/capabilities/` that no changed code uses.
- A new CSP source, or a wildcard in any directive.
- A path that reaches `std::fs` or `tokio::fs` without the containment check in `agent/security/paths.rs`.
- A string that reaches `open::that`, `shell.openExternal`, or a `window.open` without a scheme and host check.
- A child process started without a timeout, an output cap, or a kill on cancel.
- A token written to a log line, an error string, or a file.
- A `useEffect` that starts async work with no cleanup or generation check.
- A `setState` that depends on a previous state read outside the updater function.
- An `any`, a cast that hides a missing field, or a suppression comment added to pass CI.
- A duplicated helper that already exists in `lib/utils.ts`, `components/ui/`, or `src-tauri/src/core/`.
- A dead branch, an unused export, or a comment that describes code that no longer exists.
- A generated file edited by hand.
- A vendored skill file edited by hand, or a skill added without a lock entry.

---

# Part III, operational changes and automation backlog

These items would make this protocol repeatable. They are not required for a review to run. They are listed so the next change that takes one on has a starting point.

1. Run `npm run skills:verify` in the `Lint & Typecheck` job, so a vendored tree that drifts fails CI.
2. Add a PR template with the footer that `AGENTS.md` requires.
3. Scope the capability file per window, so the settings, git and preview windows do not share the `main` window's permission set.
4. Decide whether an updater plugin, with an endpoint and a public key, should be added. Until then, the updater stays absent.
5. Add a Rust or TypeScript contract test that decodes each Tauri command's argument shape.
6. Keep automatic CodeRabbit reviews for `main` unchanged. Decide separately whether the integration branch should receive automatic reviews; until a maintainer decides, keep CodeAnt as the default there and request CodeRabbit only for substantially critical PRs.

---

# Part IV, external references, non-normative

These sources informed the protocol. Read them before you change the rule they support.

- The AGENTS.md format and its guidance on the file as a README for agents, at [agents.md](https://agents.md/).
- Codex's discovery of `AGENTS.md` files, the merge order, and the 32 KiB default for `project_doc_max_bytes`, at [developers.openai.com/codex/guides/agents-md](https://developers.openai.com/codex/guides/agents-md).
- The OpenSpec project, its `openspec/specs` and `openspec/changes` layout, and its CLI, at [github.com/Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec). The npm package is `@fission-ai/openspec`.
- The `npx skills` CLI, its project install into `.agents/skills`, and its `skills-lock.json` record, at [github.com/vercel-labs/skills](https://github.com/vercel-labs/skills).
- The mausCode and mausVoice review protocols, which this file adapts. Their Part I procedure is the source of Phases 0 to 7 and the report format.
