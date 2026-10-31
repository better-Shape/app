# Motion design for BetterShape

This guide is binding for motion work. Read it with `DESIGN.md` and `engineering/design-system-baseline.md`. The user-provided video transcript is the design source for this pass. Its reusable rule is simple: motion must communicate a state, consequence, or spatial relationship. It must not decorate a frequent workflow or delay an action.

## Choose the motion before choosing the duration

Classify the interaction first.

| Class | Use it for | BetterShape examples | Default treatment |
| --- | --- | --- | --- |
| Immediate | Keyboard actions, menus, autocomplete, command surfaces, tab and content switching, drag and resize | Command palette, mention picker, quick pick, menu rows, active chat tabs | Jump cut. Keep focus and selection synchronous with the action. |
| Feedback | A small state change that benefits from acknowledgement | Toggle thumb, active tab indicator, progress value, disclosure chevron | `--transition-fast` or `--transition-base`. Use the smallest useful property change. |
| Spatial | Showing where a pane came from or which region changed | Agent sidebar, workspace pane, terminal dock, directional preview carousel | `--transition-spatial`, a short distance, and a direction tied to the control or anchor. |
| Progress | A real operation whose duration is unknown | Terminal and agent work indicators | Show honest activity. Avoid fake completion, repeated attention grabs, or motion that continues after work ends. |

Ask these questions in order.

1. Does motion tell the user something that a state change, label, focus ring, or status text cannot tell as clearly?
2. Is the action frequent, keyboard-driven, or under direct manipulation? If yes, keep the action itself immediate.
3. If the view moves, is its origin and direction clear from the control, anchor, or navigation direction?
4. Can a second action reverse or replace the first without waiting for an animation to finish?
5. Does the OS or app preference remove this motion, including JavaScript timers and WAAPI work?

If motion has no clear job, remove it.

## Shared timing and easing

Tokens live in `app/globals.css`. Component-specific values live in `app/transitions.css`. Do not add a new duration or easing curve for one component without a reason and a token update.

| Token | Value | Intended use |
| --- | --- | --- |
| `--transition-fast` | 90ms | Small control feedback, color changes, chevron rotation, tab indicator |
| `--transition-base` | 140ms | Compact disclosure, short fade, press release, small preview change |
| `--transition-spatial` | 180ms | Pane and sidebar geometry where position helps orientation |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | State changes that settle quickly and cleanly |
| `--ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` | Short exits |

`--ease-spring` is a legacy alias for `--ease-out`. It does not describe a spring and must not add bounce. Press feedback is 80ms in and 140ms out. The toggle thumb uses the base token with no overshoot. Popovers may use the dedicated 140ms open and 90ms close tokens. BetterShape menus and command surfaces are jump cuts.

Use the spatial token only when the view travels or changes a large region. Use the base token for a compact content reveal. Use the fast token for a small signal. Do not make every element move at once.

## Spatial language

- A left-side surface enters from the left. A right workspace surface enters from the right. A preview carousel follows its previous or next direction. Do not make a surface slide in from a direction unrelated to its trigger.
- Keep small offsets small. A few pixels of travel are enough for a flyout or preview. Do not scale a full pane from a tiny point or animate a large distance just to make it feel lively.
- Use opacity with transform for small spatial reveals. Use width, height, or grid tracks only when the user's mental model is that the region itself is opening or closing. Keep those changes short and allow the browser to retarget them.
- Preserve the layout while content changes where that prevents disorientation. Use FLIP only for meaningful reordering, not for every render.
- During resize or drag, update directly. Do not put a transition on the value being controlled by the pointer. A short settle after release is optional only if it clarifies the final snapped state.
- Tabs identify the selected location with the indicator. Do not animate the tab panel itself on each selection.

Current examples include `features/agent/sidebar/index.tsx`, `features/agent/layout.tsx`, `features/agent/terminal-dock.tsx`, `features/chat/ui/blocks/browse-frame.tsx`, the live reduced-motion handling in `features/chat/ui/composer/input.tsx`, the empty-chat positioning in `features/chat/ui/chat.tsx`, and `components/ui/tabs.tsx`.

