# Micro-interactions: what was found, what was built, what it cost

Branch `arena/0b5607bf-app` @ `289b134` + this work (uncommitted).
Suite: **118 files / 951 tests passing** (`npx vitest run`), `npx tsc --noEmit` clean,
`eslint` 0 errors on every touched file.

This covers four waves: the hover-preview you described (wave 1 + its correction), the
error-state pass that came out of the failure-state research (wave 2), the
reduced-motion/accessibility layer (wave 3), and the sidebar state ladder (wave 4).
Everything below is either a file you can open, a number that was measured in a browser,
or a decision with its reason attached.

---

## 1. The thing you asked for first

> the sidebar toggle (top bar), right-panel toggle, and sidebar icons, hover should
> trigger a smooth 60fps anticipatory motion that travels ~halfway toward the clicked
> end state, previewed on hover, committed on click; reversible/interruptible

**Built, for the two panel toggles.** The mechanism is a single custom property per side
that the icon's rail reads, so there is no JS in the frame loop and no second layout:

```
--panel-rail-open: 0      --panel-rail-closed: 1      --panel-rail-peek: 0.5
.panel-glyph__hide { transform: scaleX(var(--panel-rail-hide, 0)) }   140ms cubic-bezier(0.22,1,0.36,1)
```

Rest `0` → hover/focus `0.5` (halfway, your midpoint) → click commits to the end state.
Measured in Chromium on the live dev server, sampling the inline transform:

| Moment | Rail value (workspace toggle) |
| --- | --- |
| at rest | `0` / `0.000` |
| hovered | `0.5` / `0.500` |
| click → travel | `0.537 → 0.977 → 0.991 → 1.000`, pointer still on the icon |
| held after commit | `1` |
| pointer leaves and comes back | **`0.5`**: the preview returns |
| sidebar pair (left, right) | `[0.5, 0.5] → [0.378, 0.622] → … → [0, 1]` |
| committed panel width | `260 → 8.81px (t38) → 0.94px (t75) → 0` |

Reversibility is the measured line in that table: re-hovering *after* a commit drops back
to the midpoint instead of sticking at `1`. That was the actual bug in the first build: 
the peek rule kept applying once the panel had committed, so a committed toggle sat at
half width forever. The fix is `:not([data-panel-committed="true"])` on **both**
`:hover` and `:focus-visible`, plus an exit keyframe that has no `to` frame, so it
animates from the peek to whatever the element's own committed value happens to be, 
which is deliberately different on each side and in each state.

Keyboard users get the same preview on `:focus-visible`; reduced motion keeps the rail
honest (it still reports the state) with the travel zeroed.

**Built, for "sidebar icons" too, but not as motion, and that is the finding.** See §7.
The short version: the sidebar's problem was not missing animation, it was that hover and
the committed state were rendered with the *same* fill, so there was no ladder for
anything to travel along. It now has one, and the fill is measured:

| Control | rest | hovered | committed | committed + hovered | released |
| --- | --- | --- | --- | --- | --- |
| selected chat row | `0.08` | `0.10` | `0.08` | `0.10` | `0.08` |
| unselected nav row | `0` | **`0.04`** | none | none | `0` |

`hover 0.04 × 2 = 0.08 = committed`: hovering is *exactly* halfway to the state the click
commits, everywhere in the sidebar, on a 90ms `cubic-bezier(0.16, 1, 0.3, 1)` transition,
and it returns when the pointer leaves. Screenshot pair:
`.dump/app/qa/motion/sidebar-ladder-compare.png`.

---

## 2. How the bar was set

Every candidate had to clear the same gate before it was worth a line of code:

- **Purpose.** Feedback, explanation, preventing a jarring or irreversible change, or
  delight. "It looks nice" is not on the list.
- **Frequency.** Seen daily → it must be near-invisible (< 200ms, no movement that
  survives a glance). Seen rarely → it may take its time. Frequency is the *first*
  question, not a tiebreak.
- **One motion budget per control.** A control that already animates does not get a
  second animation.
- **Values, not magic numbers.** `--reveal-dur`, `--ease-out`, `--transition-fast` and
  friends from `app/transitions.css`/`globals.css`; no `transition-all`, no ad-hoc
  springs.
- **No animation runtime.** CSS variables, `t-*` classes, and small JS where CSS cannot
  reach. The app ships no animation library and this pass did not add one.

---

## 3. Everything built

### Wave 1, the catalogue, built

