# DESIGN.md

BetterShape's visual contract. Values are copied from `app/globals.css`, `app/transitions.css` and `components/ui/button.tsx` on this branch. If this file and the code disagree, the code wins and this file gets fixed in the same change.

## Direction

- Dark only. There is no light theme, and `color-scheme` is not toggled.
- A quiet, dense desktop tool. Chrome is a neutral ladder of near-black surfaces. Color is reserved for the accent, status, and the agent's own output.
- One accent: `#3946FF` (`--accent`), with hover `#4365FF`. Text on accent uses `--accent-fg`. Accent text on dark uses `--accent-text` `#9eb0ff`.
- Status colors: `--success` `#4ade80`, `--warn` `#f5a623`, `--danger` `#e5484d`. Use them for state, not decoration.

## Color

| Token | Value | Use |
| --- | --- | --- |
| `--surface-0`, `--surface-1` | `#181818` | App background, panels |
| `--surface-2` | `#1b1b1b` | Raised panel regions |
| `--surface-3` | `#202020` | Controls, inputs |
| `--surface-4` | `#252525` | Hover and active rows |
| `--text-primary` | `#f2f2f2` | Body and headings |
| `--text-secondary` | `#a3a3a3` | Labels, metadata |
| `--text-muted` | `#ffffff79` | Hints |
| `--text-disabled` | `#ffffff2f` | Disabled controls |
| `--border` | `rgba(255,255,255,0.116)` | Dividers and control outlines |
| `--border-subtle` | `rgba(255,255,255,0.062)` | Row separators |
| `--focus` | see `globals.css` | Focus ring, also `--border-focus` |

Never hard-code a hex value in a component. Use a token. Text on a tinted wash must still meet contrast on the wash, not only on the surface.

## Type

- UI font: `Inter Variable`, falling back to system UI fonts (`--font-ui`).
- Mono: `IBM Plex Mono` (`--font-mono`), for code, paths, and token counts.
- Size scale: `--text-2xs` 12px, `--text-xs` 13px, `--text-sm` 14px, `--text-base` 14px, `--text-md` 15.5px, `--text-lg` 16px, `--text-xl` 17px, `--text-2xl` 18px.
- Line heights: 14, 16, 18, 20px (`--line-height-xs` to `-lg`).
- Use `...` for ellipsis, and sentence case for labels.

## Shape

- Radius scale: `--radius-xs` 2px, `--radius-sm` 4px, `--radius-md` 6px, `--radius-lg` 8px, `--radius-xl` 12px, then 24, 32, 48, 64px, and `--radius-full`.
- Buttons use squircle corners through `squircle-*` utilities: `squircle-2xl` on sm and md, `squircle-3xl` on lg, `squircle-4xl` on icon buttons.
- Icon size is `--icon-size` 19px. Use `components/ui/icon.tsx`, not ad hoc SVGs.

## Chrome and layout

- Window chrome `--chrome-height` 30px. Titlebar `--titlebar-height` 34px. Status bar `--statusbar-height` 33px.
- Sidebar and panel headers follow `features/panels/ui/sidebar-panel-header.tsx`. Do not restyle them per feature.

## Controls

`components/ui/button.tsx` is the only button. It has:

- Variants: `default`, `confirm`, `secondary`, `ghost`, `outline`, `destructive`, `danger`, `link`.
- Categories: `primary`, `tertiary`.
- Sizes: `xs`, `sm` (h-7.5, 12px padding), `md` (h-9, default), `lg` (h-10), `icon` (size-7).
- Statuses: `idle`, `loading`, `waiting`, `error`.

Icon-only buttons need `aria-label`. Toggles need `aria-pressed`. Settings rows use the shared controls in `features/settings/ui/shared/controls.tsx`.

## Motion

Timing lives in `app/transitions.css` and the `--transition-*` and `--ease-*` tokens in `app/globals.css`. Do not write timings inline.

- `--transition-fast` 90ms, `--transition-base` 140ms.
- Easing: `--ease-out` and `--ease-spring` are `cubic-bezier(0.16, 1, 0.3, 1)`. `--ease-in` is `cubic-bezier(0.7, 0, 0.84, 0)`.
- Dropdown: open 140ms, close 90ms. Morph: open 320ms, close 240ms.
- Respect `prefers-reduced-motion`.

## Icons

- Icons come from the existing icon set in `components/ui/icon.tsx`.

## Process

- UI work follows `engineering/design-skills.md`. The skill set in `.agents/skills/` is the mandate.
- `engineering/design-system-baseline.md` records the rules that the skills check against.
