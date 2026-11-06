# DESIGN.md

BetterShape's visual contract for its own interface. Every value below was read from the code on `draft/mega-absorb-all` (commit `764f135`), and the file names each source. If this file and the code disagree, the code wins, and the change that finds the gap corrects this file in the same PR.

This file is not the prompt file the agent receives. The Visual-mode prompt is `src-tauri/src/agent/prompts/DESIGN.md`, compiled into the binary and attached to the system prompt. Section 10 covers it.

## 1. Character

- A desktop agent workspace. The window is a Tauri 2 webview with `decorations: false` and `transparent: true` (`src-tauri/tauri.conf.json`), so the app draws its own titlebar and window controls.
- Dark only. `app/layout.tsx` puts `dark` on `<html>`, `app/globals.css` sets `color-scheme: dark` on `:root`, and there is no light token set. One comment in `globals.css` still says "light theme overrides below". No such overrides exist. Treat the comment as stale.
- Dense, IDE-like. The root font size is 13px (`html { font-size: 13px }`, with a comment that Tailwind spacing must match the IDE). Controls are 28 to 40px tall.
- One brand accent, `#3946FF`. The code calls it a "deliberate brand accent (not an accidental indigo default)". Keep it. Do not swap it for a neutral.

## 2. Color

All colors are tokens in `app/globals.css` `:root`, exposed to Tailwind through `@theme inline` as `bg-*`, `text-*`, `border-*` utilities.

### Surfaces

| Token | Value | Role |
| --- | --- | --- |
| `--chrome` | `#1E1E1E` | Recessed chrome. `--background` aliases it, so `body` uses it |
| `--sidebar` | `#2D2D2D` | Agent sidebar. Dropdown and menubar panels (`dropdown.tsx`) use it too |
| `--editor` | `#191919` | Editor and canvas. The composer mention popover uses it through `--menu-bg` |
| `--panel` | `#1B1B1B` | Panels |
| `--surface-0`, `--surface-1` | `#181818` | Base |
| `--surface-2` | `#1b1b1b` | Inputs (`--input-bg`) |
| `--surface-3` | `#202020` | Secondary buttons, disabled controls, muted pills |
| `--surface-4` | `#252525` | Hover on surface-3. Context menu panels (`context.tsx`) |
| `--settings-card` | `#2a2a2a` | Settings cards |
| `--base` | `#f2f2f2` | Foreground |

The file's own comment describes the role split as "Cursor-like: chrome recessed, canvas elevated". Use the role tokens for regions and the `surface-*` ladder for controls. Do not invent a new surface.

### Text

| Token | Value | Use |
| --- | --- | --- |
| `--text-primary` | `#f2f2f2` | Body, labels |
| `--text-secondary` | `#a3a3a3` | Secondary labels, ghost buttons |
| `--text-muted` | `#ffffff79` | Help text, placeholders, icons in idle state |
| `--text-disabled` | `#ffffff2f` | Disabled text |
| `--text-active` | `#ffffff` | Active state |

The comment at `--accent-text` reads "never use --accent (too deep) as body text". Use `--accent-text` (`#9eb0ff`) for accent-colored text on dark.

### Lines

| Token | Value |
| --- | --- |
| `--border` | `rgba(255,255,255,0.116)` |
| `--border-secondary` | `rgba(255,255,255,0.075)`, input outline |
| `--border-subtle` | `rgba(255,255,255,0.062)`, dividers |
| `--window-stroke` | `rgba(255,255,255,0.178)` |
| `--stroke` | `1px` |

### Accent and action

| Token | Value | Use |
| --- | --- | --- |
| `--accent` | `#3946FF` | Primary buttons. `--focus` aliases it for the older 1px control rings; the shared keyboard focus ring uses `--accent-text` |
| `--accent-hover` | `#4365FF` | Hover on primary |
| `--action-label` | `#ffffff` | Text on accent (`--accent-fg`) |
| `--accent-text` / `-hover` | `#9eb0ff` / `#c4ceff` | Accent text on dark |
| `--accent-text-bg` | `accent-text` at 16% | Accent wash |
| `--pill-bg` / `-hover` | `accent-text` at 16% / 24% | Soft accent pills in the composer and settings |
| `--tab-indicator` | `#c45c4a` | Shell tab underline, described as "Conductor-style" |
| `--incognito` | `#a200ff83` | Private windows. The `-fg`, `-muted` and `-send` variants (`#fae3ff`, `#f6e4ffa6`, `#e787ff`) style text and the send control in the same windows |

