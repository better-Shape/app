# Visual stress campaigns and upstream issue verification

This guide is binding for broad UI, layout, streaming, markdown, editor, git, and cross-route work. Read it alongside `AGENTS.md`, `DESIGN.md`, `engineering/design-system-baseline.md`, and `engineering/deep-refinement-protocol.md`.

## Why baseline suites are not enough

Unit tests in `tests/` and the three `1280x720` snapshots in `e2e/visual.spec.ts` do not catch narrow-window clipping, wide GFM table bleed, mid-stream sanitizer corruption, tall composer overflow, off-screen Radix menus, or standalone `/popout` provider crashes. Broad UI, layout, streaming, markdown, editor, git, or cross-route changes must run a Playwright Chromium visual stress campaign combining wild adversarial inputs with failure-mode scenarios from comparable repositories when external network access is authorized or local repository sources when it is not, then inspect the rendered pixels directly and fix root-cause classes before pushing.

## Protocol

1. **Run iterative research rounds within network rules.** When external network access is authorized, query shipped peer products, upstream documentation, and real open and closed UI or layout issues across comparable repositories such as `zed-industries/zed`, `microsoft/vscode`, `continuedev/continue`, `cline/cline`, `RooCodeInc/Roo-Code`, `CherryHQ/cherry-studio`, `open-webui/open-webui`, `Mintplex-Labs/anything-llm`, `janhq/jan`, and `chatboxai/chatbox`, repeating research rounds as new failure modes appear. When external network access is not authorized, derive failure-mode scenarios from local `tests/`, `e2e/`, `.dump/`, and `git log`, and document that external research was not authorized.
2. **Build the static preview export.** Run `npm run build:preview` and serve the static output or run `npm run dev:browser`. Only `/`, `/branch`, `/git`, `/popout`, and `/settings` exist in the static export; open standalone files via `/popout?file=<path>` because `/editor` returns HTTP 404.
3. **Seed preview state through supported fixtures.** Select a bundled seed mode such as `"welcome"` or `"project"` via `window.__BETTERSHAPE_PREVIEW_SEED__` in an init script or `?seed=project` before page scripts run, as `e2e/fixtures.ts` does. Use `window.__BETTERSHAPE_PREVIEW__` only to inspect `seed`, `invokes`, `unknownCommands()`, and `clearInvokes()`, never set `window.__TAURI_INTERNALS__` before `installBrowserPreviewMocks()`, and extend `lib/preview/tauri-mock.ts` when permanent coverage requires a new modeled IPC shape.
4. **Execute two scenario waves across viewports and zoom levels.** Sweep `340x560` split panes, `1280x720` defaults, `2560x1440` wide desktops, short `1024x340` windows, scaled font sizes, and open popovers or dialogs:
   - **Adversarial wave:** unbroken tokens and URLs, deep paths, CJK and RTL and combining marks, 200-line pastes and 18 attachment chips in the composer, 12 to 20 column GFM tables, mid-stream partial fences and tables and math, multi-hunk diffs, cramped split panes, and menus near viewport edges.
   - **Issue-reproduction wave:** concrete BetterShape reproductions of layout, clipping, overflow, wrapping, table, diff, status-bar, menu, and settings failure modes gathered in step 1.
5. **Pair DOM geometry probes with pixel inspection.** Probe `scrollWidth > clientWidth` horizontal bleed, mid-word clipping at container edges, overlapping interactive controls, off-screen menus, and zero-sized boxes, then render contact sheets and full-resolution PNGs in `.qa-artifacts/` and read the images directly. Automated probes miss visual slop and flag intentional horizontal scrollbars, so only human or vision review of the screenshots confirms a pass. Keep scratch scripts and screenshots out of Git.
6. **Fix root-cause classes end to end and lock regressions.** Trace every defect across renderer components, CSS container queries, Tauri IPC payloads, and `src-tauri/` config structs. Re-run the full scenario matrix to zero defects, add permanent regression coverage in `tests/` and `e2e/`, preserve `e2e/visual.spec.ts` baselines, scan `git diff <base>...HEAD --unified=0 | node scripts/ci/check-secrets.mjs`, and pass the full Verification Gate before pushing.

## Evidence from PR 53