| What | Where | Why it earns its place |
| --- | --- | --- |
| Panel-glyph rail preview + commit | `components/ui/panel-glyph.tsx`, `features/agent/chrome.tsx`, `app/transitions.css` | The toggle reports panel state, and previews it before you commit |
| Tab icon ↔ close swap | `features/agent/workspace/tabs.tsx`, `features/chat/ui/shell/tabs.tsx` | One slot, two affordances; a hard cut made the close button appear to teleport under the pointer |
| Copy → "Copied" swap | `components/ui/swap.tsx`, `components/ui/copy-button.tsx`, `lib/ui/use-copy.ts` | Replaces a toast that fired from the window edge, far from where you clicked |
| Drawn checkmark | `components/ui/checkmark.tsx` | A drawn tick reads as "this just happened"; a pasted one reads as static |
| Sidebar flyout from the rail | `features/agent/sidebar/*` | Spatial consistency: the panel grows from the edge it is attached to |
| Drag state | workspace tabs, separators | `scale` used instead of `transform` so dnd-kit's inline transform still composes |
| Status-bar value swap | `features/agent/workbench/status/ui/status.tsx` | Ln/Col, EOL, indentation, language change under the cursor with no bridge |
| Delayed + minimum-visible loading bar | `lib/ui/use-delayed-flag.ts`, `components/ui/loading.tsx` | A 60ms request must not flash a progress bar; a 400ms one must not blink out at 90% |
| Honest clipboard | `lib/ui/use-copy.ts` | A denied clipboard now says so instead of showing a green "Copied" |
| Terminal tab activity dot | `features/terminal/{session.ts,ui/terminal.tsx,background-run.ts}` | Answers "which tab needs me" without stealing focus |
| Skeleton geometry | `features/git/ui/shared/{row-shell.ts,skeletons.tsx}` | The placeholder is now the same height as the row it replaces |
| One collapse primitive | `components/ui/collapse.tsx` | Replaced two local copies; the closed branch is `inert`, so hidden content is unreachable |
| One spring, one place | `app/transitions.css` (`--ease-overshoot`) | Used only under `@supports`, on the popover entrance, the one surface where overshoot is honest |

### Wave 2, the error states

The failure-state research (walk the core flow, break it on purpose, design the failure
the way you design the success) turned into a real defect list rather than a coat of
paint. Three findings, all in §5.

### Wave 3, reduced motion

The app had one blanket reset. It is now a reset plus a named exception layer, verified
against a real engine rather than by reading CSS. Detail in §5.3.

---

## 4. Measured, not asserted

- **Live job row, 13px root:** `py-2` 6.5px × 2 + `text-sm` line box 20px + `text-xs`
  17.33px = **50.3px**. The old placeholder computed to **40.6px** (`6.5 + 6.5 + h-4 13 +
  gap-1.5 4.875 + h-3 9.75`). Nine rows meant the loaded list was ~88px taller than the
  placeholder that promised it, a jump, not a shimmer.
- **`--press-scale` is 0.985.** A 12% overshoot on a release spring moves a control by
  0.2% of its size: invisible. That is why the only spring in the app is the popover
  (0.97 → 1) and not the press.
- **Pty output is a hot path:** 500 output chunks on one tab produce **one**
  notification, because the store only notifies on the transition into unread.
- **Reduced motion, computed in Chromium** (`scripts/qa/probe-reduced-motion.cjs`):

  | Probe | `no-preference` | `reduce` |
  | --- | --- | --- |
  | `animate-spin` | spin, 1s, infinite | **spin, 2.4s, infinite** |
  | `animate-pulse` | pulse, 2s, infinite | none, 0s |
  | `git-generate-shimmer` | shimmer, 1.1s, infinite | none, 0s |
  | `imsg-typing span` | `imsg-dot`, 1.2s, infinite | **`imsg-dot`, 2.4s, infinite** |