## Input, frequency, and interruption

- Open command palettes, quick picks, context menus, dropdown menus, mention autocomplete, and other keyboard-operated menus without an entrance animation. Do not steal focus or wait for a transition before accepting input.
- Keep selection, focus, filtering, tab changes, and keyboard movement synchronous. A 90ms color or indicator response is feedback, not a reason to debounce the action.
- Keep streamed content current rather than adding a second queue or typewriter delay. BetterShape's live Markdown reveal is a presentation layer only and must show the latest text immediately when reduced motion is active.
- Direct manipulation is immediate while active. Disable the animated fill while dragging a slider; custom cursors such as the browse-frame pointer follow the input without a transition. On pointer cancellation, blur, or lost capture, restore or settle to the committed state.
- CSS transitions are preferred for simple state changes because a new target can retarget an active transition. For Web Animations API work, cancel the prior animation before starting a replacement and account for residual transforms before measuring layout.
- Never disable a control until its animation ends. An exit may remain mounted briefly, but it must stop receiving pointer and keyboard input at once.
- Every timed cleanup must be cancellable. Clear timers when a component unmounts or a state reverses. Do not use a fixed delay as a substitute for state. If reduced motion is active, skip the visual sequence and clean up immediately.
- Do not keep `will-change` on idle elements. Do not animate layout or paint properties when opacity or transform expresses the same result. Layout animation is acceptable only when the geometry itself carries meaning and the measured region is small.

## Reduced motion and accessibility

System preference is the default. The user can choose `Settings → Application → Motion → Reduce motion`. The setting is stored in `appearance.motionPreference`, applied before hydration to `data-motion-preference`, and can be returned to `Follow system` at any time.

- CSS must handle both `@media (prefers-reduced-motion: reduce)` and the app root attribute. The shared rules are in `app/globals.css` and `app/transitions.css`.
- One-shot JavaScript or WAAPI motion can query `prefersReducedMotion` from `lib/ui/motion.ts`. Components with timers or repeated state changes should use `useReducedMotion` from `lib/ui/use-reduced-motion.ts`; it subscribes to both OS media-query changes and BetterShape's live app preference. Do not read the preference once and cache it for the process lifetime.
- For nonessential motion, prefer a jump cut or a static final state. Do not replace a removed animation with a delayed timer, and do not leave a splash, loading flourish, or exit animation blocking the product.
- Keep information and state visible when motion is reduced. A progress indicator may remain static if its changing value is truthful. A status change must remain available in text or accessibility semantics.
- A collapsed region must become `aria-hidden` and `inert` as soon as it closes, even if it stays mounted for its visual exit. Triggers need `aria-expanded`; connect them with `aria-controls` when practical. Never rely on opacity or a zero-height grid to remove controls from keyboard navigation.
- Native controls are preferred. Custom interactive controls need a visible keyboard focus state. Do not use motion as the only signal for selection, validation, success, or error.

The app preference is applied early in `app/layout.tsx`. The shared JavaScript check is tested in `tests/lib/ui-motion.test.ts`. Settings persistence and root application are tested in `tests/lib/settings-merge.test.ts` and `tests/ui/settings.test.ts`.

## Implementation patterns

- Use the shared tokens in Tailwind classes or CSS modules. Put keyframes in a CSS module or a shared stylesheet, not in a style tag rendered inside a component.
- Keep state changes declarative. Use CSS transitions for a property that follows React state. Keep input-driven values out of transitions while the user is dragging.
- Use `transform` and `opacity` for small entries. Avoid blur, filters, large scaling, and long stagger chains unless they convey necessary hierarchy.
- Use layout transitions sparingly. For a disclosure, a grid-row transition is acceptable when the content is small and its height change is the point. Keep it short and make hidden descendants inert.
- Reuse a single motion token across related surfaces. Do not add one-off `duration-200`, `duration-500`, or inline millisecond strings when an existing token fits.
- Prefer static placeholders over ambient shimmer or pulse. Use a spinner or indeterminate progress only for active work; stop it as soon as work ends. Reduced-motion rules must also stop infinite animations.
- The legacy morph menu was removed on 2026-10-30. It had no in-repo consumer, and `components/ui/dropdown.tsx` is the menu pattern. A future morph surface needs an explicit review of its layout cost, focus model, and reduced-motion behavior.
- Keep the motion preference live for JavaScript animators. `prefersReducedMotion` is the one-shot helper; `useReducedMotion` observes system and app-setting changes during component lifetimes. Sidebar FLIP, animated-size helpers, and composer hint transitions follow the same preference.

