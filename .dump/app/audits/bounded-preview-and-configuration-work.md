# Bounded preview and configuration work

## Contracts

Preview readiness is a latest-request operation. `DesignStudio` keeps one worker and one replaceable request slot instead of retaining a promise continuation for each announcement. All callers share the worker promise. The worker revalidates project and service authority before registration and publication. It skips superseded routes and releases ownership synchronously with its final queue check. Unmount revokes the worker and drops its pending request.

Provider initialization and send readiness have different contracts. `aiConfigSettled` waits for work already queued, including hydration. Future edits must not extend an initialization owner's lifetime indefinitely. `aiConfigReady` additionally checks for a current queue and permits eight settlement passes before reporting a retryable changing-settings error. It never treats an unstable or failed configuration as ready. This bounds queue chasing, not an individual hung native call.

Hydration edit tracking retains only currently configured credential IDs and clears after successful hydration. Removing a descriptor drops its tracking entry. Re-adding it records a fresh scope/value change. Durable deletion intents remain separate and are not discarded by this memory bound.

## Save results and publication

A native file-save acknowledgement cannot be undone by a renderer grant check. Token writes still validate before dispatch. After acknowledgement, a revoked preview skips token publication and invalidates only its own project's CSS cache. It must not report the successful write as failed or invalidate another project's cache or pending discovery.

Text, attribute and component edits deliberately retain optimistic preview input when persistence fails. The existing canvas banner now explicitly says the changes were not saved. The user can retry the retained input. This is session-only preview state, not durable recovery. Successful retries clear that failure message.

A chat-list recovery notification appears once after a failed refresh. Successful background polling stays quiet. The request-version fence and effect cleanup prevent a previous project or stale request from announcing recovery.

## Consumer and API research

- Traced initialization through `lib/ai/bootstrap.ts`, credential review through `lib/ai/sync.ts`, and send admission through `features/chat/lib/use-chat-session.ts`. Initialization keeps edit tracking through hydration; sends separately require current configuration.
- Inspected `lib/ai/providers.ts`, `lib/settings/store.ts` and `lib/ai/vault.ts` for descriptor filtering and deletion authority. The tracking set is not the durable deletion journal.
- Inspected the actual CSS loader and its color-variable publication in `lib/ui/css-variables.ts`. Its cache is renderer-global, so an unconditional late cache update would replace another project's published CSS.
- Traced readiness from background-run announcements through `authorization.ts`, bridge registration, probing and frame replacement. Same-origin path/query changes remain distinct requests; equivalent normalized URLs coalesce.
- Checked the installed TypeScript Promise definitions, React hook declarations and existing mounted tests. No new platform API or dependency is introduced. Native bridge installation remains separately unverified on packaged platforms.

## Counterexamples and verification

Seven original-source controls fail on the previous implementation. Two distinguish initialization settlement from continuing configuration churn. Five cover a 64-route burst, a successful token save followed by grant revocation, and failed text/attribute/component preview edits. The burst attempted 66 registrations instead of three. A separate 1,000-route stress case completes with three registrations after coalescing; on the original code it exceeded the test deadline.

Mounted tests also cover unmount while registration is pending, later retry after configuration churn, forty transient credential descriptors while the vault is unavailable, descriptor re-addition, and one recovery toast rather than recurring success toasts. CSS tests preserve another project's cached result and in-flight discovery during scoped invalidation.

The first component-edit test supplied an empty property list, then asserted a property had changed. The corrected fixture provides an actual editable text property; the assertion remains. A review of the CSS loader rejected an unconditional post-save cache update because it could publish stale project content. Scoped invalidation and independent cache-owner tests cover that correction.

UI feedback reuses the existing notification and canvas-error components. No layout, focus behavior, tokens, motion or dependencies change. `DESIGN.md` and `engineering/design-system-baseline.md` remain the visual contract. Copy uses sentence case and states the failure and retry behavior directly. Browser unit tests are not packaged WebView or device verification.

## Preview document lifecycle invariants

Two review findings on this area were validated against the code and are
contracts rather than defects:

- Bridge registration only covers documents created afterwards, so the shell
  registers before the preview document loads: the open path registers first and
  then commits the URL with `reload: true`, and a registration that replaces an
  earlier script reloads a live preview. WebView2 and WebKit expose no host API
  for executing into a cross-origin iframe, so ordering is the only mechanism.
- While an open is in flight, `opened`/`openedUrl` still describe the document on
  screen, but that iteration has already reset readiness and is about to replace
  it. Reporting an already-open URL as ready would therefore name a URL the
  worker is switching away from; the request is queued instead, and the queue
  collapses to the newest request.

A token saved while the preview was replaced invalidates the CSS cache and leaves
the token list to the replacement's own bootstrap, which clears and republishes
it. Pushing the saved value onto the old document's list would attribute it to a
preview that no longer exists.
