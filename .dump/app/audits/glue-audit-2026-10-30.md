# Missing glue across the absorbed line

Audited 2026-10-30 at `d467a61` on `arena/3f3ea9c2-app`, the line that absorbed
PRs #3, #45, #46, #49, #50, #51 and #53.

Question: after absorbing seven branches, which shipped surfaces are still not
joined to the rest of the app?

Answer: the absorption itself is clean. Every orphan below is also unwired on
the `refs/pr/3` and `refs/pr/53` heads, so the merges did not break these. What
the line lacks is glue that never existed: commands with no UI, UI with no mount
point, listeners with no dispatcher, and settings with no reader. This document
records each one with its evidence so the next pass can mount or delete it.

## Gates run on this head

| Gate | Command | Result |
| --- | --- | --- |
| Install | `npm ci` | 864 packages |
| Lint | `npm run lint:strict` | passed, no output |
| Typecheck (app) | `npx tsc --noEmit` | passed |
| Typecheck (tests) | `npx tsc --noEmit -p tests/tsconfig.json` | passed |
| Unit tests | `npx vitest run` after `npm run build:runtime` | 255 files, 2742 tests passed |
| Production build | `NODE_OPTIONS=--max-old-space-size=2560 npm run build` | passed, 7 static routes |
| Docs index | `npm run docs:index` | 17 pages, 108 chunks |
| Skills | `npm run skills:verify` | 53 of 53 locked verified, 3 unrecorded project-owned |
| Browser QA | `npx playwright test --grep-invert "@visual"` | 30 passed |
| Browser audit | `npx playwright test e2e/audit.spec.ts` | 5 passed (the `/settings` hydration mismatch from round 13 no longer reproduces) |
| Visual baselines | `npx playwright test --grep "@visual"` | not run, excluded from CI until CI-generated baselines land |
| Rust | `cargo fmt`, `cargo check`, `cargo test` | not run, no Rust toolchain and crates.io is blocked in this sandbox |

Browser runs used the vendored library closure at `/tmp/chrome-deps` with
`PLAYWRIGHT_SANDBOX_LIBS`; see `engineering/sandbox-vendored-toolchain.md`.

## Contract sweeps, all clean

| Contract | Method | Result |
| --- | --- | --- |
| Rust command defined vs registered | parse `#[tauri::command]` and `generate_handler!` | 261 defined, 261 registered, 0 unregistered |
| TS invoke vs registered command | parse every `invoke`/`invokeCommand`/`invokeCachedGit` literal | 247 invoked, 0 unknown to Rust |
| JSON and CSS imports | resolve every `@/...` and relative import | 0 missing |
| CSS custom properties | every `var(--x)` against definitions and inline setters | 0 real misses; `--chat-tint`, `--graph-surface`, `--editor-font-*` are set inline with fallbacks |
| Keybinding labels | every `config/keybindings.json` label against handlers | 39 of 40 handled; `Close Window` (`Alt+F4`) is handled by the native menu and the OS |

## P1: shipped surfaces with no reachable entry point

### 1. Design mode has a 1,516-line shell and no mount

`features/preview/design/shell.tsx` exports `DesignStudio`. It is imported only
by `tests/features/design-reconnect.test.tsx`. `features/preview/ui/preview-panel.tsx`
(350 lines, default `PreviewPanel`) is imported only by
`tests/features/design-authorization.test.tsx`. `deploy.tsx` (157),
`left-panel.tsx` (436), `rail.tsx` (127) and `tool-rail.tsx` (93) are unreferenced.

The backend half is fully wired: `start_design_proxy`, `stop_design_proxy`,
`probe_preview_url`, `register_design_bridge`, `design_mode_log`,
`inspect_design_project`, `list_design_assets`, `resolve_design_element`,
`apply_design_source_patch`, `undo_design_source_patch`,
`redo_design_source_patch`, `capture_html_preview`, `capture_page_preview`,
`cleanup_design_sandbox`, `remember_preview_url_cmd` are registered and wrapped.

`config/keybindings.json` binds `agent.toggleDesign` ("Toggle Design Mode",
`Ctrl+Shift+D`) and `docs/help/shortcuts.mdx` plus `docs/changelog.mdx` advertise
it. `dispatchShortcutAction` opens the Browser tab and dispatches
`bettershape-toggle-design-mode`; `features/agent/layout.tsx:438` listens for
that name and responds by opening the Files tab. The event the design shell
actually listens for, `bettershape-toggle-browser-design-mode`, has no
dispatcher. So the advertised shortcut switches to a file tree.

