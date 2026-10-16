# Terminal termination and retained ownership

## Failure and ownership contract

The agent registry used to remove cancelled command registrations before calling
native termination. The native registry also removed its entry before killing the
child, ignored errors, and reported an exit. Foreground cancellation independently
ignored the termination result. A failed kill could therefore lose both owners.

The revised path keeps both registrations until the process reports an exit.
`commands/pty/exit_status.rs` polls under a short child lock, issues one kill, and
polls for confirmation. A kill error, poll error, poisoned lock, or confirmation
timeout returns an error without consuming the child. The polling and lock-wait
budget is two seconds per child. It does not interrupt a blocking platform kill
implementation or a platform handle destructor.

`PtyState` clones share the same registries. The kill RPC performs termination,
owner comparison, and resource destruction in a blocking task. Registry locks do
not cover polling or session destruction. Synchronous application exit uses the
same termination policy. Kill-all attempts the other registry even when one is
poisoned, and it attempts other children after a child fails.

Agent registrations retain their cancellation token, conversation, request id,
and native metadata identity. Completion removes an entry only when its `Arc`
identity still matches. Native cleanup also compares metadata identity, including
pruning. An old command cannot kill or unregister a replacement that reused its
numeric id. Registrations whose termination failed remain selectable for a later Stop. Foreground
cancellation reports an error instead of emitting a successful cancellation when
native termination fails.

Process-status queries and readers no longer translate observation errors into
exit notifications. Unknown status is not successful completion. The common
`core/session_ownership.rs` helper returns the removed resource to its caller,
which drops it after releasing the registry lock. Returning only a boolean here
would destroy the PTY or child while the registry was locked.

## Spawn and turn ordering

Automatic session ids use a wider counter and reject exhaustion rather than
reusing `u32::MAX`. Native spawning rejects ids that are still owned by an active session.
Id allocation, PTY reader/writer preparation, and registry lock acquisition happen
before spawning a child, so those failures cannot leave an unregistered process.
The ConPTY startup reply still happens after the child is spawned.

The primary Stop path keeps its admission guard while waiting up to five seconds
for its original turn to release the in-flight slot. It reports an error if the
slot remains occupied. It does not clear the slot on the run's behalf. Retired
request retries select only that request's cancelled terminals. Stop and restore
rescan registrations after the old turn releases its slot, covering a tool that
was already spawning when the first terminal snapshot was taken.

Checkpoint restoration uses the same admission barrier, cancels only the target
conversation's terminals, waits for its original turn to unwind, and rechecks the
active conversation and project before changing history or selecting checkpoints.
This is not a transactional checkpoint/filesystem recovery implementation.

Concurrent duplicate Stop requests still need end-to-end validation. In particular,
a request that finds no matching active turn and no retained terminal may return
before another Stop's capture cleanup finishes. The renderer queue admission and
Send Now ordering reviews are not closed by these changes.

## Verification

The actual production `exit_status`, `session_ownership`, and `turn_order` sources
pass 26 isolated Rust 1.88 tests and isolated Clippy with warnings denied. Tests
cover failed kills and retry, accepted kills without exit, poisoned and busy child
locks, observation errors, exit/kill races, retained handle identity, numeric id
exhaustion, admission guards, and resource destruction after unlocking. The Unix
process tests kill and reap a real child and exercise output EOF before exit.

Mutation controls reproduce ignored kill errors, premature success, unconditional
id-based removal, and saturating id allocation. These are fault-injection controls,
not an execution of the entire old Tauri implementation.

The full Tauri dependency graph remains unavailable in this environment. These
helper results do not compile or execute the Tauri command wrappers, AgentState,
PTY registry integration tests, or platform-specific spawn code. Full Cargo tests
and Clippy, real application Stop/Send Now scenarios, and installers remain
required. No Windows, macOS, or descendant-process termination claim follows from
the isolated Linux results.

The termination policy confirms the directly owned child. It does not establish
Unix process groups for piped commands, add Windows Job Objects, guarantee that
all descendants exit, or guarantee recovery after the application itself exits.

## Research