### Status

| Token | Value | Use |
| --- | --- | --- |
| `--success` | `#4ade80` | Success |
| `--warn` / `--warning` | `#f5a623` | Warning |
| `--danger` / `--error` | `#e5484d` | Errors and destructive actions |
| `--info` | `#6eb5ff` | Information |

### Git and diff

| Token | Value |
| --- | --- |
| `--added`, `--untracked` | `#73c991` |
| `--modified` | `#e2c08d` |
| `--removed` | `#e4676b` |
| `--git-conflict` | `#f97316` |
| `--diff-added-line-bg` / `-text-bg` | `rgba(115, 201, 145)` at 0.15 / 0.28 |
| `--diff-removed-line-bg` / `-text-bg` | `rgba(228, 103, 107)` at 0.15 / 0.28 |

### Rules for color

- Use tokens. Components should not contain hex literals.
- Outside `app/globals.css`, the source files hold 131 hex literals in 19 files. Count them with `grep -rl` and `grep -o` over `*.ts`, `*.tsx` and `*.css`, excluding `tests/`, `out/`, `src-tauri/`, `.agents/` and `.claude/`, using the pattern `#[0-9a-fA-F]{3,8}\b`. The largest groups are `features/editor/ui/codemirror/theme.ts` (30), `features/chat/ui/composer/thinking-bar.module.css` (14), `features/terminal/ui/terminal.tsx` (10), and the preview design tool under `features/preview/design/` (9 in `panel/color.tsx`, 7 in `bridge.ts`, 5 in `css.ts`). `app/globals.css` holds 57 more, all in token definitions. A new hex literal in a component needs a reason in the PR.
- There are 40 arbitrary `text-[...]`, `bg-[...]` or `border-[...]` classes. New ones need a reason.
- Accent marks action, selection and focus. It is not decoration. Status colors carry state.
- Disabled accent buttons use `accent/50` (50% opacity), per `components/ui/button.tsx`.

## 3. Typography

| Role | Family | Source |
| --- | --- | --- |
| UI text | `Inter Variable` (`--font-ui`) | `@fontsource-variable/inter`, imported in `app/layout.tsx`. `html` and `body` use it |
| Brand | `Geist Variable` (`--type-brand`) | `@fontsource-variable/geist`, exposed through the `font-brand` utility |
| Code and paths | `IBM Plex Mono` 400 and 500 (`--font-mono`) | `@fontsource/ibm-plex-mono`, imported in `app/globals.css`. The CodeMirror theme, terminal and `font-mono` use it |

Geist is a brand face, not body text. Use `font-brand` for a wordmark or a title that means the brand. Body copy stays on Inter.

### Weight

- `--type-weight-normal` is **500**, not 400. The base weight is 500 for the whole UI.
- `--type-weight-medium` is 600, `--type-weight-semibold` is 700.
- `--tracking` is `-0.001em`. `--leading` is `1.5`.
- `font-synthesis: none` and `font-smoothing: auto` are set on `html`. The comment says the rendering should be subpixel "like VS Code".

### Size

| Token | px | Use in code |
| --- | --- | --- |
| `--text-2xs` | 12 | Badges, the smallest labels (`text-2xs` utility, line-height 1.4) |
| `--text-xs` | 13 | Button `xs`, help text in settings |
| `--text-sm` | 14 | Button `sm` and `md`, settings labels |
| `--text-base` | 14 | Body, button `lg` (14px, not 16px) |
| `--text-md` | 15.5 | Medium emphasis |
| `--text-lg` | 16 | Larger titles |
| `--text-xl` / `--text-2xl` | 17 / 18 | Section and page titles |

- Chat body is 15px (`--chat-text`) with line-height `--leading`.
- Line-height tokens are 14, 16, 18 and 20px (`--line-height-xs` to `-lg`).
- Use `...` (three full stops), never the ellipsis character. Use sentence case for labels.

## 4. Shape and spacing

### Radius

`--radius-xs` 2px, `--radius-sm` 4px, `--radius-md` 6px, `--radius-lg` 8px, `--radius-xl` 12px, `--radius-2xl` 24px, `--radius-3xl` 32px, `--radius-4xl` 48px, `--radius-5xl` 64px, `--radius-full` 9999px.

Roles:

- Input: `--input-radius` = `--radius-md` (6px).
- Context and dropdown menus: `--menu-radius` = `--radius-xl` (12px). Menu rows use 6px.
- Window: `--window-radius` = `--radius-2xl` (24px).
- Floating workbench panels: `--workbench-panel-radius` = `--radius-3xl` (32px). Gap between them is `--workbench-gap` 8px.

