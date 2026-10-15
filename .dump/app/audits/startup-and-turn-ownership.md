# Startup and turn ownership

## Contracts and implementation

| Boundary | Owner and rule | Evidence |
| --- | --- | --- |
| Provider startup | `lib/ai/bootstrap.ts` shares one initialization across the layout and early senders. It awaits settings, starts credential synchronization and waits for that queue. Releasing the last owner unsubscribes only after pending hydration settles. | `tests/lib/ai-bootstrap.test.ts`: early send, shared ownership, failure/retry, abort and pending-owner release. Mounted queue tests verify the composer remains intact while waiting. |
| Optimistic send | Request ids identify a WebView and JSON-encoded conversation lane plus a monotonically increasing sequence. A local start must still match a live optimistic owner. Native dispatch rechecks ownership after asynchronous preparation. | Mounted `chat-stream-store` regressions cover Stop before binding for an existing chat and a draft, including late starts after a replacement. The committed implementation failed these cases. |
| Native Stop | A request-scoped Stop records a per-lane cancellation watermark even without an active native turn. Once active, it matches the request, not the backend's current-conversation pointer. It reserves cleanup ownership so a replacement cannot be admitted while old Stop cleanup is pending. | `core/turn_order.rs` executes the production admission and cleanup-guard functions in dependency-free Rust tests. The `AgentState` integration test additionally checks the wrapper, but requires the blocked Cargo gate. |
| Turn ordering | Native admission assigns an ordinal inside the in-flight lock. Turn ids are `<u64>:<uuid>`. Starts and completions carry that same id. The frontend compares exact bigint ordinals per conversation and seeds ordering on native restoration. | `tests/lib/turn-order.test.ts` exercises 10,000 turns with one retained entry, cross-conversation order, completion-before-start and integers beyond JavaScript's safe-number limit. Native counter tests reject overflow instead of wrapping. |
| Startup close | Tauri's builder-level close handler retains managed application windows before JavaScript starts. The existing renderer handler still controls consent and calls `destroy()` only afterward. Unknown/native-only window labels are not trapped by this policy. | Dependency-free `core/window_close.rs` label-policy tests; renderer registration-failure regression and existing consent/save/rollback tests. Actual Tauri window lifecycle execution remains unverified. |

## Compatibility and limits

The ordinal prefix changes the internal turn-id contract. The new renderer and native producer must ship together; this is not compatibility with an old backend serving a new renderer. The existing journal writer sanitizes ids before making Windows filenames, and journal readers retain the original opaque id in JSON. No UUID parser consumes main-chat turn ids. Subagent turn ids are separate and do not produce the main-chat `chat_started` event.

Legacy callers may still stop an already-known conversation without a request id. `browse-frame` retains that existing path. Request-scoped Stop does not fall back to a different current chat. Cancellation checks before admission and after cancellation-token installation prevent an early Stop from being lost; they do not claim that every preflight network request is synchronously interruptible.

Ordering memory is proportional to observed conversations, not total turns. Cancellation memory is proportional to observed sender/conversation lanes, not total cancelled requests. Neither is a claim of globally constant memory regardless of how many conversations or WebViews are created.

A bounded LRU of arbitrary completed UUIDs was rejected: evicting a tombstone permits an old start to resurrect that turn. Ordinals preserve the rejection rule without storing every historical id.

## Primary source trace

Pinned Tauri 2.11.2 `crates/tauri/src/manager/window.rs`, lines 170–174, prevents native close only when a JavaScript close listener already exists, then emits the close-request event. That confirms the startup gap. The installed Tauri JavaScript `Window.onCloseRequested` awaits the handler and calls `destroy()` only when it did not prevent default. The application handler always prevents default and makes its own consent-based destroy decision. The native builder guard therefore closes the startup gap without replacing the consent protocol.

## Verification scope

Frontend mounted tests and strict typechecks cover renderer behavior. Standalone native Rust tests exercise the production standard-library admission, cancellation-watermark and label-policy code, not substitutes for those functions. They do not compile the Tauri SDK callbacks, the complete AgentState, platform-specific code or installers. Cargo tests and clippy remain required. No independent-subagent review or full-platform readiness is claimed.

## Terminal cleanup and output

Stop previously drained the global terminal-id set after asynchronous preview teardown. That could kill another chat's terminal or a newly registered command. Each registered session now retains its cancellation token, including child tokens. Stop selects cancelled owners rather than draining all sessions. Foreground cancellation still kills its own session directly. Exit callbacks remove background sessions from the registry. The broader restore-checkpoint path retains its existing all-terminal cleanup and is not covered by the scoped Stop guarantee.

The empty-content browser-finish wait delayed Stop's synchronous cleanup without producing markup. Stop now seals the latest available frame and completes synchronous cleanup before its preview-drain await. This is not proof that every global browser or preview resource has conversation-scoped ownership. Concurrent switching and those shared native resources still require integration testing and further ownership review.

The terminal prompt detector drained a byte offset from a UTF-8 string at its 8,000-byte limit. A multi-byte character crossing that offset panicked. The prompt detector and PTY output store now use `core/bounded_text.rs` to retain a suffix at a character boundary. Dependency-free Rust tests exercise an emoji across the 8,000-byte cut, zero and exact budgets, and a budget smaller than one character.

The `AgentState` test for cancelled terminal owners and their child tokens has not executed because dependency resolution blocks the native test target. Its presence is not a passing test result.

## Restored request identity

An in-flight record alone does not preserve request-scoped Stop across a renderer reload. `ChatGenerationState` must expose the request id, and `reloadViewedMessages` must copy it into the restored live owner. Otherwise Stop falls back to conversation-only cancellation and can target a replacement after a delayed native dispatch. The mounted restoration regression failed with a null request id before that transfer was added. Native and TypeScript snapshot types now both carry the optional field. Legacy snapshots without the field remain readable.
