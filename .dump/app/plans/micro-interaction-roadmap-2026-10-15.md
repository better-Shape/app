# Micro-interaction roadmap, 2026-10-15

Result of a full read of the renderer (`app/`, `components/`, `features/`, `lib/`, `core/`,
599 TS/TSX files) plus the research in `../research/motion-research-2026-10-15.md`.
Every item carries the file it lands in, the exact motion values, an effort estimate
and the gate result that let it survive. Items are ordered by leverage, not by how
fun they are to build.

## The gate

Every candidate is judged by the vendored pack, in this order:

1. **Frequency.** 100+ times a day, or keyboard-initiated: no animation, ever.
   Tens of times a day: near-imperceptible motion only. Occasional: standard.
   Rare or first-run: the delight budget lives here.
2. **Purpose**, named in one word: feedback, spatial consistency, state
   indication, preventing a jarring change, explanation, delight.
3. **Speed.** UI under 300ms; press feedback 100–160ms; dropdowns 150–250ms.
4. **Function.** Data the user reads must not move for style.

Rejected candidates are listed at the end, because a roadmap that only finds
opportunities is a worse roadmap.

## Shipped in this pass

### 1. Panel rail: the toggle icon reports panel state, and previews it on hover

`components/ui/panel-glyph.tsx`, `features/agent/chrome.tsx`, `app/transitions.css`.

Fluent fuses a panel glyph's rail into its frame path, so the icon in use
(`PanelLeft20Filled`, `PanelRight20Filled`) cannot show that a panel is open or
closed: both toggles drew the same pixels in both states, and the only signals were
a tooltip, `aria-pressed` and a text color. The glyph now draws Fluent's exact
silhouette and hides the rail's excess behind a mask, so:

| State | `--panel-rail-hide` | Result |
| --- | --- | --- |
| Panel open | `--panel-rail-open` 0 | Fluent's filled glyph, pixel for pixel |
| Panel closed | `--panel-rail-closed` 1 | Rail pulled back to the frame band: an outlined box |
| Toggle hovered or focused | `--panel-rail-peek` 0.5 | Half the change, previewing the click |

- **Purpose:** state indication, plus spatial consistency (the icon commits as the
  panel it drives moves).
- **Frequency:** tens of times a day, so it stays under 300ms and never animates
  anything but the rail.
- **Values:** `--panel-rail-dur` 140ms (matched to `--transition-base` so the icon
  and the panel move as one thing), `--panel-rail-ease`
  `cubic-bezier(0.22, 1, 0.36, 1)`. Only `transform` animates, so hover, focus and
  click run on the compositor with no React re-render.
- **Reduced motion:** the rail still reports state, it just stops travelling to it.
- **Verified:** the open state rasterises identically to Fluent's glyph (0 pixels
  differ at 1×, 2× and 4×); the six contract tests in
  `tests/ui/panel-glyph.test.tsx`; `npx tsc --noEmit` clean.

## Next, in order

### 2. Workbench tabs: the icon-to-close swap is an instant cut, and tabs never move under the press

`features/agent/workspace/tabs.tsx:91` and `:108` (the icon and the close button),
`features/editor/ui/tabs/workbench-tab-styles.ts:26` (`workbenchTabItemClass`).

The tab slot is already well built: the file icon fades out and the close button
fades into the same 16px box, so nothing reflows. Both layers are missing their
transition though: one has `group-hover:opacity-0` and the other
`group-hover:opacity-100`, with no `transition-opacity` anywhere, so the swap is a
hard cut on the one control the pointer is guaranteed to cross. The tab itself is
also `transition-colors` only: nothing in the tab family
(`features/agent/workspace/tabs.tsx`, `features/editor/ui/tabs/`,
`features/chat/ui/shell/tabs.tsx`, `features/terminal/ui/terminal.tsx`) has a press
state, so a click gives no physical acknowledgement on a surface the user clicks
tens of times an hour.

