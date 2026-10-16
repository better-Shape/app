# Packages panel: a placeholder-prop subcomponent shipped dead row buttons

**Recorded:** 2026-10-15, while adding the Packages workspace tab (`features/packages/`).

## What happened

The first version of `features/packages/panel.tsx` extracted the ready-state list
into a `ReadyBody` subcomponent. `ReadyBody` took only `groups` and hard-coded the
row action props:

```tsx
<Section rows={groups.dependencies} busy={false} onUninstall={() => {}} onUpdate={() => {}} />
```

The rendered output looked complete: names, versions, freshness labels, update and
uninstall buttons with correct `aria-label`s. Every button was inert. The same
revision also rendered `state.visible`, a filtered view that no control could change
yet.

## Root cause

Two separate habits, one cause.

1. A subcomponent was given placeholder props instead of the caller's props. Nothing
   in the type system objects: `() => {}` satisfies `(name: string) => void`. The
   compiler was green and the DOM was plausible.
2. The panel was written before the behaviour that fed it existed, so a derived field
   was consumed ahead of the control that produces it.

The common cause is treating "it compiles and it renders" as "it is wired". Both
failures are invisible to a type checker and survive a visual check, because the
failure is in the handler, not the markup.

## Change in behaviour

- Row actions now receive the caller's `onUpdate` and `onUninstall`, and `busy` is
  threaded from the tab rather than hard-coded.
- The filter field and the `visible` group it drives were added in the same change,
  so nothing renders from state no control can reach.
- `tests/packages/panel.test.ts` clicks `Update zod` and `Uninstall vitest` and
  asserts the exact names reach the handlers, and separately asserts every row
  control is disabled while a mutation runs. Those two tests fail against the
  placeholder version.

## Rule this produced

A test that only reads rendered text cannot catch a dead handler. Any interactive
control in a new panel needs a test that clicks it and asserts the callback received
the value from the rendered row, not just that the row exists.

## Where the same trap is still open

Not checked in this pass. Worth a sweep: every panel under `features/*/ui/*/panel.tsx`
that wraps its list in a subcomponent. `problems/panel.tsx` passes `onOpen` through
correctly and `search/panel.tsx` passes `onReplace`, so the pattern is not endemic,
but it was not audited exhaustively.