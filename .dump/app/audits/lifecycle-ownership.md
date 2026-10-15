# Lifecycle ownership and retry contracts

This is scoped engineering evidence for credential retry, shelf metadata, preview startup/reconnection and close ordering. It is not a whole-branch review or a native execution result.

## Ownership decisions

| Boundary | Owner and invariant | Regression evidence |
| --- | --- | --- |
| Keychain retry | The existing sync queue retries incomplete hydration before persistence. Failed probes and partial reads do not mark hydration complete. Edits, removed descriptors and destination changes remain fenced until hydration succeeds. Ordinary settings notifications do not repeatedly read an inaccessible vault. | `tests/lib/ai-sync.test.ts`: locked startup, partial reads, edits during retry, and bounded hydration requests. Three added cases failed before the fix. |
| Shelf metadata | Each chat owns `bettershape-sidebar-dispositions:v2:<encoded-id>`. Different chats never share a read-modify-write record. Legacy aggregate metadata is a read-only seed; per-chat values and null tombstones override it. Failed writes remain local and are retried on a subsequent mutation. | `tests/sidebar/disposition.test.ts`: independent module instances with stale snapshots, waking one chat while another changes, legacy clears, failed writes/reads and remounts. The two cross-window cases failed before the fix. |
| Preview PTY | All listeners register before spawn. A provisional owner buffers readiness and exits until the returned id selects its PTY; an early exit cannot grant authority. Overflow fails closed. Stop invalidates pending starts and late spawned PTYs are killed. | `tests/features/background-preview-service.test.ts`: early exit, unrelated exit, cancelled start, failed listener registration and asynchronous unlisten errors. Three new cases failed before the fix. |
| Design reconnect | An opened frame is reusable only while its service authorization remains current. A replacement registers and probes again, clears stale selection state and reloads the frame. A replacement event arriving during an older registration is retried after it, with fresh authority checks. | `tests/features/design-reconnect.test.tsx`: actual mounted DesignStudio/frame replacement, overlapping service replacement and wrong-project rejection. Two cases failed before the fix. |
| Viewing history | Opening a row clears unread state, not explicit snoozed/settled intent. Resume/drop actions still change disposition. | `tests/sidebar/chat-list.test.tsx`: real row clicks preserve both states with Windows and Darwin fixtures. Four cases failed before the fix. |
| Main close | Main-window consent precedes secondary closure. Credentials/editor revisions and generation state are rechecked after secondary closure; cancelled/changed closes retain recovery and roll back native dirty flags. | `tests/features/client-bootstrap.test.tsx`: cancel, approval ordering and edits during secondary closure. Three cases failed before the fix. |

## Primary implementation checks

- Installed `@tauri-apps/api` 2.11.0 `event.js`: `listen` resolves after the registration invoke, but its returned unlisten closure is async even though the public type is void-returning. Cleanup handles both synchronous throws and rejected promises. Listener registration is awaited before invoking spawn.
- Installed jsdom 29.1.1 `Storage-impl.js`: `setItem` updates one map entry and schedules storage events asynchronously. Tests use independent module instances sharing that real implementation, rather than a mocked atomic map merge. This tests the frontend protocol, not cross-process native WebView delivery.
- [Tauri 2.11.2 webview source](https://github.com/tauri-apps/tauri/blob/tauri-v2.11.2/crates/tauri/src/webview/mod.rs), blob `b89d3c95d0e841992542afb97b8c5c9deb87b720`, matches Cargo.lock. Lines 204–210 document the macOS controller as WKUserContentController and return the manager pointer, distinct from the WKWebView handle. Lines 1608–1613 specify that with_webview executes on the main thread. Those contracts contradict reports that the pointer is a WKWebView or that these callbacks arbitrarily change threads. They do not prove platform execution succeeds.
- [React state-adjustment guidance](https://github.com/reactjs/react.dev/blob/main/src/content/learn/you-might-not-need-an-effect.md), inspected blob `81a0842eb60f53c3f97e56f6c4d9e8b18bf846d8`, lines 205–247: conditional same-component state adjustment during render is supported. The sidebar's guarded worker-count adjustment is not an unconditional render loop and was not moved to an effect merely to satisfy a review preference.

## Limits and rejected shortcuts

Reading the old shared shelf map immediately before writing it would still allow a lost update between WebViews. No such merge is claimed atomic. Same-chat writes remain last-writer-wins; the legacy seed is retained for migration, not a dual-write compatibility protocol for concurrently running older app versions.

The bounded secondary-close deadline remains fail-closed: it keeps the main window open rather than forcing an unresponsive peer closed. Main-window cancellation does not undo already-approved secondary closures if a later revision change occurs; a fully atomic multi-window close would require a separate prepare/commit protocol.

Mocked IPC, jsdom, strict types and static export do not establish real OS-keychain behavior, native process event ordering, macOS/Windows cfg compilation, installer support or native UI behavior. Those gates remain separate requirements. There is no independent-subagent review evidence.