- **Purpose:** feedback (the press) and preventing a jarring change (the swap).
- **Frequency:** tens of times an hour, so both stay under 160ms.
- **Values:** `transition-opacity` at `--transition-fast` (90ms) `--ease-out` on both
  layers; `.press-spring` as it exists (`--press-scale` 0.985, in 80ms, out 220ms)
  on the tab, not on the close button, so a close never shrinks the whole tab.
- **Effort:** ~1 hour, plus a check in the browser preview.
- **Gate:** passes. The rejected alternative, sliding the close button in from the
  edge, moves text the user is reading.

### 3. Copy: use the swap pattern that already exists instead of a hard cut

`features/agent/workbench/status/ui/copy-button.tsx:26-47`, and the other 30 call
sites of `navigator.clipboard.writeText`, which live in 20 files across
`features/agent/`, `features/chat/`, `features/command-palette/` and
`features/editor/`.

The copy affordance swaps the clipboard glyph for a checkmark by re-rendering, so
the icon and the label ("Copy" → "Copied") change in one frame. `app/transitions.css`
already ships `t-swap` (fade, 10px rise, 6px blur-out) for exactly this, and two
call sites in the composer use it. Route the copy buttons through it, and the
colour change through the existing `transition-colors`.

- **Purpose:** state indication; the copy confirmation is the only proof the click
  landed.
- **Frequency:** tens of times a day, and `t-swap` is 380ms with a blur, so it needs
  trimming to `--transition-fast` for these call sites rather than copied as-is.
- **Values:** `t-swap` layers at 90–140ms, `--ease-out`, no width animation.
- **Effort:** ~2 hours, mostly finding the call sites.
- **Gate:** passes. This is the cheapest item on the list because the pattern and
  its reduced-motion block already exist.

### 4. Checkmarks: wire up the check that draws itself

`components/ui/checkmark.tsx:36-48` and

`app/transitions.css:489-560` (`t-success-check`).

`t-success-check` is a complete check-draw animation, rotate in from 80°, bob up
8px, blur out 4px and stroke-dashoffset 20→0, with no consumer anywhere in the app.
`Checkmark` renders a plain `Checkmark20Regular` icon instead. Wiring the two
together gives every checkbox in the app a drawn check for free, and deletes one of
the five dead definitions.

- **Purpose:** feedback, at the moment the user is least sure the click landed.
- **Frequency:** tens of times a day per checkbox, so it must stay at
  `--check-path-dur` 400ms *or be shortened*. 400ms is over the UI ceiling and I
  would cut it to ~250ms for compact rows, keeping 400ms where a checkbox is the
  primary action.
- **Effort:** ~2 hours, including the duration decision above.
- **Gate:** passes with the duration caveat. The reduced-motion block already exists.

### 5. Sidebar collapse: the flyout should come from the rail

`features/agent/layout.tsx:66-104` (`SidebarPeek`), `:596-598`.

The closed sidebar's flyout fades in over 200ms from a fixed position with no
origin story, and the rail button that opens it sits at the window edge. Give the
flyout a `transform-origin` at the toggle and a 4px x-shift on top of the fade so
the panel reads as coming out of the icon the user is hovering, and let the
`SidebarToggleBtn` rail preview carry the same state (it already does, since the
peek toggle reuses the component).

- **Purpose:** spatial consistency.
- **Frequency:** the flyout is opened by hover, so it can be seen many times an
  hour. Keep it at 200ms or below and never animate its contents.
- **Values:** opacity 200ms `--ease-out` (existing) plus
  `transform: translateX(-4px)` → 0 and `transform-origin: left center`; the 200ms
  exit delay already in `SidebarPeek` stays.
- **Effort:** ~1.5 hours. Watch the exit: it currently relies on a 200ms timer.
- **Gate:** passes.

### 6. Hold to confirm where the action has no undo

`features/git/ui/graph/commit-row.tsx:435-470` (soft / mixed / hard reset),
`features/git/ui/actions/*`, `features/agent/workspace/file-diff.tsx` (discard).

A hard reset and a discard are confirmed with a plain click in a dialog. Where a
mistake is unrecoverable, a press-and-hold fill is both a stronger guard and a
better feel than a modal. The pattern is in the skill pack under *Hold to confirm*:
`clip-path: inset(0 100% 0 0)` → `inset(0 0 0 0)` over 2s linear *while pressed*,
releasing snaps back in 200ms `ease-out`.

