# FULL-REVIEW record — PR #55 (`arena/3f3ea9c2-app` -> `mega/absorb-all`)

Protocol: `REVIEW.md` -> `FULL-REVIEW.md` (authoritative). This is the record of
the pass run on head `c1be06d`, over the 145 files the pull request touches.
Where a check could not run, the record says so in the status vocabulary of
`FULL-REVIEW.md` §9 instead of implying a pass.

## Phase 0 — scope and risk classification

| Area | Diff shape | Risk class | Basis |
| --- | --- | --- | --- |
| Editor: settings compartment, indent detection, bracket colours, whitespace | new modules + wiring in `features/editor` | standard | renderer-only, no IPC shape change |
| Save pipeline: `formatForSave` / `fixLintForSave` | edited control flow | standard | writes to disk through an existing command |
| Tooling install: `workspace.toolingInstall` reader | new module + command call | **high** | starts a package-manager process in the user's project |
| Explorer: extra workspace roots, filter, clipboard | edited UI + new path helper | standard | reads through `lsDir`, path grants owned by Rust |
| Settings store: settings keys, defaults, mappers | edited types + defaults | standard | persisted data, upgrade path matters |
| Removed modules (30 in the branch, 0 in this pass) | deletions | standard | each re-grepped for live references |
| Rust (`src-tauri/**`) | no file touched by this pass or the branch | not applicable | `git diff` shows no Rust change |

Critical changes named by the protocol (workflow files, updater config, secrets,
release signing) are absent from this diff. The tooling-install module is the one
new process-spawning path in renderer code, and it is reviewed at high depth
below.

## Phase 1 — evidence ledger (what was actually inspected)

| Level | Meaning here | Where it was reached |
| --- | --- | --- |
| E5 | Rendered in a browser against the built bundle and photographed | Settings Editor page, Markdown editor, explorer with two roots, inline blame, status bar |
| E4 | Mounted in jsdom through the public component boundary and asserted | `CodeMirrorEditor`, `MarkdownLiveEditor`, `FileTree`, `EditorSettings` |
| E3 | Pure function tested against boundaries and rejected input | `bracketMarks`, `isMissingPrettierFailure`, `isSameWorkspacePath`, `bracketMarks` depth rules, `detectIndentation` |
| E2 | Types + call sites read end to end | settings mappers, `optionExtensions` consumers, `pty_spawn` arguments, `prettier_format_file` |
| E1 | Named but not read this pass | Rust-side consumers of `setIndexEmbeddings`, `setChatMemoryEnabled` |
| E0 | Assumed | nothing is claimed at E0 |

## Phase 6 boundary traces actually walked

- **Renderer -> command -> process (format path).** `formatForSave` ->
  `prettier_format_file` (Rust, `npx --no-install prettier`, piped stdin/stdout,
  stderr captured, non-zero exit -> `Err`) -> renderer catch -> classification.
  The classifier matches only the failures that mean "package absent"; the
  install path is bounded to one in-flight install per project, passes
  `dev = true`, and never runs on a formatting error. A failed install reports
  the OS error and does not claim success.
- **Explorer -> IPC path grants.** `setExtraWorkspaceFolders` -> Rust
  `setExtraWorkspaceFolders`; the renderer stores the normalised string and the
  backend owns the grant. The renderer never widens access on its own: the tree
  only calls `lsDir` for a path the backend already granted, and a refusal is
  rendered as the folder's error line rather than silently empty.
- **Settings -> editor.** `updateSettingSection` -> `subscribeSettings` ->
  compartment `reconfigure` in both editors. Verified that a change reaches an
  open document, not only the next mount (Markdown option test, probe step 8).
- **Settings -> disk.** `persist()` writes `bettershape-settings-v1`; the union
  widening for `renderWhitespace` accepts the three previously stored values
  unchanged, so an existing profile keeps its setting.

## Phase 4 — test validity, sampled

Applied the §7.2 questions to the tests this pass adds; the ones that failed a
question were rewritten rather than kept:

- `tests/settings/editor-render-whitespace.test.tsx` finds its control through
  `aria-labelledby`, so it fails if the row loses its accessible name, and it
  asserts the store after a real menu pick rather than a mocked callback.
- `tests/editor/markdown-editor-options.test.tsx` asserts a DOM class the
  extension produces (not that the extension was constructed), and the
  "open document" case fails if the compartment stops reconfiguring.
