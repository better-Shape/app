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

#### Scenario: Replacement cannot be reached
- **WHEN** a replacement probe fails after startup has completed
- **THEN** the canvas shows a connection error rather than indefinite loading
- **AND** a subsequent valid readiness event may reconnect

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

### Requirement: Sends wait for provider initialization
A send SHALL share the settings and keychain initialization owner and SHALL NOT interpret an unhydrated credential snapshot as an unconfigured provider.

#### Scenario: Send before startup finishes
- **WHEN** the user sends before credential initialization finishes
- **THEN** the send waits without clearing the composer
- **AND** cancellation or unmount before readiness prevents that send
- **AND** failure preserves the draft and reports initialization failure

### Requirement: Request-scoped cancellation
Stop SHALL identify the originating send before the backend assigns a conversation or turn id. A cancelled request SHALL NOT revive the frontend or cancel a replacement or unrelated conversation.

#### Scenario: Stop precedes native admission
- **WHEN** Stop arrives before its request enters the native in-flight map
- **THEN** the request's cancellation watermark is recorded
- **AND** that send observes cancellation before running the main agent turn
- **AND** another conversation or newer request remains eligible

#### Scenario: Cleanup outlives the cancelled run
- **WHEN** the cancelled run releases its active slot before Stop finishes asynchronous cleanup
- **THEN** replacement admission remains blocked until cleanup releases its guard

### Requirement: Ordered turn lifecycle
Native turn admission SHALL assign a monotonically increasing u64 ordinal while holding admission ownership. The ordinal SHALL be carried as a decimal prefix in the opaque turn id. The renderer SHALL retain at most one ordering watermark per observed conversation, rather than one tombstone per completed turn.

#### Scenario: Delayed start after completion
- **WHEN** a completed or superseded turn's start arrives after newer lifecycle events
- **THEN** it cannot replace the current turn
- **AND** ordering remains independent across conversations
- **AND** restoring an active native turn seeds the same ordering check

#### Scenario: Invalid turn identity
- **WHEN** a start has no valid ordinal or exceeds u64 range
- **THEN** it grants no live-turn ownership

### Requirement: Native close defaults to retaining application windows
Managed application windows SHALL prevent native close before renderer listener registration and SHALL close only through the renderer's explicit destroy decision after consent.

#### Scenario: Close while JavaScript is starting
- **WHEN** a close request arrives before the application's listener is installed
- **THEN** the native handler retains the window
- **AND** listener registration failure is reported without destroying drafts
