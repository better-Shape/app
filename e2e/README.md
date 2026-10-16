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
| `npm run test:e2e` | Playwright suite; auto-starts `dev:browser`. First run on a new machine: `npx playwright install chromium`. Where the browser CDN is blocked, use the vendored tree instead, see the sandbox section below. |
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

Use the vendored tree first. The orphan branch `vendor/sandbox-toolchain`
carries the Chrome for Testing build `playwright-core` pins, 156.0.8078.4,
already laid out the way Playwright expects, with the shared-library closure
it needs. Fetch the payload as `engineering/sandbox-vendored-toolchain.md`
describes, reassemble the split assets (the browser tarball ships in three
parts), and verify the manifest. That recipe prints the private root it
created; export the printed path as `SV` in this shell, because the block
refuses to guess a root and a fixed default would name a directory the recipe
never created. The block then extracts the browser tree into a private
directory of its own and runs the suite:

The commands below run from the application checkout, so every payload step stays inside a
subshell and the `npm` commands run where `package.json` is:

```bash
set -euo pipefail                     # a failed checksum stops the block here
SV="${SV:?export SV to the payload root printed by the fetch recipe}"
(
  cd "$SV"
  for f in $(grep -o '^[a-f0-9]\{64\}  .*\.part-00$' MANIFEST.sha256 | sed 's/.*  //; s/\.part-00$//'); do
    cat "$f".part-* > "$f"
  done
  sha256sum -c MANIFEST.sha256
)

PB="$(mktemp -d)"                     # private tree: a fixed /tmp path can be pre-created as a symlink
trap 'rm -rf "$PB"' EXIT              # removed on exit whether the suite passes or fails; drop this line to keep it
tar xJf "$SV/browsers/browsers-playwright-1.64.1.tar.xz" -C "$PB"
export PLAYWRIGHT_BROWSERS_PATH="$PB"
export PLAYWRIGHT_SANDBOX_LIBS="$SV/chrome-deps/cft-156"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
npm run test:e2e
```

`PLAYWRIGHT_SANDBOX_LIBS` points at the NSS/NSPR closure from the same
payload and is applied to the browser launch only, so the dev server never
inherits it. Keep it that way: an exported `LD_LIBRARY_PATH` over that
directory reaches every child process, which is not the same thing. A browser
launched directly, outside Playwright, needs `LD_LIBRARY_PATH` on that one
command instead, because no config is involved.

That path was verified against this suite: 6 of 6 smoke specs on Chrome for
Testing 156.0.8078.4, with `PLAYWRIGHT_SANDBOX_LIBS` set and no exported
`LD_LIBRARY_PATH`.

When you hand in a browser instead, give `PLAYWRIGHT_CHROMIUM_PATH` the
headless shell from the same tree,
`chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`.
That is the binary Playwright's own layout resolves to in headless runs, and
it passed the same 6 of 6 here. The full `chromium-1248/chrome-linux64/chrome`
build starts and answers `--version` but exits mid-run on this host, so it is
not the one to point the suite at.

`playwright.config.ts` also resolves Chromium itself, in this order:
`PLAYWRIGHT_CHROMIUM_PATH` → Playwright's downloaded browser →
`@sparticuz/chromium`, an npm-hosted build for networks where the Playwright
CDN is blocked. If the host lacks Chromium's system libraries
(libnss3/libnspr4), set `PLAYWRIGHT_SANDBOX_LIBS` to a directory containing
them. It is prepended to `LD_LIBRARY_PATH` for the browser process on all
three paths, so a browser handed in through `PLAYWRIGHT_CHROMIUM_PATH` needs
it exactly as much as the npm fallback does. Registered npm hosts are not the
only source: `engineering/sandbox-vendored-toolchain.md` records where the
libraries come from, with hashes, for both the vendored and the npm build.

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
