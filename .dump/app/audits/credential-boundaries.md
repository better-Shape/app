# Credential boundary experiments

## Conclusion

The user approved keychain-only persistence. New drafts remain in memory, and all new settings writes redact provider credentials. The failing plaintext recovery experiments below describe the rejected approach, not the replacement contract.

The replacement adds explicit unsaved state, retry, per-window close confirmation and legacy migration protection. This is a targeted investigation, not a completed review of PR #3. Native application checks, platform runtime checks and the remaining review rounds are incomplete.

## Scope and contracts

Current baseline is `f1a43d6e1acd63425904e75de4dfd49ec992c018` on `draft/mega-absorb-all`. The experiments use the working tree above rebased commit `9cfb5e8`.

| Boundary | Owner and consumers | Required property |
| --- | --- | --- |
| Native credential reads | `src-tauri/src/core/ai_vault.rs`, `commands/ai_byok.rs`, `lib/backend/commands.ts`, `lib/ai/vault.ts` | A failed read conveys neither an empty value nor a credential lease. |
| Startup hydration | `lib/ai/sync.ts` and `lib/settings/store.ts` | Unknown keychain state does not authorize clearing a local draft. Explicit deletion remains separate. |
| Native mutation | The process-wide vault mutex and the revision supplied by each WebView | An obsolete lease cannot overwrite a newer mutation in the same native process. |
| Settings persistence | `setSecretsVaulted`, `forStorage`, localStorage and the Tauri settings store | A failed save must not broaden plaintext exposure to unrelated keys. |
| Recovery across windows | Independent settings modules sharing native state and persistent stores | An unrelated stale-window save must not erase another window's recovery draft. |

The native mutex provides process-local ordering. It does not establish coordination between separate application processes. The test helper models a native coordinator; it is not an OS keychain.

## Unreadable is not empty

The earlier `ai_load_keys` implementation substituted an empty snapshot with revision `initial` when a keychain read failed. The frontend installed that placeholder as a lease. Hydration also interpreted the missing value of an inventoried account as authoritative absence.

The read protocol now distinguishes `available` from `unavailable`. Only an available result includes a value, revision and persistence state. `AiVaultSnapshot`, `AiVaultReadResult` and `AiVaultMutation` share one TypeScript definition in `lib/backend/types.ts`.

`readSecretsDetailed` returns per-call availability and persistence evidence. This replaces the module-global read-status flag, which a later read could overwrite. Omitted rows also count as unavailable. Hydration excludes unavailable accounts from authoritative clears.

Permanent regression coverage:

- `tests/lib/ai-sync.test.ts` preserves a local recovery draft for an unreadable, inventoried account.
- `tests/lib/ai-vault.test.ts` verifies that failed reads do not replace an acquired lease and that omitted rows are not reported as durable empty credentials.
- The native `unreadable_is_not_an_empty_credential_or_a_cached_lease` test checks serialization and retries after a failed read. This test has not executed because native dependency resolution is blocked.

The frontend regressions pass. Removing the hydration availability guard causes the recovery-draft assertion to fail with an absent value. The guard was restored before subsequent checks. This is frontend test evidence, not a real keychain reproduction.

## Plaintext exposure expands after one failure

The global `secretsVaulted` boolean controls redaction for the entire settings object. One failed mutation sets it to false. Immediate fallback persistence then writes every loaded credential, including unrelated credentials already stored successfully in the OS vault.

Reproduction using the mocks and real settings store in `tests/lib/ai-vault-fallback.test.ts`:

1. Seed a search-service credential in the fake native vault.
2. Start settings and credential synchronization with a usable vault.
3. Fail persistence for one new provider credential while allowing its logical mutation.
4. Assert that the search credential remains in the native vault.
5. Assert that localStorage does not contain that unrelated search credential.

Step 5 fails. The unrelated credential appears in the whole-settings fallback. The experiment extends the existing test temporarily and restores it afterward; it is not hidden behind a skipped test or an expected-failure annotation.