## Review and verification checklist

Before calling a motion change complete:

- Name the interaction class and the purpose of the motion in the diff or review note.
- Check the default route, focus order, hover, keyboard activation, pointer drag, pointer cancellation, rapid repeated activation, reversal mid-transition, and unmount cleanup.
- Test `Follow system` with OS motion on and off, and test the explicit app override. Check both CSS transitions and JS or timed motion.
- Check that menu and command surfaces open immediately, and that hidden content is inert rather than merely transparent.
- Inspect the rendered result in the Tauri WebView or browser preview. Confirm the direction, clipping, focus ring, and final resting position. A CSS diff alone does not prove the motion feels right.
- Run `git diff --check`, lint, TypeScript, and focused tests. For a UI task, run the repository's full verification gate when the environment supports it. Report every gate that did not run.

## Research basis and status

The user-provided video transcript informed the purpose-first, spatial, interruptible, and reduced-motion rules above. Twelve distinct local skill sets were reviewed for this pass. **72 distinct, successfully fetched online pages** informed the implementation; the full ledger and per-source takeaways are in [`engineering/motion-research-sources.md`](./motion-research-sources.md). Of the 46 new pages in the later pass, 10 were complete reads and 36 were targeted/partial reads. The 70-page research target is met by unique URLs; do not imply every page was read in full.

A repeatable file-level inventory traversed **475/475 frontend source files** under `app`, `components`, `features`, `lib`, and `core` (99,752 lines). The documented broad motion/interaction keyword scan matched 141 files and 628 lines; 26 files contained explicit CSS animation/keyframe/animation-class candidates. This is automated discovery and targeted review, not proof of 95% line-by-line human review. Keep that distinction in reports and do not claim the 95% code-review target is complete without stronger evidence.

## Local skill sets reviewed

| Local skill set | Reusable guidance applied here |
| --- | --- |
| `animate` | Decide whether motion belongs before selecting a tool; extend the existing timing and easing tokens. |
| `animation-vocabulary` | Name the motion pattern precisely so code, design review, and handoff describe the same behavior. |
| `find-animation-opportunities` | Reject motion that has no user-facing purpose or is too frequent; do not turn the audit into an animation wishlist. |
| `improve-animations` | Inventory the motion surface and frequency first; prioritize findings by impact and verify cited code. |
| `review-animations` | Check duration, easing, origin, interruption, rendering cost, and reduced-motion behavior as one craft review. |
| `ui-animation` | Prefer retargetable CSS transitions for state changes; direct manipulation stays 1:1 and keyboard actions stay immediate. |
| `apple-design` | Respond on pointer-down, preserve input agency, and make drag/cancel/reversal paths continuous. |
| `ax-audit` | Motion must not obscure agent state, user authority, approval, or recovery; keep controls and outcomes legible. |
| `fluentui-design` | Treat keyboard operation, focus restoration, responsive behavior, and motion preferences as composition requirements. |
| `design-system` | Put shared values in a documented token hierarchy rather than scattering one-off timings. |
| `frontend-design` | Restrain non-user-triggered motion on functional surfaces; remove generic mount and hover flourishes. |
| `ui-verification` | A source diff is not a feel-check: verify focus, input, reduced motion, overflow, and rendered behavior in the browser. |

## Online source ledger

See [`engineering/motion-research-sources.md`](./motion-research-sources.md) for all 72 unique successful URLs and the takeaways that informed this guide. Current WCAG 2.2 and ARIA APG guidance takes precedence over archived Material 1/2 pages and the discontinued W3C `Using ARIA` draft. Practitioner recommendations are starting points, not normative requirements; automotive and visionOS guidance is platform-specific.
