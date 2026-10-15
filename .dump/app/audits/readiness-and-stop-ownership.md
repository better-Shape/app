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

## Design mutation ownership

A design selection carries the authorization that admitted its snapshot. Host-side preview, text and attribute clones preserve that owner. Source resolution and serialized persistence receive the captured assertion rather than consulting a newly granted selection. Immediately before native mutation, the assertion checks the original grant, live service, editing root, outer project, actual iframe and document-load generation. A replacement grant cannot rescue a callback retained from an old selection.

The compact inspector separates admission from completion. Turning inspection off prevents new edits but flushes already accepted slider changes. `PreviewPanel` keeps the inspector mounted with `enabled=false`; conditional unmounting would revoke the pending work before the disable handler can flush it. Those writes retain their original service, project and document authority through disk reads. A project change, server exit/replacement, frame replacement, navigation or unmount still revokes them. Debouncing merges properties only within one selection snapshot; different snapshots flush in order so asynchronous whole-file writes cannot overwrite each other. Persistence failures use the existing error notification rather than silently presenting live CSS as saved.

Mounted tests exercise host callbacks, incoming bridge messages, deferred final reads, queued edits/history, replacement grants, project changes, document loads and the real inspector slider and its actual preview parent. Positive cases also verify that current-authority edits still reach native commands. These frontend fences do not cancel an IPC operation already admitted to native code. Native design history currently has a separate process-global undo/redo stack without project-scoped ownership; frontend queue authorization alone does not establish that stored history belongs to the current project.

## Bounded PR list polling

Automatic visible-list refresh fetches the first page and at most one older loaded page. Older pages rotate, so the request count per automatic refresh does not grow with the number of pages visited. With uninterrupted 30-second polling, each older page refreshes once per rotation rather than on every tick. Explicit Refresh still reconciles the full loaded window. Detail polling and heavy tab invalidation retain their separate existing rules.

Page membership records contain IDs, not duplicate row snapshots. Reconciliation replaces refreshed canonical rows but preserves detail/CI enrichment on untouched pages. Moving boundaries deduplicate IDs, and a confirmed terminal page drops obsolete later pages. A failed request commits neither partial rows nor an advanced rotation cursor, so the next poll retries the same older page. Project or remote changes reset membership and the cursor; request versions fence obsolete responses.

## Selection mapping, CSS discovery and bound-send failures

Source resolution returns data without mutating the inspector's source target. Accepted selections start their own mapping revision. Deselecting, navigating, reconnecting or unmounting revokes earlier revisions. Only a current selection's authorized lookup may publish its source target; a queued mutation's lookup cannot replace the target displayed for a different selection.

CSS discovery caches the project, path and content together. Display-only CSS cannot assign a source path. Only the same project's concurrent discovery shares a promise, and a generation prevents invalidated or replaced work from repopulating the cache. Misses remain retryable. Known stylesheet candidates can be empty or have no tokens yet. A successful token write updates the complete record. Token creation reads current disk content and serializes read/patch/save operations, rather than overwriting intervening edits with a cached stylesheet.

A draft send's original null conversation key stops identifying its live turn after `chat_started` binds the request. Failure handling finds the still-live owner by request ID before pausing its queue and retiring the local turn. Completed, stopped or replaced requests do not acquire a new owner from the current view. A background failure does not replace the viewed chat's transcript or error; the existing notification tells the user its queue remains paused.

Send preparation remains cancellable through attachment, mention and workflow work. Provider initialization is only the first await, not the admission boundary. The preparation record is removed immediately before the native send, with no intervening await, and a `finally` removes records on every earlier failure or return. Unmount/Stop can therefore cancel late preparation without cancelling a turn already admitted to the backend. An aborted pre-admission request retires only its own still-live optimistic owner.

## Native chrome subscriptions and sidebar actions

Native titlebar initialization is skipped outside Tauri. A resize subscription belongs to the hook lifetime: registration completing after disposal immediately unsubscribes, and a pending initial synchronization cannot subscribe after disposal. Resize reads carry a local revision so a slow previous read cannot replace newer chrome state. Maximize/unmaximize reads back actual native state after the command, rather than assuming the inverse of its earlier snapshot. A failed initial read still permits a resize subscription to recover later. Initialization, subscription and command failures are reported through the existing notification surface.

Sidebar clipboard, folder-reveal and subagent subscription failures are visible rather than silently ignored. Both close aliases retain one stable callback. Removing redundant `void` operators preserves the existing internally caught bootstrap/load promises and explicit void-return event handlers; it does not substitute for rejection handling.

