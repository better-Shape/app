# Round 9: the DeepSource findings loop

Three heads, three analysis runs, one fix batch each. The point of the round was to stop
guessing what the analyzer wanted and read it: every run page is public, and each one lists
the findings it raised with the code it raised them on.

## What the runs said

| Head | Run | Findings raised |
| --- | --- | --- |
| `e19c50b` | `d11d9791` | dead `PageStage`, non-null assertions, index keys, `ChatMarkdown` and `fmtSide` used before definition |
| `e3a9675` | `dc6ae2ff` | the same class, checked against the tree |
| `434aab9` | `d69b7142` | six JS-0067 (module-scope `function` declarations), one JS-D1001 (`blockNative`), one JS-0415 (five JSX levels), one JS-C1002 (`t`), two JS-0098 (`void` in `page.tsx`), three JS-D1001 (`Breadcrumb`, `BreadcrumbItem`, `ButtonSpinner`) |

The grade did not move between the first two runs. That is the honest reading: a single
batch of fixes does not re-grade a diff whose findings are counted per changed line, and the
run before the fixes still describes the tree it analysed.

## What each finding turned out to mean

- **JS-0067** fires on module-scope `function` declarations in the files it parses with a
  script source type, and its message asks for an IIFE. That advice is wrong for these
  files: they are ES modules, and `export default function Home` is what Next.js expects.
  The shape that is both correct and quiet is a documented arrow const, which is what the
  six shell workers and the page component are now.
- **JS-0098** is the `void` operator. The fix is not to drop the promise but to own it:
  `openProject(path).catch(() => undefined)` at the two call sites, and a single
  `runEffectWork` for the effect promises, because React reads a promise returned from an
  effect body as a cleanup function.
- **JS-D1001** wants a doc comment above the declaration, including for arrows declared
  inside another function (`blockNative`). The comments added here name a constraint each:
  why `blockNative` runs in the bubble phase, why `Breadcrumb` renders only element
  children, why `current` wins over `href`, why the spinner takes the button's own color.
- **JS-0415** counts five JSX levels. The workbench branch now renders `ProviderShell`,
  which is the same four providers in one named component.
- **JS-C1002** is a name of one character. The restore timeout is `timer`.

## Gates on `2ed24d2`

- `npx tsc --noEmit`: exit 0
- `npm run lint`: 150 warnings, 0 errors, exit 0. The JSON diff against the pre-branch
  baseline groups a warning by file, rule and message, so a moved line is not a new warning:
  zero groups added, six gone.
- `npm test`: 122 files, 995 tests, exit 0
- `npm run qa`: 25 passed, 0 failed, 0 flaky, 0 skipped (84.2 s), exit 0
- `cargo fmt --all -- --check`: not run in this batch. The toolchain from
  `scripts/dev/rust-toolchain.sh` is scratch state that the sandbox reset removes, and this
  batch touches no Rust file.

## Open questions

The card is D on Reliability, Complexity and Hygiene as of run `d69b7142`. The dimensions
move on findings counted against changed lines, so the honest test of this round is the next
run rather than a prediction from this one. Two things are worth watching:

- whether JS-0067 stops firing once the module-scope declarations are arrows, which the
  crash screen's own history suggests: it carried three such findings a run until it was
  written with documented arrows, and it has been quiet since.
- whether the Documentation Coverage metric keeps climbing from 7.2 percent. It reads 7.6
  percent on the current run.

## The run over `ef75c47`

Fifteen findings, all of them in files this branch touches, and twelve of them closed by
`c25f2a7`. The three that were not were alerts rather than findings and are the section
below this one.

`Button` was the one that had been standing since the branch started. The analyzer put it
at 51 when it first named the component, at 10 after the class tables, the faces and the
predicates moved out, and at 3 now that `buttonState` derives every flag in one place,
`pressedAria` owns the pressed announcement and `ButtonFace` owns the busy-versus-idle
choice. The line the finding points at is the arrow `React.forwardRef` receives, so the
number moves with what is left inside that arrow, not with what moved beside it.