### Squircle corners

Buttons use squircle corners through the `squircle-*` utilities in `globals.css`, which set `corner-shape: squircle`. Button sizes: `xs` and `sm` use `squircle-2xl`, `md` uses `squircle-2xl`, `lg` uses `squircle-3xl`, and `icon` uses `squircle-4xl`. `corner-shape` is a CSS property that the webview engine must support. Where it is not supported, the corner falls back to a circular radius. Check corners visually on each platform's webview before you rely on them.

### Spacing

Spacing tokens are `--space-xs` 4, `--space-sm` 8, `--space-md` 12, `--space-lg` 16, `--space-xl` 24. They are exposed as padding utilities such as `px-xs`, `py-sm` and `px-sm` (`globals.css`, lines ~557 onward), not as Tailwind's default spacing scale. The comment at `@theme` says why: mapping `--spacing-xs` and the others would hijack `max-w-*`. Use the utilities. Tailwind's numeric scale (`p-2`, `gap-3`) still works, but its values are rem based. With a 13px root, `p-2` is 6.5px, not 8px.

### Icons

| Token | Value |
| --- | --- |
| `--icon-size` | 19px, the default |
| `--icon-sm` / `--icon-md` / `--icon-lg` | 14px / 16px / 20px |
| `--icon-stroke` | 0.3px, non-scaling |

### Chrome

| Token | Value | Utility |
| --- | --- | --- |
| `--chrome-height` | 30px | `h-chrome` |
| `--titlebar-height` | 34px | `h-titlebar` |
| `--statusbar-height` | 33px | `h-statusbar` |

## 5. Layout

Constants are in the files named. Change them in one place.

- Window minimum: 1000 by 500px in `src-tauri/tauri.conf.json`, and the same constants in `features/agent/layout.tsx`. Default window: 1000 by 800px.
- Agent sidebar: 304px when open (`SIDEBAR_EXPANDED` in `features/agent/layout.tsx`).
- Workspace panel: 560px by default, 360px minimum (`MIN_WORKSPACE`), 280px soft minimum, 1200px maximum (`MAX_WORKSPACE_PX`), and at most 72% of the window (`MAX_WORKSPACE_RATIO`).
- Chat column: 380px minimum (`MIN_CHAT`).
- Split panes use the `allotment` sash with `--sash-size` 4px and no visible separator (`--separator-border: transparent`).

Shell structure:

- The titlebar (`features/agent/workbench/titlebar/ui/titlebar.tsx`) carries `data-tauri-drag-region`. Interactive children must not be drag regions.
- Window controls (`features/agent/workbench/titlebar/ui/window-controls.tsx`) branch on `usePlatform()`. macOS gets traffic lights, close, minimize and zoom, with glyphs shown on group hover. Other platforms get a separate control set.
- The status bar (`features/agent/workbench/status/ui/status.tsx`) is 33px tall, `text-muted`, `text-xs`, `font-light`.
- Other windows are separate routes: `app/settings` and `app/popout`. Settings uses `bg-background`, and the main shell uses `bg-titlebar` with `bg-editor` for `<main>`.

## 6. Motion

Read `engineering/motion-design.md` before changing motion. Timing is in `app/transitions.css` and the `--transition-*` and `--ease-*` tokens in `app/globals.css`. Use those tokens rather than inventing a duration per component.

| Token | Value | Use |
| --- | --- | --- |
| `--transition-fast` | 90ms | Small state and color feedback; chevrons and indicators |
| `--transition-base` | 140ms | Compact content changes, press release, and fades |
| `--transition-spatial` | 180ms | Larger pane or sidebar movement where location helps orientation |
| `--ease-out` / `--ease-spring` | `cubic-bezier(0.16, 1, 0.3, 1)` | Decelerating motion; `--ease-spring` is retained as a legacy alias, not a bounce |
| `--ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` | Short exits |
| `--swap-dur` / `--swap-ease` | 380ms / `cubic-bezier(0.22, 1, 0.36, 1)` | How long a replaced value keeps its slot |
| `--reveal-dur` / `--reveal-ease` | 200ms / `--ease-out` | A section or disclosure body growing to its height |
| `--ease-overshoot` | `linear(0, 0.28 18%, 0.87 42%, 1.06 62%, 1.01 78%, 1)`, `@supports` only | Popover entrance overshoot |

Motion rules:

- Keep high-frequency and keyboard-driven actions immediate: command surfaces, menu selection, tab/content switching, direct manipulation, and repeated controls should not wait for an entrance animation. The tab indicator may move briefly; tab content does not animate in. Menus can use a jump cut.
- Use motion only when it clarifies state, gives a small acknowledgement, or preserves spatial orientation. Prefer transform and opacity; do not add continuous decorative motion to a dense work surface.
- Use `--transition-spatial` for pane geometry, `--transition-base` for compact changes, and `--transition-fast` for small feedback. Direct manipulation bypasses transitions while dragging. Let CSS transitions retarget naturally when the state changes again; cancel WAAPI work before starting a replacement.
- A closing disclosure must become `aria-hidden` and `inert` immediately, even if its visual exit remains mounted briefly.
- Dropdown: open 140ms, close 90ms. Pre-scale 0.97, closing scale 0.99. Ease `cubic-bezier(0.22, 1, 0.36, 1)`.
- Morph (the expanding menu): open 320ms, close 240ms. Fade 180ms with a 40ms delay. Closed size 40px square, open size 260 by 180px, radius 16px.
- Press: `.press-spring` scales to `--press-scale` 0.985. Press-in 80ms with `cubic-bezier(0.3, 0, 0.2, 1)`. Press-out 220ms with `cubic-bezier(0.22, 1, 0.36, 1)`. Hover brightens to 1.05, pressed darkens to 0.94.
- Loading: the `ButtonSpinner` in `components/ui/button.tsx` uses three iMessage-style dots (`imsg-typing`). `LoadingGlyph` uses `Arc` from `loading-dev`.
- Panel rail: a panel toggle icon previews the state it switches to. Its rail sits at `--panel-rail-open` 0, at `--panel-rail-closed` 1 when the panel is closed, and at `--panel-rail-peek` 0.5 while the toggle is hovered or focused. `--panel-rail-dur` is 140ms, matched to `--transition-base` so the icon commits with the panel it drives, on `--panel-rail-ease`. Only `transform` animates. `components/ui/panel-glyph.tsx` owns the geometry and `app/transitions.css` owns the rule.
  - **The preview yields to the commit.** A hover preview is a promise about a click that has not happened yet, and it is spent the moment one does. `usePanelCommit` in `features/agent/chrome.tsx` marks the button `data-panel-committed="true"` on the user's click, which the peek rule excludes, and clears it on pointer-out or blur so the preview is reversible. Without it, `:hover` kept the rail pinned at the midpoint and a pointer that stayed on the button never showed the state it had just switched to, measured at `--panel-rail-hide` 0.5 with the panel already closed.
  - The mark is set by the *click*, never by watching the state prop. Panels also move on their own, when a project loads and the workspace opens, when the layout restores a preference or zen mode takes the sidebar, and treating those as commits suppressed the preview for the whole session.
  - **A replacement finishes the travel.** Closing the sidebar swaps the toggle for the title-bar peek toggle, which has no previous value to transition from. It mounts with `data-panel-commit-mount="true"` and `t-panel-rail-commit` animates the rail from `--panel-rail-peek` to wherever the button now says it should be. The end keyframe is left implicit so one rule serves both panel sides and both states. A cold first paint passes nothing, because nothing was committed and nothing should play.
- State fills: every row and icon button in the sidebar sits on one ladder declared in `app/globals.css`: `--row-hover` 4%, `--row-selected` 8%, `--row-selected-hover` 10%. Hover is exactly half of the committed fill, so pointing at a row fills it halfway toward the state the click is going to put it in; `--row-selected-hover` exists because a selected row still has to answer the pointer, and a selected row that stops responding reads as disabled. Tinted rows run the same ladder as a percentage of their own colour (`--chat-tint` at 22 / 26 / 30 / 34, where the 4% step is the midpoint of 22 → 30). The fill transitions on `--transition-fast`. The rules this replaces had hover and selected on the *same* tone, one control that hovered with no fill at all, and a coloured row that hovered brighter (34%) than the state the click commits (30%). `scripts/qa/probe-sidebar-ladder.cjs` measures the ladder live.
- Value swap: when a label or number is replaced in place, it crosses to the new value over `--swap-dur` on `--swap-ease`, ghosting out and copying in. `components/ui/swap.tsx` owns the timing and shortens the token per surface (90ms for the status bar, 140ms for a copy label). A first render never animates; only a change does.
- Confirmation: "that worked" is drawn, not faded. `DrawnCheck` in `components/ui/checkmark.tsx` renders the stroked path that `t-success-check` rotates, bobs and draws in. A filled Fluent glyph cannot show this, because the draw animates `stroke-dashoffset`. The dense-list case uses `data-motion="compact"` to run the same beat in about 240ms.
- Container reveal: `components/ui/collapse.tsx` animates `grid-template-rows: 0fr → 1fr` over `--reveal-dur`, which reaches the content's own height without measuring it. Its closed branch is `inert`, so a collapsed section's controls leave the tab order.
- Terminal activity: `.t-tab-dot` marks a terminal tab that produced output while the user was looking elsewhere. One dot, one meaning, no pulse, because the strip is on screen for the whole session and constant motion there is noise. It shares the close glyph's reserved slot and hands it over on hover or keyboard focus.
- Spring: only the popover entrance overshoots, through `--ease-overshoot` behind `@supports (animation-timing-function: linear(0, 1))`. `cubic-bezier` is clamped to its endpoints, so `linear()` is the only curve that can pass 1. It is not applied to the press release: returning from `--press-scale` 0.985 means a 12% overshoot moves the control 0.2% of its size, which is invisible.