Shelf intent is a typed shared table for menu actions and drag/drop. Each action snapshots previous pin/disposition state once, uses one snooze deadline for the entire selection, and produces one undo entry restoring both dimensions. Keyboard target lookup, directional stepping and coordinate calculation are separate, bounded functions. Unsupported keys, edges and unmeasured targets remain unconsumed; keyboard navigation owns its current position independently of incidental collision targets. Direct coordinate/undo tests and the mounted keyboard-drag harness cover these contracts, including a baseline run against the prior implementation to distinguish behavior-preserving extraction from regression fixes.

Keyboard collision ranking follows the coordinate contract: arrow movement centers the dragged row on the chosen shelf header, so keyboard collisions use center distance. Intersection area is not a reliable ranking when an expanded row fully overlaps several equally sized collapsed headers; its tie can choose the wrong shelf. Pointer drops still use containment and cancel outside all targets. A direct tall-row regression exercises the actual dnd-kit collision algorithms, while the mounted suite retains real keyboard movement and undo.

## Attachment admission and composer revisions

A send snapshots submitted attachment IDs and the composer revision before provider initialization. Processing waits follow only those IDs; files added later belong to a subsequent message. Missing, failed, unsupported or timed-out attachments reject the entire preparation with a retryable error rather than silently sending an incomplete message. Text and binary reads handle asynchronous errors, synchronous start failures and cancellation, removing reader/abort handlers on settlement. Oversized binary assets retain their existing explicit metadata notice without first allocating a data URL.

Provider validation occurs before attachment work and again immediately before native admission. Pre-admission failures preserve composer text/files and pause the originating queue without inventing or retiring a native turn. A background preparation failure does not overwrite the viewed chat's error. Submitted files are consumed only at native admission; new files remain. Composer text is consumed only if the originating view and edit revision still match. Text equality alone is insufficient: editing a new draft back to the same text must not let an earlier send clear it. Once native dispatch begins, the existing stream ownership and failure handling govern the admitted turn; these preparation guarantees do not claim to cancel or roll back native work already admitted.

## Sidebar shortcut and removal-snapshot contracts

Global sidebar undo and numbered navigation share an input-ownership predicate. Composition (including legacy keycode 229), consumed events and reserved modifiers are excluded. Text controls, textbox roles and nested contenteditable markup retain their own shortcuts. This also prevents a sidebar undo from consuming an editor's key when the event target is a nested span or SVG element. Search keeps its separate unmodified Enter/Escape handling behind the same composition predicate.

Menu and row label/disposition projections share typed helpers without changing shelf intent. Pending-removal snapshots separately identify current cache ownership and removal-entry targets. Non-removal stack changes reuse an equal snapshot; overlapping asynchronous removals keep a row hidden until every owning commit settles.

Window-flow initialization exposes its rejection handler at the promise call site, satisfying the promise scanner without reintroducing the redundant void operator. Its prior internal catch already observed failures; moving that boundary preserves error reporting and cancellation checks rather than claiming an unhandled runtime rejection was reproduced.


Keyboard navigation and display share one canonical shelf specification. Working is a valid starting position but not a drop destination. ArrowDown from Working selects Active and ArrowUp selects Pinned. A per-drag controller, reset on drag start, tracks subsequent choices: dnd-kit can report a nearest collision header before the first arrow, so treating that initial collision as a previous keyboard step skips a shelf. Distinct-rectangle unit regressions and real mounted Working-row drags verify both directions and undo; repeated controller steps/reset are also covered.

An explicit PR Refresh is retained while list polling, initialization or pagination is busy. Repeated clicks coalesce into one follow-up reconciliation of the complete window of pages loaded when the active operation finishes, including a newly loaded page. Automatic polls remain skippable rather than queueing indefinitely. Both successful and failed active requests drain pending explicit intent; owner-version checks and effect cleanup discard it on unmount or project/filter changes. This does not add overlapping list requests or expand automatic polling's two-page budget.

## Natural group labels and provisional PTY output

Project/collection labels use numeric, case-insensitive locale comparison before the existing ID tie-breaker, so Project 2 precedes Project 10 while missing metadata stays last.

A provisional preview listener buffers output until spawn identifies its PTY. Activation replays only that PTY's ordered chunks into terminal scrollback and run-status parsing; unrelated records are discarded. Disposal clears all provisional output. Retention is deliberately bounded to 32 PTYs, 128 chunks and 32,768 UTF-16 characters per PTY, retaining recent chunks rather than claiming unlimited startup history. Buffer overflow does not grant preview authority; the existing native readiness owner remains separate. A selected process that exits unsuccessfully during startup retains its error state rather than being reset to idle by generic startup cleanup.