The same run carried a complexity of 7 on the `Children.map` callback inside `MenubarMenu`,
an undocumented `composedRef` inside that callback, and an effect cleanup shaped
`() => observer.disconnect()`. The callback's work is four module-level functions now
(`triggerDisplayName`, `isMenubarTrigger`, `composeTriggerRef`, `withTriggerRef`), each at
three or less, and the cleanup has a block body so a void arrow returns nothing.

`morph-menu.tsx` carried the module-scope `function` declaration that the global-scope rule
reports. It is a documented arrow const, and the two cleanup arrows in the file took the
same block-body treatment as the dropdown's.

Eight undocumented arrows across the two menu files have doc comments that name the
constraint each one holds rather than the line under it: one shared hint class list, a
nested row that holds its own open state, a collapse that animates a grid row instead of a
height, and a busy face drawn over held contents.

## The three alerts that were not findings

Every run since `fff17ef` has come back with the same three info alerts:

```
Parsing error: 'import' and 'export' may appear only with 'sourceType: module' in eslint.config.mjs
Parsing error: 'import' and 'export' may appear only with 'sourceType: module' in scripts/motion/compare.mjs
Parsing error: 'import' and 'export' may appear only with 'sourceType: module' in scripts/motion/springs.mjs
```

The set is exactly the `.mjs` files this branch touches, out of fifteen in the repository,
and the extension is the whole of it. `.deepsource.toml` sets `module_system = "es-modules"`
and the comment above that option claimed it had fixed these, which the runs since then
disprove: the option covers `.js`, and a `.mjs` file is read as a script whatever it says.
A file that does not parse is a file that is not analyzed, which is why a `.mjs` script can
carry any anti-pattern at all without a finding.

`package.json` sets `"type": "module"`, so `.js` is a module for Node as well and the
extension was buying nothing. The three files carry `.js` now (`c5144a5`). ESLint finds
`eslint.config.js` with no config change, `node scripts/motion/springs.js --write`
regenerates `app/springs.css` byte for byte apart from its header line, and
`node scripts/motion/compare.js --write` still writes the comparison page. The seven
module-scope `function` declarations in the two scripts are documented arrow consts, because
a file the analyzer now parses is a file it holds to every other rule.

The dated reports beside this one still name the old filenames. They are records of the runs
that produced them, so they were left as written.

## What the complexity number actually tracks

The run page gives the count the analyzer assigns to a function, and the local
`complexity-file.tmp.mjs` script reports the same number for the same function on the same
tree. That is worth writing down because the core ESLint `complexity` rule and the
analyzer's JS-R1005 do not agree in general: on `ef75c47` both read `Button` as 10 at line
337, and on `c25f2a7` both read it as 3, while a scan of the whole file with the core rule's
own threshold reports different totals. What matters is that the two agree on the function
the finding names, which they do for every finding this round touched.

## Gates on `c25f2a7`

- `npx tsc --noEmit`: exit 0
- `npm run lint`: 150 warnings, 0 errors, exit 0. Zero warning groups added against the
  pre-branch baseline, six gone, on a comparison that ignores line numbers.
- `npm test`: 122 files, 995 tests, exit 0
- `npm run qa`: 25 passed, 0 failed, 0 flaky, 0 skipped (77.2 s), exit 0
- `node scripts/motion/springs.js --write`: regenerates `app/springs.css`, and the token
  test in `tests/ui/spring-tokens.test.ts` fails if the committed file is stale
- `cargo fmt --all -- --check`: not run in this batch, no Rust file touched and the toolchain
  is scratch state that a sandbox reset removes

## Correction: the rename that did not clear the parsing alerts

The section above says the extension is the whole of it and that `.js` is a module for Node
as well, so the rename to `.js` was the fix. The runs since then say otherwise. The run over
`fac333d` reported the same three alerts against the new names:

```
Parsing error: 'import' and 'export' may appear only with 'sourceType: module' in eslint.config.js
Parsing error: 'import' and 'export' may appear only with 'sourceType: module' in scripts/motion/compare.js
Parsing error: 'import' and 'export' may appear only with 'sourceType: module' in scripts/motion/springs.js
```

