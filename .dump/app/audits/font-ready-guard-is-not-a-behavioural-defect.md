# S6544 at the font sites is a readability defect, not a behavioural one

Measured 2026-10-16 on `mega/absorb-all` at 8c2aa42 while triaging the SonarCloud
findings in `security-audit-report.md`.

## What the rule says

`typescript:S6544` fires on `if (document.fonts?.ready)`. `FontFaceSet.ready` is a
`Promise`, so the condition is truthy whenever the FontFaceSet exists.

## What I expected

A branch that is always taken is a branch that never means what its author
intended, so I expected the call sites to take a wrong path and the fix to be a
behavioural repair.

## What is actually true

`git log` and the four call sites agree on the shape:

- `runtime/entry.ts` had `try { if (document.fonts?.ready) await document.fonts.ready } catch {}`
- `features/chat/ui/design-capture.tsx` had `if (doc.fonts?.ready) { await doc.fonts.ready.catch(...) }`
- `features/preview/design/bridge.ts` injected `if (document.fonts && document.fonts.ready)`
- `lib/agent-preview/sandbox.ts` injected `if (document.fonts && document.fonts.ready)`

Every one of them still awaited the promise inside the branch. The only input on
which the guard changes behaviour is a FontFaceSet whose `ready` is falsy, and
`ready` is always a promise, so no real document reaches it.

**Proof, not reasoning.** I mutated `waitForFonts` back to the always-truthy shape,
`if (doc.fonts?.ready) await doc.fonts.ready;`, and all four tests still passed.
Two other mutations were caught: dropping the `await` failed 2 of 4, and
re-throwing the swallowed rejection failed 1 of 4. So the suite pins awaiting and
error tolerance, and cannot distinguish the truthiness guard, because no input
distinguishes them.

## Verdict

NOT A BEHAVIOURAL DEFECT. It is a readability and ownership defect: four copies of
the same dance, one of which grew a `.catch` at the call site. The real fix is the
extraction, not the deleted `if`:

- `lib/ui/wait-for-fonts.ts` owns the wait and the rejection tolerance.
- `runtime/entry.ts` and `features/chat/ui/design-capture.tsx` import it.
- The two injected-source sites cannot import a module, because they are JavaScript
  strings handed to the preview frame, so they keep an inline `if (document.fonts)`.
  That is a delivery boundary, not an oversight, and the shared module says so.

## Changed behaviour

Next time a rule says "this conditional is always true", do not assume a wrong path
runs. Check whether the branch body still does the work anyway. If it does, the
finding is about ownership and duplication, and the honest report says so. A test
that cannot fail on the mutation is a test of the contract that survives the
defect, not a test of the defect.
