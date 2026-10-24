# Chat UX design gates and UI capture report, 2026-10-24

## Decision

Ship the chat composer, empty stage, provider setup diagnostics, commit popover geometry, quote selection UI, notification toast redesign, and tool-call block updates on `mega/absorb-all` with all seven delivery gates of `engineering/design-skills.md` verified.

## Design read and dials

Reading this as: desktop coding-agent workbench for technical builders, with BetterShape's dark monochrome surface language (`#111111` to `#2A2A2A` plus `#3946FF` accent), `antislop` dials `ENERGY 1 / RHYTHM 2 / MOTION 2` and `design-taste-frontend` dials `DESIGN_VARIANCE: 5 / MOTION_INTENSITY: 5 / VISUAL_DENSITY: 7`.

## Delivery gates (`engineering/design-skills.md`)

### 1. `antislop` Delivery Gate (Mode 1, `During`)

#### Block 1: Hard Gate

- `R-02` em dash check: PASS. No new user-facing copy or committed record adds an em dash. Existing test-pinned separators (`button[aria-label]` and future-timestamp fallback) remain untouched for contract compatibility.
- `R-03` overflow and responsive reflow: PASS. Verified across `1440x900`, `1200x760`, `1000x800`, `640x800`, and `1000x520` viewports plus `@container/chat` and `@container/workspace` pane queries with zero horizontal overflow.
- `R-17` unsourced statistics: PASS. No marketing statistics exist.
- `R-18` fictional testimonials: PASS. None exist.
- `R-23` unapproved visual assets: PASS. Restored the committed `public/logos/logo_animated.svg` mark from `origin/main` and bundled `thesvg` vendor icons already declared in `package.json`.
- `R-24` broken navigation targets: PASS. `Open Providers` opens `Settings -> Providers` via `openSettings("providers")`, and cross-workbench file chips open real workspace paths.
- `R-25` WCAG AA contrast: PASS. Verified by Playwright axe audits across `/`, `/settings`, and `/git` with zero new violations.
- `R-26` dead controls: PASS. Every button (`Open Providers`, `Check chat`, `Test connection`, `Quote`, `Expand composer`, `Commit`, `Jump to bottom`, `Find in chat`) executes a live handler tested in Vitest and Playwright.
- `R-27` empty, loading, and error states: PASS. Empty chat renders the centered stage and marquee hints; streaming turns render `Eclipse` with `SwapText` status; empty `Check chat` renders an inline `role="alert"` message.
- `R-28` generic FAQ: PASS. Not applicable; no FAQ exists.
- `R-32` keyboard navigation and focus visibility: PASS. Every new control uses `--focus` (`focus-visible`) and supports keyboard operation (`Cmd+F`, `Cmd+Enter`, `Escape`, `ArrowUp`/`ArrowDown` prompt recall).
- `R-33` external monkey-patching: PASS. All styles and behavior live in application source files.
- `R-34` theme consistency: PASS. Dark-only desktop surface rules preserved per `DESIGN.md` rule 3.
- `R-35` live build and click-through verification: PASS. Built static export (`npm run build:preview`), ran `25/25` Playwright E2E tests, and recorded two 30fps `ui-capture` flows exercising the controls.
- `R-36` fabricated claims: PASS. None exist.
- `R-37` direction settled before build: PASS. Built against `DESIGN.md` and `engineering/design-system-baseline.md` with explicit dials above.
- `R-38` fabricated content: PASS. None exist.

#### Block 2: Purpose-Gate

- `R-01` gradients and glows: PASS. Removed `backdrop-blur` glass effects from toasts, quotes, find bar, mentions menu, code headers, and floating pills in favor of opaque `bg-surface-3` and `bg-surface-4` elevation steps. The scroll-edge masks use `mask-image` alpha fades solely to indicate clipped overflow.
- `R-04` icon relevance: PASS. All chrome icons come from `@fluentui/react-icons` through `@/components/ui/icon`, and AI vendor marks come from `thesvg`.
- `R-06` typography purpose: PASS. `Inter Variable` handles UI copy at the `13px` root scale, and `IBM Plex Mono` is restricted to code blocks, diffs, paths, and numeric counters (`tabular-nums`).
- `R-07` background patterns: PASS. None added.
- `R-08` decorative arrows: PASS. Directional chevrons and arrows appear only on disclosures, history steppers, send buttons, and off-screen scroll indicators.
- `R-09` capsule badges: PASS. No decorative badges or eyebrows added; pills are reserved for interactive controls (`Open Providers`, `Quote`, `Jump to bottom`).
- `R-10` glassmorphism cap: PASS. Zero `backdrop-blur` surfaces added.
- `R-12` shadow restraint: PASS. Floating menus, toasts, and pills use `border-border-secondary` plus `shadow-md` or `shadow-lg` only when detached above scrolling content.
- `R-13` simultaneous glow: PASS. Zero colored glow halos used.
- `R-14` identical feature cards: PASS. Starter cards were removed from the empty chat stage so only the animated mark and composer remain.
- `R-19` purposeful motion: PASS. Composer height, collapse rows, and floating pills use tokenized curves from `app/springs.css` and `app/transitions.css` with `prefers-reduced-motion` disables.
- `R-22` generic illustrations: PASS. None used.

#### Block 3: Liveliness