- **The sidebar ladder, computed in Chromium** (`scripts/qa/probe-sidebar-ladder.cjs`):
  tokens resolve to `--row-hover` 3.9%, `--row-selected` 7.8%, `--row-selected-hover` 10.2%;
  a selected chat row reads `0.08 → 0.10 → 0.08` across hover / commit / release; an
  unselected nav row reads `0 → 0.04 → 0`; the fill transitions in 90ms on
  `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Suite growth:** wave 1 ended at 114 files / 923 tests; now **118 / 951** (+28 tests
  across `panel-commit`, `crash-screen`, `reduced-motion`, `sidebar-state-ladder`).

---

## 5. Three findings that matter more than any animation

### 5.1 The app had no root error boundary at all

`components/layout/error/global-error.tsx` existed, was styled, was tested, and was
**dead code**. Nothing imported it, and Next.js only resolves `global-error` as a
route-segment convention at the *root of `app/`*, which did not exist. So a crash in the
root layout fell through to Next.js' built-in unstyled fallback. Proof, before and after,
in the dev server:

| URL | Before | After |
| --- | --- | --- |
| `?crash=global` | Next's default: "This page couldn't load / Reload / Back" | the designed screen: error glyph, **"IDE crashed"**, message, `Try again` / `Reload IDE` / `Report this crash` |

Fixed by creating `app/global-error.tsx` (client component, owns its `<html>`/`<body>`,
imports `./globals.css` so the tokens travel with it) and deleting the two dead files.
The regression is pinned by a test that asserts the boundary's *address*, not just its
contents, a test that passes against a file nothing mounts is worse than no test.

### 5.2 The route boundary threw the reason away

`app/error.tsx` said "Can't reach this page" and nothing else: no error text, no digest,
no way to report it. The one screen a user sees when the UI fails was the one screen that
could not tell anyone why. It now renders the same shared `CrashScreen` as the root
boundary, so all three surfaces are one component and cannot drift apart again.

Evidence: `.dump/app/qa/motion/crash-route.png` (route boundary inside the app shell, so
the sidebar and titlebar survive, which is the difference between a route and a global
boundary, visible in one image) and `crash-global.png`.

The screen's actions are ordered by cheapness and likelihood, and the report path reuses
the existing `submitProblemReport` (which already redacts and opens a prefilled issue)
instead of inventing a second diagnostics format. On-screen honesty copy, because a
"Report" button that silently uploads a stack trace is a trust bug:
*"Reporting copies a redacted report to your clipboard and opens a prefilled issue.
Nothing is sent until you submit it."*

### 5.3 The reduced-motion story was wrong in both directions

Two corrections, both found by measuring rather than reading:

1. **A guard named a class nothing carries.** The block I added guarded
   `.bettershape-orb-breathe`, which is the *keyframe* name; the class that applies it is
   `.onboard-orb`, which is applied to **no element in the repo**. The guard was a silent
   no-op that read as coverage. And it would have been wrong even if applied: with
   `animation: none` the orb loses the keyframe's resting state and renders at full
   opacity, off-centre.
2. **A "slowed" spinner that stops after one turn.** `app/globals.css:1588` already
   carries a blanket reset (`*` → `animation-duration: 0.01ms`,
   `animation-iteration-count: 1`, `transition-duration: 0.01ms`). Raising only the
   duration left the count at `1`, so the spinner played one 2.4s turn and froze, which is the
   exact hang-look the fix was for. The guard now re-asserts
   `animation-iteration-count: infinite !important`, which wins on specificity against `*`.

The principle behind the exception layer: `reduce` means *as little motion as necessary*,
not *none*. Decorative waits stop (a still skeleton still says "content is coming");
informational motion slows and keeps going (a frozen spinner is indistinguishable from a
hung app, and these are small, regular, low-amplitude). No universal `*` reset was added,
and none was widened. The existing reset is right, and it needed an exception it could
not eat.

---

## 6. What is still open, with effort

| Item | Effort | Notes |
| --- | --- | --- |
| **Hold-to-confirm** for hard reset / discard / irreversible actions | ~4h | A new primitive with a keyboard + screen-reader path, and it touches destructive flows that deserve their own review. Worth doing as its own change |
| **First-run and empty states**, the delight budget | ~4h | The only surfaces where a longer beat, a 30–80ms stagger or a real overshoot is warranted, because they are seen once. Needs one design decision about which moment deserves it |
| **Git graph: draw the newest branch line in** | ~3h | The commit flash already exists; this adds the "where does it attach" explanation. Gate is borderline: it must be one-shot on arrival and never re-fire on scroll |
| **Wire `DrawnCheck` into the success checks** | ~1.5h | Today it is only used by the copy button. Fluent's filled glyph cannot be drawn, so the remaining sites need a different geometry rather than a class change |
| **Housekeeping: 4 orphan motion patterns** | ~1h | `t-wave-bar`, `t-think`, `t-reason`, `t-stream-w` in `app/transitions.css` have no consumer. Wire or delete, so the file describes what the app does |
| **Fold `collapsible.tsx` + `dropdown.tsx` (×2) into `Collapse`** | ~1.5h | They still hand-roll the grid reveal; they carry their own scroll-body constraints |
| **Terminal dot scope** | ~1h | It marks the tab, not the panel. With the terminal pane closed, the dot waits somewhere nobody is looking |
| **Refresh the motion captures** | ~0.5h | `.dump/app/qa/motion/` currently holds the commit cases and the new crash shots; the earlier GIFs were wiped by a `--only` run before the script was fixed to scope its deletions |
| | **≈ 16.5h** | |

---

## 7. "Sidebar icons": what I found, what I picked, and why

You said to research it and pick. So, the research first, because it changed the answer.

**What the design systems actually specify.** Material 3's state layers are a *fractional*
system: hover is an 8% overlay of the content colour, focus and press 10%, drag 16%, and
the states are **additive**, "when multiple states occur at once, such as selection and
hover, both state indicators should be displayed". Hover is not a second look, it is a
partial version of the committed state. Microsoft's own guidance for Fluent navigation
says the same thing, and its absence is a filed defect: *"There should be a visual
difference between a selected menu item and a menu item that has been hovered on"*
(microsoft/fluentui#4992). A team fixing the same class of bug in another Fluent app
described it as giving "selected navigation buttons a dedicated selected+hover state
instead of degrading to ordinary hover".

**What the sidebar actually did.** Three different collapses of that ladder, all in the
same list:

| Control | Hover | Committed | What was wrong |
| --- | --- | --- | --- |
| Uncoloured chat row | `--panel-hover` 4% | `--panel-hover` 4% | **Identical**: a row could not preview anything, and the selected row went inert under the pointer |
| Coloured chat row | 22% + 12% wash ≈ **34%** | 30% | Hover was **brighter than the state the click commits** |
| Rail nav icon | none | `--panel-active` 6% | Hovered with a text-colour change only, while its selected state had a fill |
| Row action icons | `--panel-active` 6% | none | Hover wearing the committed tone |

**What I rejected, and why.** The two readings I offered you both died on the markup.
The section chevrons are not one rotating glyph: they are two Fluent glyphs swapped
(`ChevronRight20Regular` ↔ `ChevronDown20Regular`), so there is no 90° rotation to
half-deliver. And a hover *nudge* on the icon buttons would have been my invention: no
design system moves an icon button on hover, and nothing in the app gives it a meaning.
That is precisely the decoration-for-nothing you told me to avoid, so I did not build it.

**What I built.** The ladder the app was missing, applied to every row and icon button:

```
rest 0  →  hover: --row-hover 4%  →  committed: --row-selected 8%  →  committed+hover 10%
tinted rows: --chat-tint 22% → 26% → 30% → 34% of the row's own colour
```

- Hover is **exactly half** of the committed fill, the midpoint you asked for, and now
  an invariant with a test on it rather than a number that drifted.
- A committed row still steps up when pointed at (`--row-selected-hover`), because a
  selected row that stops answering the pointer reads as disabled. This is Material's
  additive rule; measured `0.08 → 0.10 → 0.08`.
- The hover step for tinted rows became the same 4% for both states, which is what makes
  26% the arithmetic midpoint of 22 → 30 instead of a second tint.
- Every fill got the transition it was missing. Eleven sites had a hover fill with
  `transition: all 0s ease`, a hard cut, and now fade on `--transition-fast`.
- An open menu trigger takes the *committed* fill (`data-[state=open]`, 8%), because open
  is what the click did, and it steps up again on hover.

**Why this is the honest answer and not a dodge.** For rows and icon buttons, a hover
*fill* is the anticipation; a transform would be the invention. That is what both design
systems the app's own tokens follow say, and the app's one control that genuinely travels
to an end state, the panel rail, already does travel, in the same project, on the same
tokens. The sidebar now states each control's end state on hover instead of hiding it
behind a click, which is the thing you actually asked for.

Verified: `tests/ui/sidebar-state-ladder.test.ts` (5 tests, both mutations checked: 
breaking the 2× ratio and restoring the hover==selected bug each fail the suite), and
`scripts/qa/probe-sidebar-ladder.cjs` for the computed result in a real engine.

## 8. Rejected, with the reason

Kept here because "we did not do it" is only useful with the why attached.

| Candidate | Why it is out |
| --- | --- |
| Animating the command palette open | Keyboard-initiated and used hundreds of times a day. Raycast has no open animation; this is a disqualifier, not a taste call |
| Hover rotation on file-tree chevrons | They already rotate 90° on expand. A second rotation double-signals the same state and makes a constantly-scanned list fidget |
| `transition-all` on error screens | An automatic block, but the honest fix was the whole surface, not the easing |
| View Transitions for tab/list reorder | The cheap parts (`view-transition-class`, nested groups) are Chromium-only; the moves are already CSS transitions on live elements |
| `interpolate-size: allow-keywords` for `height: auto` | Chromium-only here; the portable `0fr → 1fr` grid pattern stays |
| A spring library, or `linear()` overshoot everywhere | Nothing in the catalogue is a gesture the user can flip mid-motion, which is the case that justifies a spring |
| Press-scale on the window controls | Platform convention: neither Windows nor macOS scales its caption buttons, and they are already a 46px target on a window edge |
| Particle, confetti, cursor-follow, glow | Decoration on an information-dense surface; `DESIGN.md` rejects glow outright |

---

## 9. Checking it yourself

```
npm run dev:browser          # app with a mocked backend at http://localhost:48921
```

- `/?seed=project`, the workbench; hover the left toggle (top of the sidebar) and the
  right toggle (top of the chat column). Half width while hovered, returns on leave,
  finishes on click, in the same 140ms as the panel it drives. Tab to either one to see
  the same preview on focus.
- `/?crash=route`, the route boundary (welcome state only), and
  `/?seed=project&crash=global` for the root boundary. Both are preview-only and gated on
  `NEXT_PUBLIC_BROWSER_PREVIEW === "1"`, which is inlined at build time, so a packaged
  Tauri release cannot reach either code path.
- `PLAYWRIGHT_SANDBOX_LIBS=... node scripts/qa/{capture-motion,probe-rail,probe-reduced-motion,probe-sidebar-ladder,shot-errors,shot-sidebar-ladder}.cjs`

Tests that fail if the contracts are undone: `tests/ui/panel-commit.test.tsx` (9),
`tests/ui/crash-screen.test.tsx` (9), `tests/ui/reduced-motion.test.ts` (5),
`tests/ui/panel-glyph.test.tsx` (6), `tests/ui/git-list-skeleton.test.tsx` (13),
`tests/ui/copy-button.test.tsx` (10), `tests/ui/swap.test.tsx` (7),
`tests/ui/collapse.test.tsx` (5), `tests/ui/reduced-motion.test.ts` (5),
`tests/ui/sidebar-state-ladder.test.ts` (5), `tests/terminal/tab-activity.test.ts` (8).

---

## 10. Limits of this report

- Every animation claim above was measured in Chromium on this machine. None of it has
  been checked on a packaged Tauri window, on Windows or macOS caption buttons, or on a
  120Hz display.
- The reduced-motion exceptions are verified by computed style, which is the strongest
  check available here, but "a 2.4s spinner looks right" is still a judgment, not a
  measurement.
- `?crash=route` is only reachable before a project is open in the seeded preview: the
  workbench renders around the page component, so the trigger is not mounted on that
  path. That is a harness limitation, documented in the component, not a product
  behaviour.
- The `features/agent/sidebar/motion/` FLIP system (1586 lines) predates this work and was
  not touched; this report does not audit it.

---

## 11. Round 6, the vocabulary sweep, and evidence you can watch

Round 5 shipped the springs and repointed the things that MOVED: the panel rail, the
panel widths, the toasts, the section reveals. It left the things that FILL. That is the
gap this round closed, and it was bigger than it looked: **58 transitions across 30 files
were still running `cubic-bezier(0.16, 1, 0.3, 1)`, the exact curve the springs were
introduced to replace.**

### 11.1 Why a tint is not exempt

The note in `globals.css` claimed the beziers were kept for "colour and opacity tints (a
fade has no shape to get right)". Measured, that reasoning does not hold:

| | declared | half way at | effectively done at | dead tail |
|---|---|---|---|---|
| `cubic-bezier(0.16, 1, 0.3, 1)` | 140ms | 10% | 43% | **57%** |
| `--spring-quick` (bounce 0) | 180ms | 20% | 56% | 44% |

The fill was on `--transition-fast`, **90ms**, on top of that curve, so the visible part
of a hover tint was about 38ms and the transition then spent 52ms crawling against a value
the eye had already accepted. The fill is the most-touched transition in the app, so it is
the last place to keep dead air, not the first. The comparison is generated, not asserted:
`node scripts/motion/compare.mjs --write && node scripts/qa/shot-compare.cjs` produces
`scripts/motion/compare.html` and `.dump/app/qa/motion/spring-compare.png`, and the traces
in it are drawn from the boxes' real sampled positions.

### 11.2 What was repointed, by kind

| kind | sites | token | why this one |
|---|---|---|---|
| hover / press / selected tints | 50 | `--spring-tap` 140ms | bounce 0, so a fill never overshoots the row it belongs to |
| chevron rotation | 5 | `--spring-flick` 255ms | Apple's reference table gives rotation damping 0.8 / response 0.4, the one place a small overshoot is right, because a rotating glyph is an indicator and not a target |
| expanding track / flex (layout) | 3 | `--spring-quick` 180ms | layout must not overshoot or it shoves its neighbours |
| dialog + scrim exit | 2 | `--spring-panel` 240ms | was 90ms on an *accelerating* curve, the one motion a user would call violent |
| Monaco suggestion row | 1 | `--spring-tap` | a hover row like any other |

Left on the bezier deliberately, and now commented in place: the splash overlay's opacity
fade, the logo crossfade, and the indeterminate progress bar. None of those is something
the user drives, and none has a spatial reference that makes a tail legible.

### 11.3 The sweep is now enforced

`tests/ui/spring-tokens.test.ts` (13 tests) is the file `scripts/motion/springs.mjs` has
been promising in its header. It re-derives every token from the physics and compares it to
the committed stylesheet, then checks the shape (bounce-0 springs never cross their target,
the under-damped ones peak between 40% and 75% of the curve and above 1.005, every curve is
still climbing in its last four stops), and finally guards the source: no interactive fill
may sit on `--ease-out`, no `--spring-x` may be given a duration that is not
`--spring-x-dur`, and the removed `--ease-spring` decoy may not come back.

All four guards were **mutation-tested**. Reintroducing a bezier tint, hand-editing the
generated CSS, and handing a spring an inherited duration each fail exactly one test, the
intended one.

### 11.4 Evidence: recorded, annotated GIFs

Numbers are not a substitute for watching the thing. `scripts/qa/make-gifs.cjs` drives a
real pointer in Chromium, draws the pointer, an arrow along the axis of travel, a live
readout of the animated value and a caption into the page before each screenshot, then
assembles the frames into a GIF with ImageMagick (there is no ffmpeg in this environment).

```
node scripts/qa/make-gifs.cjs --list
PLAYWRIGHT_SANDBOX_LIBS=/tmp/sandboxlibs/lib node scripts/qa/make-gifs.cjs
```

| GIF | what it shows |
|---|---|
| `.dump/app/qa/gifs/panel-peek.gif` | sidebar toggle: rail 0 → 0.50 on hover, released back to 0 |
| `.dump/app/qa/gifs/panel-commit.gif` | click finishes the travel and it holds; hovering again previews again |
| `.dump/app/qa/gifs/terminal-peek.gif` | the bottom rail travelling on Y, midpoint 0.50 |
| `.dump/app/qa/gifs/sidebar-ladder.gif` | row hover 4% against committed 8%, and 8% → 10% when the committed row is pointed at |
| `.dump/app/qa/gifs/sessions-icons.gif` | the sessions cluster as it stands today |

`scripts/qa/probe-motion-tokens.cjs` closes the loop the sweep opened: a source edit is not
evidence, and Tailwind's arbitrary-value syntax fails *silently*, so the probe drives a real
pointer onto real controls and reads the resolved `transition-timing-function` and
`transition-duration` off the element. All three sampled controls resolve their spring with
`background-color` among the animated properties.

### 11.5 The open question on the sessions cluster

Measured, the four session icons are **not** missing a hover state. 
`scripts/qa/probe-hover-visibility.cjs` composites the fill against the panel behind it and
reports a delta of **8 channel units** for every one of them, which is above the threshold
where a fill stops reading on an uncalibrated display. What they are missing is a
*midpoint*: the app's ladder rule is "hover fills halfway toward the state the click
commits", and a momentary action commits nothing persistent, so there is nothing to be half
of. Search and New chat inherit the row value (4%) by adjacency rather than by reasoning.

Two readings are defensible and they lead to different code, so this one is being put to the
user rather than guessed at. See the question at the end of round 6.

---

## 12. Round 6b, the button rung

The open question in §11.5 was answered from the research rather than from taste, and the
answer turned out to be a larger finding than the four icons that raised it.

### 12.1 What was actually wrong

Measured, the sessions cluster was **not** missing a hover state. `probe-hover-visibility.cjs`
composites a control's fill against the panel behind it and reports the change in channel
units, and all four icons came back at **Δ8**, present, and right at the threshold where a
fill stops reading on an uncalibrated display. That is why the complaint ("hovering does
nothing") and the token audit ("the hover state exists") could both be true at once: the
audit was counting a value, not a visible change.

The cause was that the app gave a **button** and a **row** the same fill. A full-width row at
4% white across 200-odd pixels is a legible wash; a 28px icon at 4% has about a fourteenth of
the area and lands at Δ8. Two shipping systems draw this line the same way:

| | button | row |
|---|---|---|
| Material 3 state layers | hover **8%**, press 10%, for *every* variant, filled, outlined, text or icon | list items sit below |
| macOS (per the platform design skill) | toolbar icon button `.label.opacity(0.08)` | sidebar row 0.06, list row 0.04 |

So the line is not "icon versus text" but "button versus row". `--icon-hover` was
therefore named `--btn-hover` before it shipped: a ghost **text** button and a ghost **icon**
button are the same control with different contents, and both take the button rung.

### 12.2 The ladder, and why the committed rung had to move too

```
row:     0  →  hover  4%  →  selected  8%  →  selected + hover 10%
button:  0  →  hover  8%  →  open     12%  →  open     + hover 14%
```

`--btn-open` is 12% and not 8% because a hover fill equal to the committed fill is exactly the
defect the row ladder was built to avoid (`microsoft/fluentui#4992`): the user cannot tell "I
am pointing at this" from "this one is open", and the control has spent its only state before
the click arrives. Both ladders keep the shape, every step above the one before it, nothing
inert.

