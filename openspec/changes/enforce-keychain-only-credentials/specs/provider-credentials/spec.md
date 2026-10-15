## ADDED Requirements

### Requirement: Keychain-only persistence
The app SHALL redact provider API keys, service API keys and connection-header values from new settings writes and settings broadcasts regardless of keychain availability.

#### Scenario: Failed save
- **WHEN** the OS vault rejects an edit
- **THEN** the edit remains an unsaved in-memory draft
- **AND** no plaintext fallback is created
- **AND** the user can retry from Providers

### Requirement: Safe legacy migration
The app SHALL retain each existing plaintext settings copy until migration succeeds or the user explicitly supersedes its credentials.

#### Scenario: Conflicting copies
- **WHEN** local and desktop copies disagree
- **THEN** automatic migration is blocked
- **AND** neither copy is silently erased
- **AND** the user is asked to review destinations or re-enter the affected credentials

### Requirement: Unsaved close warning
App-controlled closes SHALL warn before discarding unsaved credential changes.

#### Scenario: Keep the window open
- **WHEN** the user cancels the credential close confirmation
- **THEN** that window remains open with its draft

#### Scenario: New edit during confirmation
- **WHEN** credential state changes while confirmation is pending
- **THEN** the earlier approval does not discard that newer state

### Requirement: Read failure is not absence
An unreadable credential SHALL return no value or revision lease and SHALL NOT authorize clearing a local draft.

#### Scenario: Locked account during hydration
- **WHEN** an inventoried account cannot be read
- **THEN** hydration retains its local draft
- **AND** the failed read does not replace an acquired revision

### Requirement: Interrupted edits must not rebind credentials
The app SHALL NOT automatically hydrate an older saved credential into an endpoint configured by an unfinished edit.

#### Scenario: A failed key edit is lost on restart
- **WHEN** the old key remains in the vault and the new in-memory draft is lost
- **THEN** the unfinished write blocks automatic recovery
- **AND** explicit destination review or credential re-entry is required before applying the provider configuration

### Requirement: Durable credential destinations
A new nonempty vault record SHALL store the credential and its destination identity atomically. Runtime configuration and hydration SHALL reject a mismatched destination.

#### Scenario: Stale settings survive restart
- **WHEN** settings contain an older endpoint than the saved vault record
- **THEN** the saved credential is not hydrated into that endpoint
- **AND** the original vault record remains unchanged

#### Scenario: Same key, different destination
- **WHEN** a user changes the destination while retaining the key value
- **THEN** the vault mutation advances the revision
- **AND** an earlier save acknowledgement does not mark the later destination edit saved

### Requirement: Explicit saved-key review
The app SHALL allow a user to review saved-key destinations without exposing key values or requiring key rotation.

#### Scenario: Legacy key lacks a destination
- **WHEN** an available persisted key has no recorded destination
- **THEN** the user can approve its selected destination
- **AND** cancellation makes no credential mutation
- **AND** a settings change during review invalidates the approval
- **AND** a concurrent native mutation remains protected by its revision

### Requirement: Close waits for actual saves
A window SHALL remain open when saving fails, never acknowledges, leaves dirty files, or a new editor or credential edit occurs after close approval.

#### Scenario: Slow save
- **WHEN** saving takes longer than 400 milliseconds
- **THEN** closing waits for completion rather than discarding the editor

#### Scenario: Hanging secondary-window IPC
- **WHEN** enumeration, listener registration or a close request fails to finish within the close deadline
- **THEN** the main window remains open
- **AND** late registrations are cleaned up without issuing a late close