## A stale window erases recovery

Immediate fallback persistence fixes the single-window restart case but does not establish cross-window ownership of the settings blob.

Reproduction with two separately imported settings/sync module instances, shared localStorage, a shared mocked Tauri store and one fake native coordinator:

1. Window A successfully saves a provider credential.
2. Open window B against that persisted state.
3. Window B edits the credential. Let the logical mutation succeed but fail OS persistence.
4. Confirm the Tauri settings store contains B's recovery draft.
5. Window A changes only an editor setting and finishes synchronization.
6. Confirm the recovery draft has disappeared from the settings store.
7. Restart both frontend modules and the fake native coordinator with only the old physical credential.
8. Assert that the new draft is recovered.

Step 8 fails: the old physical credential returns. No successful native credential overwrite is needed. A redacted whole-settings write is enough to erase recovery. The experiment does not simulate event delivery; delaying cross-window notifications is part of the stale-window scenario. A real multi-WebView reproduction remains required.

## Persistence policy decision, approved

`openspec/project.md` says sensitive credentials never enter plaintext settings. Existing code and `docs/developing/client-trust.mdx` permit plaintext fallback when no usable vault exists. The unfinished failure-recovery patch extends that fallback to failures after startup.

The user selected keychain-only persistence. Plaintext recovery was rejected. The compared contracts were:

- **Keychain-only persistence.** Failed edits remain explicitly unsaved, session-only drafts. Retrying, closing with unsaved changes and migrating legacy plaintext require defined behavior. The app must not claim that a failed draft will survive a crash.
- **Explicit local recovery.** Permit a disclosed, opt-in plaintext recovery mechanism with per-credential ownership. Unrelated settings writes must not replace recovery, and successful persistence or explicit deletion must clean it up. This changes the storage/security pattern and requires an approved design before implementation.

Do not solve this by suppressing errors, silently copying all secrets into another file, storing an encryption key beside its ciphertext, or relabeling a memory-only draft as saved. A read-merge-write over the entire settings blob does not by itself prove cross-window atomicity.

## Verification boundary

These checks preceded the keychain-only implementation and do not establish its readiness:

| Check | Result |
| --- | --- |
| `npm ci` | Passed. Audit reported the separate dependency advisory below. |
| Production TypeScript | Passed. |
| Expanded strict TypeScript check for changed tests | Passed. |
| `npm run test -- --maxWorkers=2` | 135 files, 1,084 tests passed. This suite does not cover the two failing experiments above. |
| Unreadable-account negative control | Failed at the intended draft-retention assertion when the guard was removed. |
| Additional fallback fault-injection experiments | Both failed at the intended assertions. Blockers, not suite passes. |
| `npm run lint` | Zero errors, 154 warnings. Strict lint was not run. |
| `npm run build` | Passed. Static export only, not an installer. |
| `npm run skills:verify` | All 53 locked skills verified; two project-owned skills are unrecorded. |
| Rust 1.88 formatter | Passed after formatting. |
| Dependency-free native Clippy probe | Passed. Proves toolchain operation only. |
| Application Clippy and Cargo tests in offline mode | Blocked before compilation because the crates.io index has no cached `base64` package. |
| `npm run test:all`, native runtime, platform installers | Not completed. |

No application-native test result, platform support claim, quiet review round or full-PR readiness follows from this table.

## Sources and API checks

- Cargo locks Serde to 1.0.228. Its upstream [`containing_flatten` test](https://github.com/serde-rs/serde/blob/v1.0.228/test_suite/tests/test_enum_internally_tagged.rs) serializes flattened struct fields alongside an internal enum tag. This supports the intended `ReadResult` shape; it does not replace execution of the application's native serialization test.
- The installed Tauri API declares `invoke<T>(cmd, args, options): Promise<T>` in `@tauri-apps/api/core.d.ts`. The generic provides a TypeScript expectation, not runtime payload validation.
- The three-source research gate for the full continuation diff is not complete.

## Dependency advisory

The dependency audit reports five high-severity affected package nodes from one root advisory, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). The advisory covers stack exhaustion from deeply nested brace patterns through `braces` 3.0.3 and lists no first patched version.

