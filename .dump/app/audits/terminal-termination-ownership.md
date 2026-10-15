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
