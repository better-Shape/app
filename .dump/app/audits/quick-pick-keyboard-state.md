# Quick-pick keyboard state

The shared quick-pick must reset its selected row when the query, result count or
open state changes. A passive effect performs that reset too late: the committed
DOM and Enter handler temporarily refer to the old index. A sibling layout effect
can exercise that stale handler before the reset. This is observable with the real
Radix dialog and portal, without mocking their lifecycle.

The reset now uses a guarded, component-local render adjustment. React discards
the stale render before committing children. The guard records exactly the old
reset dependencies, so a new result-array identity alone does not reset navigation.
Keying the whole dialog by query would instead remount the input for every edit,
disrupting focus and composition. Storing a selected item ID would change the
existing count-change reset contract. Neither is necessary for this repair.

Composition keydown events belong to the input method, including boundary events
with key code 229 and `isComposing` false. They must not submit a branch rename,
repository clone or connection query, or move the highlighted result. Explicit
nonempty query submission still takes priority over the selected item on Enter.
Clicking a result still selects that result. The prop documentation now states
that existing contract rather than describing an unimplemented fallback.

Scheduled focus is canceled when its owning effect is replaced or unmounted.
The existing open/count focus dependencies and all markup, classes, copy and
visual tokens are unchanged.

## Evidence

`tests/ui/quick-pick.test.tsx` mounts the actual dialog. Against the original source,
seven regressions fail and four controls pass. The regressions cover commit-time
query/count resets, composing Enter/Up/Down, boundary key code 229, and canceled
focus work. Controls cover explicit query submission versus clicking, wrapping and
reopening, and empty results with blank/nonblank queries. All eleven pass with the
repair. These are DOM/lifecycle tests, not packaged WebView or physical IME tests.

Primary references checked against the installed React event implementation:

- [React: adjusting some state when a prop changes](https://github.com/reactjs/react.dev/blob/main/src/content/learn/you-might-not-need-an-effect.md#adjusting-some-state-when-a-prop-changes-adjusting-some-state-when-a-prop-changes)
  explains why the guarded adjustment avoids committing stale children.
- [MDN: keydown during IME composition](https://github.com/mdn/content/blob/main/files/en-us/web/api/element/keydown_event/index.md)
  documents `isComposing` and key code 229, including composition boundary ordering.

The React derived-state rule informed the reset. Antislop-human's keyboard/focus
checks and Impeccable's Operate/craft-floor guidance keep this a behavior repair
within the existing design. Unslop applies to this note. No skill scripts,
installers, generators, dependencies or new visual assets are needed.

Reviewed by Arena.ai.