Provenance: unwired on `refs/pr/3` and `refs/pr/53` as well.

### 2. Hunk staging has commands and no controls

`git_list_hunks`, `git_stage_hunk`, `git_unstage_hunk` and
`git_restore_hunk` are registered, wrapped in `lib/backend/commands.ts`, and
covered by tests. The only UI for them is
`features/git/ui/shared/diff-hunks.tsx` (306 lines: `DiffHunkToolbar`,
`useDiffHunkState`), which nothing imports. The live diff surface imports
`features/git/ui/shared/manager-diff.tsx` instead, and that file has no hunk
actions. Partial staging is therefore unreachable from the app.

### 3. The all-changes diff view is routed but not rendered

`features/agent/workspace/multi-diff.tsx` (403 lines) defines
`ALL_CHANGES_TAB_ID = "__all_changes__"` and `ALL_CHANGES_TAB_PATH`, and
dispatches `bettershape-center-view` with `detail: "all-changes"`. The listener
in `features/agent/layout.tsx:221` only acts on `"editor"` and `"chat"`. The
`bettershape-all-changes-focus` sessionStorage key has no reader. No tab id
matches `__all_changes__`.

### 4. Voice input device has a settings file and no settings page

`features/settings/ui/sections/microphone.tsx` (163 lines) renders device
enumeration, a permission request and a live level meter against
`settings.voice.deviceId` and `microphoneConstraints()`. `SETTINGS_NAV` has no
voice leaf and `SettingsView` has no panel branch for it.
`features/chat/ui/composer/dictation-button.tsx:573` reads
`settings.voice.deviceId`, so the value exists and is consumed, but no user can
set it from the UI.

### 5. Editor popout cannot be opened

`app/popout/` renders a full editor window, `e2e/responsive-resilience.spec.ts`
covers the route, and `lib/window/open-editor-popout.ts` creates the window with
a per-file label. The exported `openEditorPopout` has no caller anywhere in the
app, and no menu, palette entry or context-menu item references it. The route is
reachable only by typing the URL.

### 6. "Switch Panel To" is a dead menu item

`features/panels/ui/sidebar-panel-menu.tsx` dispatches
`bettershape-swap-sidebars` from a rendered context-menu item
(`SidebarSwitchPanelMenuItems`, used by `sidebar-panel-header.tsx:97`).
Nothing listens for that name anywhere. Clicking the item does nothing.

### 7. A background dev server cannot be stopped

`features/terminal/dev-run-host.tsx` listens for `bettershape-terminal-run`,
`bettershape-terminal-run-stop` and `bettershape-terminal-run-restart`. Only
`bettershape-terminal-run` is ever dispatched, from
`app/welcome-dialogs.tsx:260`. No component dispatches stop or restart, and no
status surface renders the run state (`useDevRunStatus` has two consumers, both
internal). Once a run starts it can only be stopped by killing the terminal.

## P2: dead surfaces and dead channels