### 12.3 Scope, and how it was kept honest

84 button-rung sites and 78 row-rung sites, classified explicitly in
`scripts/qa/classify-hover-rungs.py`, a judgment per site, because no heuristic can tell a
toolbar button from a tree row. The script also **audits its own work**: it fails loudly if a
row site moved or a button site was missed.

Three findings the per-line sweep could not see, all of them the same class of bug:

- `features/agent/chrome.tsx`'s panel-toggle `Btn`, the app's most important control, had
  its class split across lines, so the scan skipped it entirely.
- The expanded **"New Chat" nav row** had no row classes at all. It was inheriting whatever
  `variant="ghost"` happened to carry, which means it silently followed the button rung the
  moment the two were separated. It now states the row ladder for itself, as its collapsed
  twin `NavItem` does.
- `components/ui/collapsible-nav.tsx` hand-rolled the same idea with the wrong numbers at
  both ends, hover at 60% of a 4% fill (2.4%, below the visible threshold) and commit at 4%
  (making hover and committed equal). It is on the row ladder now.
- Six sites were on `hover:bg-panel-hover/60`, i.e. a hand-rolled 2.4%: below the threshold
  and on no rung. All moved to `--row-hover`.

`--panel-hover` survives, but only for `data-[state=open]`, `focus:` and `data-[state=unchecked]`
fills. Every hover fill in the app is now on one of the two ladders: **zero** legacy hover fills.