Reduced motion: the default is to follow the OS. `Settings → Application → Motion` can override it with “Reduce motion”; the preference is stored as `appearance.motionPreference` and applied before hydration to `data-motion-preference`. JavaScript, WAAPI and timed sequences must use `prefersReducedMotion` from `lib/ui/motion.ts` and jump directly to their final state. `app/globals.css` carries the blanket reset (every animation to `0.01ms` for a single iteration, every transition to `0.01ms`), and `app/transitions.css` carries the exception layer on top of it. Decorative waits stop; informational motion (`.animate-spin`, `.imsg-typing span`) slows to 2.4s and **keeps iterating**, since a frozen spinner is indistinguishable from a hung app, and `animation-iteration-count: infinite !important` has to be re-asserted because the blanket reset sets it to `1`, which would otherwise turn a slowed spinner into one slow turn and then a still image. A new animation needs a decision in that block, and a guard on a class that no element carries is worse than no guard because it reads as coverage. `tests/ui/reduced-motion.test.ts` holds the source contract; `scripts/qa/probe-reduced-motion.cjs` holds the computed result in a real engine.

## 7. Components

The shared set lives in `components/ui/`. Extend these before you write a new primitive.

| Component | File | Notes |
| --- | --- | --- |
| Button | `button.tsx` | The only button. See the table below |
| Icon | `icon.tsx` | Wraps a Fluent glyph. Size follows `--icon-size` |
| Panel glyph | `panel-glyph.tsx` | A panel toggle icon whose rail reports panel state, with the hover and focus preview from `data-panel-toggle`. Not a Fluent glyph: it composes Fluent's silhouette with a mask |
| Input, Textarea | `input.tsx`, `textarea.tsx` | Input is `h-chrome` (30px), `squircle-2xl`, `border-input-border`, `bg-input-bg`, `px-sm`, `text-sm`. Textarea uses `border-border-secondary` |
| Switch | `switch.tsx` | Radix switch. A `loading` state shows a spinning sync icon |
| Slider | `slider.tsx` | Radix slider |
| Tabs | `tabs.tsx` | Radix tabs |
| Dropdown, context | `dropdown.tsx`, `context.tsx` | Radix dropdown, menubar and context menus. Panels are `bg-sidebar` (dropdown, menubar) and `bg-surface-4` (context). The `--menu-*` tokens style the composer mention popover |
| Tooltip | `tooltip.tsx` | Radix tooltip, `--z-tooltip` 1200 |
| Dialog and alert | `alert-dialog.tsx` | Radix alert dialog |
| Notification | `notification.tsx` | Custom toast stack. `--z-notification` 1300 |
| Search, quick pick | `search.tsx`, `quick-pick.tsx` | Command surfaces |
| Scroll | `scroll.tsx` | Radix scroll area. Scrollbar `--scrollbar` |
| Collapse | `collapse.tsx` | The container reveal. `0fr → 1fr` on `--reveal-dur`, closed branch `inert` |
| Swap | `swap.tsx` | Cross-fades a value that was replaced in place, never a first render |
| Copy | `copy-button.tsx` + `lib/ui/use-copy.ts` | The copy affordance. Awaits the write before it confirms, draws its check, and offers manual copy instead of a retry when the clipboard is denied |
| Breadcrumb, checkmark | `breadcrumb.tsx`, `checkmark.tsx` | Small controls |
| Loading, shimmer text | `loading.tsx`, `shimmer-text.tsx` | Progress and pending states. `LoadingBar` waits out `useDelayedFlag` (200ms) so sub-200ms work shows nothing, then holds for 400ms |
| Skeletons | `features/git/ui/shared/skeletons.tsx` | Placeholders read their row geometry from `row-shell.ts`, which the live rows import too |

