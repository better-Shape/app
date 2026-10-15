# Browser Preview & Agent QA Suite

Playwright tests that run the **full BetterShape UI in a real browser** with
the Tauri backend replaced by a deterministic mock. They exist so that:

- **humans** can launch and click through the whole app locally without
  compiling Rust (`npm run dev:browser`),
- **agents** can run QA headlessly. The suite crawls every route, catches
  console/page errors, scans accessibility, screenshots UI state, and
  asserts behaviour (`npm run qa`).
- **PR reviewers** get a deployable static preview of the change
  (`.github/workflows/preview.yml`, Vercel-ready via `vercel.json`).

Contributor-facing docs: `docs/developing/browser-preview.mdx`.
This file is the operator/agent runbook.

## Commands

| Command | What it does |
|---|---|
| `npm run dev:browser` | Next dev server (port 48921) with mocks on. Open `http://localhost:48921`, add `?seed=project` for the fake open project. |
| `npm run test:e2e` | Playwright suite; auto-starts `dev:browser`. First run on a new machine: `npx playwright install chromium`. |
| `npm run qa` | Full suite + a compact pass/fail summary for agents (`scripts/qa/run-qa.cjs`). Exit code = Playwright's. |
| `npm run qa:audit` | Only the route crawl (`e2e/audit.spec.ts`): axe scan + screenshot + console/IPC inventory per route. |
| `npm run test:e2e:ui` | Playwright UI mode for debugging selectors/flakes interactively. |
| `npm run test:e2e:update-snapshots` | Regenerate `@visual` baselines. Review the image diff like code. |
| `npm run build:preview` | Production static export with mocks on → `out/` (what Vercel deploys). |
| `npm run preview:browser` | Serve `out/` on port 48921 (`scripts/qa/serve-static.cjs`). |
| `E2E_STATIC=1 npm run test:e2e` | Run the suite against the static bundle instead of the dev server (CI/preview mode). |

Reports: `playwright-report/index.html` (human), `test-results/results.json`
+ per-test traces/screenshots (agents/tooling).

## How it works

```
lib/preview/tauri-mock.ts     Fake IPC backend + installer (shipped code, inert by default)
app instrumentation-client.ts Calls the installer before first paint
e2e/fixtures.ts               Seed modes, console/pageerror guards, route table
e2e/*.spec.ts                 smoke / welcome / settings / git / workbench / audit / visual
playwright.config.ts          Server lifecycle, browser resolution, reporters
```

**Mock design.** The installer uses the official `@tauri-apps/api/mocks`
bridge (`mockIPC` / `mockWindows` / `mockConvertFileSrc`) with a handler
that serves a seeded fake project (`/preview/bettershape-demo`: file tree,
README/App.tsx contents, Git branches+log, one chat) and returns safe
defaults for everything else. State mutations (`set_project_path`,
`open_file`, …) update observable state and emit `project-state-update`
events, so flows behave like the desktop app. Every invoke is recorded on
`window.__BETTERSHAPE_PREVIEW__` (`invokes`, `unknownCommands()`); the
audit spec reports commands that still hit the fallback, which is the
backlog for growing fixture fidelity.

**Safety gates.** Mocks install only when (1) the build was made with
`NEXT_PUBLIC_BROWSER_PREVIEW=1` (only `dev:browser`, `build:preview`, and
preview CI do this) **and** (2) no real Tauri runtime is present. A Tauri
release build can never be mocked; `npm run tauri:build` is unaffected.
Seed data is obviously fake; the preview has no model keys and must never
be given any.

**Seeds.** `seedMode: "welcome"` (default: welcome screen + one recent
project) or `"project"` (workbench open on the fake project). Per-test:
`test.use({ seedMode: "project" })`. Manually: `?seed=project` in the URL.

**Selectors.** The app has no test-id convention; specs use roles and
visible text (which doubles as an accessibility signal). One exception:
`data-testid="welcome-screen"` scopes the welcome cards (the sidebar has a
same-named "Connect GitHub" button).

**Accessibility gate.** `e2e/a11y-baseline.json` pins today's
critical/serious axe counts per route; the audit fails only on new or
increased violations. Lower the numbers as debt is fixed, and never raise
them silently.

**Visual baselines.** Committed under `e2e/visual.spec.ts-snapshots/`
(Linux/Chromium). Time is frozen via Playwright's clock. They run in the
local suite but are excluded from CI (`--grep-invert @visual`) until
CI-generated baselines replace them; OS font rendering differs.

## Known noise (recorded, not hidden)

- `/settings` logs one React hydration-mismatch error in dev about a
  `Button` `title` attribute: the native-tooltip suppression rewrites
  `title` → `data-native-title` on the client only, so SSR HTML and first
  client render differ. The audit records it; it is deliberately **not**
  in the fixtures allowlist. Fix is to apply the same rewrite during SSR
  or render `data-native-title` on both sides.
- React DevTools / Fast Refresh console chatter is allowlisted in
  `fixtures.ts` (environmental, not app code).

## Sandboxed / CI environments without browser downloads

`playwright.config.ts` resolves Chromium in this order:
`PLAYWRIGHT_CHROMIUM_PATH` → Playwright's downloaded browser →
`@sparticuz/chromium` (npm-hosted build, for networks where the Playwright
CDN is blocked). If the host lacks Chromium's system libraries
(libnss3/libnspr4), set `PLAYWRIGHT_SANDBOX_LIBS` to a directory containing
them; it is prepended to `LD_LIBRARY_PATH` for the browser process only.

## CI

- `ci.yml` → `test-e2e` job: builds the static bundle, runs the suite
  (minus `@visual`), uploads the Playwright report. Additive (not yet in
  the `ci-success` gate), mirroring the `static-macos` precedent.
- `preview.yml` (per PR): same run, then uploads the deployable `out/`
  bundle and the Playwright report as artifacts. It holds no secrets.
- `preview-deploy.yml`: a trusted `workflow_run` subscriber that GitHub
  resolves from the default branch. When `VERCEL_TOKEN`, `VERCEL_ORG_ID`
  and `VERCEL_PROJECT_ID` secrets exist, it deploys the bundle with a
  fixed static-only config and maintains one sticky preview comment.
  Without secrets it skips the deploy and the bundle stays downloadable
  from the build run. It activates only once the file lands on the
  default branch.

## Writing new specs

1. Pick the closest existing spec and copy its shape (fixtures come from
   `./fixtures`, never raw `@playwright/test`).
2. Assert page errors with `expectNoPageErrors()`; treat console errors
   as failures unless the noise is already allowlisted in `fixtures.ts`.
3. Prefer role/text locators. If a component is unidentifiable, add the
   smallest possible stable anchor and say why in the PR.
4. If the UI issues an IPC command the mock gets wrong, extend
   `lib/preview/tauri-mock.ts` (and its Vitest contract in
   `tests/preview/`) instead of working around it in the spec.
5. Tag crawl/visual work `@audit` / `@visual`; keep the default suite fast.