### 12.4 Enforcement, and a test that was lying

Four new cases in `tests/ui/sidebar-state-ladder.test.ts` (9 total): the button ladder ascends
above the row ladder, no hover fill ever equals its committed fill, every icon-only button is
on the button rung, and no hover fill is written against the legacy alias.

The first version of the icon-button check **scanned single lines**, and a mutation test proved
it was useless: pushing an icon button back to the row rung left the suite green, because
`size-7` and `items-center` sit on different lines from the hover class in a `cn(...)` block, 
which is how most of this app is written. It now reads the enclosing `className` expression.
Four mutations (single-line and multi-line icon buttons, the legacy alias, and equalised hover
and committed tokens) each fail exactly the intended test.

### 12.5 Measured result

`probe-hover-visibility.cjs`, before and after:

| control | before | after |
|---|---|---|
| Search / Filter / Sessions actions / New chat | Δ8 | **Δ17** |
| sidebar nav row (a row, correctly) | Δ8 | Δ17 → restored to the row rung |
| sidebar + terminal toggles | Δ8 | **Δ17**, and no longer inconsistent with each other |

---

## 13. Round 6c, auditing my own work to the same bar

The crash screen was rebuilt because it had been designed at hero size and shipped at 56px.
That is a class of mistake, not an incident, so every glyph and mark drawn by hand for this
work was put through the same test: `scripts/qa/shot-glyphs.cjs` renders each one both
magnified and at the size it actually renders in, on one sheet.