- `tests/editor/bracket-colors.test.ts` takes its expected depths from the input
  string, not from a production constant.
- `tests/workspace/folders.test.ts` resets modules per case so module-level
  bookkeeping cannot make a later case pass, and covers corrupt and partially
  invalid stored data.
- `tests/editor/tooling-install.test.ts` covers the rejected path (install
  failure) and the dedupe path, and proves a formatting error does not reach the
  installer — the one behaviour where a false positive would be destructive.
- Named gap: no test drives `npmInstall` against a real npm; the command boundary
  is mocked. The failure mode that matters (a rejected install) is covered.

## Phase 7 — findings

Each survivor passes the five conditions (diff cause, reachable scenario,
concrete impact, minimal remediation, verification path).

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | `workspace.toolingInstall` unread; every save in a project without Prettier reported a raw `npx` error and never recovered | high | fixed (`9f2f293`), tested |
| 2 | Markdown editor ignored every Editor setting | medium | fixed, tested |
| 3 | `renderWhitespace` had no Settings row | medium | fixed, tested |
| 4 | "Bracket colors" wrote a key nobody read; mapper advertised `guides.bracketPairs` with no renderer | medium | fixed, tested |
| 5 | `RenderWhitespaceSetting` could not express `trailing`/`boundary`, and the new row only compiled through a cast | medium | fixed (`c1be06d`), typecheck gate widened to the tests project |
| 6 | Explorer filter ignored extra roots | low | fixed, tested |
| 7 | Adding the project folder as an extra root listed it twice | low | fixed, tested |
| 8 | `showBracketGuides` key with no reader and no control | low | deleted with its mapper fields |

Discarded candidates, with the condition they failed:

- "`colorTheme` is dead" — fails diff cause and impact: the theme registry is
  dark-only by design (`lib/settings/themes.ts`), normalised and applied.
- "`defaultShell` is unread" — fails diff cause: `resolveDefaultTerminalShell`
  reads it and the terminal and background-run paths both call it.
- "`indexEmbeddings` / `chatMemoryEnabled` are unread" — fails diff cause: both
  are forwarded to Rust settings commands in `persistSettingsEffects`.
- "`pnpm`/`yarn` projects break the install" — fails diff cause: `npm_install`
  takes the package manager; the renderer passes the project path only, and the
  command resolves the manager itself.

## Phase 6/9 — verification matrix on `c1be06d`

| Check | Applies | Status | Evidence |
| --- | --- | --- | --- |
| Lint | yes | Passed | `npm run lint:strict` — zero warnings |
| Typecheck | yes | Passed | `npm run typecheck` — app and tests projects |
| Unit tests | yes | Passed | `npx vitest run` — 273 files, 2866 tests |
| Build (renderer) | yes | Passed | `npm run build:preview`; CI `Build Next.js` |
| Preview probe | yes | Passed | 9 steps, zero console errors, screenshots listed in the PR |
| Skills verification | no `.agents/` change | Passed (rerun) | 53 of 53 locked skills verified |
| Security audit | yes | Passed | `npm audit --audit-level=high` — 0 vulnerabilities |
| Rust tests / fmt / clippy | no Rust change | Not applicable | CI `Test Rust (Cargo)` and `Rust Lints` succeed on the head |
| Packaging | yes (ships) | Not run here | no Tauri toolchain; `build-installers.yml` is the owner |
| e2e Playwright | yes | **Inconclusive** | the CI job failed on this head and on two earlier heads while passing on the head in between; its logs are unreadable from this sandbox (`results-receiver` returns EOF) and the re-run API is not permitted for this token. Not called green. |

`FULL-REVIEW.md` §9: a review with a required `Inconclusive` result is
`Needs Verification`, not `Ready`. That is the status this record claims for the
browser e2e job, and the reason the PR body says so rather than "all green".

## Coverage limits named, not hidden

- No Rust toolchain here, so no cargo command ran locally; CI owns them.
- No Tauri runtime here, so multi-root grants and inline blame are proven
  against the mocked IPC bridge and the static preview, not a real git backend.
- The browser e2e job is `Inconclusive` for the reason above.
- The UI capture GIF could not be produced (no ffmpeg/gifsicle in the sandbox);
  the still frames are in `.qa-artifacts/feature-wiring/`.
