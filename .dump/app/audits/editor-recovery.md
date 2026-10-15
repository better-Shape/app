# Editor recovery boundaries

## Decision

`lib/workspace/dirty-buffers.ts` owns project-text recovery. CodeMirror and markdown edits stage their current text synchronously in a per-window map. A 250 millisecond debounce writes the existing localStorage array format. A failed write leaves the session copy available. This store must not receive provider credentials.

Save All and close approval select open files using both native dirty flags and recovery records. A delayed native flag cannot exclude a known draft. The titlebar asks mounted editors for a synchronous snapshot before using recovery, a cached broadcast or disk text. An old broadcast from an unmounted editor does not outrank a recovery copy.

## Reproduced failures and fixes

| Failure | Root cause | Correction | Evidence |
| --- | --- | --- | --- |
| A recovered CodeMirror document acquired the wrong saved baseline. | The mount effect replaced the disk baseline with the recovered text. | The file loader owns the baseline. The editor updates it only after a save receipt. | `tests/editor/codemirror-recovery.test.tsx`, mounted editor test. |
| A last keystroke disappeared when an editor unmounted before its broadcast timer. | CodeMirror published debounced text but never wrote recovery; cleanup cancelled the last broadcast. | Stage edits immediately, flush recovery on unmount, and publish the final document before disposing the view. | Mounted unmount and path-switch tests. |
| A save left an older recovery copy behind, or failed to retain a newer edit. | Save completion updated a baseline but did not reconcile recovery with the mounted document. | Save receipts compare against the actual current document and preserve newer text with the saved baseline. | Mounted save-receipt tests and `tests/lib/file-save-ack.test.ts`. |
| An agent write replaced unsaved editor text. | The file-edited callback deleted recovery before reloading disk. | Keep the draft, read the updated disk baseline, and notify the user to review before saving. | `tests/editor/file-content-lifecycle.test.tsx` failed with the agent's disk text instead of the user draft before the fix. |
| A newly selected path temporarily displayed the preceding file's text. | Hook state was not associated with its loaded path during the first commit. | Expose a loading state until the hook's path matches the requested file. | The lifecycle test records committed path, text and loading state. |

The first four mounted CodeMirror checks failed before the changes. They use the real CodeMirror view and mock native operations, not the editor implementation. The staging tests cover quota failure, retry, clearing, reverting, delayed acknowledgements and unrelated drafts. Titlebar tests exercise Save All through the real menu handler and command wrapper.

## Close transaction

`lib/window/close-guard.ts` separates Cancel from Don't save. It validates editor and credential revisions before discarding, retains pending dirty-state rollback after failure, and restores unchanged recovery copies after failed window destruction. It rechecks generation before destroying the main window. Every app-controlled window destruction flushes pending recovery first, including popouts. A failed flush keeps the window open, and a failed recovery deletion rolls back the discard. The close tests reproduce all three failures before these checks. The installed dialog 2.6.0 API supports the three distinct results, as recorded in `../research/credential-and-close-protocols.md`.

A browser reload attempts to flush pending file recovery. If it cannot persist an in-memory draft, the handler requests a beforeunload warning. This is a browser request, not a guarantee that every webview or forced termination will show a dialog.

## Limits

These tests do not establish OS-dialog behavior or native event ordering. Native compilation and packaged scenarios remain required. Concurrent editors for the same path in separate windows do not have a versioned merge protocol for file recovery. A crash before a debounced write, a failed localStorage write followed by forced termination, or an external change to stored recovery can still lose session-only edits. These limits are separate from the keychain-only provider-credential policy.