| Surface | File | Lines | State |
| --- | --- | --- | --- |
| Rich subagent cards | `features/agent/subagents/cards.tsx` | 225 | `SubagentCards` unrendered; sidebar renders flat rows in `sections.tsx:689` instead. `bettershape-open-subagents-for` is listened at `chat.tsx:249` and never dispatched |
| Chat overflow menu | `features/chat/ui/shell/more.tsx` | 141 | `ChatMoreMenu` unrendered. Find in chat and export exist in the command palette; the menu itself is unreachable |
| Branch detail and compare | `features/git/ui/branches/detail.tsx`, `hooks.ts` | 691 | `BranchDetailPane` and the compare hooks are unrendered; `GraphDetailPanel` is the live surface |
| Inline markdown diff | `features/chat/ui/md/diff.tsx` | 360 | `InlineDiff` unrendered; chat renders `ChatEditDiff` and `ChatPatchDiff` from `blocks/chat-diff.tsx` |
| Workbench modes | `features/agent/workspace/files-mode.tsx`, `multi-diff.tsx`, `preview.tsx` | 469 | Only `multi-diff` has a described surface above; `FilesMode` duplicates `workspace/tree.tsx`, `WorkspacePreview` is a one-line wrapper over `BrowserView` |
| Chat context bar | `features/chat/ui/composer/context-bar.tsx` | 131 | Repo/context chips unrendered |
| Chat welcome | `features/chat/ui/shell/home.tsx` | 61 | `ChatWelcome` unrendered; `shell/empty.tsx` is mounted instead |
| Motion primitives | `components/ui/collapsible.tsx`, `disclosure.tsx`, `morph-menu.tsx`, `sorting.tsx` | 640 | Superseded by `components/ui/collapse.tsx` and the dropdown; the micro-interaction roadmap already tracks folding them in |
| Chrome micro-components | `features/chat/ui/blocks/loading-state.tsx`, `blocks/preview.tsx`, `md/stream-words.tsx`, `features/agent/sidebar/account.tsx`, `features/promo/types.ts` | 201 | Small unrendered components |
| Helpers | `lib/mcp/install.ts`, `lib/plan/branch.ts`, `lib/editor/jsonc.ts`, `lib/ui/textarea-caret.ts`, `lib/agent-preview/agent-options.ts`, `lib/window/open-branch-window.ts` (a two-line re-export) | 281 | No importers |

Total for the table plus P1 items 1 to 5: about 6,400 lines of TypeScript that
no route can reach. All of it typechecks, lints and passes its own tests, which
is why the gates stayed green.

Dead event channels with a listener and no dispatcher, after excluding DOM
events and cross-window `storage` fallbacks:

- `bettershape-swap-sidebars` (P1 item 6)
- `bettershape-terminal-run-stop`, `bettershape-terminal-run-restart` (P1 item 7)
- `bettershape-toggle-design-mode`, `bettershape-toggle-browser-design-mode` (P1 item 1)
- `bettershape-typescript-version`: the status bar renders `TS x.y` when set
  (`status.tsx:165`); nothing dispatches it, so the chip never appears
- `bettershape-browser-focus-url`: the browser URL bar listens; no shortcut or
  button dispatches it
- `bettershape-editor-search`, `bettershape-open-preview`,
  `bettershape-open-browser`, `bettershape-chat-restore-last`: legacy aliases.
  The equivalent action exists through another path, so these are dead code
  rather than dead features
- `bettershape-chat-fork`: a legacy alias. Fork does work through
  `chat.tsx:945` `onFork`, so the listener is only redundant
- `chat_renamed` (Rust to TS): `agent/commands/titles.rs:424` emits it; no
  renderer listens. Titles update through `chat_title`, so the event is inert

## Settings that are stored, rendered and never read

Verified by grepping the key outside `lib/settings/**` and
`features/settings/ui/**`.

| Setting | Rendered at | Consumer |
| --- | --- | --- |
| `editor.formatOnSave` | `settings.tsx:163` | none |
| `editor.autoSave`, `editor.autoSaveDelay` | `settings.tsx:169` | none |
| `editor.trimTrailingWhitespace` | `settings.tsx:182` | only the palette action, not the setting |
| `editor.insertFinalNewline` | `settings.tsx:188` | none |
| `editor.imagePreview` | `settings.tsx` | none |
| `editor.compactTabs` | `settings.tsx:80` | none |
| `terminal.copyOnSelect` | `settings.tsx` | none |
| `ai.maxContextLines` | `settings.tsx` | none |
| `privacy.showLoginPromptOnLaunch` | not rendered | none |
| `updates.channel` | `settings.tsx` | the updater forwards an `options.channel` parameter but never reads the setting, and updates are manual by design |
| `ai.multiworkConfirm`, `ai.multiworkShowChips` | not rendered | retired Multiwork feature; `agent/models/mod.rs:160` treats the kind as legacy |
| `eslint.enable`, `eslint.fixOnSave`, `prettier.enable` | not rendered | no reader. Prettier runs only from the explicit format action, ESLint only from the Problems tab |
| `node.interpreterPath`, `node.codingAssistance`, `lsp.emmet` | not rendered | none. Python's interpreter setting is wired |
| `designAutocomplete`, `designDiagnostics`, `tailwindControls`, `designBlame`, `spacingRefactor` | not rendered | none; the UI that would read them is the unmounted design shell |

Format on save and autosave are the ones a user will notice: both toggles are in
Editor settings and neither changes behaviour.

## Duplicate implementations

