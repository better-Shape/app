# Workbench accessibility and bidirectional text research, 2026-11-05

Sources behind the accessibility, right-to-left and pointer-target work on PR #57 (branch
`arena/0de22628-app`, base `mega/absorb-all`). Conclusions first, then every source with what it
settles here. Each source was read on 2026-11-05 unless the end of this paragraph dates it later,
from the upstream repositories through the GitHub API or from the installed packages under
`node_modules`. Library versions are the ones in `package-lock.json` at the time: `axe-core` 4.13.0,
`@dnd-kit/core` 6.3.1, `react-markdown` 10.1.0, `remark-gfm` 4.0.1, `mdast-util-to-hast` 13.2.1,
`@radix-ui/react-menubar` 1.1.16, `@codemirror/view` 6.43.9, `@codemirror/merge` 6.12.2,
`tailwindcss` 4.1.18. The three keyboard focus sources added with finding 7, the three dialog focus
sources added with finding 8, the button example, the focus fixup step behind finding 9, the
Primer mixin behind finding 10 and the CSS Fonts `@font-face` descriptor behind the custom font
label were read on 2026-11-06, the dialog source at
`@radix-ui/react-dialog` 1.1.15. The 1.4.11 understanding note was read again that day for finding
10.

The audit that used these sources is
[`../audits/cumulative-acceptance-ledger-2026-11-05.md`](../audits/cumulative-acceptance-ledger-2026-11-05.md).
The visual campaign is `engineering/visual-stress-and-upstream-issue-verification.md`.

## Findings that change decisions

1. **A pointer target is any focusable widget, so making text focusable changes its neighbours.**
   axe counts an element as a target when its role is a widget role and it is focusable
   (`widget-not-inline-matches`). Giving read-only diff text `tabindex="0"` made its `role="textbox"`
   a target, and the Stage and Restore actions floating over it (22.75px and 19.5px tall under the
   13px root) failed WCAG 2.5.8. They now keep the 24px floor themselves. The same rule explained the
   commit graph: a focusable `role="listbox"` around the rows was a target under every row button, and
   a listbox must own options anyway. It is now a `group`, which clears one critical and six serious
   findings.
2. **A `title` attribute is not a reliable accessible name in this app.** `SuppressNativeTooltips` moves every
   `title` to `data-native-title` on the first pointer move and on focus. Thirteen icon-only buttons
   were named only by `title`, and thirty had no name beyond a Radix tooltip, which only adds
   `aria-describedby` while it is open. Forty-two now carry `aria-label`, matching the tooltip text
   as the codebase already did for "Close terminal". The thirteenth `title` button, the command
   palette's delete, was also nested in its row, so it became a glyph the row acts on.
3. **A closable tab is the only interactive element in it, in every strip.** The WAI-ARIA tabs pattern
   and axe `nested-interactive` agree. The terminal strip still nested a close `<button>` in each tab
   and had no `role="tablist"`. It now shares the workbench helper: Enter or Space opens a terminal
   tab, Delete closes it and moves focus to the next tab or the previous one. VS Code binds the same
   Delete key to killing the focused terminal tab (Cmd+Backspace on macOS).
4. **Automatic direction has to stop at the outermost block.** HTML leaves descendants that carry
   their own `dir` out of an ancestor's `dir="auto"` resolution, so every nested block with
   `dir="auto"` made right-to-left lists resolve left to right. Only top-level blocks carry it now;
   code, file chips and display math carry `dir="ltr"`. Headings of every level follow the rule.
5. **Tailwind orders same-property utilities deterministically, and tailwind-merge does not know
   custom spacing.** `min-h-target-min` beside a Button's `min-h-7` wins because Tailwind v4 sorts by
   property order and then by candidate name, and the end-to-end measurement guards it. Registering
   `target-min` with tailwind-merge was rejected: the app's merge config lets a later `min-h-*` remove an
   earlier `size-*`, which would shrink the controls that already use the floor.
6. **Radix modal menus trip `aria-hidden-focus`, by design.** A modal Radix menu hides the rest of the
   page with `aria-hidden` while focus stays trapped in the menu. axe reports focusable elements under
   the hidden subtree. This is the library's documented model, not an app defect, and it is left alone.
7. **The shared focus ring belongs in the base layer, and Tailwind v4's `outline-none` really removes
   the outline.** The old reset that removed the outline from every button sat outside any cascade
   layer, like the rest of `app/globals.css`, and normal declarations outside a layer beat those inside
   one, so it overrode any focus utility a component set. Tailwind v4 made `outline-none` set
   `outline-style: none` (the old invisible outline is now `outline-hidden`), so a control with
   `outline-none` and no ring of its own showed nothing, even in forced colours. The ring now sits in
   `@layer base`, where a control's own focus utilities override it. `:focus-visible` follows the
   Selectors 4 heuristics: a pointer press on a button does not indicate focus, and script focus takes
   the previous element's state. A browser probe agreed: no ring at load or after clicks, and a ring
   when Escape returns focus to a menu trigger.
8. **A Radix dialog without a trigger returns focus to nothing.** The modal content's
   `onCloseAutoFocus` prevents the focus scope's own restore and focuses `triggerRef`, which stays
   empty when no `Dialog.Trigger` exists. Five dialogs open from shortcuts, menu items and events (the
   command palette, the quick pick, the New file prompt, the attachment preview, the shortcuts sheet),
   so Escape left focus on the page body. The authoring practices say focus returns to the invoking
   element, or to another element that keeps the work flow when that element is gone. A menu item
   that opened a dialog is gone by the time the dialog closes, and so is a palette row, so capturing
   the element at open time is not enough: `useDialogFocusReturn` keeps a short history of focused
   elements and focuses the most recent one that is still on the page, which is the menu button in
   that case and the element a dialog's action moved focus to in another.
