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
9. A control may preview its next state on hover or focus, and then only partway: the midpoint, never the finished state. Full state changes belong to the click. See the panel rail in `app/transitions.css`.
   - The same ladder covers rows and icon buttons, not only a rail: `--row-hover` is exactly half of `--row-selected`, and a control that is already committed still steps up (`--row-selected-hover`) instead of going inert. Hover and selected must never share one tone. That is the defect Microsoft filed against its own combobox, and it leaves the surface with nothing to anticipate along.
   - The preview must yield when the click lands. A pointer that stays on the control has to see the state it just switched to, not the preview it was promised; release the mark on pointer-out so hovering again previews again.
10. Confirmation is earned, not assumed. A success state appears only once the operation has actually succeeded; a failed clipboard, a rejected write or a cancelled spawn reports its own failure and names the next safe action instead of offering a retry that would fail the same way.
11. A placeholder matches what replaces it. A skeleton reads its geometry from the same constant as the live row, and a pending view that is a different height than the loaded one is a defect even though nothing crashes.
12. Repeated action gets less motion, not more. Timing scales with how often a control is used: the dense-list check runs `data-motion="compact"`, the panel rail commits in 140ms, and a surface the user clicks dozens of times gets a transition rather than a performance.

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
| Panel glyph | `components/ui/panel-glyph.tsx` |
| Swap and collapse | `components/ui/swap.tsx`, `components/ui/collapse.tsx` |
| Copy affordance | `components/ui/copy-button.tsx`, `lib/ui/use-copy.ts` |
| Delayed indicators | `lib/ui/use-delayed-flag.ts` |
| Row geometry | `features/git/ui/shared/row-shell.ts` |

## Changing the baseline

Change `DESIGN.md` and this file in the same PR as the token or component change. Record the reason in the PR body.
