# Motion research, 2026-10-15

Research pass behind the panel-rail toggle and the micro-interaction roadmap in
`../plans/micro-interaction-roadmap-2026-10-15.md`. Sources first, then what each one
changes for this repository. Everything here was read on 2026-10-15.

## Sources

| Source | What it is | What it settles here |
| --- | --- | --- |
| [You Don't Need Animations](https://emilkowal.ski/ui/you-dont-need-animations), Emil Kowalski | The frequency gate: animations repeat hundreds of times a day make an app feel slow | Nothing new may animate on the command palette or a keyboard shortcut path |
| [7 Practical Animation Tips](https://emilkowal.ski/ui/7-practical-animation-tips), Emil Kowalski | Origin-aware popovers, skipping the delay on subsequent tooltips, `data-instant` | The tooltip pattern already in `components/ui/tooltip.tsx` is the reference; new popovers use `var(--radix-*-content-transform-origin)` |
| [Animations at 60fps / performance notes](https://emilkowal.ski/), Vaul and Sonner source | CSS animations run off the main thread, rAF-driven ones drop frames under load; transitions retarget, keyframes restart | Predetermined motion in CSS, gesture motion in JS; transitions for anything fired twice in a second |
| [Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design), Rauno Freiberg | Spatial consistency, fluid morphing, frequency and novelty, Fitts's law, scroll landmarks | The icon that reports state should be the icon that moves; a control near a window edge is cheap to hit, so it can carry the affordance without a label |
| [Springs and Bounces in Native CSS](https://www.joshwcomeau.com/animation/linear-timing-function/), Josh W. Comeau | `linear()` easing, generated from spring parameters via the Linear Easing Generator | Springs stay out of this repository until a gesture needs one; `cubic-bezier` covers the UI budget |
| [Custom CSS easing with `linear()`](https://modern-css.com/custom-easing-without-cubic-bezier-guessing/) | `linear()` is Baseline since 2024 (Chrome 113, Firefox 119, Safari 17.2) | Available if a genuine overshoot is ever wanted, behind `@supports` |
| [What's new in view transitions (2025 update)](https://developer.chrome.com/blog/view-transitions-in-2025), Chrome for Developers | Same-document view transitions reached Baseline Newly available with Firefox 144; `view-transition-name: match-element`, `view-transition-class`, scoped transitions | Tab drag, list reorder and panel state are candidates, but nested groups and `view-transition-class` are Chromium-only, so any use must be progressive enhancement |
| [View Transitions: browser support](https://www.testmuai.com/learning-hub/view-transitions-api-browser-support/) | Chrome 111+, Safari 18+, Firefox 144+ same-document; cross-document is Chromium-only | Same-document only, feature-detected, never load-bearing |
| [Animated accordions with the `details` element](https://www.builder.io/blog/animated-css-accordions) | `::details-content`, `transition-behavior: allow-discrete` (Baseline August 2024) | Available for any native disclosure. This repository does not use `<details>` today |
| [`interpolate-size`](https://developer.mozilla.org/en-US/docs/Web/CSS/interpolate-size) and [accordion write-ups](https://oleksiimazurenko.dev/en/blog/smooth-details-accordion-pure-css) | `interpolate-size: allow-keywords` animates `height: auto`, Chromium-only as of 2026 | Progressive enhancement only. The `grid-template-rows: 0fr → 1fr` pattern already in `components/ui/collapsible.tsx` is the portable equivalent and stays |
| [react-icons / Fluent System Icons](https://github.com/microsoft/fluentui-system-icons) | Fluent's headless SVG modules expose `PanelLeft`/`PanelRight` at 16, 20 and 24, plus `Contract`/`Expand`/`FocusRight` variants | Confirms the glyph this repository imports is the 20px filled silhouette, and that Fluent ships no variant whose rail sits between open and closed |
| [Emil Kowalski skill pack](https://github.com/emilkowalski/skills) (`animate`, `review-animations`, `find-animation-opportunities`, `improve-animations`, `apple-design`) | Vendored in `.agents/skills/`, loaded per `engineering/design-skills.md` | The gate and the budgets used below |
| Vendored `animation-vocabulary` (`.agents/skills/animation-vocabulary/SKILL.md`) | The project glossary | Names used in the roadmap: *Press / Tap feedback*, *Origin-aware animation*, *Continuity transition*, *Interruptible animation*, *Anticipation*, *Stagger*, *Hold to confirm*, *Line drawing* |

## Findings that change decisions

1. **No library is needed.** Every candidate in the roadmap is CSS transitions, CSS
   animations, or WAAPI. `package.json` has no motion dependency, and this research
   finds no reason to add one. The one class that would justify it, gesture-driven
   motion with momentum, has a single candidate (tab drag on `@dnd-kit`) that
   `@dnd-kit` already covers.
2. **Springs are available but unwarranted today.** `linear()` would give
   overshoot in CSS. Every item on the roadmap is a state change on a control the
   user touches tens of times a day, where the skill pack's ceiling is "short and
   subtle": `cubic-bezier` is the right tool, and the repo's `--ease-out`
   (`cubic-bezier(0.16, 1, 0.3, 1)`) is already a strong curve.
3. **The repository already owns a motion vocabulary, and five of its entries are
   dead.** Grepping every file under `app/`, `components/`, `features/`, `lib/` and
   `core/` for the class names `app/transitions.css` defines, five have no consumer
   at all: `t-success-check`, `t-wave-bar`, `t-think`, `t-reason` and `t-stream-w`.
   `t-composer-hint` has one (`features/chat/ui/composer/input.tsx`), `t-spin-check`
   one (`features/chat/ui/composer/activity.tsx`), `t-swap` two
   (`input.tsx`, `thinking-bar.tsx`). Wiring a pattern that already exists into the
   component that needs it is cheaper and more consistent than writing a new one,
   and the roadmap prefers that where it can.
4. **State-reporting icons are the repo's blind spot.** `SidebarToggleBtn` and the
   workspace toggle in `features/agent/chrome.tsx` each drew the same Fluent glyph
   in both of their states; only the tooltip, `aria-pressed` and the icon's text
   color changed. Every other control in the chrome already reports state in
   something that moves or changes shape (the section chevrons, the switch, the
   tab indicator, the commit flash in the git graph). This is why the first
   implemented item is the panel rail rather than a decorative hover effect.
5. **View Transitions are a "later", not a "never".** Same-document transitions
   are Baseline, so tab reorder and list reorder could ride on them. Every target
   here is a Tauri webview whose Chromium and WebKit versions accept the API, but
   the features that make it cheap (`view-transition-class`, nested groups) are
   Chromium-only, so it is not adopted in this pass.

## Rejected approaches

- **Fluent's `PanelLeftContract` / `PanelLeftExpand` glyphs.** Checked in
  `@fluentui/react-icons@2.0.343`: their box is a 20×16 panel with the thin
  variant on the side the arrow points at, not the same silhouette as the icon in
  use (20×12 left, 20×13 right). Swapping the whole glyph on click would also make
  the state change a hard cut rather than a move.
- **`view-transition-name` for the panel state.** The width transition in
  `features/agent/layout.tsx` is already a 200ms CSS transition on a live element;
  a view transition would snapshot and cross-fade instead, which is a downgrade for
  a resize the user watches.
- **A JS-driven rail.** `--panel-rail-hide` is inherited by the SVG and consumed by
  one `transform`, so hover, focus and click all run on the compositor with no
  React re-render. A React state or motion library implementation would re-render
  the chrome on every hover.

---

# Domains added in wave 1 (2026-10-15, later pass)

## Perceived performance: what to show while work runs

Timing ladder, from `72technologies` (sources in the report):

| Window | What the user should see |
| --- | --- |
| < 100ms | Nothing. It is instant |
| 100–400ms | Still nothing. A loader that flashes is worse than the pause |
| 400ms–1s | Something, but no explanation |
| 1–10s | Skeleton or determinate progress |
| > 10s | Progress + status text + cancel |

A delayed flag alone is half the rule: pair it with a **minimum visible time**, or a
300ms operation ends with a 50ms flash of skeleton that reads as a glitch.

**The counterexample that must not be buried.** The best-known controlled comparison
(`theplusaddons`) found the *skeleton* group reported the **longest** perceived wait
(2.82s, against 2.41s for a spinner and 2.29s for a blank pane) and the lowest
agreement that the page "loaded quickly" (59%, against 74%). Skeleton screens are
justified by **layout stability**, the CLS budget, ≤ 0.1 at p75, not by speed. Any
note claiming a skeleton "feels 2× faster" is unsupported.

Applied: `useDelayedFlag` with a 200ms delay and a 400ms floor on the git loading bar;
`row-shell.ts` so a placeholder is the same height as the row it precedes.

## Error and recovery: design the next safe action

`oggy.studio` is the sharpest source here. Every failure resolves to one of five
outcomes, correct it, retry it, wait, take an alternative, or escalate, and **retry
must not be the default**. Where an external side effect may already have happened, a
retry duplicates work.

`nngroup` (errors and forms) plus `boomlify` (recovery walkthrough):

- Inline validation, next to the field, and confirm success for complex fields as well
  as failure.
- Do not validate before the user has finished typing; ~500ms of quiet before showing an
  error, and clear it within ~200ms of the input becoming valid.
- Colour is never the only signal.
- Prefer guidance to a red border, and avoid shake for vestibular safety.

Applied and audited: the chat error dialog (`features/chat/ui/blocks/error.tsx`) already
implements this taxonomy, retry only for a transient `rate limit` / `model busy` class,
"Add credits" for a billing failure, "OK" otherwise. That is correct as it stands and
should not be "simplified" to a uniform retry. The copy affordance is where the gap was:
a denied clipboard used to produce a green "Copied" toast, so it now reports the failure
and points at manual copy.

## Entry and exit without the rAF flip

`@starting-style` with `transition-behavior: allow-discrete` is Baseline Newly Available
(Chrome/Edge 117, Firefox 129, Safari 17.5) and is the idiomatic replacement for the
"mount, then flip a flag in rAF" entry animation. Two traps:

- A `transition: all` shorthand does **not** cover discrete properties, and
  `transition-behavior` has to be declared *after* the shorthand or it is reset by it.
- `overlay ... allow-discrete` is still not in Safari.

Not adopted this pass: the repo's entries are CSS animations on mount or state, which are
assertable in tests, and this sandbox has no browser to confirm the visual difference.
Recorded as the preferred shape for the next animation that needs to animate out.

## `linear()` easing

Baseline: Chrome 113, Firefox 119, Safari 17.2. `cubic-bezier` is clamped between its
endpoints, so it can never pass 1. **Only `linear()` can overshoot**, which makes it the
only way to express a real spring in CSS without an animation runtime. Guarded with
`@supports (animation-timing-function: linear(0, 1))`, with the ease-out as the fallback.