9. **An element that stops being focusable while it has focus drops focus to the page.** The HTML
   rendering update runs the focus fixup step: when the focused area is no longer focusable, focus
   moves to the viewport, which the standard says will usually fire `blur`. Chromium 156 moves it at
   once and fired `blur` in the probe: after removing `tabindex` from a focused `div`, the next line
   read `document.activeElement` as the body. A chat table's scroll box is a keyboard stop only
   while the table overflows, so it keeps the stop while it holds focus, or a table that came to
   fit, say after Ctrl+B hid the sidebar, would throw focus away.
10. **A ring inside a filled button has to contrast with the fill as well.** The understanding note
   on 1.4.11 sorts indicators by where they sit. One outside the control needs 3:1 against the page;
   one at the control's border, inside it and touching the outside, needs 3:1 against both
   neighbours. The shared ring is drawn 2px inside the edge, so on the `--accent` fill it measured
   2.9:1 and on `--danger` 1.9:1. The owner chose the label colour over an outside ring with a gap,
   which containers that hide overflow would clip: white measures 6.0:1 and 3.9:1 on the fills and
   17:1 on the page. GitHub's Primer does the same for its filled emphasis buttons:
   `focusOutlineOnEmphasis` draws an inner ring in `--fgColor-onEmphasis`, the label colour, inside
   the 2px focus outline.

## Standards and techniques