- Dials declared (`ENERGY 1 / RHYTHM 2 / MOTION 2`): YES.
- Output consistent with dials: YES.
- One clear focal point per screen (centered composer on empty stage, active turn and docked composer in thread): YES.
- Structural whitespace (`348px` top / `345px` bottom symmetry at `1440x900`, `16px` mark-to-composer gap): YES.
- One deliberate accent (`#3946FF` reserved for primary actions and active selection): YES.
- Identity motif (`BetterShapeLogo` middle-brick marquee echoed on the empty stage and `Open Providers` action): YES.
- Design Read declared: YES.

#### Block 4: Craftsmanship and Quality Locks

- `C-1` through `C-5`, `R-05`, `R-11`, `R-15`, `R-16`, `R-20`, `R-21`, `R-29`, `R-30`, `R-31`: PASS. Radius hierarchy distinguishes pills (`rounded-full` for compact floating triggers and composer single-line state) from framed panels (`rounded-xl` and `rounded-lg` for multi-line composer, toasts, popovers, and quote cards). Every visual choice maps to a `DESIGN.md` token.

### 2. `design-taste-frontend` pre-flight check

- Copy self-audit, motivated motion, single marquee rule (at most one active marquee on screen when unset), navigation height, semantic icons, no decorative dots or eyebrows, `prefers-reduced-motion` parity, `useEffect` listener/timer cleanup, empty/loading/error states, isolated client interactivity, and single design system: ALL CHECKED AND PASSED.

### 3. Baseline mirror check (`engineering/design-system-baseline.md`)

- Matched rules 1 through 12: semantic color tokens (`bg-surface-3`, `border-border-secondary`, `text-text-secondary`), shared `Button`/`Icon`/`Input`/`Dropdown` primitives in `components/ui/`, dark-only styling, `--focus` rings, `aria-label` on icon buttons and `aria-pressed` on toggles, sentence-case copy, `app/transitions.css` motion tokens with `prefers-reduced-motion`, earned confirmation states (`Check chat` validates before reporting success), matching single-line composer height (`44px`), and compact `140ms`/spring-tap timing on high-frequency controls.
- Deviation considered and rejected: keeping translucent `bg-surface-3/90 backdrop-blur-md` on floating quote pills and toasts. Rejected because `DESIGN.md` encodes elevation through opaque `#111111 -> #2A2A2A` steps rather than frosted glass.

### 4. `unslop` pass on copy

- Checked every added UI string, error message, caption, and engineering record for sentence case, straight quotes, concrete verbs, and zero em dashes.

### 5. Motion check

- Continuous animations (`logo-brick-marquee`, `composer-hint-in`) and spring tokens (`--spring-tap`, `--spring-quick`, `--spring-smooth`) live in `app/transitions.css` and `app/springs.css`, and disable cleanly under `@media (prefers-reduced-motion: reduce)`.

### 6. Accessibility pass

- Verified `role="alert"` on provider validation errors, `role="status"` and `[aria-label="Dismiss notification"]` on toasts, `aria-expanded` on composer expand and message clamps, keyboard focus rings on every interactive control, and `25/25` Playwright + axe checks passing.

### 7. Skill report

- Loaded and applied: `DESIGN.md`, `engineering/design-system-baseline.md`, `engineering/design-skills.md`, `antislop`, `antislop-ui`, `antislop-copywriting`, `antislop-human`, `antislop-code`, `impeccable` (`SKILL.md` and `reference/craft-floor.md` directly; `scripts/impeccable context` refused per execution limits), `design-taste-frontend`, `redesign-existing-projects`, `full-output-enforcement`, `ui-ux-pro-max`, `emil-design-eng`, `ask-sonner`, `apple-design`, `ui-animation`, `ui-verification`, `ui-capture`, and `unslop`.
- Refused per execution limits: network installers, remote image generators, and third-party UI package installs.

## Capture gate evidence

Two 30fps captures were recorded against the static Browser Preview on `http://127.0.0.1:48921/?seed=project` with `.agents/skills/ui-capture/scripts/{capture,encode,validate}.mjs` and inspected frame-by-frame via `review/inspect-sheet.png`, `review/subtitle-strip.png`, and full-resolution step stills:

1. `.qa-artifacts/composer-providers/out.gif`: `1100x697`, `335` frames, `33.33fps` moving rate (`30ms` min frame delay), `62%` active frames, `100%` caption coverage, `1003KB`, `validate.mjs` verdict `PASS_WITH_WARNINGS` (only `tesseract` OCR binary absent; verified visually on `subtitle-strip.png`). Shows clicking `New Chat`, typing three lines into the composer with smooth height morphing and `[Expand]` reveal, clicking `Open Providers` in the bottom-right composer bar, and clicking empty `Check chat` on OpenAI to surface the red inline validation alert.
2. `.qa-artifacts/commit-popover/out.gif`: `1100x697`, `182` frames, `33.33fps` moving rate, `49%` active frames, `100%` caption coverage, `511KB`, `validate.mjs` verdict `PASS_WITH_WARNINGS` (`tesseract` absent; verified visually). Shows opening the `Commit` popover from the titlebar and typing a commit message inside the framed `Message` input with symmetric padding and matched `29.25px` split-button height.

### Sandbox attachment note

Per `.gitignore` and `ui-capture`, `.qa-artifacts/` stays untracked out of Git. As documented in `ui-change-design-gates-and-capture-2026-10-24.md`, GitHub CLI (`gh`) has no binary PR-attachment upload endpoint from this restricted sandbox, and `gh gist create` rejects binary GIFs. Both validated clips remain in `.qa-artifacts/composer-providers/out.gif` and `.qa-artifacts/commit-popover/out.gif` in the workspace alongside their `review/` sheets, and the PR body describes each recorded step and measurement explicitly.
