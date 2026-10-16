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