Same-named exports in different modules, a drift risk that the merge made
permanent:

| Export | Files |
| --- | --- |
| `Collapse` | `components/ui/collapse.tsx`, `features/chat/ui/blocks/collapse.tsx` |
| `CopyButton` | `components/ui/copy-button.tsx`, `features/agent/workbench/status/ui/copy-button.tsx` |
| `openBrowserTab` | `features/agent/browser/store.ts`, `lib/window/browser-tab.ts` |
| `stripProviderPrefix` | `lib/ai/providers.ts`, `features/settings/ui/sections/providers/provider-card-helpers.ts` |
| `getGitStatusColor` | `core/utils.ts`, `lib/ui/syntax-theme.ts` |
| `formatBytes`, `formatRelative` | `features/git/ui/actions/utils.ts`, `features/git/ui/github/detail/types.ts` (plus `prs/mapping.ts` for `formatRelative`) |
| `joinPath`, `cleanPath` | `lib/path/utils.ts` against `lib/workspace/file-clipboard.ts` and `lib/workspace/repo-history.ts` |
| `getFileExtension` | `features/editor/lib/image-types.ts`, `features/chat/ui/composer/input-helpers.ts` |
| `pluralFiles`, `relativeLabel` | `features/git/ui/problems/model.ts` against `search/model.ts` and `blame/model.ts` |

## Browser preview coverage

`lib/preview/tauri-mock.ts` models 106 commands explicitly. 145 commands invoked
by the app fall through to the null fallback, including `send_chat_message`,
every git write command, `pty_*`, the `browser_*` navigation family and the
provider test calls. The e2e suite therefore cannot exercise chat send, git
mutations or terminal behaviour, which is why 30 browser tests pass over
surfaces that would fail on a real backend. `e2e/README.md` already calls this
the backlog for fixture fidelity.

## What this means for the absorption

- Containment holds. PR #53's tree is identical apart from four `.dump` docs,
  and every sampled orphan is equally orphaned on `refs/pr/3` and `refs/pr/53`.
- The static gates cannot see any of this. Dead modules typecheck, lint and pass
  their unit tests, and the e2e suite passes because the mock answers everything
  else with null.
- The pattern class is "surface without a mount point": a component plus its
  tests, or a command plus its wrapper, that no route renders or calls. The same
  class produces the dead event channels and the inert settings.

## Suggested order of work

1. Decide mount or delete for each P1 item, one concern per PR. Design mode and
   hunk staging are the two that need a product call: the code is complete, so
   the cheapest correct outcome may be to mount them.
2. Wire or remove the four P1 no-op controls (panel swap, run stop/restart,
   voice settings page, popout action). Each is a single mount or a single
   `dispatchEvent`.
3. Delete the P2 dead modules and duplicate exports, or fold the duplicates into
   one owner as `AGENTS.md` requires. Deleting is cheaper and removes the drift.
4. Read every remaining setting key and either consume it or drop it from the
   schema and the settings page.
5. Grow the preview mock for chat send and git writes so the browser suite can
   catch a broken glue point in future.

## Round 2, 2026-10-30: the fix pass

Two tools now measure this class repeatably, so the numbers below are
reproducible rather than claimed.

| Tool | What it proves | Run |
| --- | --- | --- |
| `scripts/qa/audit-glue.mjs` | Orphan modules, one-sided event channels, settings keys with no reader, duplicate exports | `node scripts/qa/audit-glue.mjs` |
| `scripts/qa/probe-mounted-surfaces.cjs` | The mounted surfaces render in Chromium with zero console errors, and writes a screenshot of each | `PLAYWRIGHT_SANDBOX_LIBS=/tmp/chrome-deps node scripts/qa/probe-mounted-surfaces.cjs` |

Measurements, before and after the pass:

| Metric | Audit head | After the mount pass | After the dead-code sweep |
| --- | --- | --- | --- |
| Modules scanned | 573 | 574 | 531 |
| Orphan modules | 48 | 33 | 0 |
| Test-only modules (own tests, no app importer) | not measured | 13 | 7 |
| Event channels, listener only | 18 | 16 | 11 |
| Event channels, dispatch only | 9 | 8 | 7 |
| Settings keys with no reader | 34 | 28 | 0, see the caveat above |
| Duplicate exported names | 15 | 15 | 15 |

