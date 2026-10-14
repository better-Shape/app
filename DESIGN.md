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
| `--sidebar` | `#2D2D2D` | Agent sidebar |
| `--editor` | `#191919` | Editor and canvas. Context and dropdown menus use it (`--menu-bg`) |
| `--panel` | `#1B1B1B` | Panels |
| `--surface-0`, `--surface-1` | `#181818` | Base |
| `--surface-2` | `#1b1b1b` | Inputs (`--input-bg`) |
| `--surface-3` | `#202020` | Secondary buttons, disabled controls, muted pills |
| `--surface-4` | `#252525` | Hover on surface-3 |
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
| `--accent` | `#3946FF` | Primary buttons, focus ring (`--focus` aliases it) |
| `--accent-hover` | `#4365FF` | Hover on primary |
| `--action-label` | `#ffffff` | Text on accent (`--accent-fg`) |
| `--accent-text` / `-hover` | `#9eb0ff` / `#c4ceff` | Accent text on dark |
| `--accent-text-bg` | `accent-text` at 16% | Accent wash |
| `--pill-bg` / `-hover` | `accent-text` at 16% / 24% | Soft accent pills in the composer and settings |
| `--tab-indicator` | `#c45c4a` | Shell tab underline, described as "Conductor-style" |
| `--incognito` | `#a200ff83` | Private window only. This is the one purple in the product, and it is scoped to private windows |

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
- The count today is 111 hex literals across 16 files. Most are intended palettes: `features/editor/ui/codemirror/theme.ts` (30), `features/terminal/ui/terminal.tsx` (10), and the preview design tool under `features/preview/design/` (9 in `panel/color.tsx`, 7 in `bridge.ts`, 5 in `css.ts`). New hex literals outside those palettes need a reason in the PR.
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

Spacing tokens are `--space-xs` 4, `--space-sm` 8, `--space-md` 12, `--space-lg` 16, `--space-xl` 24. They are exposed as padding utilities such as `px-xs`, `py-sm` and `px-sm` (`globals.css`, lines ~557 onward), not as Tailwind's default spacing scale. The comment at `@theme` says why: mapping `--spacing-xs` and the others would hijack `max-w-*`. Use the utilities. Tailwind's numeric scale (`p-2`, `gap-3`) still works because the root is 13px.

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

Timing is in `app/transitions.css` and the `--transition-*` and `--ease-*` tokens in `app/globals.css`. Do not write timings inline.

| Token | Value |
| --- | --- |
| `--transition-fast` | 90ms |
| `--transition-base` | 140ms |
| `--ease-out` / `--ease-spring` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `--ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` |

Specific systems:

- Dropdown: open 140ms, close 90ms. Pre-scale 0.97, closing scale 0.99. Ease `cubic-bezier(0.22, 1, 0.36, 1)`.
- Morph (the expanding menu): open 320ms, close 240ms. Fade 180ms with a 40ms delay. Closed size 40px square, open size 260 by 180px, radius 16px.
- Press: `.press-spring` scales to `--press-scale` 0.985. Press-in 80ms with `cubic-bezier(0.3, 0, 0.2, 1)`. Press-out 220ms with `cubic-bezier(0.22, 1, 0.36, 1)`. Hover brightens to 1.05, pressed darkens to 0.94.
- Loading: the `ButtonSpinner` in `components/ui/button.tsx` uses three iMessage-style dots (`imsg-typing`). `LoadingGlyph` uses `Arc` from `loading-dev`.

Reduced motion: `app/transitions.css` and `app/globals.css` contain `prefers-reduced-motion: reduce` blocks, and 8 files in `app`, `components`, `features` and `lib` reference it. A new animation needs the same guard.

## 7. Components

The shared set lives in `components/ui/`. Extend these before you write a new primitive.

| Component | File | Notes |
| --- | --- | --- |
| Button | `button.tsx` | The only button. See the table below |
| Icon | `icon.tsx` | Wraps a Fluent glyph. Size follows `--icon-size` |
| Input, Textarea | `input.tsx`, `textarea.tsx` | Input is `h-chrome` (30px), `squircle-2xl`, `border-input-border`, `bg-input-bg`, `px-sm`, `text-sm`. Textarea uses `border-border-secondary` |
| Switch | `switch.tsx` | Radix switch. A `loading` state shows a spinning sync icon |
| Slider | `slider.tsx` | Radix slider |
| Tabs | `tabs.tsx` | Radix tabs |
| Dropdown, context | `dropdown.tsx`, `context.tsx` | Radix dropdown and context menus. Tokens `--menu-*` |
| Morph menu | `morph-menu.tsx` | Expanding menu, `--morph-*` tokens |
| Tooltip | `tooltip.tsx` | Radix tooltip, `--z-tooltip` 1200 |
| Dialog and alert | `alert-dialog.tsx` | Radix alert dialog |
| Notification | `notification.tsx` | Custom toast stack. `--z-notification` 1300 |
| Search, combobox, quick pick | `search.tsx`, `combobox.tsx`, `quick-pick.tsx` | Command surfaces |
| Scroll | `scroll.tsx` | Radix scroll area. Scrollbar `--scrollbar` |
| Collapsible, disclosure | `collapsible.tsx`, `disclosure.tsx` | Expand and collapse |
| Breadcrumb, sorting, checkmark | `breadcrumb.tsx`, `sorting.tsx`, `checkmark.tsx` | Small controls |
| Loading, shimmer text | `loading.tsx`, `shimmer-text.tsx` | Progress and pending states |

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

Statuses: `idle`, `loading`, `waiting`, `error`. `selected` uses `panel-active` fill. Icon-only buttons need `aria-label`. Toggles need `aria-pressed`.

## 8. Icons

- The icon set is Fluent System Icons, through `@fluentui/react-icons` headless SVG imports such as `@fluentui/react-icons/headless/svg/search`. The app imports about 160 distinct glyphs.
- Glyphs are chosen by name. Regular is the default: 126 files import Regular glyphs and 36 import Filled. Filled appears where a state needs weight, for example `CheckmarkCircle20Filled` and `DismissCircle20Filled` in `features/testing/ui/test-panel.tsx`, and `Delete20Filled` in `features/terminal/ui/terminal.tsx`.
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
