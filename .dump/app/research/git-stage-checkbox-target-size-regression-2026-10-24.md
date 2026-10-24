# The /git stage checkbox target-size regression

## Conclusion

`Test Browser (Playwright)` and `Browser Preview` were failing on exactly one
assertion: on `/git`, axe reported 2 `target-size` nodes where
`e2e/a11y-baseline.json` allows 1. The regression was the stage checkbox in the
Source file list, not the generate-commit button. Fixed by widening the margin
beside the checkbox from `mr-1` to `mr-1.5` in
`features/git/ui/source/source.tsx`, which restores the safe clickable diameter
from 22.8px to 26px. The suite is 22 passed, 0 failed.

Neither failing job is in `ci-success` `needs`
(`.github/workflows/ci.yml:399`), so this never blocked a merge. It was silently
red on `mega/absorb-all` for that reason.

## Root cause

Commit `0bb05598`, "fix(a11y): give the remaining flagged elements real roles
and keyboard", 2026-10-18. It replaced the file row's single clickable wrapper
`div` with a `role="presentation"` wrapper plus a real sibling `<button>` for the
open-diff action, so the row became keyboard accessible.

That is a genuine improvement, and it broke the neighbour. WCAG 2.2 SC 2.5.8
passes a small control either on size, at least 24 by 24px, or on spacing, when
the clickable area plus the clear space around it gives a 24px diameter. The
stage checkbox has always been 11.38px (`h-3.5 w-3.5` at a 13px rem root) and
has always passed on the spacing branch. Before `0bb05598` its siblings were not
axe targets at all: the icon wrapper is `pointer-events-none` and the path and
status labels are plain text, so nothing consumed the space around it. After
`0bb05598` a real `<button>` sits immediately to its right.

The arithmetic matches axe's own number. The checkbox is centred in a `w-5`
wrapper, 16.25px, giving 2.435px of clear space on each side, and the wrapper's
`mr-1` is 3.25px, so the gap to the button is 5.685px and the safe diameter is
11.38 + 2 x 5.685 = 22.75px. axe reported 22.8px. `mr-1.5` is 4.875px, the gap
becomes 7.31px and the diameter 26.0px.

Generalisable: **adding an interactive element next to a small one can violate
target-size without touching the small one.** The violation lands on the
neighbour, and the diff that caused it looks unrelated to it. A baseline that
pins a count will catch the increase but will not name the cause, and the commit
that triggers it is usually an accessibility fix.

## Why the button is the pinned node and not the regression

The baseline was captured at `d49de661`, 2026-10-15T13:30:13Z, in the commit
that introduced the suite. Determining which of the two nodes it pinned is what
decides the fix, and guessing wrong means either editing the wrong control or
moving the baseline number to make a test pass.

Four plausible causes were checked and eliminated by comparing the tree at
`d49de661` against HEAD:

| hypothesis | verdict | evidence |
| --- | --- | --- |
| the generate button changed size | no | `features/git/ui/shared/generate-star.tsx` is byte-identical at both, `size-7` and `pointer-events-auto` unchanged |
| the root font-size dropped, shrinking every rem value | no | `app/globals.css` sets `html { font-size: 13px }` at both commits |
| the seed started staging a file, enabling the button | no | `lib/preview/tauri-mock.ts` seeds `README.md` `staged: true` at both |
| the audit started waiting for the git content to mount | no | the `waitForIpcQuiet` plus `getByText("preview: seeded commit history")` block is identical at both |

What settled it was running the audit at the baseline commit rather than reading
more code. In a throwaway worktree at `d49de661` the `/git` audit passed and
reported exactly one `target-size` node, `.size-7`, the generate button. So the
button is the pinned debt and the checkbox is the regression. axe-core is
4.13.0 at both commits, so the rule did not change either.

Method, which is the reusable part:

```bash
git fetch --depth=1 origin <full-baseline-sha>   # short sha is refused
git worktree add -f /tmp/basewt <full-baseline-sha>
cp -al node_modules /tmp/basewt/node_modules     # hardlink, not symlink
cd /tmp/basewt && npm run build:preview && <run the audit>
```

Two details matter. A **symlinked** `node_modules` does not work: Turbopack
resolves the worktree as the filesystem root and fails when a dependency
resolves outside it, so hardlink with `cp -al`, which costs no extra disk on the
same filesystem. And a **short** SHA is refused by
`git fetch --depth=1 origin d49de661` with `couldn't find remote ref`; resolve
the full SHA through the API first. Remove the worktree with
`git worktree remove --force` and `git worktree prune` afterwards.

## The fix, and what was deliberately not done

`features/git/ui/source/source.tsx`, the Source file row: `mr-1` to `mr-1.5` on
the checkbox wrapper, with a comment recording that the margin is load-bearing
and why. `mr-1.5` was chosen over a new value because the icon wrapper two lines
below already uses it, so the row keeps one spacing vocabulary. It shifts the
row content 1.625px right.

Not done, with reasons:

- **Raising `target-size` to 2 for `/git`.** That is altering a test to pass. The
  baseline file says the opposite: lower the numbers as violations get fixed,
  never raise them without a note.
- **Also fixing the generate button and lowering the baseline to 0.** Tempting,
  since the file states that as the goal, but it is separate pre-existing debt
  and the button is coupled to its container: it is `size-7` (22.75px) placed
  `bottom-1` inside a `Textarea` with `pb-8` (26px), so growing it to `size-8`
  (26px) would overlap the text unless the padding grows too. It is shared by
  three call sites, `features/agent/workspace/commit-menu.tsx:587`,
  `features/git/ui/github/create-pr-dialog.tsx:167` and `source.tsx:2011`. That
  is a design decision for whoever owns the debt, and `/` also pins
  `target-size: 4`, which may include the same button.
- **Enlarging the checkbox itself.** The row is `h-7`, 22.75px, so a 24px
  checkbox cannot fit. The spacing branch of SC 2.5.8 is the correct mechanism
  for a dense IDE list.
- **Updating visual baselines.** None cover `/git`:
  `e2e/visual.spec.ts-snapshots/` holds only `welcome`, `settings` and
  `workbench`, and `visual.spec.ts` navigates only `/` and `/settings`. The
  `@visual` tag is excluded from CI anyway, `--grep-invert @visual`, because the
  baselines are OS and font sensitive.

## Two wrong diagnoses recorded so they are not repeated

Before the worktree run produced evidence, two confident causes were proposed
and both were false: an absorbed 28-file provider-catalog refactor, inferred
from a branch-to-branch `git diff --stat` between a passing and a failing head,
and then the root font-size, inferred from a `grep | head -12` whose truncation
hid the `font-size: 13px` line that was present at the baseline too.

The branch comparison was unsound in a way worth naming: the "passing" head
`15dea73` and the "failing" head `4ae4236` are on divergent branches, and
`4ae4236` does not contain `generate-star.tsx` at all while `15dea73` does. A
diff between two divergent branches is not a before-and-after, and attributing a
failure to the largest file-count delta in it is a guess dressed as a finding.
Compare against the commit that recorded the baseline instead, or run the code.

Related: `playwright-in-a-cdn-blocked-sandbox-2026-10-24.md` for the harness
that made this diagnosable, and
`../../global/a-red-aggregate-check-does-not-tell-you-what-it-aggregates.md` for
why these two jobs were red without blocking anything.