### 13.1 What the audit found in the glyphs

**Nothing wrong, after a false alarm worth recording.** The first pass looked like a serious
defect: the workspace toggle appeared as a solid white blob and the terminal toggle as a fine
outline, i.e. the same control rendered at wildly different weights. That reading was wrong.
Rendering all five glyph/state combinations side by side showed the real structure:

| glyph | state | renders as |
|---|---|---|
| terminal | closed | outline + 1-unit horizontal seam |
| workspace | open | solid rail on the right + 1-unit frame, wall cut out |
| workspace | closed | outline + vertical seam |
| terminal | open | solid rail on the bottom + 1-unit frame |
| sidebar | open | same as workspace-open, in the muted tone |

That is Fluent's Regular-for-closed / Filled-for-open convention, reproduced to the pixel, and
the "blob" was the open rail. The near-square frame with a coloured element at its top-right
reading as a camera was a real problem, but it was in the **crash mark**, not the toggles, and
§11.6 had already fixed it by making the frame landscape.

The lesson is the same one that produced the audit: at 900% nearest-neighbour magnification a
1.14px frame stroke and a 7.4px rail look like the same kind of mark, and only a sheet showing
all of them at once makes the difference legible. The sheet is now a committed tool so the
next person does not have to re-derive any of this.

### 13.2 What the audit found in the motion, which was a real bug

