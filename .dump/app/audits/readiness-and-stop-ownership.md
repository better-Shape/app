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
