# Provider readiness and Stop ownership

## Initialization settlement is not send readiness

`lib/ai/sync.ts` has two callers with different requirements.

- A send must wait for the current serialized configuration queue and reject if Rust did not accept the provider configuration.
- Bootstrap cleanup and credential recovery must wait for that queue without requiring successful configuration. Recovery exists to repair a configuration that is not ready.

`aiConfigReady` checks health after `aiConfigSettled` drains the queue. Native configuration failure invalidates the last-applied cache, because a failed IPC acknowledgement does not prove the native side made no change. A later retry must submit the configuration again.

An initial implementation changed readiness to reject but left `reviewSavedCredentials` calling it. That prevented review of the very conflicts the recovery action needed to repair. The recovery caller now waits for settlement. The vault fallback tests explicitly expect blocked send readiness in conflict scenarios and retain their original assertions about key retention, destination binding, cancellation and migration. Successful recovery tests still require the original recovery result.

`tests/lib/ai-bootstrap.test.ts` separately covers release before initialization starts, release during settings hydration and release while keychain synchronization remains pending. The owner checks its user count before and after the non-cancellable settings load.

## Stop acknowledges captured ownership

`prepareStop` captures a live turn without retiring it. A failed native Stop leaves that turn available for further tokens and another Stop attempt. After acknowledgement, the commit follows the captured request through draft-to-conversation binding. It does not use the currently selected tab or the last draft's conversation ID.

If completion or a replacement removes that owner before acknowledgement, commit does nothing. The native turn ordering watermark is never rolled back. Stops for the same request share a promise; other requests keep independent ownership.

Send-now queue operations restore the selected entry when Stop fails. Their force-send and drain flags reset in `finally`, including the failed Stop path.

## Diff scanning

`scripts/ci/check-secrets.mjs` reads Git's added hunk lines, not arbitrary lines beginning with a plus sign. File headers and removals are not additions. Added content that itself begins with plus signs remains subject to scanning.

The scanner removes only complete GitHub secret-reference expressions before matching credential values. An example marker, environment variable name or secret reference elsewhere on a line does not exempt a literal credential. Diagnostics never include the matched text. The workflow uses `pipefail` so a failed Git diff cannot become a successful scan of empty input.

## Native API review evidence

The following sources describe contracts, not proof of a native installer or runtime test.

- Tauri 2.11.2 documents `with_webview` as executing its closure on the main thread. Its public example casts `controller()` to `WKUserContentController`, and the controller accessor returns the manager pointer. See [the upstream implementation and example](https://github.com/tauri-apps/tauri/blob/tauri-v2.11.2/crates/tauri/src/webview/mod.rs#L1608-L1675) and [the controller accessor](https://github.com/tauri-apps/tauri/blob/tauri-v2.11.2/crates/tauri/src/webview/mod.rs#L204-L211).
- The [objc2 WebKit bindings](https://docs.rs/objc2-web-kit/0.3.1/objc2_web_kit/struct.WKUserContentController.html) expose `userScripts`, `addUserScript` and `removeAllUserScripts`. They do not expose the suggested individual `removeUserScript` method. The bridge retains the existing array and re-adds each non-bridge script object in order, rather than reconstructing scripts with different injection settings.
- These contracts do not settle separate concerns about WebView recreation, late installation after timeout, current-document injection or platform execution. Those require their own fixes and verification.

## Retry generation and export authority

A cancelled PTY start retains responsibility for killing its eventual native process. A same-command retry must not reuse that cancelled promise or race its cleanup. The starting record carries its generation; a caller waits for an obsolete start to settle before admitting its replacement.

Keychain availability probes also have generations. Concurrent callers share one probe, while manual retry invalidates earlier results. A delayed failure cannot overwrite a successful retry, and a delayed success cannot resurrect stale availability. Callers of an obsolete probe follow the current generation's result.

The separate design-export response listener must validate the same frame, authorized origin, editing root and live service as the general bridge listener. It captures its authorization when sending the export request and revalidates on receipt. A matching request ID and WindowProxy alone do not authorize a response after cross-origin navigation or service replacement. Mounted regressions exercise the actual export callback, rather than only the shared predicate.

The added-line scanner covers the legacy OpenAI `sk-` form as well as longer prefixed forms. Secret-shaped test values are assembled in the executable fixtures rather than stored as credential literals.

## Removal persistence and gesture ownership

A pending recovery deletion is durable state, not the absence of work. If flushing a null dirty-buffer entry fails, unload must remain guarded; otherwise the old recovery payload survives and can reappear on restart.

Sidebar dispositions use a read-only legacy seed plus independent per-chat records. Only a valid legacy-seeded disposition requires a null override. Clearing a newer chat removes its own record, preventing unbounded accumulation of unnecessary tombstones. Failed reads/removals retain the window's pending intent; a clear must not guess whether a legacy seed exists when storage cannot be read. Do not passively garbage-collect tombstones with an unlocked read/remove pair, which could delete another WebView's intervening update.

PR close-sweep eligibility, hit containment and candidate selection are separate predicates. Repository-owned closing state resets during guarded render, while the layout-effect generation still revokes old gesture listeners before layout-phase input. Closing mutations remain serial; a repository round-trip cannot revive an obsolete sweep.

## Independent recovery records and bounded titlebar fallback

Editor recovery no longer read-modify-writes one shared array. New writes target an encoded per-path v2 record. The v1 array/object remains a read-only seed; only legacy-seeded clears need tombstones. Partial flushes retain unsuccessful intents, and clears/read failures stay visible to unload protection. Interleaved WebView writes to different paths cannot delete each other's recovery. Same-path recovery is still not a versioned cross-window merge.

A window retains the unsaved buffers it edits or explicitly adopts from recovery until save/discard, including during storage-read outages. This is necessary unsaved work, not a cache of every clean file visited. The titlebar can therefore retain only the latest legacy broadcast: mounted editors answer a synchronous flush, and older unsaved documents remain in recovery. Cache reduction must not discard that fallback ownership.

PR action rollback holds the immutable optimistic-entry identity and the prior expiry. A failed request can restore only its own still-current entry, without extending the prior trust window or overwriting a newer owner. Canonical refresh/expiry can retire an owner before a network failure arrives; that failure must not resurrect it.