`probe-springs.cjs` prints what the engine actually runs, and it caught one:

```
bettershape-popover-out   90ms   linear    div.bettershape-popover-content
```

The dismiss was declared as `animation: bettershape-popover-out var(--dropdown-close-dur)
var(--dropdown-ease)` with `--dropdown-close-dur: 90ms` and `--dropdown-ease: var(--spring-tap)`.
`--spring-tap` settles in 140ms, so the curve was **truncated at 64% of its settle**: the
element is cut off mid-flight and the remaining 7% of the fade pops when the animation is
removed. That is the exact defect the pairing rule exists to prevent, and the file was
hand-picked rather than taken from the token.

Fixed by pairing it with its own settle time (`var(--spring-tap-dur)`, 140ms). A dismiss is
still over before anyone watches it, and the curve now completes.

### 13.3 The guard that should have caught it twice and didn't

This is the more useful finding. `tests/ui/spring-tokens.test.ts` already had a pairing check,
and it missed the bug, twice, at two levels:

1. **Line scope.** The check read a six-line window around `ease-[var(--spring-X)]`, i.e. it
   only understood Tailwind classes. A CSS `animation:` shorthand was invisible to it.
2. **Indirection.** After being widened to CSS shorthands it *still* missed the bug, because
   the spring is two hops away: the shorthand references `var(--dropdown-ease)`, which is
   declared as `var(--spring-tap)`. A textual search for a spring easing inside an
   `animation:` line can never see that, and most of `transitions.css` is written with this
   kind of alias.

The check now parses every `--name: value` declaration in the stylesheet, resolves custom
properties recursively, and compares the duration a shorthand ends up with against the settle
time of whichever spring its easing traces back to. The mutation that reintroduced 90ms now
fails with a precise message:

```
app/transitions.css:148 runs --spring-tap (settles in 140ms) for 90ms
```

Both rounds of this are worth keeping in mind: a source-level motion check that passes is not
evidence until it has been shown to fail, and the failures to look for are the ones your own
check's shape makes invisible.

### 13.4 Verified state of the whole system

`probe-springs.cjs` (v3, run for the first time in this round), against the live app:

```
1. TOKENS      6/6 linear(), 65 stops, accepted by CSS.supports as transition AND animation
               durations .14 / .18 / .24 / .319 / .255 / .458s
4. PANEL RAIL  rest=0  hovered=0.5  released=0  midpoint-holds=true
2. ENGINE      aside.relative: border-right-color + width, both 180ms on the spring
3. PACING      median 16.7ms, p95 16.8ms, worst 16.8ms, frames over 25ms: 0
```

Suite: **119 files / 969 tests passing**; `tsc --noEmit` clean; eslint clean on every file
touched this round.