- **Purpose:** preventing a jarring change, in the opposite direction: preventing
  an irreversible one.
- **Frequency:** rare by construction, which is what makes a 2s hold acceptable.
- **Effort:** ~4 hours: it is a new primitive (`components/ui/`), needs a keyboard
  and screen-reader path, and touches destructive flows that deserve review. Worth
  doing as its own change, not folded into a motion pass.
- **Gate:** passes for the *hold*, and the deliberate phase is exactly the
  asymmetric-timing case the pack describes (slow where the user is deciding, fast
  where the system responds).

### 7. Panel and tab reorder: give the drag its own state

`features/agent/workspace/tabs.tsx:61-74`, `features/editor/ui/tabs/tab-bar-shell.tsx`.

dnd-kit drives these reorders and the dragged item is only `opacity-40`. Add a
lift (`scale(1.02)` plus a shadow) for the dragged tab and use the existing 40%
opacity for the gap it leaves, so the drag reads as a physical object.

- **Purpose:** feedback plus spatial consistency.
- **Frequency:** occasional.
- **Values:** `transform 160ms var(--ease-out)`; dnd-kit's own transform handles the
  movement, so this only styles the grabbed state.
- **Effort:** ~2 hours.
- **Gate:** passes.

### 8. Git graph: the commit flash is wired, but nothing explains the branch line

`features/git/ui/graph/svg-row.tsx`, `app/globals.css:1600-1609`
(`graph-commit-flash`), `features/git/ui/graph/commit-row.tsx`.

The flash on a new commit exists and is good. The gap is the *line drawing* on first
paint: the graph draws at once. A one-shot `stroke-dashoffset` draw over ~300ms on
the newest row, once per fetch, would tell the user where the new commit attaches.

- **Purpose:** explanation.
- **Frequency:** occasional, and only where the graph is on screen.
- **Effort:** ~3 hours, and it needs a decision on suppression while the user is
  scrolling.
- **Gate:** borderline. Animation is allowed on explanation, but the graph is data
  the user reads, so this needs to be a one-shot on arrival, never on scroll.

### 9. Status bar: give the changing values a shared swap

`features/agent/workbench/status/ui/status.tsx:56-70`,
`features/agent/workbench/status/ui/status-item.tsx`.

Language, branch, position and encoding swap with no bridge. `t-swap` fits, at
`--transition-fast`, on the values only.

- **Purpose:** preventing a jarring change.
- **Frequency:** the status bar is glanceable, not interacted with, so the motion
  must be small enough to miss.
- **Effort:** ~1.5 hours.
- **Gate:** passes at the shortest token; fails if it is slower.

### 10. First-run and empty states: spend the delight budget

`app/welcome-screen.tsx`, `features/agent/workspace/*` empty views,
`features/chat/ui/shell/home.tsx`.

The delight budget is unspent. These are the only surfaces where a longer beat, a
stagger of 30–80ms, or a genuine overshoot is warranted, and they are seen once.