So the analyzer reads these files as scripts and a top-level `import` is what it cannot
accept, whatever the extension says out loud. What works is the extension this repository
already used for tooling: `scripts/qa` has held CommonJS files since before this branch, and
none of its twenty-eight files has ever produced the alert, because a CommonJS file has no
`import` statement to misread. `eslint.config.cjs`, `scripts/motion/springs.cjs` and
`scripts/motion/compare.cjs` follow it (`6928672`), the config file sits inside its own
CommonJS override in that config so `require` is not an error there, and the next run
(`36ae327f`, over `6928672`) reads **Alerts 1**: the baseline warning and nothing else. The
three parsing alerts are gone after being reported against four different commit ranges.

`node scripts/motion/springs.cjs --write` regenerates `app/springs.css` byte for byte, and
the token test that compares the committed file against a fresh render passes.

## What JS-0067 is actually firing on

The rule reads "unexpected function declaration in the global scope", and it fires on
module-scope `function` declarations in the files this pull request changes. Exported or
not, top-level or not: `MorphMenu`, `ToastCard`, the six workers in `app/client-layout.tsx`,
`PanelGlyph`, `SuppressNativeTooltips`, `BreadcrumbItem`, `ButtonSpinner`, `LoadingGlyph`,
`CollapsibleSection`, `DropdownScrollScrim`, `QuickPick` and `SwapText` all came back with
it. `module_system = "es-modules"` is set and does not reach it, so the fix is the shape
rather than the config: an arrow const, which is also the form the neighbours already use.
The template the rule prints suggests an IIFE, which would only trade a named declaration
for an anonymous one.

The rule is also what answers the question the first pass left open about `ToastCard`, and
it explains the trap in that pattern: adding a doc comment above a module-scope declaration
puts the declaration in the diff, and the declaration then inherits every rule that reads it.

## Complexity, measured before and after

Each split was checked with the local reader for JS-R1005, and the three functions the run
named were also checked against the number the run itself printed.

| Function | Run number before | Local before | Local after |
| --- | --- | --- | --- |
| `SwapText` | 13 | 14 | 5, at `useSwapLayers` |
| `QuickPick` | 12 | 14 | 5, at the key map and the list |
| `CollapsibleSection` | 6 | 8 | nothing above 4 |

The splits are extractions of decisions, not of lines. `SwapText` is the pair of values, the
settled first frame, the width pin and one layer; `QuickPick` is the key map, the row, the
heading, the list and four named decisions; `CollapsibleSection` is the stored read and the
class list of the section, the chevron and the body row. The swap also moved the pinned width
out of React state and onto the node, because a length only the compositor reads should not
cost a second render, and the eight swap tests walk that pin through the leaving width, the
incoming width and back to the layout unchanged.

## Documentation inside one declaration

`features/terminal/ui/terminal.tsx` holds twenty-one arrows inside the effect that owns the
panel, and the analyzer wants a comment on each of them. Every one now states the constraint
it enforces: the copy handler needs the capture phase or Ctrl+C interrupts the running
process, the visibility handler refits only on the visible transition because a hidden
document measures zero, the split ratio is clamped so neither pane reaches zero width, the
refit is debounced because one monitor change fires resize and focus together. None of the
twenty-one restates the line below it.

## Gates on `9d9892f`

- `npx tsc --noEmit`: exit 0
- `npx eslint .`: 150 warnings, 0 errors, exit 0. Zero warning groups added against the
  pre-branch baseline, six gone, on a comparison that groups a warning by file, rule and
  message so a moved line does not read as new.
- `npm test`: 122 files, 995 tests, exit 0
- `npm run qa`: 25 passed, 0 failed, 0 flaky, 0 skipped (84.3 s), exit 0
- `node scripts/motion/springs.cjs --write`: regenerates `app/springs.css`, byte for byte
- `npm run skills:verify`: 53 of 53 locked skills verified, 2 project-owned skills have no
  lock entry
- `cargo fmt --all -- --check`: not run, no Rust file touched and the toolchain is scratch
  state a sandbox reset removes


## The run over `ded79b4`