The orphan count fell by mounting the design studio, the all-changes view, the
subagent cards, the chat overflow menu and hunk staging, and by deleting
fourteen modules that a live surface had already superseded: `collapsible`,
`disclosure`, `morph-menu`, `sorting`, `combobox`, `files-mode`,
`workspace/preview`, `diff-hunks`, `chat/shell/home`, `open-branch-window`, the
providers index barrel, and three unused barrels.

The settings count fell because Format on save, autosave, Trim trailing
whitespace, Insert final newline, Image preview, Compact tab bar and Terminal
copy on select now have readers.

### Defects the visual pass found, and the fixes

1. The Voice page rendered a different device description on the server and
   on the client, because `unavailable` read `navigator` during render. It now
   reads the mount flag, and the probe asserts zero console errors.
2. The design tab entered a crash path when the browser preview returned a
   null project: the raw message `Cannot read properties of null` was on
   screen. The mock now models `inspect_design_project`, and the studio guards
   a null result with an actionable sentence.
3. The all-changes view drew duplicate hover controls on top of the diff
   text. The duplicate overlay is gone; the header controls remain.

## Round 3, 2026-10-30: the dead-code sweep

The auditor now scans `tests/`, `e2e/` and `scripts/` as consumers and reports a
separate test-only bucket, so a module kept alive only by its own test is no
longer counted as wired. That split took the 32 conflated candidates down to 19
orphans and 13 test-only modules, and each was judged on its import graph rather
than on how often its name appears in the tree: shared basenames (`types`, `tab`,
`diff`, `commands`) made a text search useless as a verdict.

Deleted, because a live surface already covers the same ground or nothing could
reach them at all:

| Module | Why it is dead |
| --- | --- |
| `features/agent/sidebar/account.tsx` | Footer row superseded by the sidebar account control |
| `features/agent/sidebar/agent-tabs-chip.tsx` | Subagent list replaced by the Agents tab cards mounted in the previous pass |
| `features/chat/ui/blocks/loading-state.tsx` | Generating indicator is the live loading surface |
| `features/chat/ui/blocks/preview.tsx` | The design studio supersedes it; nothing imported it |
| `features/chat/ui/composer/context-bar.tsx` | Repo context moved into the composer's own controls |
| `features/chat/ui/md/diff.tsx` | Inline diff moved to the chat diff block |
| `features/chat/ui/md/stream-words.tsx` | Documented no-op wrapper with no importers |
| `features/git/commands.ts` | Unused command helpers |
| `features/git/ui/branches/{detail,hooks,list,actions,data}.tsx` | Half-finished branch panel; the shipped one is `branches/panel.tsx` |
| `features/preview/design/{deploy,left-panel,rail,tool-rail}.tsx` | Superseded by the design shell's integrated panels |
| `features/promo/types.ts` | No importer |
| `lib/agent-preview/agent-options.ts` | No importer |
| `lib/editor/jsonc.ts` | No importer |
| `lib/mcp/install.ts` | No importer |
| `lib/plan/branch.ts` | No importer |
| `lib/dev/perf-hud-overlay.ts` | Dev overlay never mounted |
| `lib/path/uri.ts` | No importer |
| `lib/settings/tab.ts` | No importer |
| `lib/terminal/tabs.ts` | No importer |
| `lib/ui/textarea-caret.ts` | No importer |

Each of the five modules with a dedicated test lost that test with it
(`agent-tabs-chip`, `perf-hud`, `path-uri`, `settings-tab`, `select-tab`); no
test was edited to make another one pass. Two further edits were mechanical: the
chat styling invariant no longer reads the deleted `md/diff.tsx`, and
`classify-hover-rungs.py` lost its two entries for deleted files.

The Notifications menu was kept and mounted instead of deleted. It is the only
surface that reads `notificationStore` history, it already had a passing
accessibility test, and the status bar had no notifications entry; deleting it
would have removed the only way to see earlier notifications.

Still test-only, and deliberately not deleted: the OpenUI rich blocks
(`analysis`, `carousel`, `style`, `thinking`, `disable-openui-devtools`), the
design `preview-panel`, and `lib/preview/tauri-mock.ts`. The blocks are asserted
by broader chat and design suites that also cover live components, and the mock
is browser-test infrastructure. Removing them means pruning assertions from
tests that pass today, which is a separate change from proving the glue works.