The installed chain is `eslint-config-next@16.4.0` to `@next/eslint-plugin-next@16.4.0`, `fast-glob@3.3.1`, `micromatch@4.0.8`, then `braces@3.0.3`. Inspection of the plugin's `get-root-dirs.js` finds the glob call behind an explicit `settings.next.rootDir` value; this repository's ESLint config does not set it. This is a bounded lint-path trace, not proof that every bundled dependency is unaffected.

Do not apply npm's suggested downgrade to `eslint-config-next@14.2.35` automatically. It changes the lint framework across major versions without fixing the root package. No dependency or audit suppression was changed.


## Keychain-only implementation

- `lib/ai/credential-drafts.ts` tracks unsaved values in process memory. Versioned receipts cannot acknowledge a newer re-entry with an older write result.
- Settings persistence always redacts new writes. Existing plaintext copies are held until migration succeeds, without copying them to another destination. Conflicting copies block automatic migration until an explicit credential edit resolves them.
- An early renderer read no longer prevents loading the desktop settings store. This uses a separate desktop-hydration flag.
- Providers retains its existing warning area and shared button. The warning describes session-only drafts, offers retry and identifies conflicting legacy IDs without displaying credential values.
- Every application window uses the credential close check. Browser unload requests receive a warning while drafts remain. Titlebar and native menu actions request window closes instead of bypassing their guards with process exit.
- The old single-window plaintext-recovery test was replaced because the user changed the persistence contract, not to hide its failure. New tests check non-persistence, retry, divergent copies, legacy preservation and independent window state.

Verification still needs real native dialogs and all-window quit behavior. A cancelled close in one secondary window must not be represented as successful application exit. Forced process termination cannot preserve session-only drafts.

## Recovery lesson

A restored checkout retained the working files but started from the original commit. Stashing a tracked directory that had become a symlink failed with a beyond-symlink error. The directory-to-symlink transition required preserving the link target and temporarily removing only the link before taking the checkpoint. No vendored skill body was removed or changed.

The session branch was rebuilt from remote commit `d016359`, rebased onto the updated draft base, and the saved working changes were restored. Both checkpoints were retained. Skills verification confirmed all 53 locked skills afterward. Future recovery must compare the Git ancestry with the saved working tree before applying another base update.


## Further failure-path corrections

Always-redacted writes exposed a first-read bug. `updateSettings` could store a redacted snapshot before initializing the local settings state. A later getter reloaded that snapshot over the live draft. The full suite caught the lost Composio key in the plugin catalog test. Updates now initialize local state before mutation, and a dedicated regression protects the first-edit path.

Recovery also distinguishes a missing account from a versioned clear. An initial empty native account does not authorize deleting a legacy draft. A versioned tombstone or explicit deletion marker does.

Partial legacy migration can leave old endpoint metadata beside a newly persisted key. A failed edit in a modern install can likewise leave an old key beside newly persisted endpoint metadata. Recovery now blocks these tested combinations rather than silently attaching the saved key. Interrupted write markers survive rejected mutations; another operation's persisted snapshot is not an acknowledgement of the submitted edit. Re-entry resolves the recovery conflict.

Tests cover both restart cases with a fake native process and real settings modules. They do not exercise real provider requests or prove endpoint binding under every independent-process or external-file scenario. Those remain part of the full review.

The changed-test TypeScript harness initially lacked Next's styled-jsx ambient declaration. Adding the installed `styled-jsx/global.d.ts` to that external harness restored the intended Next type context. No application diagnostic was suppressed and no dependency was changed.


## Test-model corrections and remaining recovery limits

