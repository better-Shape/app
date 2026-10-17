# A green cross-window assertion can be a listener that was never armed

Applies to: any test in this repository that asserts on a `storage` event reaching
`lib/workspace/dirty-buffers.ts`.

## The trap

Three independent things have to line up before a cross-window assertion means
anything, and each one fails silently:

1. The event must name a path. `entryPath` (`dirty-buffers.ts:215`) returns `null` for
   `event.key === null`, which is the `localStorage.clear()` form, so a test that
   dispatches `{ key: null }` never reaches `repairClobberedDraft` at all.
2. The window under test must have a listener. `watchForeignWrites` is called from
   `stageDirtyBuffer` only, so a module instance that merely calls `loadDirtyBuffer`
   has no listener and every storage-event assertion against it passes.
3. The assertion must read durable storage. `stageDirtyBuffer` only arms a 250 ms
   timer, so reading `localStorage` straight after staging reads the previous state,
   not the staged draft.

Miss any one and the test is green against a build that has the bug back.

## Evidence

`tests/lib/dirty-buffer-cross-window.test.ts:92` is named `does not re-add a record
another WebView removed, which is also how a save reads` and dispatches
`{ key: null }`, so it exercises case 1 failing. Reproduced on 2026-10-17 by executing
that test's body against a mutant that treats a missing record as a very old record
(`storedBuffer(path) ?? { ..., updatedAt: 0 }`): the mutant resurrects the draft and
the test still passes.

`tests/lib/review-z-dirty-buffer-foreign-removal.test.ts` covers all five paths with
one listener-arming `stageDirtyBuffer` per test and a positive control that repairs a
real clobber, so the removal assertions cannot pass by reaching nothing.

## Rule for the next test

Before trusting a cross-window assertion, run the mutant first. A removal-event
assertion is only proven if the same file also asserts that an older foreign overwrite
IS repaired; the two cases sit on opposite sides of the `!stored` guard and a suite
that omits the positive control cannot tell "correctly ignored" from "never ran".