On branch `arena/c0114966-app` in [PR 53](https://github.com/better-Shape/app/pull/53), commits `1b8d0ce18e18670df1ad52970b48942561479514`, `b3fdd4ac6ea454d6aad0b0c130b6a346572875e3`, `c0ad8e12b0ec637c523bd92ddd51efeb4cdcb726`, and `0c6f3fea589c92d746b2cad020bb3b0099a68c9f` ran 265 Chromium scenarios across 150 adversarial cases and 115 scenarios derived from 300 upstream issues after unit and baseline E2E suites were already green.

| Defect class uncovered by the 265-scenario run | Root cause | Fix verified in `tests/features/layout-resilience-and-stream-tables.test.tsx` and `e2e/responsive-resilience.spec.ts` |
| --- | --- | --- |
| `/popout?file=...` crashed in standalone and browser-preview windows | `app/popout/popout-page.tsx` rendered workbench components without `installBrowserPreviewMocks()`, `AgentProvider`, or `TooltipProvider` | Wrapped `PopoutPage` in `AgentProvider` and `TooltipProvider` after preview mock bootstrap |
| Pinned `260px` sidebar crushed main workspace below `684px` window width, and status bar clipped right-cluster labels mid-word | `features/agent/layout.tsx` forced the pinned sidebar open regardless of window width, and `features/agent/workbench/status/ui/status.tsx` lacked priority folding | Added `MIN_SIDEBAR_WINDOW = 684` auto-fold with hover and keyboard toggle plus `Escape` dismissal, and `@container/status` ancestor grid centering with secondary-item folding while keeping `1280x720` `workbench.png` identical |
| Streaming duplicate-span repair mangled ASCII tables and hex dumps, and wide GFM tables overflowed chat and Markdown previews | `collapseAdjacentDuplicateSpan` ran inside code fences and pipe rows, `MarkdownPreview` omitted `remarkGfm`, and table wrappers lacked horizontal scroll containment | Guarded `stream.ts` via `mapOutsideCodeFences` plus pipe and box-drawing checks, added `remarkGfm`, and bounded `MarkdownTableShell`, `ChatDataTable`, and CodeMirror `StateField` table widgets |
| 18 attachment chips or 240-line pastes pushed composer controls off `560px` and `340px` viewports, and tall Radix menus clipped at viewport edges | Attachment tray and textarea max heights ignored viewport height, and `DropdownMenuContent` placed `max-h` only on inner scroll areas | Capped attachment tray to `max-h-[min(120px,22vh)]`, bounded composer height against `100dvh`, and applied `--radix-dropdown-menu-content-available-height` on `DropdownMenuPrimitive.Content` and `MorphMenu` |
| Provider `agent` and `commits` model slots updated UI state without reaching Rust `send_chat_message` or `generate_commit_message` | `toRustAiConfig` in `lib/ai/providers.ts` forwarded only `defaultModel`, and `AiProviderConfig` in `src-tauri/src/core/ai_providers.rs` had no `agent_model` or `commit_model` fields | Added `resolveRoutableFeatureModel` validating tool-use support for `agent`, extended `AiProviderConfig`, and wired `generate_commit_message` and non-`Ask` `auto` chat routing |

## Evidence from PR 57

On branch `arena/0de22628-app` in [PR 57](https://github.com/better-Shape/app/pull/57), a 249-scenario Chromium campaign ran against the current head: 212 adversarial scenarios and 37 reproductions of 55 upstream issues from `open-webui/open-webui`, `CherryHQ/cherry-studio`, `continuedev/continue`, `cline/cline`, `RooCodeInc/Roo-Code`, `chatboxai/chatbox`, `Mintplex-Labs/anything-llm`, `janhq/jan`, `zed-industries/zed`, and `microsoft/vscode`. Each scenario recorded DOM geometry probes, axe WCAG 2.2 AA serious and critical violations, console and page errors, unmodeled IPC commands, and a screenshot reviewed on contact sheets. Fully clean scenarios rose from 8 to 196 of 249 after these fixes; every remaining signal was classified below.

| Defect class | Root cause | Fix and regression lock |
| --- | --- | --- |
| Project-seeded workbench failed six axe rules, and the audit never saw it | `e2e/audit.spec.ts` crawled `/` only with the welcome seed | Named CodeMirror surfaces (`editorContentLabel`), labelled the status-bar format button, made breadcrumb separators presentational `<li>`, rendered the compact editor trail without an empty `role="menubar"`, and moved tab close to Delete plus an `aria-hidden` glyph; the audit now crawls a `workbench` route with an empty baseline |
| Unmodeled IPC failed silently in the preview | `get_chat_incognito`, `index_project`, and `set_diagnostics` had no `lib/preview/tauri-mock.ts` handlers | Backend-parity handlers, `tests/preview/tauri-mock.test.ts`, and an audit gate that fails any route calling an unmodeled command |
| Right-to-left replies and input rendered left-to-right | Chat blocks, user text, and the composer had no direction and used physical spacing | `dir="auto"` with logical utilities, locked by `tests/ui/bidi-and-list-semantics.test.tsx` |
| Menu group labels, task checkboxes, wide table scrollers, and dense Git rows failed axe | `text-muted` measured 4.36:1 on menus, task inputs had no name, scrollers had no focusable content, and `h-7` rows rendered 22.75px under the 13px root | `text-secondary` labels, named task inputs, focusable named table scrollers, and the `--target-size-min` floor on Git rows and session-row actions |

Classified as non-defects: link-chip favicon requests to third-party services failing in the offline sandbox, the commit-message generator overlaying its textarea by design, the animated session-row action reveal, Radix hiding the page behind an open modal context menu, and viewports below each window's native minimum (main `1000x500`, settings `720x480`, popout `480x320`, root font fixed at 13px).

A follow-up sweep opened the states the route crawl never reaches: every workbench tab kind, the
terminal dock, all twenty settings sections, the command palette, and the diff a Git change row
opens. Each held failures the crawl could not see: terminal tabs outside a tablist with nested close
buttons, a commit graph listbox holding a list, thirty icon buttons with no name and thirteen named
only by a `title` the app strips, a delete button nested in a palette row, undersized Legal links,
and Stage and Restore actions that failed target size once the diff text under them became
focusable. The findings, fixes and locks are in
[`.dump/app/audits/cumulative-acceptance-ledger-2026-11-05.md`](../.dump/app/audits/cumulative-acceptance-ledger-2026-11-05.md),
and the sources behind them in
[`.dump/app/research/workbench-accessibility-and-bidi-research-2026-11-05.md`](../.dump/app/research/workbench-accessibility-and-bidi-research-2026-11-05.md).
`e2e/panel-state-accessibility.spec.ts` keeps the settings, palette and Git diff states under axe.

A keyboard pass then found that most buttons drew no focus ring, and that five dialogs opened
without a trigger button dropped focus to the page when they closed.
`e2e/keyboard-focus-visibility.spec.ts` walks four windows with Tab and fails on any button
without an indicator, and `e2e/dialog-focus-return.spec.ts` closes each of the five dialogs
with Escape and checks where focus lands.

## Rejected approaches

- Setting `window.__TAURI_INTERNALS__` before `installBrowserPreviewMocks()` executes causes `lib/preview/tauri-mock.ts` to assume native Tauri is present and skip mock registration.
- Implementing CodeMirror 6 multi-line GFM table replacements inside `ViewPlugin` throws a runtime error because `Decoration.replace` with `block: true` is permitted only from a `StateField`.
- Indexing plain `{}` objects by dynamic file paths in `features/chat/lib/proposed-edits.ts` triggers CodeQL `js/remote-property-injection` when large PR diffs disable CodeQL diff-range filtering; store dynamic keys in `Map` instances instead.
- Committing literal `sk-` prefixed strings of 20 or more characters in unit tests trips `scripts/ci/check-secrets.mjs` in `Check Large Files & Secrets`; build test placeholder strings dynamically at runtime.
- When a sandbox restart resets `.git/HEAD` to the base commit `ae262b9b0997a84f20957ac7436e72fdf602759f` while workspace files remain at the pushed tip `c0ad8e12b0ec637c523bd92ddd51efeb4cdcb726`, verify `git merge-base --is-ancestor HEAD origin/arena/c0114966-app` and `comm -23` on untracked files before running `git reset --hard origin/arena/c0114966-app` so no local work is lost.
- Overriding `get_chat_generation_state` with partial content does not render a live turn. Drive streaming through the mocked event bridge instead: `plugin:event|emit` with `chat_started`, then `chat_token` chunks for the viewed conversation.
- Waiting on a Playwright selector list such as `#app-root, body > div` resolves to the first match in document order, and a zero-height first match never becomes visible. Wait for `html[data-bettershape-preview]` and a non-empty route root.
- Geometry probes that require `text-overflow: ellipsis` flag the design system's mask-fade truncation, and overlap probes on raw bounding boxes flag controls scrolled out of their container. Accept gradient masks and clip rectangles by every scrolling ancestor.
- A Tab walk stalls in two places. CodeMirror keeps Tab for indentation until Escape is pressed, and the terminal sends Tab to the shell and never gives it back. Press Escape when focus lands in `.cm-content`, and open the terminal only after the walk, or reach its tabs from earlier controls.
- Naming a control with `title` alone does not work in this app. `SuppressNativeTooltips` moves every `title` to `data-native-title` on the first pointer move and on focus, so the control is unnamed by the time assistive technology reads it. Use `aria-label`.
- Making text focusable without checking what floats over it. axe treats any focusable element with a widget role as a pointer target, so focusable read-only diff text turned the 22.75px actions above it into target-size failures.
- A `ui-capture` `type` step with a `selector` clicks the centre of the field first, which drops the caret into existing text. To append, `press` End and then `type` without a selector.
- ESLint 9 no longer ships the `unix` formatter, so `-f unix` exits with an error unless `eslint-formatter-unix` is installed; use the default formatter or JSON.