Nine findings, all of them in four files this branch had already rewritten, and eight of them
are the same two rules read again after the rewrite moved their lines: `SwapText` at 13 with
JS-0067 and JS-C1003 beside it, three mixed returns in the swap, `CollapsibleSection` at 6,
`QuickPick` at 12, and JS-0067 on `isGroup` and `Combobox` in `components/ui/combobox.tsx`.
They are fixed in `9d9892f`, and the fixes are the ones the report's own complexity section
describes: a decision is moved out of the function, not restated inside it. Documentation
Coverage read 8.6% against 15.7% on the branch side of the metric, Issues 2014, Alerts 1.

`QuickPick` is worth recording for a second reason. It had never been read by any earlier run,
and the two shapes the run named were a nested arrow at each end of the component: the key
map and the list. Splitting them moved the count to 5 and 5, and the four helpers that came
out (`cycleIndex`, `submitPaletteQuery`, `paletteTitle`, `paletteDescription`) are module
scope, which keeps their own counts at 1 or 2 rather than adding to the component's.

## The run over `ddc7072`

Fifteen findings across the two files that hold the sidebar toggle and the layout around it.
Nine were in `features/agent/chrome.tsx`: the four module-scope declarations, their missing
comments, and two complexity readings, `AgentChrome` at 11 and `SidebarToggleBtn` at 8. Six
were in `features/agent/layout.tsx`: `layoutMinWidth` and `isFlyoutUiTarget` with JS-0067 and
JS-D1001 each, plus one more declaration. Three were single lines elsewhere: the callback in
`components/ui/tabs.tsx` that serves the observer, the resize listener and the window resize
without saying why one callback is enough; the deliberate two-step height measure in
`components/ui/textarea.tsx`, which the analyzer reads as assigning twice; and the `TODO`
marker in `eslint.config.cjs`, which is a finding in its own right.

All three single-line findings are fixed by saying the thing rather than reshaping the code.
The textarea keeps its two-step measure, because a shrinking edit has to lower the box and
the height has to be cleared before the content height can be read, and the clear is now
`removeProperty("height")` so the file writes one height instead of two. The tabs callback
carries the reason the three signals share it. The config comment keeps its meaning without
the marker.

## The run over `8dfb02a`, where the layout was read for the first time

Alerts 1, Documentation Coverage 9.7% and 16.8%, Issues 1939, and fifteen findings. Four of
them are complexity readings inside `features/agent/layout.tsx` (`SidebarPeek` 7,
`AgentLayout` 25, and the two nested handlers `onTab` 6 and `onToggle` 11), six are `void`
operators in the same file, three are effects that return a cleanup on one path and nothing
on another, and one is JSX nested five levels.

The mechanism behind that jump is worth writing down, because it is the trap of this whole
round. The analyzer reports an issue when its location is inside a declaration whose
declaration line is part of the diff, not only when the location itself is an added line.
`AgentLayout` had stood in that file since before the branch and no run had ever looked
inside it; writing it as a documented arrow const (`8dfb02a`) put its declaration line in the
diff, and 25 complexity, six `void` operators, three mixed returns and a five-level JSX tree
came out at once. The rule is what makes the arrow-const fix double-edged: it satisfies
JS-0067 and it opens the body to every other rule.

The answer here is to fix what came out rather than re-hide it, and the shape is the same
one the rest of the round used. `AgentLayout` composes six hooks now (stored preferences,
workspace width and drag, window minimum, nav slot, splash sequence, sidebar flyout), six
event subscriptions that share one action bag, three helpers for the columns' derived
visibility, and three components for the `<div>` layers, the platform window strip and the
splash. `SidebarPeek`'s mount-through-exit rule is `useExitDelay`. The six `void` operators
are ordinary imports with a `.catch`, plus two window-control callbacks handed straight
through. No wrapper element moved and no class string changed, and that is checked rather
than asserted: `npm run qa` compares the workbench route against a pixel baseline.

| Function | Run number | Local before | Local after |
| --- | --- | --- | --- |
| `AgentLayout` | 25 | 25 | 5 |
| `SidebarPeek` | 7 | 7 | 4 |
| `onToggle` | 11 | 14 | 3 |
| `onTab` | 6 | 7 | 2 |
| the layout file | not named | 9 functions above 4 | one function at 5 |