The native fake originally assigned `initial` to existing raw credentials and discarded saved revisions when simulating restart. The Rust decoder instead hashes legacy credentials and restores persisted revisions. The fake now models both behaviours, retains saved tombstones across restart, and drops only volatile mutations on restart. Restart regressions use that operation rather than reseeding raw values.

A regression now covers concurrent initialization, an edit during the desktop read, and retention of an unmigrated desktop-only credential after the visible draft reaches the vault. The initial implementation skipped the entire incoming desktop snapshot when an edit intervened. The hydration merge described below replaces that behaviour.

The unsupported-vault deletion regression verifies retention of the pending deletion after restart. The first implementation required two retries after the vault became available. Deletion recovery now acquires the missing lease before mutation and checks that no newer intent replaced the deletion. The regression requires one retry and one native deletion.

The initial recovery guards did not bind a key to its endpoint. That gap motivated the scoped record implementation described below.


Recovery conflicts now publish a changed settings snapshot even when the lost draft leaves no live key. Without that notification, the Providers section could keep its earlier render and omit the recovery warning. A regression checks subscriber notification and snapshot identity without inventing an unsaved draft.

Negative controls remove the recovery guards and the unmigrated-ID replacement check separately. The restart assertions and the retained desktop-copy assertion fail, respectively. The original implementation was restored after each experiment.

Before scoped records and the additional close fixes, the frontend suite passed 137 files and 1106 tests. Production TypeScript, the strict changed-test TypeScript project, lint and the static build pass. Lint reports 154 warnings and no errors. Rust formatting passes. Both the application Cargo test and clippy commands stop during offline dependency resolution because `base64` is unavailable. These results do not establish native compilation or runtime correctness.


## Destination-bound records and hydration merge

`AiVaultSnapshot.scope` is an optional, versioned JSON tuple. New nonempty writes require it. The native vault persists the scope, credential and revision in one OS-vault record. A destination-only change advances the revision even if the key is unchanged. Native runtime configuration checks both key and destination. The renderer rejects mismatched hydration even when the separate intent ledger is missing.

Provider scopes include wire format, trimmed base URL without trailing slashes, and resolved auth style. Search scopes include the selected provider. Composio scopes include the resolved user ID. Header credentials share their provider's destination but retain separate credential IDs. `tests/fixtures/credential-scopes.json` is consumed by renderer tests and native tests to detect wire-format drift. The native tests still need execution.

An unbound OS-vault key is not silently assigned to an endpoint. A matching legacy plaintext copy can establish the original pairing. Otherwise Providers offers explicit saved-key review. The dialog identifies destinations without displaying credentials. Cancellation, unavailable keys and changed settings prevent application. Native revision checks reject a key changed by another window while the review was open. Existing keys need not be rotated merely to adopt the new format.

The settings initializer now performs a three-way merge against its starting snapshot. Local field edits win, unrelated saved fields load, arrays remain atomic, and a changed provider or service connection stays intact as a credential-destination pair. Two legacy copies with equal keys but different destinations count as conflicting copies.

Versioned draft acknowledgements now include destination identity. An identical key saved for another endpoint is not success for the current draft. A reproduced failure also showed an earlier in-flight deletion erasing a newer window's unsaved input after a rejected write. The fix reconciles clears only while a deletion intent remains authoritative. The native clear can win its lease without discarding the newer input.

These boundaries do not grant protection from a compromised renderer, external keychain modification by another process, provider-side disclosure or all network redirects. Platform keychain behaviour and native application compilation remain unverified.

## Damaged managed records stay unreadable

`ai_vault::decode` treats a password carrying the `bettershape-vault-v1\n` marker
as a managed record and returns the parse error instead of falling back to the
raw bytes. The marker ends in a newline, so a legacy raw secret cannot carry it;
a prefixed value that does not parse is a damaged record. Importing its bytes as
an API key would resurrect a truncated record and drop its lease identity, and the
record is never deleted — saving a key writes a fresh one. The existing test that
rejects `bettershape-vault-v1\n{broken` is the regression guard, and the reasoning
is documented at `decode`.
