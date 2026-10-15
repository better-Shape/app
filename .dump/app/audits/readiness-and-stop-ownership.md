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

## Visible preparation and project lifetime

The composer receives preparation separately from native generation. Preparation retains the submitted draft, so combining both flags would incorrectly select Queue for a nonempty draft. Preparation takes priority for Stop, including during optimistic mention expansion. Stop is not disabled by provider availability or attachment processing. The existing generation-plus-new-draft queue action remains unchanged. The status label is "Preparing message" before admission and "Generating" afterwards.

The preparation hook owns controllers by project lifetime and conversation, including the unnamed draft. A reactive snapshot exposes only the viewed conversation. Stop removes matching controllers before aborting them, without waiting for uncooperative work to settle. Finishing one controller cannot clear another. Native admission removes preparation ownership without aborting an admitted turn. Project changes and unmount abort remaining preparations, and retained callbacks from old project lifetimes cannot register new work. Returning to the same project path creates a new lifetime.

An early hook draft mutated a memoized object and relied on forced renders. The React lint warnings showed that this was not a suitable reactive state owner. Controllers now live in a ref, while the visible owner snapshot lives in state. A StrictMode regression exposed a second issue: effect cleanup can retain component state. Cleanup now clears its own snapshot as well as aborting controllers, without overwriting another scope's snapshot.

The mounted composer tests reproduce disabled Stop, missing preparation status, and composition/consumed Escape handling. The session tests cover pending provider initialization, processing attachments, native admission, conversation switches and project changes. Hook tests cover overlapping owners, old finalizers, unmount, returned project paths and StrictMode cleanup. Initial test typechecking also caught an unsupported reasoning-effort fixture and a broad prop replacement that incorrectly touched the message list; both were corrected rather than widening production types.

These are renderer tests with native commands mocked. They do not establish native cancellation, release a still-pending native slot, or make an uncooperative underlying promise settle. The existing in-flight send guard remains unchanged. Requestless native Stop races and native slot release require separate verification.