## Structural design writes and native source ranges

Host and iframe delete/duplicate requests share the same persistence queue as style, text, reorder, token and history writes. Target lookup happens inside the queue, after the preceding native acknowledgement. The admitting grant is checked before lookup, after lookup and after the structural native call. A failed native request does not poison later queue entries. A successful structural request reloads the preview, so later entries admitted by that old document must fail authorization rather than edit a replacement document.

A local JSX match must contain real opening and full-element ranges. Placeholder ranges can suffice for a whole-file replacement but cannot address a native delete or duplicate. Native `apply_design_source_patch` uses UTF-8 byte offsets; Babel reports JavaScript string positions. Location lookup parses the original source with the existing Babel TypeScript parser and converts positions to UTF-8 bytes. Recast still owns transformations and printing. Its parse wrapper expands tabs and normalizes line endings before calling Babel, so its numeric offsets cannot address the original disk content.

The rejected first range implementation converted Recast offsets directly. A CRLF regression exposed the one-byte shift. Tests now cover CRLF, tabs, multi-byte prefixes, supplementary characters, paired elements and self-closing elements. Mounted queue tests check that structural target ranges include an earlier acknowledged style change, rather than only counting native calls. An initial reverse-order test incorrectly expected a queued style write to survive a successful structural reload. The corrected contract rejects that old grant; a separate native-rejection test verifies queue continuation when no reload occurred.

Primary references checked against the installed implementation:

- [Recast parser](https://github.com/benjamn/recast/blob/master/lib/parser.ts) passes `lines.toString` output with whitespace reuse disabled to its parser.
- [Babel source positions](https://github.com/babel/babel/blob/main/packages/babel-parser/src/util/location.ts) track string indices; the installed `recast/parsers/babel-ts` implementation exposes direct parsing of original source.
- [TextEncoder encoding contract](https://github.com/mdn/content/blob/main/files/en-us/web/api/textencoder/encode/index.md) specifies UTF-8 bytes. Tests use Node Buffer as an independent byte-range oracle.
- [JavaScript module scope](https://github.com/mdn/content/blob/main/files/en-us/web/javascript/guide/modules/index.md) keeps module declarations out of the browser global object. Scanner global-function warnings on imported/exported sidebar modules do not justify adding IIFEs or suppressing analysis.

These checks exercise frontend sequencing and payloads with a mocked native command boundary. They do not prove packaged native execution, cancel an already admitted IPC write, or protect against another process editing the file between lookup and mutation.

## Credential sync admission

Unrelated settings notifications still synchronize native provider configuration, but they no longer rewrite credentials after a successful persistence batch. Each synchronizer tracks a credential-edit revision. Only that captured revision becomes clean after acknowledgement, so a newer edit during an older write remains pending. Explicit Retry, unsaved drafts, pending deletions and changed shared intent tokens still enter persistence. The low-level vault write API continues checking native leases even for identical values.

A local dirty flag alone is insufficient. An existing two-window regression showed that it skipped conflict detection after another window's failed write. The vault now remembers the intent token validated by each successful native mutation. Sync compares those tokens with current shared metadata, including completed foreign writes, before skipping persistence. A late acknowledgement records its original token, not a newer token observed after the await. This metadata contains no credential text. It does not replace native revision checks or add plaintext recovery storage.

Regression coverage includes unrelated model changes without keychain writes, explicit Retry, failed writes and deletions, equal-value destination changes, newer edits during pending writes, completed and unsaved foreign changes, and foreign intent arriving during native acknowledgement. Native keychain execution remains a separate verification requirement.

## Component child text and structural cache receipts

The component-properties panel edits `props.children` at the component instance, not at the DOM node rendered by its shared implementation. Its text path now uses the same instance resolver as component attributes. If that instance cannot be found, persistence fails without falling back to shared DOM text. The mounted fixture now includes an actual instance source file; deferred-read authorization tests return that matching source so they still reach the final write fence.

A successful native delete/duplicate invalidates the resolved source file's renderer cache before the final UI-authority check. Losing preview authority during an admitted native write must prevent stale UI updates, but must not keep a now-stale file cache. Failed native writes do not trigger this success invalidation. Existing editor listeners still own mounted-editor reloads and unsaved-buffer protection; cache invalidation alone does not claim cross-window or native filesystem-watcher verification.
