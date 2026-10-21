# Design system baseline

This is the BetterShape baseline that UI review checks against. The values live in `DESIGN.md` and the token files it names. This file holds the rules.

## Baseline rules

1. Tokens only. No hard-coded colors, radii, durations, or font sizes in components.
2. One button, one icon component, one set of settings controls. Extend them rather than forking.
3. Dark only. Do not add light-mode branches.
4. Every interactive element has a visible focus state from `--focus`.
5. Icon-only controls have `aria-label`. Toggles have `aria-pressed`.
6. Copy is sentence case and uses `...` rather than the ellipsis character.
7. Motion follows `engineering/motion-design.md`, uses shared fast/base/spatial tokens, stays immediate for frequent and keyboard-driven actions, and respects both the OS and app reduced-motion preference. One-shot JavaScript motion uses `lib/ui/motion.ts`; components with timers or repeated changes use the live `useReducedMotion` hook from `lib/ui/use-reduced-motion.ts`.
8. Status colors carry state. Do not use them for decoration.

## Where to check

| Concern | File |
| --- | --- |
| Tokens | `app/globals.css` |
| Motion | `app/transitions.css` |
| Button | `components/ui/button.tsx` |
| Icon | `components/ui/icon.tsx` |
| Dropdown | `components/ui/dropdown.tsx` |
| Settings controls | `features/settings/ui/shared/controls.tsx` |
| Panel header | `features/panels/ui/sidebar-panel-header.tsx` |

## Changing the baseline

Change `DESIGN.md` and this file in the same PR as the token or component change. Record the reason in the PR body.