Radix packages in `package.json` cover dialog, alert dialog, context menu, dropdown, menubar, scroll area, slider, switch, tabs and tooltip. Use them through the wrappers above.

### Button

Variants (`ButtonVariant`): `default`, `confirm`, `secondary`, `ghost`, `outline`, `destructive`, `danger`, `link`.

- `default` and `confirm`: accent fill, accent hover, `accent/50` when disabled.
- `secondary`: `surface-3` fill, secondary text, `surface-4` on hover.
- `ghost`: transparent, secondary text, panel hover.
- `outline`: `input-border` outline, transparent fill.
- `destructive` and `danger`: `--error` fill, white text, `error/90` on hover.
- `link`: no padding, accent text, underline on hover.

Category `tertiary` turns `default`, `confirm`, `secondary`, `destructive` and `danger` into transparent buttons with colored text, for toolbars.

Sizes (`ButtonSize`):

| Size | Height | Padding x | Text | Radius |
| --- | --- | --- | --- | --- |
| `xs` | 28px | 10px | 13px (`text-xs`) | `squircle-2xl` |
| `sm` | 30px | 12px | 14px | `squircle-2xl` |
| `md` (default) | 36px | 14px | 14px | `squircle-2xl` |
| `lg` | 40px | 16px | 14px (`text-base`) | `squircle-3xl` |
| `icon` | 28px square | 0 | | `squircle-4xl` |

Dense session-toolbar, session-row hover actions, Git change rows, commit-generation controls, the Legal links in Data Control settings, and the Stage and Restore actions that float over an All changes diff use `--target-size-min` (24 CSS pixels) as a minimum width and height. The floating actions need it because the diff text under them takes keyboard focus, which makes it a pointer target of its own. Their rem-based preferred size may grow with text scaling but must not shrink the pointer target below that floor. Glyph size stays unchanged.

Statuses: `idle`, `loading`, `waiting`, `error`. `selected` uses `panel-active` fill. Icon-only buttons need `aria-label`. Toggles need `aria-pressed`.

Menu group labels (`DropdownMenuLabel`, `MenubarLabel`) and shortcut hints (`DropdownMenuShortcut`, `MenubarShortcut`) use `text-secondary`. `text-muted` on the `#2d2d2d` menu surface measures 4.36:1, below the 4.5:1 that 13px text needs.

A single choice in a menu is a radio group: picking a radio item closes the menu, as a native select does, and the chosen item shows a checkmark. A checkbox item toggles one option among several and leaves the menu open for the next toggle. `SettingSelect` lists its choices as one radio group and any commands after a separator, as menu items: the font select's "Upload font..." is an action, not a choice that could be checked.

Keyboard focus on any `button` or `[role="button"]` draws a 2px `--accent-text` ring inside the control's edge, from a base-layer rule in `app/globals.css`. Inside the edge, a parent that clips overflow cannot cut it off. A pointer press does not match `:focus-visible`, so a click draws nothing. `--focus`, and through it `--border-focus` and `--color-border-focus-ring`, names `--accent-text` too, so the older `ring-border-focus` rings and text field focus borders draw the same colour; `--accent` measures 2.29:1 to 2.95:1 on the surfaces, below the 3:1 a focus indicator needs. No control draws its focus in `--accent`. A control filled with `--accent` or `--danger` draws the ring in its label colour instead (`focus-visible:outline-current`), because `--accent-text` measures 2.9:1 on `--accent` and 1.9:1 on `--danger`, and a ring at a control's edge needs 3:1 against both neighbours. The white label measures 6.0:1 and 3.9:1 on those fills and 17:1 against the page. The shared `Button` does this for its `default`, `confirm`, `destructive` and `danger` faces, except in the tertiary category, which drops the fill; the composer's send button and the collection dialog's Create button do it too. A checked switch and a ticked checkmark turn their own 1px ring white, because white measures higher than `--accent-text` on their blue fill. The shared `Button` sets no other focus style. A control that styles its own focus with utilities keeps that style, which is why the older `focus-visible:ring-*` rings paired with `outline-none` still draw, in `--accent-text`; a new control should take the shared ring instead. Text fields show their caret. Tabs are not buttons, so `workbenchTabItemClass` gives every tab strip the same 2px `--accent-text` ring. A target smaller than 24px, such as the lightbox's 8px pager dot, is drawn inside a 24px button, which meets WCAG 2.5.8 and puts the ring on the backdrop around the dot.

