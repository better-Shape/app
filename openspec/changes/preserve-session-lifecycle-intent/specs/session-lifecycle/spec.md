## ADDED Requirements

### Requirement: Retry incomplete credential hydration
The application SHALL retry failed credential hydration before persistence on explicit retry without overwriting intervening credential or destination edits.

#### Scenario: Keychain unlock after startup
- **WHEN** the keychain was unavailable at startup and the user unlocks it and retries
- **THEN** untouched saved credentials are loaded without restarting
- **AND** edits made while the retry was pending remain authoritative local intent

### Requirement: Isolate independent shelf writes
The application SHALL persist disposition changes to different chats independently and preserve readable legacy intent and explicit clears.

#### Scenario: Two WebViews change different chats
- **WHEN** both WebViews start with stale snapshots and change different chats
- **THEN** both changes survive restart
- **AND** waking one expired snooze does not replace another chat's disposition

### Requirement: Fence preview process lifetime
The application SHALL observe preview exit events before spawning and SHALL NOT grant design authority to a stopped or already exited startup.

#### Scenario: Exit precedes the spawn reply
- **WHEN** the owned PTY exits before the spawn command returns its id
- **THEN** startup fails without retaining preview authorization
- **AND** listeners are released and a later start may retry

### Requirement: Reauthorize replacement previews
The application SHALL revalidate project, origin and service identity before replacing an existing design frame.

#### Scenario: Service replacement overlaps registration
- **WHEN** another owned PTY becomes ready while a prior registration is pending
- **THEN** the latest service is revalidated after the prior attempt
- **AND** an obsolete or foreign-project service cannot commit the frame

### Requirement: Viewing history preserves lifecycle intent
Opening a history row SHALL NOT clear its explicit snoozed or settled disposition.

#### Scenario: View a dormant session
- **WHEN** the user opens a snoozed or settled history row
- **THEN** the session opens without implicitly resuming it

### Requirement: Main close consent precedes peer closure
The main window SHALL finish its credential and file prompts before initiating secondary closures and SHALL revalidate approval afterward.

#### Scenario: Cancel main close
- **WHEN** the user cancels the main window's unsaved-file prompt
- **THEN** no secondary window is closed by that request
