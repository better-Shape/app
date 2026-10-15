# Credential persistence and close safety

## Decision

Credentials persist only in the OS vault. Failed writes remain unsaved drafts in the owning window. The app does not write a plaintext recovery file for credentials. File-editor recovery remains separate and contains project text, not provider settings.

## Owners and boundaries

- `lib/settings/store.ts` owns settings hydration, redaction and legacy-copy preservation. `lib/settings/hydration.ts` merges early edits with unrelated persisted settings.
- `lib/ai/credential-drafts.ts` owns in-memory credential versions and destination identities. A save receipt must match both before it can clear an unsaved indicator.
- `lib/ai/vault.ts` owns renderer intent metadata and observed native revisions. Shared metadata contains IDs and generation tokens, never credential values.
- `lib/ai/sync.ts` coordinates hydration, migration, saved-key review and runtime configuration. It does not copy a newer window's key into an older window's destination.
- `src-tauri/src/core/ai_vault.rs` serializes native mutations within the application process. The OS-vault record stores the key, revision and destination together.
- `lib/window/close-guard.ts` owns app-controlled close approval and is installed by `app/client-layout.tsx`. `lib/window/close-others.ts` bounds secondary-window coordination, and `lib/workspace/save-all.ts` requires actual save acknowledgements.

## Persistence protocol

A read reports either an available snapshot or an unavailable account. Only an available snapshot grants a revision. A missing account is an available empty snapshot, not a read error.

A mutation supplies the observed revision. Native code rejects a stale revision without applying the mutation. A failed OS-vault write retains the logical mutation in native memory and reports `persisted: false`. A clear writes a non-secret generation record so a stale write cannot recreate a deleted key after restart. Removing the entire account would lose that protection.

New nonempty records include a versioned destination tuple. Provider tuples include wire format, effective base URL and auth style. Search tuples name the search provider. Composio tuples name the account. Header values use their provider's destination and a distinct credential ID. The shared fixture is `tests/fixtures/credential-scopes.json`.

The renderer never treats an empty conflict response as permission to clear a newer write draft. Deletion recovery may acquire a missing lease, but checks the current intent again after that read.

## Upgrade and recovery

Existing plaintext settings copies remain untouched until their credentials migrate or the user explicitly supersedes them. Equal key strings at different destinations still conflict. A matching legacy copy can establish an unbound vault key's destination.

Otherwise the user can review saved keys. The dialog lists destinations without key values. It refuses unavailable or unpersisted values, makes no change on cancellation, and invalidates approval if settings or draft revisions change. Native revision checks still apply after approval. An orphaned header stays in the vault but is neither restored into a missing header descriptor nor treated as a blocker for unrelated configuration.

## Close and file saves

A main window with active generation hides rather than destroys itself. The close path checks generation again after dialogs and saves. Credential approval does not authorize a later credential edit.

Save All supplies promises through the existing event boundary. The close path waits for them, checks native dirty files again, and rejects approval after a new editor edit. A successful file write acknowledges only matching recovery content. A newer draft keeps its content and receives the new saved baseline. Editors stage recovery in memory before waiting for native dirty-state updates and debounce localStorage writes. Unmount flushes pending recovery. Mounted save receipts reconcile against the current document, not an earlier React render or broadcast.

The file loader associates text with its path and retains the disk baseline when restoring a draft. An agent write updates the disk baseline without deleting unsaved editor text. The titlebar prefers a synchronous mounted-editor snapshot, then recovery, then a cached broadcast, then disk.

The file dialog distinguishes Save, Don't save and Cancel. Cancellation and unknown dialog results do not discard. A discard prepares native dirty-state changes before deleting recovery copies, then checks approval again. An aborted or failed discard restores dirty flags. Failed rollback remains pending for the next close attempt rather than trusting a stale clean flag. Failed window destruction restores unchanged recovery copies without overwriting newer copies.

## Limits and verification

The native coordinator protects windows in one application process. It is not an inter-process OS-keychain transaction. External keychain edits, compromised renderers and network redirect policy are outside this protocol's guarantees.

Renderer tests exercise failed persistence, interrupted migration, conflicting windows, destination changes, review cancellation, delayed saves and discard rollback. Rust tests cover record encoding, tagged read results, revision rejection and destination fixtures, but require execution with the native dependencies installed.

A real app pass remains necessary for platform dialogs, OS-vault locking and unlocking, popout editors, application exit, native dirty-event ordering and packaged upgrades. No installer or cross-platform support claim follows from the renderer tests.