`text-base` sets the 16px size only. No theme colour is named `base`, because Tailwind would make `text-base` set that colour too, and it overrode the label colour of every large button.

A dialog that opens from a shortcut, a menu item or an event has no `Dialog.Trigger`, and Radix returns focus to the trigger, so on close focus fell to the page body. Pass `useDialogFocusReturn()` from `lib/ui/use-dialog-focus-return.ts` as the content's `onCloseAutoFocus`. It focuses the most recent element still on the page: the control that opened the dialog, the menu button when a menu item opened it, or wherever the dialog's action sent focus. The command palette, the quick pick, the New file prompt, the attachment preview and the shortcuts sheet use it.

A closable workbench or terminal tab is the only interactive element inside `role="tab"`, and each strip of tabs is a `role="tablist"` with a name: "Workspace", "Chats", "Terminals". A strip is one stop in the Tab order: the selected tab, or the first tab when none is selected; the arrow keys reach the others. Enter opens the focused tab, Delete or Cmd+Backspace closes it (macOS laptop keyboards have no Delete key), a click on the close glyph closes it, and the workbench context menu offers Close. Closing the open tab opens the tab focus moves to. Closing the open terminal from its strip leaves focus on the strip rather than in the terminal that opens, and a terminal tab scrolls into view when it is selected. The sortable strips drop dnd-kit's `aria-roledescription`, so a screen reader says "tab" and not "sortable"; the strips share `useSortableTab`. A held Delete closes one tab, not every tab that takes focus after it. With no modifier held, Left and Right Arrow move focus along the strip, wrapping at the ends, and Home and End jump to the first and last tab. Moving focus does not open a tab. In the workbench strips every other key goes to drag-and-drop reordering, which picks a tab up with Space and then takes the arrows until the tab is dropped. The terminal strip has no reordering, so Space opens a terminal tab as Enter does. When the focused tab closes, focus moves to the tab after it, or to the one before it when it was last, as the WAI-ARIA tabs pattern describes. When it was the last tab of a split terminal pane, focus moves to the other pane's selected tab, and the two strips are named "Left terminals" and "Right terminals". The glyph is an `aria-hidden` span the tab acts on, because a focusable button nested in a tab is an invalid nested interactive control.

Chat text takes its direction from its own content. The outermost block of a reply (a paragraph, heading, list, blockquote or table), user messages, and the composer textarea with its highlight mirror carry `dir="auto"`. Blocks inside a list, blockquote or table inherit the container's direction rather than carrying their own, because HTML leaves text under a `dir` attribute out of an ancestor's automatic direction. Spacing uses logical utilities (`ms-*`, `ps-*`, `border-s-*`, `text-start`), so right-to-left replies indent, align, and draw quote bars on the correct side. Code blocks, inline code, file chips and display math carry `dir="ltr"`, and so do the code spans, file paths, mentions and workflow chips of a sent message: code reads left to right in any reply, and it never decides the direction of the prose around it. Table header cells set `text-start` themselves, because the user agent stylesheet centres a header cell whose row inherits the initial alignment.

The commit graph scroller takes focus for the graph's keyboard shortcuts and is a group named "Commit graph" around the commit list. It is not a listbox: a listbox must own options, and a focusable widget role would also make it a pointer target under every row's own buttons. The shortcuts move the selection and not focus, so a status line reads the selected commit's subject, short hash and author for a screen reader.

The terminal sends Tab to the shell. Ctrl+M, the "Toggle Tab Key Moves Focus" keybinding as in VS Code, switches Tab to moving focus for every terminal in the window, and the strip shows "Tab moves focus" while it is on. Ctrl+J hides the dock from inside the terminal and gives focus back to where it came from, else to the title bar's terminal toggle. The terminal input's description says both, because WCAG 2.1.2 accepts a way out other than Tab only when the user is told it.

Icons never load from another host. Framework, editor and site marks and plugin logos come from the bundled `thesvg` package as `data:` images; the plugin catalog page also shows the logo the catalog lists. A site icon draws only when the page published it in the in-app browser, and every other link shows a globe. Commit authors' GitHub pictures wait for the Graph Branch Avatars setting, which is off by default.