| Source | What it is | What it settles here |
| --- | --- | --- |
| [Understanding SC 2.5.8 Target Size (Minimum)](https://github.com/w3c/wcag/blob/main/understanding/22/target-size-minimum.html) | 24 by 24 CSS pixels, or the 24px-circle spacing exception | The floor `--target-size-min` enforces, and why adjacent undersized rows fail |
| [Understanding SC 2.5.5 Target Size (Enhanced)](https://github.com/w3c/wcag/blob/main/understanding/21/target-size-enhanced.html) | The AAA 44px target and its equivalent-target exception | Out of scope; AA is the bar, recorded so the 24px choice is not mistaken for AAA |
| [Understanding SC 1.4.11 Non-text Contrast](https://github.com/w3c/wcag/blob/main/understanding/21/non-text-contrast.html) | Focus indicators and control boundaries need 3:1, measured without rounding; an indicator at a control's edge, inside it and touching the outside, needs it against both neighbouring colours | `--focus` measures 2.87:1 on `--surface-2`, so new rings use `--accent-text`; on an `--accent` or `--danger` fill that ring falls to 2.9:1 and 1.9:1, so filled buttons ring in their label colour |
| [Understanding SC 1.4.3 Contrast (Minimum)](https://github.com/w3c/wcag/blob/main/understanding/20/contrast-minimum.html) | Text needs 4.5:1 | Menu shortcut hints moved from `text-muted` (4.35:1) to `text-secondary` (5.46:1) |
| [Understanding SC 2.4.7 Focus Visible](https://github.com/w3c/wcag/blob/main/understanding/20/focus-visible.html) | Any keyboard-operable interface has a visible focus indicator; a text field's caret is one | Buttons take the shared 2px inset ring, read-only editors draw no caret and get the same outline, and text fields rely on their caret |
| [Selectors Level 4: `:focus-visible` heuristics](https://github.com/w3c/csswg-drafts/blob/main/selectors-4/Overview.bs) | Suggested rules for when a browser indicates focus | A pointer press on a button draws no ring, and script focus takes the previous element's state, so the shared ring shows for keyboard use only |
| [Understanding SC 2.1.1 Keyboard](https://github.com/w3c/wcag/blob/main/understanding/20/keyboard.html) | All functionality operable from a keyboard | Command palette rows are `role="button"` and now run on Enter and Space |
| [Understanding SC 4.1.2 Name, Role, Value](https://github.com/w3c/wcag/blob/main/understanding/20/name-role-value.html) | Controls expose a name and a role | The forty-three unnamed or `title`-only icon buttons, and tabs without a tablist |
| [Understanding SC 2.4.3 Focus Order](https://github.com/w3c/wcag/blob/main/understanding/20/focus-order.html) | Focus moves in an order that preserves meaning | Closing a tab hands focus to its neighbour instead of dropping it to the page |
| [Understanding SC 2.4.13 Focus Appearance](https://github.com/w3c/wcag/blob/main/understanding/22/focus-appearance.html) | AAA area and contrast rules for focus indicators | Guides the 2px inset outline; AAA itself is not claimed |
| [Understanding SC 2.4.11 Focus Not Obscured (Minimum)](https://github.com/w3c/wcag/blob/main/understanding/22/focus-not-obscured-minimum.html) | A focused component is not fully hidden | Rounded, clipped frames use inset outlines so the ring is not cut off |
| [Understanding SC 2.5.3 Label in Name](https://github.com/w3c/wcag/blob/main/understanding/21/label-in-name.html) | The accessible name contains the visible label | `aria-label` repeats the tooltip text, for example "New Terminal" |
| [Understanding SC 1.3.1 Info and Relationships](https://github.com/w3c/wcag/blob/main/understanding/20/info-and-relationships.html) | Structure is programmatically determinable | Tabs sit in a tablist, list markers stay real list items, separators are hidden list items |
| [Understanding SC 1.1.1 Non-text Content](https://github.com/w3c/wcag/blob/main/understanding/20/non-text-content.html) | Controls made of images need a name | Glyph-only buttons need text alternatives |
| [Technique ARIA14](https://github.com/w3c/wcag/blob/main/techniques/aria/ARIA14.html) | `aria-label` where a visible label cannot be used | The technique used for icon-only buttons |
| [Technique ARIA6](https://github.com/w3c/wcag/blob/main/techniques/aria/ARIA6.html) | `aria-label` to label objects | Same, for glyph controls such as gallery navigation |
| [Failure F59](https://github.com/w3c/wcag/blob/main/techniques/failures/F59.html) | A scripted `div` or `span` control without a role | Every glyph the strips act on is `aria-hidden`, and the element that acts carries the role |
| [Technique H65](https://github.com/w3c/wcag/blob/main/techniques/html/H65.html) | `title` to identify a control | A fallback only, and unusable here because the app strips `title` |
| [HTML: the `dir` attribute](https://html.spec.whatwg.org/multipage/dom.html#the-dir-attribute) | `auto` resolves from the first strong character and skips descendants with their own `dir` | Nested blocks inherit instead of carrying `dir="auto"` |
| [HTML rendering: tables](https://html.spec.whatwg.org/multipage/rendering.html#tables-2) | The user agent centres a `th` whose row inherits the initial alignment | Header cells set `text-start` themselves |
| [HTML: update the rendering, focus fixup](https://github.com/whatwg/html/blob/main/source) | A focused area that is no longer focusable, for example after `hidden` or `disabled`, hands focus to the viewport and usually fires `blur` (`id="focus-fixup-rule"`) | A chat table's scroll box keeps its keyboard stop while it holds focus, so a table that comes to fit does not drop focus |
| [CSS Fonts 4: the `@font-face` `font-family` descriptor](https://github.com/w3c/csswg-drafts/blob/main/css-fonts-4/Overview.bs) | A family that `@font-face` defines with the name of an installed font hides that font for documents that use the stylesheet | Uploaded fonts keep the `BetterShapeCustom-` prefix, and the settings label strips it only for display |

## WAI-ARIA Authoring Practices

| Source | What it is | What it settles here |
| --- | --- | --- |
| [Tabs pattern](https://github.com/w3c/aria-practices/blob/main/content/patterns/tabs/tabs-pattern.html) | Enter or Space activates; Left and Right Arrow move focus between tabs, wrapping at the ends, and Home and End jump to the first and last; Delete closes and focuses the following tab, else the preceding one, and optionally activates it | The keyboard model of workbench and terminal tabs: arrows move focus without opening a tab, and a held Delete closes only one |
| [Breadcrumb pattern](https://github.com/w3c/aria-practices/blob/main/content/patterns/breadcrumb/breadcrumb-pattern.html) | A labelled navigation with `aria-current="page"` | The project breadcrumb keeps the list structure and current marker |
| [Button pattern example](https://github.com/w3c/aria-practices/blob/main/content/patterns/button/examples/js/button.js) | The reference button runs Enter on key down and Space on key up, cancelling Space's key down so the page does not scroll | Palette rows, which are `role="button"`, run Space on key up, and only when the same row took the key down |
| [Developing a keyboard interface](https://github.com/w3c/aria-practices/blob/main/content/practices/keyboard-interface/keyboard-interface-practice.html) | Focus movement conventions and reserved keys | Space reorders in sortable strips, Enter opens, Delete closes |
| [Listbox pattern](https://github.com/w3c/aria-practices/blob/main/content/patterns/listbox/listbox-pattern.html) | A listbox owns options and moves a selection | The commit graph scroller is not a listbox |
| [Dialog (Modal) pattern](https://github.com/w3c/aria-practices/blob/main/content/patterns/dialog-modal/dialog-modal-pattern.html) | When a dialog closes, focus returns to the element that invoked it; if that element no longer exists, to another element that keeps the work flow | `useDialogFocusReturn` steps back past a closed menu item or palette row to the menu button or the control that had focus |
| [Grid pattern](https://github.com/w3c/aria-practices/blob/main/content/patterns/grid/grid-pattern.html) | A composite widget for rows of interactive cells | The fit for a fully keyboard-driven commit graph, recorded as the follow-up |
| [Treegrid pattern](https://github.com/w3c/aria-practices/blob/main/content/patterns/treegrid/treegrid-pattern.html) | Expandable rows with cells | Alternative for commit rows that expand, also left for the follow-up |
| [Names and descriptions](https://github.com/w3c/aria-practices/blob/main/content/practices/names-and-descriptions/names-and-descriptions-practice.html) | `title` is a weak name source and tooltips are hover-only | Supports naming icon buttons with `aria-label` |
| [Tooltip pattern](https://github.com/w3c/aria-practices/blob/main/content/patterns/tooltip/tooltip-pattern.html) | A tooltip describes its trigger through `aria-describedby` | A tooltip is a description, so it does not name the button |
| [Toolbar pattern](https://github.com/w3c/aria-practices/blob/main/content/patterns/toolbar/toolbar-pattern.html) | One tab stop with roving focus | Considered for dense icon rows; not adopted in this change |
| [Feed pattern](https://github.com/w3c/aria-practices/blob/main/content/patterns/feed/feed-pattern.html) | `aria-posinset` and `aria-setsize` on virtualized items | The commit list keeps both on its list items |
| [Structural roles](https://github.com/w3c/aria-practices/blob/main/content/practices/structural-roles/structural-roles-practice.html) | `list`, `group` and related roles | A focusable scroller is a named group |

## MDN reference pages

| Source | What it settles here |
| --- | --- |
| [`dir` global attribute](https://github.com/mdn/content/blob/main/files/en-us/web/html/reference/global_attributes/dir/index.md) | `auto` skips descendants with a valid `dir` |
| [`<th>`](https://github.com/mdn/content/blob/main/files/en-us/web/html/reference/elements/th/index.md) | Header cells are centred by default |
| [`EventTarget.addEventListener()`](https://github.com/mdn/content/blob/main/files/en-us/web/api/eventtarget/addeventlistener/index.md) | A listener already in the target's list is not added a second time |
| [`outline-offset`](https://github.com/mdn/content/blob/main/files/en-us/web/css/reference/properties/outline-offset/index.md) | A negative offset draws the ring inside the box, past clipping |
| [`@layer`](https://github.com/mdn/content/blob/main/files/en-us/web/css/reference/at-rules/@layer/index.md) | Normal declarations inside a layer lose to declarations outside any layer, which is why the old unlayered reset beat every focus utility and why the shared ring sits in `@layer base` |
| [`:has()`](https://github.com/mdn/content/blob/main/files/en-us/web/css/reference/selectors/_colon_has/index.md) | Takes its argument's specificity |
| [`:focus-visible`](https://github.com/mdn/content/blob/main/files/en-us/web/css/reference/selectors/_colon_focus-visible/index.md) | Chosen by heuristics, so tests press a key before focusing |
| [ARIA tab role](https://github.com/mdn/content/blob/main/files/en-us/web/accessibility/aria/reference/roles/tab_role/index.md) | Delete may remove a tab; tabs belong to a tablist |
| [ARIA tablist role](https://github.com/mdn/content/blob/main/files/en-us/web/accessibility/aria/reference/roles/tablist_role/index.md) | The required container for tabs |
| [ARIA menubar role](https://github.com/mdn/content/blob/main/files/en-us/web/accessibility/aria/reference/roles/menubar_role/index.md) | A menubar contains menuitems, so the breadcrumb uses it only when it renders menus |
| [ARIA group role](https://github.com/mdn/content/blob/main/files/en-us/web/accessibility/aria/reference/roles/group_role/index.md) | The role for focusable scrollers |
| [ARIA region role](https://github.com/mdn/content/blob/main/files/en-us/web/accessibility/aria/reference/roles/region_role/index.md) | A landmark, too heavy for a table or graph scroller |
| [`<ol>`](https://github.com/mdn/content/blob/main/files/en-us/web/html/reference/elements/ol/index.md) | `start` keeps the number a list resumes from |
| [`aria-keyshortcuts`](https://github.com/mdn/content/blob/main/files/en-us/web/accessibility/aria/reference/attributes/aria-keyshortcuts/index.md) | Tabs announce Delete as their close key |
| [`tabindex`](https://github.com/mdn/content/blob/main/files/en-us/web/html/reference/global_attributes/tabindex/index.md) | `0` puts read-only editor text in the tab order |
| [`text-align`](https://github.com/mdn/content/blob/main/files/en-us/web/css/reference/properties/text-align/index.md) | `start` follows the direction |
| [CSS logical properties](https://github.com/mdn/content/blob/main/files/en-us/web/css/guides/logical_properties_and_values/index.md) | `ms-*`, `ps-*`, `border-s-*` mirror for right-to-left text |
| [`<bdi>`](https://github.com/mdn/content/blob/main/files/en-us/web/html/reference/elements/bdi/index.md) | Isolation for embedded opposite-direction runs |
| [`<code>`](https://github.com/mdn/content/blob/main/files/en-us/web/html/reference/elements/code/index.md) | Inline code carries `dir="ltr"` so `fn()` does not render as `()fn` |
| [`unicode-bidi`](https://github.com/mdn/content/blob/main/files/en-us/web/css/reference/properties/unicode-bidi/index.md) | How `dir` isolates runs |
| [ARIA listbox role](https://github.com/mdn/content/blob/main/files/en-us/web/accessibility/aria/reference/roles/listbox_role/index.md) | A listbox holds options only |
| [ARIA option role](https://github.com/mdn/content/blob/main/files/en-us/web/accessibility/aria/reference/roles/option_role/index.md) | Options have presentational children, so rows with buttons cannot be options |
| [ARIA grid role](https://github.com/mdn/content/blob/main/files/en-us/web/accessibility/aria/reference/roles/grid_role/index.md) | Background for the graph follow-up |
| [ARIA list role](https://github.com/mdn/content/blob/main/files/en-us/web/accessibility/aria/reference/roles/list_role/index.md) | The commit list stays a list of listitems |
| [`aria-posinset`](https://github.com/mdn/content/blob/main/files/en-us/web/accessibility/aria/reference/attributes/aria-posinset/index.md) | Needed because the list is virtualized |
| [ARIA button role](https://github.com/mdn/content/blob/main/files/en-us/web/accessibility/aria/reference/roles/button_role/index.md) | A button always has a name and runs on Enter and Space |
| [`aria-label`](https://github.com/mdn/content/blob/main/files/en-us/web/accessibility/aria/reference/attributes/aria-label/index.md) | The naming attribute used for icon buttons |
| [`title` global attribute](https://github.com/mdn/content/blob/main/files/en-us/web/html/reference/global_attributes/title/index.md) | Inconsistent for assistive technology, and stripped in this app |
| [`aria-selected`](https://github.com/mdn/content/blob/main/files/en-us/web/accessibility/aria/reference/attributes/aria-selected/index.md) | Marks the open tab in each strip |
| [`aria-hidden`](https://github.com/mdn/content/blob/main/files/en-us/web/accessibility/aria/reference/attributes/aria-hidden/index.md) | Never on focusable content, which is why close glyphs are not focusable |
| [`min-height`](https://github.com/mdn/content/blob/main/files/en-us/web/css/reference/properties/min-height/index.md) | Beats `height`, so the floor works beside a fixed height |

## axe-core rules and internals

| Source | What it settles here |
| --- | --- |
| [`target-size` rule](https://github.com/dequelabs/axe-core/blob/develop/lib/rules/target-size.json) | Runs on `widget-not-inline-matches` targets |
| [`target-size` check](https://github.com/dequelabs/axe-core/blob/develop/lib/checks/mobile/target-size.json) | `minSize` 24 |
| [`target-size-evaluate`](https://github.com/dequelabs/axe-core/blob/develop/lib/checks/mobile/target-size-evaluate.js) | Measures the space a target keeps from obscuring and neighbouring widgets |
| [`widget-not-inline-matches`](https://github.com/dequelabs/axe-core/blob/develop/lib/rules/widget-not-inline-matches.js) | A target is a focusable element with a widget role |
| [`get-offset`](https://github.com/dequelabs/axe-core/blob/develop/lib/commons/math/get-offset.js) | The spacing-exception distance |
| [`aria-required-parent`](https://github.com/dequelabs/axe-core/blob/develop/lib/rules/aria-required-parent.json) | Terminal tabs had no tablist |
| [`aria-required-children`](https://github.com/dequelabs/axe-core/blob/develop/lib/rules/aria-required-children.json) | The graph listbox owned a list instead of options |
| [`button-name`](https://github.com/dequelabs/axe-core/blob/develop/lib/rules/button-name.json) | The unnamed icon buttons |
| [`aria-hidden-focus`](https://github.com/dequelabs/axe-core/blob/develop/lib/rules/aria-hidden-focus.json) | Reported while a modal Radix menu is open; left alone |
| [`aria-prohibited-attr`](https://github.com/dequelabs/axe-core/blob/develop/lib/rules/aria-prohibited-attr.json) | Why the graph scroller keeps a role instead of a bare `aria-label` |
| [`nested-interactive`](https://github.com/dequelabs/axe-core/blob/develop/lib/rules/nested-interactive.json) | Tab close buttons and the palette delete button |
| [`scrollable-region-focusable`](https://github.com/dequelabs/axe-core/blob/develop/lib/rules/scrollable-region-focusable.json) | Why read-only diff text and wide tables take focus |
| [ARIA roles standard](https://github.com/dequelabs/axe-core/blob/develop/lib/standards/aria-roles.js) | `tab` requires the `tablist` context |
| [`label`](https://github.com/dequelabs/axe-core/blob/develop/lib/rules/label.json) | Task checkboxes carry a name |
| [`color-contrast`](https://github.com/dequelabs/axe-core/blob/develop/lib/rules/color-contrast.json) | The menu text measurements |
| [`list`](https://github.com/dequelabs/axe-core/blob/develop/lib/rules/list.json) | Breadcrumb separators stay `li` elements |
| [`listitem`](https://github.com/dequelabs/axe-core/blob/develop/lib/rules/listitem.json) | Same |
| [`aria-allowed-role`](https://github.com/dequelabs/axe-core/blob/develop/lib/rules/aria-allowed-role.json) | Roles placed on native elements |
| [`focus-order-semantics`](https://github.com/dequelabs/axe-core/blob/develop/lib/rules/focus-order-semantics.json) | Focusable scrollers carry a role |
| [axe-core#3674](https://github.com/dequelabs/axe-core/issues/3674) | target-size and nested widgets: descendants of a widget are excluded from its obscuring set |
| [axe-core#4224](https://github.com/dequelabs/axe-core/issues/4224) | Overlapping targets reduce the measured size unless they do the same thing |
| [axe-core#4295](https://github.com/dequelabs/axe-core/issues/4295) | Offset calculation bugs exist, so every finding was measured in the page too |
| [axe-core#5184](https://github.com/dequelabs/axe-core/issues/5184) | Nested interactive targets remain an open design question upstream |

## Libraries and reference implementations

| Source | What it settles here |
| --- | --- |
| [Primer `focusOutlineOnEmphasis` mixin](https://github.com/primer/react/blob/main/packages/postcss-preset-primer/src/mixins/focusOutlineOnEmphasis.css), used by `ButtonBase.module.css` for primary buttons | A shipped design system draws a filled button's focus indicator with its on-emphasis foreground colour inside the focus outline, the precedent for ringing filled buttons in their label colour |
| [Tailwind CSS v4 upgrade guide](https://github.com/tailwindlabs/tailwindcss.com/blob/main/src/docs/upgrade-guide.mdx) | `outline-none` now sets `outline-style: none`, and the old invisible outline that showed in forced colours is `outline-hidden`; a control with `outline-none` and no ring of its own has no indicator |
| `@dnd-kit/core` 6.3.1 `KeyboardSensor` (`node_modules/@dnd-kit/core/dist/core.esm.js`) | Space and Enter start a drag by default, and handled events are skipped, so the strip claims Enter first |
| `@dnd-kit/core` 6.3.1 default screen reader instructions | They name only the space bar, which matches Space reordering |
| `mdast-util-to-hast` 13.2.1 list handler | Sets `start` when a list does not begin at 1 |
| `react-markdown` 10.1.0 component map | Every heading level and block goes through the custom components |
| `remark-gfm` 4.0.1 | Tables, task lists and footnotes |
| `@radix-ui/react-menubar` 1.1.16 | Menubar parts throw outside a Menubar, so the breadcrumb chooses the role by what it renders |
| [`@codemirror/view` `extension.ts`](https://github.com/codemirror/view/blob/main/src/extension.ts) and 6.43.9 base theme | `editable` and `contentAttributes` facets; the base `.cm-focused` ring is a 1px dotted outline |
| `@codemirror/merge` 6.12.2 | Split diffs mount two editors, named original and modified |
| [Tailwind CSS `compile.ts`](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/compile.ts) | Utilities sort by property order, then by candidate, so the floor class lands after `min-h-7` |
| [tailwind-merge configuration](https://github.com/dcastil/tailwind-merge/blob/main/packages/tailwind-merge/docs/configuration.md) | Custom theme values need registering in class groups |
| [tailwind-merge limitations](https://github.com/dcastil/tailwind-merge/blob/main/packages/tailwind-merge/docs/limitations.md) | Unregistered custom classes are kept side by side |
| [tailwind-merge#377](https://github.com/dcastil/tailwind-merge/issues/377) | Custom spacing scales merge inconsistently, the reason `core/utils.ts` registers its own |
| [Radix Dialog source](https://github.com/radix-ui/primitives/blob/main/packages/react/dialog/src/dialog.tsx) | Modal content's `onCloseAutoFocus` prevents the default restore and focuses `context.triggerRef`, which is empty without a `Dialog.Trigger` |
| [Radix Tooltip source](https://github.com/radix-ui/primitives/blob/main/packages/react/tooltip/src/tooltip.tsx) | The trigger gets `aria-describedby` only while the tooltip is open |
| [radix-ui/primitives#1952](https://github.com/radix-ui/primitives/issues/1952) | Radix tooltips describe, they do not label |
| [radix-ui/primitives#2988](https://github.com/radix-ui/primitives/issues/2988) | A label equal to the tooltip may be read twice by VoiceOver; accepted, as the codebase already pairs them |
| [Radix Menu source](https://github.com/radix-ui/primitives/blob/main/packages/react/menu/src/menu.tsx) | A modal menu calls `hideOthers` |
| [`aria-hidden` package](https://github.com/theKashey/aria-hidden) | `hideOthers` marks every sibling subtree hidden |
| [radix-ui/primitives#3085](https://github.com/radix-ui/primitives/issues/3085) | Hidden content with focusable descendants is a known Radix report |
| [radix-ui/primitives#4250](https://github.com/radix-ui/primitives/issues/4250) | Chrome blocks `aria-hidden` on a subtree that still holds focus |
| [VS Code `terminalActions.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/terminalActions.ts) | `KillActiveTab` binds Delete, and Cmd+Backspace on macOS, while terminal tabs have focus |

## Analyzers and CI

| Source | What it settles here |
| --- | --- |
| DeepSource analysis run `42caf930` | Issues are counted against the default branch, so the unrelated `main` history inflates the PR count |
| [actions/runner-images](https://github.com/actions/runner-images) | `macos-26` is ARM and `macos-26-intel` is x64; a pinned label does not guarantee capacity |

## Upstream issues replayed in the visual campaign

Fifty-five reports from comparable chat and editor apps, read in full. Each became a scenario in
`engineering/visual-stress-and-upstream-issue-verification.md`.

| Issue | State | Report | What it settles here |
| --- | --- | --- | --- |
| [open-webui/open-webui#33282](https://github.com/open-webui/open-webui/issues/33282) | closed | bug: chat scroll jumps back down while scrolling up in long conversations | Scroll anchoring. Streaming and history loads must not move the reader; the campaign's scroll-anchoring scenarios replay these reports |
| [open-webui/open-webui#23990](https://github.com/open-webui/open-webui/issues/23990) | closed | issue: Scrolling up jumps around in a conversation/chat | Scroll anchoring. Streaming and history loads must not move the reader; the campaign's scroll-anchoring scenarios replay these reports |
| [open-webui/open-webui#29317](https://github.com/open-webui/open-webui/issues/29317) | closed | Bug: auto-scroll does not follow streamed response with reasoning-parser models, only p... | Scroll anchoring. Streaming and history loads must not move the reader; the campaign's scroll-anchoring scenarios replay these reports |
| [open-webui/open-webui#17141](https://github.com/open-webui/open-webui/issues/17141) | closed | issue: Cmd+Enter shortcut to send message fails after activating IME | IME composition. Enter, Backspace and shortcuts stay with the input method while it composes |
| [open-webui/open-webui#33223](https://github.com/open-webui/open-webui/issues/33223) | closed | issue: Backspace during IME composition force-commits the text; in Firefox it also copi... | IME composition. Enter, Backspace and shortcuts stay with the input method while it composes |
| [open-webui/open-webui#23526](https://github.com/open-webui/open-webui/issues/23526) | closed | bug: balanced $$...$$ LaTeX display math is parsed unreliably and stray $$ can disrupt... | Display math. Display math renders as one block and carries `dir="ltr"`, so it never decides the direction of the prose around it |
| [open-webui/open-webui#2615](https://github.com/open-webui/open-webui/issues/2615) | closed | enh: configurable latex delimiters | Display math. Display math renders as one block and carries `dir="ltr"`, so it never decides the direction of the prose around it |
| [open-webui/open-webui#2134](https://github.com/open-webui/open-webui/issues/2134) | closed | feat: RTL support | Right-to-left text. Reply blocks, user messages and the composer use `dir="auto"`, nested blocks inherit, and code stays left to right |
| [open-webui/open-webui#13633](https://github.com/open-webui/open-webui/issues/13633) | closed | issue: Input text box direction not affected by RTL Interface setting | Right-to-left text. Reply blocks, user messages and the composer use `dir="auto"`, nested blocks inherit, and code stays left to right |
| [open-webui/open-webui#8448](https://github.com/open-webui/open-webui/issues/8448) | closed | add Auto Direction Detection | Right-to-left text. Reply blocks, user messages and the composer use `dir="auto"`, nested blocks inherit, and code stays left to right |
| [open-webui/open-webui#27305](https://github.com/open-webui/open-webui/issues/27305) | closed | issue: long chat titles are not truncated in Settings → Archived Chats on wide viewports | Truncation and overflow. Long titles, menus and rails truncate or reflow instead of clipping, at every supported root size |
| [open-webui/open-webui#27473](https://github.com/open-webui/open-webui/issues/27473) | closed | issue: sidebar chat row flickers between title truncation and timestamp while hovering | Truncation and overflow. Long titles, menus and rails truncate or reflow instead of clipping, at every supported root size |
| [open-webui/open-webui#27690](https://github.com/open-webui/open-webui/issues/27690) | closed | issue: Open Terminal cloud icon and Account profile avatar are cut off on their left side | Truncation and overflow. Long titles, menus and rails truncate or reflow instead of clipping, at every supported root size |
| [open-webui/open-webui#29083](https://github.com/open-webui/open-webui/issues/29083) | closed | issue: workspace model id and timestamp overlay the model name on narrow screens | Truncation and overflow. Long titles, menus and rails truncate or reflow instead of clipping, at every supported root size |
| [open-webui/open-webui#28500](https://github.com/open-webui/open-webui/issues/28500) | closed | fix: collapsed sidebar rail pushed off screen, recoverable only by shrinking the window... | Truncation and overflow. Long titles, menus and rails truncate or reflow instead of clipping, at every supported root size |
| [open-webui/open-webui#5975](https://github.com/open-webui/open-webui/issues/5975) | closed | Inconsistent Conversation Bubble Sizes with YAML Code Blocks in Widescreen Mode | Code blocks. Code blocks keep their copy action, wrap or scroll without clipping, and show a visible scrollbar |
| [CherryHQ/cherry-studio#23247](https://github.com/CherryHQ/cherry-studio/issues/23247) | closed | [Bug]: Agent session — scrolling up jumps to the very beginning and the list gets stuck... | Scroll anchoring. Streaming and history loads must not move the reader; the campaign's scroll-anchoring scenarios replay these reports |
| [CherryHQ/cherry-studio#23196](https://github.com/CherryHQ/cherry-studio/issues/23196) | closed | [Bug]: Message list jumps back to the first message when scrolling (v2.1.9) | Scroll anchoring. Streaming and history loads must not move the reader; the campaign's scroll-anchoring scenarios replay these reports |
| [CherryHQ/cherry-studio#19596](https://github.com/CherryHQ/cherry-studio/issues/19596) | closed | [Bug]: Long code blocks lose the copy action after scrolling | Code blocks. Code blocks keep their copy action, wrap or scroll without clipping, and show a visible scrollbar |
| [CherryHQ/cherry-studio#19500](https://github.com/CherryHQ/cherry-studio/issues/19500) | closed | [Bug]: Selection translation result code blocks do not wrap and are clipped | Code blocks. Code blocks keep their copy action, wrap or scroll without clipping, and show a visible scrollbar |
| [CherryHQ/cherry-studio#10951](https://github.com/CherryHQ/cherry-studio/issues/10951) | closed | [Bug]: Code block selection overflow | Code blocks. Code blocks keep their copy action, wrap or scroll without clipping, and show a visible scrollbar |
| [CherryHQ/cherry-studio#19798](https://github.com/CherryHQ/cherry-studio/issues/19798) | closed | [Bug]: Horizontal scrollbar thumb is invisible in code and text blocks | Code blocks. Code blocks keep their copy action, wrap or scroll without clipping, and show a visible scrollbar |
| [CherryHQ/cherry-studio#23482](https://github.com/CherryHQ/cherry-studio/issues/23482) | open | [Bug]: LaTeX formula is split into separate blocks when an equals sign occupies its own... | Display math. Display math renders as one block and carries `dir="ltr"`, so it never decides the direction of the prose around it |
| [CherryHQ/cherry-studio#18869](https://github.com/CherryHQ/cherry-studio/issues/18869) | open | [Bug]: LaTeX formulas are rendered incorrectly | Display math. Display math renders as one block and carries `dir="ltr"`, so it never decides the direction of the prose around it |
| [CherryHQ/cherry-studio#19576](https://github.com/CherryHQ/cherry-studio/issues/19576) | closed | [Bug]: Cherry Studio 2.0.9 intermittently exposes raw LaTeX commands in chat | Display math. Display math renders as one block and carries `dir="ltr"`, so it never decides the direction of the prose around it |
| [CherryHQ/cherry-studio#21296](https://github.com/CherryHQ/cherry-studio/issues/21296) | open | [Feature Request] Add RTL (Right-to-Left) text direction support for Persian and Arabic | Right-to-left text. Reply blocks, user messages and the composer use `dir="auto"`, nested blocks inherit, and code stays left to right |
| [CherryHQ/cherry-studio#23200](https://github.com/CherryHQ/cherry-studio/issues/23200) | closed | After upgrading the desktop version to the latest version, the scrollbar on the right s... | Scroll affordance. Scrollable regions show their scrollbar and stay reachable by keyboard |
| [continuedev/continue#2992](https://github.com/continuedev/continue/issues/2992) | closed | Don't auto-scroll chat to keep end of conversation in view | Scroll anchoring. Streaming and history loads must not move the reader; the campaign's scroll-anchoring scenarios replay these reports |
| [continuedev/continue#3081](https://github.com/continuedev/continue/issues/3081) | closed | Word wrap/Line length setting | Code blocks. Code blocks keep their copy action, wrap or scroll without clipping, and show a visible scrollbar |
| [continuedev/continue#2795](https://github.com/continuedev/continue/issues/2795) | closed | Missing scrollbar | Scroll affordance. Scrollable regions show their scrollbar and stay reachable by keyboard |
| [continuedev/continue#12910](https://github.com/continuedev/continue/issues/12910) | open | Sidebar buttons pushed off-screen due to Flexbox overflow | Truncation and overflow. Long titles, menus and rails truncate or reflow instead of clipping, at every supported root size |
| [continuedev/continue#12912](https://github.com/continuedev/continue/issues/12912) | open | Continue chat pane sizing error | Truncation and overflow. Long titles, menus and rails truncate or reflow instead of clipping, at every supported root size |
| [cline/cline#3434](https://github.com/cline/cline/issues/3434) | closed | Fix buggy scrolling in chatview | Scroll anchoring. Streaming and history loads must not move the reader; the campaign's scroll-anchoring scenarios replay these reports |
| [cline/cline#8636](https://github.com/cline/cline/issues/8636) | open | Thinking section not displayed in v3.50.0 | Reasoning blocks. Reasoning content renders as its own collapsible block and is never dropped |
| [RooCodeInc/Roo-Code#4787](https://github.com/RooCodeInc/Roo-Code/issues/4787) | closed | Markdown tables don't render correctly | Markdown tables. Tables render while streaming, and wide tables scroll inside a focusable group with an inset focus ring |
| [RooCodeInc/Roo-Code#12026](https://github.com/RooCodeInc/Roo-Code/issues/12026) | open | [BUG] Markdown Table Format not working correct | Markdown tables. Tables render while streaming, and wide tables scroll inside a focusable group with an inset focus ring |
| [chatboxai/chatbox#1448](https://github.com/chatboxai/chatbox/issues/1448) | open | [Feature] : RTL Right To Left BiDi Support Chat window | Right-to-left text. Reply blocks, user messages and the composer use `dir="auto"`, nested blocks inherit, and code stays left to right |
| [chatboxai/chatbox#2646](https://github.com/chatboxai/chatbox/issues/2646) | open | [BUG][Mobile] Markdown Table Rendering Failure During Response Streaming 在流式响应过程中 Markd... | Markdown tables. Tables render while streaming, and wide tables scroll inside a focusable group with an inset focus ring |
| [chatboxai/chatbox#3975](https://github.com/chatboxai/chatbox/issues/3975) | open | [BUG]Clicking any in-page anchor in a message (GFM footnote reference, definition link,... | In-page anchors. Footnote and back-reference links scroll inside the message instead of navigating the window |
| [Mintplex-Labs/anything-llm#3430](https://github.com/Mintplex-Labs/anything-llm/issues/3430) | open | [FEAT]: Improve RTL Support for Arabic in Model Responses | Right-to-left text. Reply blocks, user messages and the composer use `dir="auto"`, nested blocks inherit, and code stays left to right |
| [Mintplex-Labs/anything-llm#3050](https://github.com/Mintplex-Labs/anything-llm/issues/3050) | closed | [FEAT]: Better Rendering for <think> Tag Content | Reasoning blocks. Reasoning content renders as its own collapsible block and is never dropped |
| [janhq/jan#8672](https://github.com/janhq/jan/issues/8672) | open | bug: Jinja template input box truncates long template content in model settings | Truncation and overflow. Long titles, menus and rails truncate or reflow instead of clipping, at every supported root size |
| [zed-industries/zed#28174](https://github.com/zed-industries/zed/issues/28174) | closed | Keymap takes precedence over input methods(CJK IME) | IME composition. Enter, Backspace and shortcuts stay with the input method while it composes |
| [zed-industries/zed#21042](https://github.com/zed-industries/zed/issues/21042) | closed | Zed Leaks Key Events to Chinese Input Method | IME composition. Enter, Backspace and shortcuts stay with the input method while it composes |
| [zed-industries/zed#61752](https://github.com/zed-industries/zed/issues/61752) | closed | [UI Bug] Model selection dropdown menu text is truncated / cut off | Truncation and overflow. Long titles, menus and rails truncate or reflow instead of clipping, at every supported root size |
| [zed-industries/zed#40213](https://github.com/zed-industries/zed/issues/40213) | closed | Image viewer clips the bottom of images | Truncation and overflow. Long titles, menus and rails truncate or reflow instead of clipping, at every supported root size |
| [zed-industries/zed#35958](https://github.com/zed-industries/zed/issues/35958) | open | Bad resolution on icons when UI font size is small | UI scaling. Pointer targets keep the 24px floor under the 13px root and at larger text scales |
| [zed-industries/zed#7820](https://github.com/zed-industries/zed/issues/7820) | closed | Allow changing the scale of UI | UI scaling. Pointer targets keep the 24px floor under the 13px root and at larger text scales |
| [zed-industries/zed#14971](https://github.com/zed-industries/zed/issues/14971) | closed | Zed on Gnome should support font scaling factor org.gnome.desktop.interface text-scalin... | UI scaling. Pointer targets keep the 24px floor under the 13px root and at larger text scales |
| [microsoft/vscode#318345](https://github.com/microsoft/vscode/issues/318345) | open | Right-clicking can spawn context menu under cursor and action | Context menus. Context menus open without running the item under the pointer, and stay keyboard reachable with Shift+F10 |
| [microsoft/vscode#113175](https://github.com/microsoft/vscode/issues/113175) | closed | Linux: native context menu runs action under mouse when opened | Context menus. Context menus open without running the item under the pointer, and stay keyboard reachable with Shift+F10 |
| [microsoft/vscode#188903](https://github.com/microsoft/vscode/issues/188903) | open | file operation context menu offset error | Context menus. Context menus open without running the item under the pointer, and stay keyboard reachable with Shift+F10 |
| [microsoft/vscode#201532](https://github.com/microsoft/vscode/issues/201532) | open | context menu display on another monitor | Context menus. Context menus open without running the item under the pointer, and stay keyboard reachable with Shift+F10 |
| [microsoft/vscode#159275](https://github.com/microsoft/vscode/issues/159275) | open | Sticky keys and context menu keybinding (Shift F10) | Context menus. Context menus open without running the item under the pointer, and stay keyboard reachable with Shift+F10 |
| [microsoft/vscode#264052](https://github.com/microsoft/vscode/issues/264052) | open | Pressing 'return' with file explorer context menu open starts renaming file | Context menus. Context menus open without running the item under the pointer, and stay keyboard reachable with Shift+F10 |

## Rejected or deferred

- **Registering `target-min` with tailwind-merge.** Rejected: the merge config treats `min-h-*` as
  conflicting with `size-*`, so a registered floor class would remove an earlier `size-7`.
- **Keyboard Delete on command palette rows.** Rejected: deleting a conversation cannot be undone. The
  context menu keeps a deliberate Delete.
- **A full grid or treegrid model for the commit graph.** Deferred to a follow-up. The `group` role fixes
  the invalid listbox now; arrow-key semantics for screen readers need their own design.
- **`modal={false}` on Radix menus to silence `aria-hidden-focus`.** Rejected: it gives up focus
  containment to quiet a report about a pattern that works.
- **Cmd+Backspace as a macOS close key for tabs.** Deferred: VS Code uses it, but adding a second
  close chord is a product decision.
- **Recolouring the older 1px focus rings.** Deferred: `ring-border-focus`, `ring-border-focus-ring` and
  `ring-accent` draw `#3946ff`, which measures 2.29:1 to 2.95:1 on the app's surfaces, below 3:1. The
  approved scope kept existing rings; pointing `--border-focus` at `--accent-text` is the proposed
  follow-up, and it would also recolour text field focus borders.