## Gates on `3bec047`

- `npx tsc --noEmit`: exit 0
- `npx eslint .`: 150 warnings, 0 errors, exit 0. Zero warning groups added against the
  pre-branch baseline (156), six gone, compared as a multiset of file, rule and message so a
  moved line cannot read as new. The layout file itself carries the same two
  `react-hooks/set-state-in-effect` warnings it carried before the refactor, one for the
  storage read on mount and one for the nav slot.
- `npm test`: 122 files, 995 tests, exit 0
- `npm run qa`: 25 passed, 0 failed, 0 flaky, 0 skipped (92.3 s), exit 0
- `node scripts/motion/springs.cjs --write`: regenerates `app/springs.css` byte for byte
- `cargo fmt --all -- --check`: not run, no Rust file touched and the toolchain is scratch
  state a sandbox reset removes

## The run over `83c03a0`, where the sidebar was read

Run `9583da9b`: Failed, 1 alert (the parent-branch baseline warning, which no commit clears),
Documentation Coverage 10.6 against 17.6 percent, External Dependencies 3 of 90, Issues 1891.
The window moved to `features/agent/sidebar/` and read four files at once:

- `chats.tsx`: JS-0415 at `:704`, the shelf's return, seven JSX levels.
- `collection-dialog.tsx`: JS-D1001 on `CollectionDialog` (`:90`) and on `finish` (`:109`).
- `hosted-nav.tsx`: JS-D1001 on `find` (`:35`) and on `HostedSidebarShell` (`:100`).
- `index.tsx`: JS-0067, JS-D1001 and JS-R1005 at 6 on `NavItem` (`:23`); JS-0067, JS-D1001 and
  JS-R1005 at 22 on `AgentSidebar` (`:88`); JS-D1001 on `toggleSidebar` (`:109`) and `newChat`
  (`:129`); JS-0098 on the three `void` calls (`:125`, `:272`, `:291`).

Every one is answered on `cbf55dc`. The sidebar's own file is the informative case: it was one
function holding the toggle, the account name, the avatar, the settings window, the connect
call, the two new-chat events, the width classes, the footer spacing and both header shapes,
which is where a complexity of 22 comes from. Each decision is its own documented arrow now,
the two headers and the footer are components, and the file's own reader is a ternary and a
footer. `collection-dialog.tsx` at 15 and `hosted-nav.tsx` at 7 split the same way: the write,
the two label rules and the draft left the dialog, and the question of which of three controls
to show left the component that owns the slot poll. In `chats.tsx` the seven-level chain was
two menus standing inline in the shelf's return; they are `ShelfViewMenu` and `SelectionMenu`
now, and the return is four deep.

One of the sixteen findings needed the other direction. Moving the row fill into `navRowFill`
to take a branch out of `NavItem` first failed `tests/ui/sidebar-state-ladder.test.ts`, which
holds that a fill and the transition it travels on are stated within reach of each other. The
helper carries the spring itself now, and the constraint is written above it.

### The scope rule, confirmed twice

The same run reported `HostedSidebarShell` (`:100`) and `finish` (`:109`) and `toggleSidebar`
(`:109`), and no hunk header names any of the three. Together with the declarations the headers
do name, the rule reads: a finding is reported when it sits inside a declaration the diff
touches, and the diff touches a declaration when a hunk header names it or when an added line
falls inside it. `.dump/app/qa/ds-worklist.tmp.py` models both cases over the 124 changed
files and predicts 812 findings across 100 of them: 305 JS-D1001, 144 JS-0067, 133 JS-0098, 125
JS-0415, 60 JS-0045, 36 JS-C1002 and 9 JS-0321, before the complexity band is counted. That is
the size of the backlog this loop is working through, and it is why each round fixes the
window's findings and reads the same shapes one file ahead rather than guessing.

## Gates on `cbf55dc`

Every gate below ran on this head, with `node_modules` installed and `PLAYWRIGHT_SANDBOX_LIBS`
set for the browser suite.