Command palette rows are buttons. Enter runs the focused row on key down and Space on key up, from the same row only, as the WAI-ARIA button example does, so moving focus before releasing Space abandons the press. A focused row takes the selection highlight (`--row-selected`) that arrow keys and hover move, so the highlight and the focus ring mark the same row. The delete glyph is an `aria-hidden` span the row acts on when it is clicked. Deleting has no key, because it cannot be undone; it stays in the row's context menu.

A chat table wider than its box scrolls inside a focusable group named "Scrollable table". A table that fits adds no keyboard stop and no name; `useHorizontalOverflow` decides, as it does for `FadeTruncate`. A focused table that comes to fit keeps its stop until focus leaves it, so focus never drops to the page. Its focus ring is an inset `--accent-text` outline, because the rounded frame clips anything drawn outside it.

Editor text surfaces (`.cm-content`) are named after the file they edit through `editorContentLabel`: `README.md editor`, `App.tsx diff`, and in a split diff `App.tsx original` and `App.tsx modified`. A read-only surface draws no caret, so the editor shows a 2px inset `--accent-text` outline while its content has keyboard focus.

## 8. Icons

- The icon set is Fluent System Icons, through `@fluentui/react-icons` headless SVG imports such as `@fluentui/react-icons/headless/svg/search`. The app imports 174 distinct glyph names (141 Regular, 33 Filled), counted with `grep -ohE` over `*.ts` and `*.tsx` outside `tests/`.
- Glyphs are chosen by name. Regular is the default: 132 files import Regular glyphs and 40 import Filled, counted by import name. Filled appears where a state needs weight, for example `CheckmarkCircle20Filled` and `DismissCircle20Filled` in `features/testing/ui/test-panel.tsx`, and `Delete20Filled` in `features/terminal/ui/terminal.tsx`.
- `components/ui/icon.tsx` imports `headless/styles.css` and renders with `bettershape-icon`. That class applies `currentColor` fill and stroke, `--icon-stroke` 0.3px, round joins and caps, and `vector-effect: non-scaling-stroke`.
- Do not add a second icon library. `@iconify-json/vscode-icons` and `@iconify/utils` are in `package.json` for file-type icons. They are not a general icon set.
- Do not use emoji as icons.

## 9. Editor and code

- The code editor is CodeMirror 6 (`features/editor/ui/codemirror/`). Its theme is in `theme.ts`, with the palette hard-coded there, as noted in section 2.
- Syntax highlighting uses `react-syntax-highlighter` through `lib/ui/syntax-theme.ts`, with `var(--font-mono)`.
- The terminal is xterm (`@xterm/xterm`, with the fit and WebGL addons) in `features/terminal/`.
- Chat markdown uses `--font-ui` through the `.chat-markdown` class in `globals.css`.
- Monaco is not a dependency. Do not add it without a decision recorded in `.dump`.

## 10. The agent's design prompt

`src-tauri/src/agent/prompts/DESIGN.md` (15,181 bytes) is compiled in with `include_str!`. `send_chat.rs` attaches it to the system prompt when the mode is `visual` or the legacy `design`. It tells the agent building a user's project to:

- read the project's CSS variables and reuse them;
- avoid "AI-looking" defaults: purple or indigo accents, glow, glass, gradient text, bento grids, and Inter or Geist as an automatic brand font;
- keep motion short and purposeful.

Two things to know:

1. It is product behavior. Changing it changes what the agent produces for every user, so it is not edited as part of a UI change. Edit it in a PR that names the behavior change.
2. Its rule against indigo and purple accents applies to the user's projects. BetterShape's own `#3946FF` is a documented brand accent, so the two documents do not conflict. The prompt itself allows "unless intentional brand".

## 11. Drift and open items

These are facts a reviewer should know. They are not fixed by this file.

- The "light theme overrides" comment in `globals.css` is stale, and there is no light theme.
- The `csp` in `tauri.conf.json` allows `script-src 'unsafe-inline'`. That is a security item, not a design one. It is recorded in `FULL-REVIEW.md`.
- Hex literals sit in component files outside the palettes listed in section 2. Each new one should move to a token.
- Button `lg` is 14px, the same as `md`, because `--text-base` is 14px. A future change to 16px is a design decision, and it belongs in this file first.

## 12. Changing this system

- Tokens are defined once, in the `:root` block of `app/globals.css`, and mapped once, in `@theme inline`. Adding a token means editing both.
- Change this file and `engineering/design-system-baseline.md` in the same PR as the token or component change. Record the reason in the PR body.
- Prototype a visual change before you commit to it. The `prototype` skill is for showing the human several options.
- UI work follows `engineering/design-skills.md`. The skill set is the mandate.