- Rust 1.88 `std::process::Child` documents that `try_wait` is nonblocking, reaps an
  exited Unix child, and retains the successful status for later polls.
  [Source](https://github.com/rust-lang/rust/blob/1.88.0/library/std/src/process.rs)
- The portable-pty publication-preparation commit below declares version 0.9.0.
  Its child trait returns `io::Result` for kill and polling. Unix kill sends SIGHUP
  to the direct child, checks a short grace period, then calls the standard child
  kill. This source comparison is not a checksum verification of the published
  crate archive.
  [Manifest](https://github.com/wezterm/wezterm/blob/f8921727a11b9f8b073e8c24821d72fd41283500/pty/Cargo.toml)
  [Child API and kill](https://github.com/wezterm/wezterm/blob/f8921727a11b9f8b073e8c24821d72fd41283500/pty/src/lib.rs)
- The Unix and ConPTY master implementations prepare reader and writer handles
  independently of spawning the child. Taking the writer twice is invalid.
  [Unix](https://github.com/wezterm/wezterm/blob/f8921727a11b9f8b073e8c24821d72fd41283500/pty/src/unix.rs)
  [ConPTY](https://github.com/wezterm/wezterm/blob/f8921727a11b9f8b073e8c24821d72fd41283500/pty/src/win/conpty.rs)
- Tokio-util 0.7.18 has no public cancellation-token identity comparison. An
  application-owned `Arc` supplies registration identity independently of token
  cancellation state.
  [Source](https://github.com/tokio-rs/tokio/blob/tokio-util-0.7.18/tokio-util/src/sync/cancellation_token.rs)

The backend changes retain the existing renderer layout and tokens. Design and
baseline documents were read. The antislop code/copy rules and unslop constrain
the comments, error text, and this record. No assets, dependencies, capabilities,
or telemetry were added.

## Stop diagnostics and cleanup completeness

A follow-up review round on the published native batch raised eight points. Six
were reproduced and fixed, and two are refuted with the reason recorded here.

Fixed:

- `PtyState::session_is_running` treated a poisoned session registry as "status
  unavailable", which made `read_session_output` fail while the metadata still
  reported the command running. The metadata is authoritative for the running
  state, so an unreadable registry now falls back to it and leaves the handle
  registered for a later Stop.
- `kill_owned_session` returned one message for a replaced registration, an
  already released record and an unknown id. `OwnershipLoss` now classifies those
  cases (`core/session_ownership.rs`) and the message names the condition.
- `exit_status::terminate` reported lock contention and a survived kill with the
  same timeout error. Contention is now `WouldBlock` ("child was busy"); a
  process that survived its kill stays `TimedOut` ("did not exit").
- `kill_tracked_terminals` returned only the first failure, hiding terminals that
  still needed a retry. Every failure is now reported, and a single failure keeps
  its original message.
- `restore_checkpoint` killed a lane's terminals twice around the turn-cleanup
  wait. The sweep is now `kill_terminals_for_conversation_exhaustive`, which
  documents why the second sweep is not redundant.
- The retried-cleanup gate is now `turn_order::claim_lanes`: it *takes* each lane
  the retry is about to kill or refuses all of them, instead of observing the
  lanes and killing after the lock is released, which left a window for a Stop to
  claim the lane and tear the same session registry down underneath the retry.
  The guards keep replacement admission out until the kills finish, and its lane
  scope is documented rather than incidental.

- `TerminationTarget::terminate` recorded `-1` for every stopped session, including one whose process
  had already exited before Stop polled it, which reported a clean exit as a killed session.
  `exit_status::terminate` now returns `Terminated { code, killed }`: a process that had to be killed
  keeps the cancellation marker (`-1`), an already-exited one reports the status it exited with, and a
  kill that failed but raced an exit reports that exit (nothing was killed).
- `pty_kill_all` reported only the first failure and only the first unreadable registry; both are now
  aggregated, naming every session that still needs a stop (`aggregate_cleanup_failures`).
- The PTY reader thread checked the session cancellation token at the top of every iteration, so a
  Stop that landed while the reader was publishing one chunk ended the drain before the bytes the
  process had already written - the tail of a stopped command's output, including anything it
  printed on the way down - were read. The check is gone: a Stop publishes the session's status
  (see `terminate` and `Terminated { code, killed }` above) and leaves the drain alone, and the loop
  ends at end of file or on a read error, which is what a killed child produces once its last
  writer is gone. A descendant that keeps the PTY open keeps that reader blocked, which is the
  documented process-tree boundary rather than a reason to discard output, and nothing waits on the
  reader to publish an exit (`mark_exited` and `exit_notify` carry that state).
  `PtySession::cancellation_token` and `TerminationTarget::Pty::cancellation_token` were removed
  with the check: they had no remaining reader anywhere in the crate, and a write-only cancel token
  is what invited the discarded-tail bug in the first place. `wait_for_session_exit` keeps its own
  owner-scoped `CancellationToken`, which is a different mechanism and unchanged.
Refuted:

- Making `TerminalOwner::native_session` a required field would break the
  fast-exit path: a command that exits immediately can be unregistered before the
  window registers it, so registration must accept a missing handle. The actual
  failure mode is fail-closed — `kill_registered_session` refuses to stop an
  unidentified process, keeps the session tracked, and Stop can be retried. That
  rationale is now in the function's documentation.
- Reporting `cancelled: true` when a kill cannot be confirmed would claim a live
  process had stopped. The result keeps `cancelled: false`, carries the failure
  text, and the session stays tracked, so the caller shows a backgrounded command
  with an explicit retry. The field's meaning is documented at its definition.

Verification: `rustfmt --edition 2021 --check` is clean on all seven changed
files and on all 39 changed Rust files of this branch, the dependency-free harness
compiles the real `exit_status.rs`, `session_ownership.rs` and `turn_order.rs`
sources and runs 36 tests (48 with the eight further dependency-free modules of
this branch added), and `cargo clippy --all-targets -- -D warnings` is clean for
that set on linux-gnu, linux-musl, windows-msvc (x64 and arm64) and macOS (x64 and
arm64) - type-checks for the non-Linux targets, execution only on Linux. See
`native-toolchain-and-cross-target-verification.md` for the toolchain and the
controls that prove the Windows-only branch is really compiled.
`agent/models/mod.rs`, `commands/pty/mod.rs`, `agent/commands/terminal.rs` and
`agent/commands/conversation.rs` are Tauri-dependent and are **not** compiled by
that harness; full Cargo compilation and Clippy of the application crate remain
required and are still blocked by uncached dependencies in this environment. The
reader and token change above is inside `commands/pty/mod.rs`, so its only machine
check on this branch is `rustfmt --edition 2021 --check`, which parses the file
(exit 0, no diff); its correctness argument is the one written next to the loop.