The API checks use React's [layout-effect contract](https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useLayoutEffect.md), MDN's [abort contract](https://github.com/mdn/content/blob/main/files/en-us/web/api/abortcontroller/abort/index.md) and [composition-event definition](https://github.com/mdn/content/blob/main/files/en-us/web/api/keyboardevent/iscomposing/index.md), checked against installed React types, TypeScript DOM types and jsdom's abort implementation. Aborting a controller is a signal, not a guarantee that arbitrary asynchronous work terminates.

## Bounded text decoding and source traversal

Text attachments now pass at most 320,000 bytes to FileReader before applying the existing 80,000 UTF-16-unit output limit. The read budget leaves room for multibyte UTF-8 input without materializing an arbitrarily large file. Blob slicing retains the source MIME type. When the entire file was decoded, the existing exact character-count notice remains. When only a byte prefix was decoded, the notice reports the original File's byte size instead of inventing a total character count. Existing FileReader cancellation and error cleanup still govern the bounded read.

Four initial regressions reproduced unbounded reads and incorrect large-file disclosures. Coverage includes one- and two-megabyte inputs, three-byte characters, surrogate pairs, exact read-budget boundaries, MIME metadata, and existing read failure/cancellation behavior. An initial slice dropped MIME metadata because Blob.slice defaults its type to an empty string. A regression now checks the actual Blob passed to FileReader. A proposed Windows-1252 output assertion was not a valid jsdom oracle: the installed FileReader implementation defaults to UTF-8 without MIME-charset sniffing. That assertion was replaced with a metadata-preservation check rather than claiming browser charset verification.

The shared design source filter rejects a complete parent-directory segment after normalizing separators. This prevents a same-origin selection from using `../` or Windows-style parent segments to make the inspector read and patch outside its editing root. Eight negative-control assertions failed before the fix, including actual mounted inspector read/write attempts. Literal double dots within a filename remain valid. Existing successful edits and revocation tests stay enabled. This renderer filter does not establish native symlink containment, file identity across writes, or a fix for same-origin navigation authorization.

API references checked include MDN's [Blob.slice byte-range and MIME contract](https://github.com/mdn/content/blob/main/files/en-us/web/api/blob/slice/index.md) and [FileReader.readAsText memory behavior](https://github.com/mdn/content/blob/main/files/en-us/web/api/filereader/readastext/index.md), TypeScript DOM declarations and the installed jsdom Blob/FileReader implementations. The caller trace includes attachment preprocessing and the inspector's disk-read, patch and save sequence.

## Readiness includes the announced URL

A live preview service identity is not a navigation target. The design shell now records the complete normalized URL it successfully opened and the URL of each pending registration. An announcement for a new path, query or fragment on the same service goes through registration/probing and replaces the frame. An equivalent announcement still coalesces, and a different target arriving during registration waits for that operation and revalidates afterwards. The shell compares the last announced target, not the user's current browser location, so a repeated server announcement does not undo manual browsing.

Three initial mounted regressions reproduced the ignored same-origin path, dropped pending target and unavailable retry feedback. Positive coverage includes equivalent root URLs, query/fragment-only changes and revocation of a retained selection callback after document replacement. Existing service/project ownership checks remain mandatory. This fixes readiness navigation without widening which origin or project may edit files.

The URL comparison uses the whole [URL.href value](https://github.com/mdn/content/blob/main/files/en-us/web/api/url/href/index.md), checked against TypeScript's DOM declaration and the installed WHATWG URL serializer. Comparing origin alone discards the path, search and fragment. The native probe and Tauri WebView behavior still require native execution; the mounted tests use mocked command acknowledgements.

## Recovery conflicts and field-level provider hydration

An explicit credential edit grants permission to replace an older legacy plaintext copy after safe vault persistence. It must not permanently exempt that credential ID from future native scope or ownership conflicts. The generic conflict registry now always records reported conflicts; the legacy-copy exception stays inside the legacy migration path and is named for that limited purpose. Explicit re-entry or approved credential recovery still clears the currently reviewed conflict.

Three negative controls reproduced suppressed conflicts, including a same-window synchronizer restart that put a saved key into settings for a different endpoint. The tests do not claim a provider received that key: another synchronization check could still reject configuration. They now require the key to remain absent at the wrong destination, no native configuration/write attempt, preservation of the original vault value/scope, and successful explicit recovery for the new destination.

Desktop hydration now treats API key, endpoint, authentication style and header values as one connection bundle, while merging enabled state and model choices independently. Search provider/key and Composio account/key likewise remain paired. A local credential or routing edit pins the entire bundle, including absent fields, without discarding untouched saved model pins. A model-only edit no longer prevents a saved endpoint from loading. The external-settings merge applies the same distinction when it preserves live credentials at their original destination.

Five valid negative controls reproduced lost provider preferences across the pure merge, external-settings merge and actual deferred desktop hydration. A malformed initial test object failed parsing before any tests ran; that was corrected before collecting the negative-control results. Existing migration, failed-save, cross-window, service-binding, re-entry and review-cancellation tests remain enabled. No credential schema, native lease check or keychain-only persistence policy changed.

## Project path identity, same-shelf drops and image metadata

Project reuse must not infer Windows from a slash-only `//` root. Such roots remain case-sensitive unless the platform is Windows. Explicit drive/backslash-UNC pairs retain Windows normalization. Exactly two leading POSIX slashes remain distinct from one; other all-slash roots reduce to the ordinary root. Literal POSIX backslashes and whitespace also remain part of project identity. A regression starts two distinct PTYs for case-distinct double-slash projects and requires new output before granting the replacement preview service. These are lexical comparisons, not proof of native canonicalization, symlink containment or every filesystem's case rules.

Shelf drops filter each selected row against its current rendered shelf. Filtering only the dragged row would incorrectly block mixed selections whose other rows still need to move. Already-snoozed rows keep their deadline; an all-same-shelf drop creates no undo entry, while a mixed drop records only the rows actually moved. Real keyboard-drag controls cover both Windows and macOS modifier conventions, including the prior undo action. Explicit menu actions retain their existing semantics.

Image filename and MIME attributes must not introduce the first `>` seen by native vision framing. Producers escape the existing four XML attribute entities. A `name_encoding="xml"` marker is emitted only when the name changes, allowing native copy-by-name to decode new names once without interpreting entity-looking filenames from legacy conversations. The versioned lookup extracts the name before decoding, so neither encoding metadata nor encoded entity spelling can masquerade as a filename. Existing partial-name lookup remains available. Native page-shot/read-file image tags use the same codec; ordinary image tags remain unchanged. Text/binary attachment envelopes are not changed by this image-specific correction.

Path/shelf negative controls reproduced nine failures; image framing and renderer controls reproduced eight. Six dependency-free native codec tests compile and run with Rust 1.88, with standalone Clippy enabled. Three additional native attachment-byte consumer tests remain subject to the full application's dependency-resolution gate; isolated helper tests do not establish Tauri integration or packaged behavior. The renderer test initially omitted its existing `isGenerating` property from the expected chunk; correcting that expectation and rerunning against the old serializer still reproduced the wrong image body.

Research: CPython's POSIX implementation preserves precisely two leading slashes and cites POSIX path-resolution semantics (<https://github.com/python/cpython/blob/3.13/Lib/posixpath.py>). MDN documents that XML-mode DOMParser reports malformed input via `parsererror` rather than throwing (<https://github.com/mdn/content/blob/main/files/en-us/web/api/domparser/parsefromstring/index.md>); framing tests explicitly check this and the decoded attribute value. Native vision regexes, attachment lookup and the existing markdown parser were traced separately. No new dependency or UI surface is introduced.

## Unknown reviewers, export failures and credential follow-up adjudication

A completed reviews request does not prove that requested reviewers or teams have loaded. Requested-reviewer snapshots now carry PR identity and detail revision; unknown, failed or incomplete detail responses cannot produce `None`. The paged resource also exposes whether it has a matching loaded snapshot, so its initial render is not mistaken for an empty result. Confirmed empty arrays still render `None`, while submitted and requested names remain independent.

The existing Export control owns error feedback for its asynchronous callback. It catches both rejected writes and synchronous setup failures, reports through the existing notification surface, and clears busy state for retry. A resolved cancellation remains quiet. The mounted-design test follows the authorized frame response through image conversion, save-dialog selection, path grant and a rejected native write. Existing frame/service/document revocation guards are unchanged.

Eight corrected negative controls reproduced reviewer false-empty states and export failures, including three previously unhandled errors. Initial export tests accidentally clicked the identically labelled section toggle and assumed native `disabled`; the corrected controls target the action and verify the Button's actual `aria-busy`/`aria-disabled` contract before checking the failure path.

Credential follow-up review distinguished the one-time legacy-copy comparison from fresh native recovery conflicts. Removing explicit-edit consent as suggested reproduced two migration/re-entry regressions; that change was rejected. The fresh-conflict registry remains unconditional. A same-endpoint deferred desktop hydration test confirms that a local header edit retains its accompanying API key and does not import the saved key; unchanged same-destination snapshots still use the established merge policy. Search and Composio bundle fields are now explicitly enumerated per service, with conservative behavior retained for unknown service keys. These controls do not claim packaged keychain execution.

## Native tombstones without renderer inventory and binary attachment framing

Local inventory is an aid to finding credentials, not deletion authority. An available native tombstone now participates in authoritative hydration even when the renderer's inventory entry is absent. Untouched legacy credentials must not migrate over that tombstone. Initial empty vault slots still permit migration, and explicit re-entry during a pending read remains authoritative. Four provider/header/service regressions failed before this correction; matching initial-slot controls and subsequent explicit re-entry remain enabled.

Attachment metadata escaping now covers binary, text and audio envelopes as well as images. Native asset lookup decodes marked names once while retaining legacy literal names, exact matching and media-ID lookup. Binary envelopes historically place usage instructions before the final data URL; the native consumer now locates that final payload without treating the instructions as data. Trailing payload junk is left for the existing base64 decoder to reject. Nine frontend metadata controls and two isolated native codec controls reproduced the failures. Nine isolated codec tests pass; full native byte-consumer tests still require application dependency resolution.

The shelf callback must depend on current rendered sections. Narrowing it to filtered chats as suggested in review reproduced stale Working-to-Settled drops on both modifier platforms; that experiment was reverted. Path whitespace is deliberately preserved because resolved filesystem paths may contain it. WSL and Windows paths are different namespaces without an independently verified mapping, so the lexical comparer does not silently equate them.

## Preparation before transcript admission and inspection teardown

Mention expansion, project rules and workflow preparation now finish before the session creates an optimistic user message or request owner. Stop and provider changes during those awaits keep the composer draft without leaving an unsent transcript row. Admission rechecks live ownership before appending, so another session that started a turn during preparation is not overwritten. Real session/store regressions reproduced three ghost-user rows before this change, then verified single-message retries, cached transcript preservation and a competing owner.

Design inspection retains the exact window and origin that entered select mode for teardown only. Revoking a service still rejects incoming selections, source writes and outgoing project metadata, but a data-free normal-mode message can release the original document's click capture. No wildcard origin or fresh authority is granted. Seven negative controls covered exit/replacement followed by disable, unmount or project change, plus iframe replacement. The browser discards a message whose explicit target origin no longer matches the recipient document.

Origin research checked MDN's Window.postMessage reference in `mdn/content`, the WPT `webmessaging/postMessage_origin_mismatch_xorigin.sub.htm` scenario, and TypeScript's `Window.postMessage` declarations. These describe exact-origin delivery and stable targeting; the DOM tests verify the host's outgoing payload and recipient, not execution in a packaged WebView.

## Public preset headers are not deleted credential overrides

Removing a private header override restores the preset's public attribution value in the renderer. An empty native credential tombstone must reject the old private override but permit that exact known public value. The renderer and native vault now consume one checked-in public-header registry. Native admission selects defaults by provider and header name; the renderer cannot supply or expand the exception. Nonempty stored bindings still require exact value and scope matching. Provider keys and service keys receive no default exception.

The extracted native value comparison failed its cleared-override control under the original predicate. All three isolated comparison tests pass with Clippy, including nonempty and wrong-scope rejection. Five frontend tests pin the existing public defaults, override removal, explicit blanking and separation from credential inventory. Native vault integration tests exercise the registry wiring, failed/durable clears and non-header rejection, but full application tests remain blocked by offline dependency resolution. GitHub workflow dispatch also returned HTTP 403 for the integration, so local helper tests are not substituted for full native or platform verification.

## Partial reviewer data and unknown credential bundles

Requested-reviewer data now carries completeness separately from known names. A partial payload can display available users or teams without claiming that the missing list is empty. None requires both requested lists and the completed-review resource to be known empty. Four mounted regressions reproduced the loss of partial names or completeness before this correction.

Unknown service hydration deliberately retains the conservative credential bundle. Narrowing the fallback to apiKey alone failed two tests by mixing an edited key/account with a saved destination/credential. Fields absent from the local object are deleted rather than invented, and unrelated preferences still hydrate. The precise search and Composio field lists remain unchanged.

## Committed chat refs under concurrent rendering

The session no longer publishes attachments, queue, model, mode or metadata callbacks through refs during render. Layout effects publish committed values before event handlers run. Two Suspense transition regressions reproduced a pending send using an uncommitted model or mode even though the visible session retained its prior selection. Both now preserve the committed selection through admission.

The mount-only legacy-mode conversion was unreachable because the state always initializes to Code, so it was removed rather than hidden behind an asynchronous setter. The compact-command handler now precedes its first consumer. These corrections remove seven warnings from the session module without suppressions; its remaining effect-state warnings still need separate ownership refactors.

## Explicit PR override snapshots

PR list and detail rendering now subscribe to the immutable override map rather than a separate version counter. The same subscribed snapshot is passed into override projection, so memo dependencies describe the data read instead of relying on an otherwise unused version. The timed trust, sweep, rollback and settlement rules are unchanged. Tests cover a retained snapshot after a newer global write, the expiry boundary, and mounted row removal/restoration without a parent render. Removing the old dependency without replacing its data contract would have left optimistic rows stale.

## Revalidate admission and recovery receipts

Attachment serialization is not admission: removal or replacement during file reading or later mention/rule preparation must still cancel the send before an optimistic transcript is inserted. The final synchronous fence compares the prepared IDs, immutable File identities and serialized metadata against committed composer state. New attachments are excluded from that comparison and remain for the next draft. Mounted controls cover removal, replacement and addition during both file reading and mention expansion.

Stored asset instructions precede their data URL. Frontend restoration now accepts the final payload line as the native decoder does, decodes versioned names exactly once, and restores bytes using an ArrayBuffer. Missing/unreadable bytes become explicit error chips requiring reattachment, not ready empty files. This does not invent original bytes for text/audio/oversized attachments whose full original bytes were never stored. Tests perform serialize → parse → restore → resend for binary assets, including delimiter/entity-looking names, and preserve bare legacy payloads.

Credential recovery consent creates an unacknowledged draft. It resets the vaulted flag before changing recovery authorities, and replacement of a legacy copy also independently requires zero unsaved drafts. Local and desktop-store regressions reproduce early deletion under an old successful receipt and verify retention until the replacement draft is acknowledged. These are host-side persistence tests, not native keychain execution.

## MIME charset compatibility research

The File API's package-data algorithm explicitly falls back to the Blob type's charset before UTF-8: <https://github.com/w3c/FileAPI/blob/main/index.bs#L1194-L1225>. The claim that the standard always ignores MIME charset is inaccurate, but relying on host compliance is not sufficient here. WebKit fixed its missing fallback in June 2026: <https://github.com/WebKit/WebKit/commit/90c69edf1c0ebeef9a60ead6ad3e6cae9a19577a>. The installed jsdom FileReader also ignores Blob charset. A source fix in current WebKit does not prove deployment to every supported packaged host.

The bounded reader now supplies the declared encoding explicitly, retaining the Blob type and FileReader's BOM/default behavior. The dependency-free parser handles quoted pairs, embedded semicolons, empty/duplicate parameters and invalid MIME essences. Non-UTF-8 bytes reproduce the host fallback failure in six controls; the expanded serialization suite passes after the explicit argument. Upstream reference tests: <https://github.com/web-platform-tests/wpt/blob/master/FileAPI/reading-data-section/filereader_readAsText_blob_type_charset.any.js>. Those upstream browser tests were inspected, not executed in packaged WebViews.

An independent 1,445-case projection comparison against the installed WHATWG MIME parser caught missing whole-input trailing-whitespace removal for an unterminated quote. The parser was corrected before publication; all 1,445 comparisons now agree. Checked-in fixtures retain the unterminated/closed-quote distinction and parameter edge cases. This is parser parity evidence, not browser or native packaging evidence.

## PTY stream completion is not process completion

The native PTY reader used EOF to record an unknown exit, which permanently blocked the later child-status lookup. Its event also omitted `exit_code`. The reader now collects the actual child status after the output loop and emits the same recorded code to agent callbacks and the `pty-exit` event. Interrupted reads resume. Explicit Stop keeps its existing cancellation status rather than being relabeled as process success.

The child is shared through a mutex with the existing query and kill paths. The production wait helper locks only for a nonblocking status poll, then releases the lock before its retry delay. It does not hold the session map lock or block in child.wait(). No extra monitor thread is added. Output already read is delivered before exit publication. Child-status queries can still observe completion before all output drains, as before. Descendants retaining PTY handles and platform-specific blocking reader cleanup remain outside this verification; no complete process-tree shutdown claim is made.

Five standalone production-helper tests cover pending polls, zero/nonzero status, errors, poisoned locks, real Unix output EOF before process exit, concurrent kill access and child reaping. Returning unknown at the first pending poll fails two tests. Retaining the child lock across polls fails the concurrent-kill test after its bounded watchdog; the fixture closes stdin and joins both workers before asserting. Three application-level tests cover event serialization and first-recorded completion/cancellation, but cannot execute until full Cargo dependencies are available. The existing 24 background-preview consumer tests pass.

Sources inspected include portable-pty 0.9's Child and SlavePty contracts and Windows implementation at <https://github.com/wezterm/wezterm/blob/f8921727a11b9f8b073e8c24821d72fd41283500/pty/src/lib.rs> and <https://github.com/wezterm/wezterm/blob/f8921727a11b9f8b073e8c24821d72fd41283500/pty/src/win/mod.rs>, plus Rust 1.88 Child::try_wait at <https://github.com/rust-lang/rust/blob/1.88.0/library/std/src/process.rs>. The standard child API guarantees nonblocking observation, Unix reaping and repeatable completed status. These sources establish the locking/status contract, not packaged Windows or macOS execution.

## Early-exit overflow needs session-specific evidence

A bounded startup event buffer cannot infer that a selected process exited merely because unrelated events filled it. Once spawn returns its native ID, the listener owner now filters new events to that ID and retains its buffered exit/readiness. If an overflow could have lost that process's exit, it requests the existing native `pty_read_output` snapshot before activation. The snapshot must identify the selected session and contain a boolean running state. Missing, mismatched or failed evidence rejects startup; a known selected exit does not need a query.

Selected exit events received during the query outrank a stale running snapshot. New unrelated events cannot fill the selected buffer again. Readiness remains buffered until activation, and the caller rechecks its start generation after the new await so Stop cannot publish a stale run. This preserves the output-only preview grant and does not promote a TCP probe into edit authority.

Six original-source regressions failed on buffer overflow; the expanded 32-test consumer suite passes. Cases cover a healthy selected child after 140 unrelated exits, an actual dropped selected exit, a stale snapshot with a concurrent exit, unavailable/wrong/malformed status, newer selected output readiness, and Stop/retry during reconciliation. The native snapshot's camelCase fields were traced from `TerminalSessionSnapshot` and `pty_read_output`; the installed Tauri invoke implementation returns the IPC promise directly. Await scheduling is documented at <https://github.com/mdn/content/blob/main/files/en-us/web/javascript/reference/operators/await/index.md>. Host tests mock IPC and are not packaged-WebView verification. No layout, styles, controls, permissions or network endpoints change.

## Committed editor, history and markdown callbacks

Imperative editor listeners and scroll/animation callbacks must read the committed render, not a suspended replacement. CodeMirror's content callback, the history stepper's streaming flag, and the markdown reveal cursor/live history now publish through layout effects. Subscription ownership, editor lifetime, recovery writes, scroll thresholds and reveal speeds remain unchanged.

Mounted Suspense regressions reproduce three separate consequences of render-phase ref writes. Editing the retained CodeMirror view called an uncommitted callback. Scrolling a short history selected the streaming tail before streaming committed. An abandoned live markdown render made a later finished message animate instead of appearing in full. All three fail against the prior implementation. Controls verify callback replacement after commit, the committed streaming tail, and completion of a real reveal. The markdown control uses nonrepeating prose because the existing stream-glitch repair deliberately removes repeated phrases.

Research checks the shared ref identity and commit timing against React's [useRef contract](https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useRef.md), [React 19.2.3 hook implementation](https://github.com/facebook/react/blob/v19.2.3/packages/react-reconciler/src/ReactFiberHooks.js), [layout-effect commit implementation](https://github.com/facebook/react/blob/v19.2.3/packages/react-reconciler/src/ReactFiberCommitEffects.js), and installed `@types/react` declarations. A ref object survives updates; layout effects publish only the finished render. Updating these tiny values in a layout effect closes the pre-paint callback window without rebuilding the consumers.

These tests mount the real React components and CodeMirror in jsdom. They do not prove packaged WebView behavior or resolve other render-ref and effect-state findings. No layout, tokens, copy, native payload, persistence format, or dependencies change.

## Runtime status interpretation and live-owner projection

Status interpretation now lives in `features/chat/lib/chat-status.ts`. It does not choose a conversation, mutate a live turn or grant ownership. The store resolves an admitted owner first, retains the ignored-conversation and turn-ID fences, updates that owner's activity, and projects messages/status only when that owner is visible. Legacy unscoped events still require exactly one live owner. `TurnPhase` remains re-exported from the store for existing consumers.

The refactor preserves explicit trimmed labels, approval/input distinctions, known tool phases, generic extension labels, and label-only unknown phases. Eighteen added mounted controls pass before and after extraction. An independent comparison of the prior source and the new parser agrees on 840 phase/tool/label combinations. Existing stale-turn, background-turn, optimistic draft, Stop and native-restoration controls remain enabled.

Tool names must not index inherited object properties. Three further mounted controls reproduce exceptions in the old label lookup for `constructor`, `toString` and `hasOwnProperty`. The initial extraction also exposed why a new phase lookup must not use a prototype-bearing record. Both tool lookups now use Map entries; these names receive ordinary extension labels and the generic tool phase. Research checks [MDN's accidental-key comparison](https://github.com/mdn/content/blob/main/files/en-us/web/javascript/reference/global_objects/map/index.md), [Test262's missing-entry contract](https://github.com/tc39/test262/blob/main/test/built-ins/Map/prototype/get/returns-undefined.js), and the installed TypeScript Map declarations. A missing entry returns undefined, not an inherited method.

Local ESLint complexity measurements reduce `patchLive` from 10 to 4 and the status-event callback from 15 to 4. Owner resolution is 6; the extracted status functions range from 3 to 7. These are local measurements, not a claim that the hosted DeepSource scan or all complexity findings are clear. Native event producers, admission recovery and the other large stream handlers remain separate work.