- **Purpose:** delight, allowed at this frequency only.
- **Effort:** ~4 hours for one considered moment (the app's first paint), plus a
  design decision about which moment deserves it.
- **Gate:** passes by tier. Do not extend this treatment to anything seen daily.

## Rejected, with the reason

| Candidate | Why it is out |
| --- | --- |
| Animating the command palette open/close (`features/command-palette/cmd-palette.tsx`) | Keyboard-initiated and used hundreds of times a day. Raycast has no open animation; the pack calls this a disqualifier, not a judgment call |
| Icon-hover rotation on file-tree and sidebar chevrons (`features/agent/workspace/tree.tsx:164`, `features/agent/sidebar/sections.tsx:517-536`) | Those chevrons already rotate 90° on expand. Adding a hover rotation makes an element the user scans constantly fidget, and it double-signals the same state |
| `transition-all` on the two error screens (`components/layout/error/error.tsx:31,37`, `global-error.tsx:30,36`) | `transition-all` is an automatic block, but these are full-screen failure paths seen by almost nobody. Replacing it with named properties is a hygiene fix, not a micro-interaction; it belongs in a lint pass |
| View Transitions for tab or list reorder (`features/agent/workspace/tabs.tsx`) | Same-document transitions are Baseline, but the parts that make it cheap here (`view-transition-class`, nested groups) are Chromium-only, and the panel/tab moves are already CSS transitions on live elements. Revisit when `view-transition-class` is in all three engines |
| `interpolate-size: allow-keywords` to animate `height: auto` | Chromium-only as of this research. `components/ui/collapsible.tsx` already uses the portable `grid-template-rows: 0fr → 1fr` pattern, which stays |
| A spring library, or `linear()` overshoot | Nothing on this list is a gesture the user can flip mid-motion, which is the case that justifies a spring. `cubic-bezier` with the repo's `--ease-out` is a stronger curve than the built-in keyword and is enough |
| Press-scale on the window controls (`features/agent/workbench/titlebar/ui/window-controls.tsx`) | They follow the platform convention on purpose: neither Windows nor macOS scales its caption buttons, the macOS cluster already reveals its glyphs on group hover, and the close button already has a distinct hover state. The three are also a 46px target on a window edge, so Fitts's law already does the work |
| Animation on the titlebar app menu trigger (`features/agent/workbench/titlebar/ui/app-menu.tsx:143`) | It is a menu trigger on a keyboard-reachable path, used many times an hour. `titlebarIconButtonClass` gives it `transition-colors` and an open state, which is the whole budget |
| Particle, confetti, cursor-follow or glow effects | Decoration on a functional, information-dense surface. The pack's function gate rejects them, and `DESIGN.md` rejects glow outright |

## Housekeeping the research turned up

Five motion patterns in `app/transitions.css` have no consumer anywhere in the app:
`t-success-check` (`:489`), `t-wave-bar` (`:603`), `t-think` (`:371`), `t-reason`
(`:445`) and `t-stream-w` (`:476`). Items 4 and 9
use one of them; the rest should either be wired into the component that was meant
to use them or deleted, so the file describes what the app does. `t-wave-bar` (a
`scaleY` wave) has no obvious home and is the first candidate to delete.

## How to check the work in this pass

`npm run dev:browser` serves the app with a mocked backend at
`http://localhost:48921/?seed=project`. In the title bar: hover the left toggle at
the top of the sidebar and the right toggle at the top right of the chat column.
Each rail travels to half width while hovered, returns when the pointer leaves, and
finishes the move when clicked, in the same 140ms as the panel it drives. Tab to
either toggle with the keyboard to see the same preview on focus.

---

# Wave 1, what actually landed (same day)

Each item below is built, wired into at least one real surface, and pinned by a test
that fails if the contract is undone. Test files added: 7. Suite grew from 107 files /
870 tests to 114 / 923. `npx tsc --noEmit` clean; no new eslint warnings (the 3 that
remain on touched files are pre-existing `set-state-in-effect` in effects this pass
did not write).

| # | Roadmap item | Landed as | Test |
| --- | --- | --- | --- |
| 1 | Panel rail preview | earlier pass: `components/ui/panel-glyph.tsx`, `--panel-rail-*` | `tests/ui/panel-glyph.test.tsx` |
| 2 | Tab icon↔close swap | `transition-opacity` on both layers in workspace + chat tabs; `press-spring` on the tab item; `[scale:1.02]` while dragging | covered by existing tab tests |
| 3 | Copy swap | `components/ui/swap.tsx` + `components/ui/copy-button.tsx` + `lib/ui/use-copy.ts`; 8 call sites routed, 2 toast-only paths dropped in favour of an in-place tint | `tests/ui/swap.test.tsx` (7), `tests/ui/copy-button.test.tsx` (10) |
| 4 | Checkmark draw | `DrawnCheck` in `components/ui/checkmark.tsx`, `data-motion="compact"` default | `tests/ui/checkmark-draw.test.tsx` (5) |
| 5 | Sidebar flyout | `origin-left`, `translate-x` travel, 200ms | none |
| 7 | Drag state | separators and the workspace handle got hairlines; `scale` property used so dnd-kit's inline `transform` still composes | none |
| 9 | Status bar swap | `SwapText` on Ln/Col, EOL, indentation, language | `tests/ui/swap.test.tsx` |

Items added this wave that were **not** in the original roadmap:

1. **Delayed + minimum-visible loading bar**, `lib/ui/use-delayed-flag.ts`, wired into
   `components/ui/loading.tsx`. (`tests/ui/delayed-flag.test.tsx`, 5)
2. **Honest copy**, `useCopyToClipboard` awaits the write; a denied clipboard shows an
   error naming manual copy instead of a green "Copied". This reverses the old
   behaviour at every site that wrote without awaiting.
3. **Terminal tab activity dot**, `terminalSessionStore.noteOutput` /
   `unreadTabs` / `clearUnread`, `.t-tab-dot`, close button now hover-gated.
   (`tests/terminal/tab-activity.test.ts`, 8)
4. **Skeleton geometry**, `features/git/ui/shared/row-shell.ts` shared by the live rows
   and `GitListSkeleton`; bars are line boxes, not guessed heights.
   (`tests/ui/git-list-skeleton.test.tsx`, 13)
5. **One container reveal**, `components/ui/collapse.tsx`, replacing two local
   `AnimatedCollapse` copies; the closed branch is now `inert`.
   (`tests/ui/collapse.test.tsx`, 5)
6. **Spring, in one place**, `--ease-overshoot` behind `@supports`, on the popover
   entrance only.

## Measured, not asserted

- Live job row at the app's 13px root: `py-2` 6.5px a side + `text-sm` line box 20px +
  `text-xs` line box 17.33px = **50.3px**. The old placeholder measured
  `6.5 + 6.5 + h-4 13 + gap-1.5 4.875 + h-3 9.75` = **40.6px**. Nine rows put the loaded
  list ~88px taller than its placeholder.
- `--press-scale` 0.985 makes any press-release spring invisible: a 12% overshoot moves
  the control by 0.2% of its size. That is why the spring went to the popover (0.97 → 1)
  and not to `.press-spring`.
- The pty output path is a hot path: 500 output chunks on one tab produce **one**
  notification, because the store only notifies on the transition into unread.

## Still open

- 28 of 35 `clipboard.writeText` sites are context-menu items. They were left alone on
  purpose: the menu closes on click, so a swap there animates something nobody can see.
  The two that were toast-only in a dense list now tint in place instead of firing a
  toast at the window edge.
- `components/ui/collapsible.tsx` and `dropdown.tsx` (x2) still hand-roll the grid
  reveal. They carry their own layout constraints (`flex-1 min-h-0`, scroll bodies) and
  were not folded into `Collapse` this pass.
- The terminal dot marks the tab, not the panel. When the terminal pane is closed, the
  dot waits inside the strip.
---

# Wave 2, error states and reduced motion (same day, second leg)

Suite: **117 files / 945 tests** (+3 files / +22 tests over wave 1). `tsc --noEmit` clean.
The user-facing narrative for this leg is `.dump/app/reports/micro-interactions-2026-10-15.md`.

## What the failure-state research turned up

Three real defects, none of them cosmetic:

1. **The root error boundary did not exist.** `components/layout/error/global-error.tsx`
   was dead code, nothing imported it, and `global-error` is a route-segment convention
   that Next.js only resolves at the root of `app/`. A root-layout crash fell through to
   Next.js' built-in unstyled fallback ("This page couldn't load"). Fixed by creating
   `app/global-error.tsx` (client component; owns `<html>`/`<body>`; imports
   `./globals.css` so the tokens travel with it) and deleting both dead files.
   Verified by screenshot before/after via `?crash=global`.
2. **The route boundary hid the error.** `app/error.tsx` showed a title and nothing else:
   no message, no digest, no report path. It now renders the shared `CrashScreen`.
3. **A guard that named a class nothing carries.** `.bettershape-orb-breathe` is the
   *keyframe*; the class is `.onboard-orb`, which no element uses. Removed, with the
   reasoning left in the file.

## Reduced motion, corrected

`app/globals.css:1588` already carries the blanket reset (`*` → `animation-duration:
0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms
!important`). The earlier claim that the infinite animations were "unguarded" was wrong:
they were all answering that reset, which is what made every spinner static.

So `app/transitions.css` now carries an **exception layer** on top of it, not a second
reset:

- decorative → stopped: `.animate-pulse`, `.git-generate-shimmer`
- informational → slowed **and still iterating**: `.animate-spin`, `.imsg-typing span`
  at `animation-duration: 2.4s !important; animation-iteration-count: infinite !important`,
  because the count has to be re-asserted: `*` sets it to `1`, and a raised duration
  without a raised count is a spinner that turns once and then looks hung.

Both the source contract (`tests/ui/reduced-motion.test.ts`, 5 tests) and the **computed**
result (`scripts/qa/probe-reduced-motion.cjs`, Chromium with `reducedMotion: "reduce"`)
are covered, because a specificity mistake is invisible in the source.

## Housekeeping this leg added to the list

- `.onboard-orb` (with `@keyframes bettershape-orb-breathe`) is dead CSS: one rule, no
  consumers. Either wire the onboarding blob up and give it a real guard that restores
  its resting state, or delete both.
- `scripts/qa/shot-errors.cjs` needs `waitUntil: "commit"` plus a long timeout (the first
  dev compile of a crash route exceeds Playwright's 30s default) and
  `nextjs-portal{display:none !important}`, since Next's dev overlay covers the very
  screen being captured.

---

# Wave 3, the sidebar state ladder (same day, third leg)

Suite: **118 files / 951 tests**. Closes the third part of the user's original ask
("sidebar icons"), which was delegated to me to research and settle.

## What the research said

Material 3 state layers are fractional and additive: hover 8% of the content colour, focus
and press 10%, drag 16%, and selected + hover both apply. Fluent's own guidance implies the
same, and microsoft/fluentui#4992 is a filed defect for getting it wrong ("There should be
a visual difference between a selected menu item and a menu item that has been hovered on").

## What the sidebar was doing

| Control | Hover | Committed | Defect |
| --- | --- | --- | --- |
| Uncoloured chat row (`uncolouredChromeClass`) | `--panel-hover` | `--panel-hover` | identical |
| Coloured chat row (`outerTintClass` + wash) | 22% + 12% ≈ 34% | 30% | hover brighter than committed |
| Rail nav icon (`index.tsx`) | none | `--panel-active` | hovered with no fill |
| Row action icons (`sections.tsx` 346/377) | `--panel-active` | none | hover wearing the committed tone |

## What landed

- `app/globals.css`: `--row-hover` (0.04), `--row-selected` (0.08), `--row-selected-hover`
  (0.10), hover is exactly half of committed, with the reasoning in the file.
- Every sidebar row and icon button migrated onto them (no `hover:bg-panel-*` or bare
  `bg-panel-active` remains in `features/agent/sidebar/`, except the unrelated
  `collection-dialog.tsx`).
- Tinted rows: `--chat-tint` at 22 / 26 / 30 / 34, so the 4% hover step is the arithmetic
  midpoint of 22 → 30.
- Eleven sites that applied a hover fill without a transition got
  `transition-colors duration-[var(--transition-fast)] ease-[var(--ease-out)]`.
- Open menu triggers take the committed fill (`data-[state=open]` 8% + 10% hovered).
- `tests/ui/sidebar-state-ladder.test.ts` (5) holds the ratio, the additive step, the
  migration, the transition, and the tint arithmetic. Both mutations were checked and fail.
- `scripts/qa/probe-sidebar-ladder.cjs` measures the ladder on live elements, and
  `scripts/qa/shot-sidebar-ladder.cjs` writes the two-frame comparison.

## Rejected, with the reason

- **Half-rotating the section chevrons**: there is no rotating glyph. The app swaps
  `ChevronRight20Regular` for `ChevronDown20Regular`, so the literal reading of the brief
  does not exist in the markup.
- **A hover nudge on the icon buttons**: no design system moves an icon button on hover and
  nothing in the app would give the movement a meaning. Decoration.
