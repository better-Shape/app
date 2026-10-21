# Deep refinement pass — 2026-10-21

Durable conclusions from the review-and-debug turn on `draft/mega-absorb-all`
(+ the four deep-refinement features). Evidence, not narrative.

## Fixed

### 1. Performance HUD failed its own a11y audit

`e2e/audit.spec.ts` crawled every route with the HUD mounted (dev default) and
failed all five with an identical pair of violations:

```
color-contrast (serious), 3 node(s)   #71717a at 10px on the composited #050505
target-size (serious), 1..5 node(s)   # header buttons, 16px tall
```

`e2e/a11y-baseline.json` allows `{}` for `/popout`, so the HUD was the only
source. Fixed in `lib/dev/perf-hud-overlay.ts`:

- opaque `#111113` panel (axe cannot composite a translucent panel over an
  unknown backdrop; the readout no longer depends on what is behind it)
- `MUTED = #a1a1aa` (7.4:1) replaces `#71717a` (3.7:1), 11px type
- both header buttons are 24x24 minimum, each has its own `aria-label`
- `role="complementary"` + `aria-label="Performance HUD"`
- `pointer-events:none` on the panel, `auto` only on the header strip, so a HUD
  parked over the terminal or status bar cannot eat input

Verified with a focused axe probe: `/popout` 0 serious violations (was 4),
`/` 0, `/settings` 1 (pre-existing, allowed by baseline).

### 2. `npm run lint` crashed after any QA run

```
RangeError: Invalid string length
  at text-table.js -> stylish formatter
```

ESLint linted `playwright-report/` and `test-results/`, both written by
`npm run qa` / `npm run test:e2e` and both gitignored, but neither was in
`globalIgnores`. The HTML reporter ships a minified trace viewer, so the output
table grew past V8's max string length. Added both to `eslint.config.mjs`
ignores. Lint is 0 errors / 159 warnings again.

## Found, deliberately not changed (needs a human decision)

### `/settings` hydration mismatch is pre-existing

`audit settings` fails on a console error: React reports that the server HTML
and the client disagree on `title` / `data-native-title` for the provider
"test" buttons. Cause: `components/ui/suppress-native-tooltips.tsx` strips
`title` from the DOM in a mount effect, which runs before a deferred subtree
hydrates, so hydration sees a mutated attribute.

Proof it is not from this branch: reverting only `app/client-layout.tsx` to
`HEAD` (no HUD mount, no cheat sheet mount) reproduces the identical console
error. Both implicated files are untouched by the branch.

Proposed fix (not applied): stop mutating the DOM eagerly; keep the
`mouseover`/`focusin` strip, which is enough to suppress the native bubble
before it appears, and drop the eager tree walk plus the attribute observer.

### Global shortcuts are only mounted by the workbench titlebar

`useKeyboardShortcuts()` lives in
`features/agent/workbench/titlebar/ui/titlebar.tsx`. The browser preview renders
no titlebar (`document.querySelectorAll(".titlebar-container").length === 0`),
so *no* global shortcut fires there, including `Ctrl+K Ctrl+S`. The cheat sheet
is reachable regardless: `F1` -> "Keyboard Shortcuts" -> `Enter`, or the
`bettershape-open-shortcuts` event. Proposed (not applied): mount the hook in
`app/client-layout.tsx` instead of the titlebar.

## Measurements

- `out/` contains no `Collapse performance HUD` string: the overlay module is
  dead-code eliminated from production. `lib/dev/perf-hud.ts` (the store) does
  ship (29 KB raw, ~1.1 % of the 2,572 KB initial script payload) because
  production can opt in through `localStorage["bettershape-perf-hud"] = "1"`.
- Visual baselines absorb the dev HUD: it covers 0.30 % of `/settings` and
  0.23 % of `/` at 1440x900, under the 2 % `maxDiffPixelRatio`. Running
  `test:e2e:update-snapshots` in dev would bake it into the PNGs.
- `cargo check --all-targets` 8m36s, `cargo clippy --all-targets -- -D warnings`
  4m14s, both exit 0, using the `vendor/sandbox-toolchain` pin `7c4c878`.

### 3. Cheat sheet said the wrong number while filtering

The header printed the total ("40 bound") even when the list showed two rows.
It now reads "2 of 40 bound" while a query is active, and the plain total
otherwise. Row `title={binding.when}` and the "Custom shortcut" `title` were
dead code: `components/ui/suppress-native-tooltips.tsx` strips every `title`
attribute from the document on mount, so the custom-binding accent had no text
equivalent for assistive tech. Replaced with an `sr-only` prefix.

### 4. Terminal find bar gave no announcement

Enter moves the active match without moving focus, so a screen-reader user got
no feedback. The match counter (`1/2`, `0/0`) is now `aria-live="polite"`.

## Measurement traps (do not repeat)

- **xterm renders to a canvas.** `locator(...).innerText()` on
  `[data-terminal-root]` returns only the tab titles, never the buffer text.
  Assert on the canvas pixels (screenshot) or on `term.buffer.active`; reading
  DOM text made a working scrollback restore look broken for a whole round.
- **Playwright `page.goto` has no default 30s grace under load.** Two runs
  failed with `ERR_CONNECTION_REFUSED` / `Timeout` because a second dev server
  was compiling on 2 cores; the app was fine.
- **`npm run lint` includes `playwright-report/`** until the ignore fix above
  lands; the crash hides the real warning list.

## Browser evidence (dev server, seeded project)

- perf HUD: `data-perf-hud` present on `/`, `/settings`, `/popout`; 264x99;
  axe serious/critical inside the panel: 0.
- cheat sheet: opens from the `bettershape-open-shortcuts` event and from
  `F1` -> "Keyboard Shortcuts" -> Enter; 103 `<kbd>` nodes, filter reduces
  them, Esc closes.
- terminal: `Ctrl+F` -> "HISTORY" reports `1/2`, Enter -> `2/2`, gutter text
  `0/0` for no match, Esc closes. Restore shows the old lines followed by
  `── restored from previous session ──`.