- `npx tsc --noEmit`: passed, exit 0, no output.
- `npx eslint . --format json`: passed, 0 errors and 150 warnings, exit 0, against the
  repository baseline of 156. `lint-diff.tmp.mjs` compares file, rule and message as a
  multiset, so a warning that only moved line does not read as new: 0 groups added, 6 gone.
- `npm test`: passed, 122 files and 995 tests, 138.2s, exit 0.
- `npm run qa`: passed, 25 tests, 0 failed, 0 flaky, 0 skipped, 77.5s, exit 0, on a real
  Chromium against the dev server on port 48921.
- Complexity after this batch, from the repository's own reader: `features/agent/sidebar/`
  has no function at 5 or above. Before it, `AgentSidebar` read 22, `CollectionDialog` 15,
  `NavItem` 6 and `HostedSidebarBack` 7.
- `npm run test:rust`, `cargo clippy`, `npm ci`: not run, the same three boundaries the
  section above records. This diff touches no file under `src-tauri` and adds no dependency.

## The run over `ebea985`, where the arrow const bit back

Run `96ab7810`: Failed, 1 alert (the baseline warning), Documentation Coverage 11.2 against
18.2 percent, External Dependencies 3 of 90, Issues 1882. Nine findings across the four
sidebar files and two files of the workbench status bar.

- `features/agent/sidebar/index.tsx`: JS-0357 four times, Major: `NavItem` read above its
  declaration at `:234` and `:235`, `SidebarNav` at `:265`, `NavItem` again at `:306`.
- `features/agent/sidebar/collection-dialog.tsx`: JS-0757 twice, the `autoFocus` prop at
  `:177` and `:214`.
- `features/agent/sidebar/hosted-nav.tsx`: JS-W1044 at `:26`, an optional chain in
  `readBackSlot`.
- `features/agent/workbench/status/ui/copy-button.tsx`: JS-0067 at `:10`.
- `features/agent/workbench/status/ui/status-item.tsx`: JS-D1001 at `:6`.

Two things this round settled.

An arrow const does not hoist, so a batch that writes a component beside the components it
renders can order them either way and only the analyzer sees it. JS-0357 is Major and it is
right: `CollapsedNavRows` and `StandaloneSidebar` read `NavItem` and `SidebarNav` above their
declarations. The file is ordered so nothing is read above its own definition, the sidebar
itself last, and the worklist tool models the rule now (a reference to a module-scope
declaration that appears above that declaration), which is how the last two of the four were
found rather than waited for.

The analyzer reads the folder, not the file. The two workbench status files came into the
window because the branch already had them open, and their findings are the same two shapes
the sidebar batch was already fixing: a module-scope `function` declaration and a missing doc
comment. That is the loop working as intended, and it is why the backlog number in the
previous section is the one to track.

## Gates on `685d316`

- `npx tsc --noEmit`: passed, exit 0, no output.
- `npx eslint . --format json`: passed, 0 errors and 150 warnings, exit 0, against the 156
  baseline, 0 groups added and 6 gone by file, rule and message.
- `npm test`: passed, 122 files and 995 tests, exit 0.
- `npm run qa`: passed, 25 tests, 0 failed, 0 flaky, 0 skipped, 81.4s, exit 0.
- Complexity: `features/agent/sidebar/`, `features/agent/workbench/status/ui/` and
  `components/ui/panel-glyph.tsx` hold no function at 5 or above.
- `npm run test:rust`, `cargo clippy`, `npm ci`: not run, the recorded sandbox boundaries.
  This diff touches no Rust file and adds no dependency.

## What is still open

- `features/chat/ui/md/view.tsx` keeps one forward reference that cannot be ordered both
  ways: the components map renders `ChatMarkdown` and `ChatMarkdown` builds the map. It is a
  recursion, and the rule has no ordering that satisfies it.
- The analyzer reads a growing window of findings per run rather than the whole set. The
  window is not arbitrary and this round finally named it: a finding is reported when it sits
  inside a declaration whose declaration line is in the diff. Fixing the window's findings
  opens the next window, and every run so far has moved it forward.
