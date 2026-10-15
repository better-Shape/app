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

## Related preview and pagination ownership

The media lightbox had the same passive-reset defect. Changing its design array,
initial index or open state could first commit the previously selected index
against the new preview collection. It now adjusts its component-local index
before committing children, preserving the original reset dependencies and paging
when those dependencies are unchanged. Three original-source failures use
layout-effect observations; two controls cover stable paging and the unchanged
HTML sandbox/Escape-listener lifecycle. All five pass with the repair. The DOM
checks do not establish image rendering quality or native WebView execution.

PR page reconciliation has a different contract: `pageIds` owns membership and
order, while `fresh` supplies row replacements. The list refresh builds both from
the same responses before publication. Unindexed fresh rows must not be appended
as a fallback, because that would bypass the authoritative page set. The helper
now documents this boundary and a characterization test covers an unindexed
fresh row alongside retained enrichment. Existing list tests cover page pruning,
queued refresh and later-page failures. No pagination runtime behavior changed.

Quick-pick Escape dismissal is owned by Radix's document listener, not the
content's keyboard handler. Installed `@radix-ui/react-dismissable-layer` calls
`onEscapeKeyDown` before checking `defaultPrevented` and dismissing. Composition
Escape must therefore be canceled at that callback as well. Two additional
original-source failures cover both `isComposing` and boundary key code 229,
while subsequent ordinary Escape still dismisses. All thirteen quick-pick tests
pass with both guards. Physical input-method behavior still needs platform testing.

## Scanner follow-up

DeepSource identified mixed effect return paths, missing navigation-helper
documentation and keyboard-routing complexity. The focus effect now always
returns a cleanup function, but schedules nothing while closed. A control covers
that path and frame ID zero so cleanup cannot accidentally use a truthiness test.
The navigation helper documents why empty lists must avoid modulo arithmetic.

Keyboard routing delegates composition detection and query submission to named
helpers. Click confirmation only selects its indexed result. Query submission
remains confined to Enter, including the empty-list case. Three-result navigation
controls distinguish Up from Down, which a two-result wrap test cannot do.
Installed ESLint measures the keyboard callback at complexity 5, composition at
2, query submission at 4 and confirmation at 3. This is local evidence, not a
claim that the hosted scanners or the full-project baseline are clean.
