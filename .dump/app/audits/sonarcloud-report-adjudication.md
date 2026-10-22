# SonarCloud report adjudication: every rule family, at HEAD

The security-audit report carried 268 SonarCloud findings across 26 rules,
generated against analysis `473485a7` (2026-10-16). This file is the disposition
of every family at HEAD (`mega/absorb-all`, `fead28ba` and its ancestors), with
the method and the evidence for each verdict. The rule is: re-derive the finding
against the current tree, do not trust the report's line anchors, and do not
add `NOSONAR`.

Two facts make the report unreliable as written. First, 47 of the 103 `S8786`
anchors and a similar share of others no longer hold the code they name, because
the report predates the fix commits that landed on this branch. Second, several
rules are shape heuristics (`S8786` "super-linear regex", `S7767` "use
`Math.trunc`") that need a measurement or a semantic argument to accept or
reject, not a line read.

## Verdict summary

| Rule | Report | Verdict at HEAD |
| --- | --- | --- |
| `typescript:S8786` | 103 | 0 super-linear. Every shipped `.ts`/`.tsx` regex swept. |
| `javascript:S8786` | 6 | 0 super-linear. All six are in `.mjs` scripts, timed directly. |
| `typescript:S9383` | 28 | 0. Type-aware `no-floating-promises` run reports none. |
| `typescript:S6848` | 35 | 0. jsx-a11y scanner reports none. |
| `typescript:S6845` | 5 | 0. jsx-a11y scanner reports none. |
| `typescript:S2819` | 24 | 0 live defect. Every live site passes an explicit target origin. |
| `typescript:S2245` | 12 | 0. No `Math.random` in shipped source. |
| `typescript:S7773` | 10 | 0. No bare `parseInt`/`parseFloat` in shipped source. |
| `githubactions:S7637` | 6 | False positive. Actions pinned by full SHA plus a `# vN` comment. |
| `typescript:S6324` | 5 | False positive. `\u001b` escapes in an ANSI stripper, no raw control char. |
| `githubactions:S6505` | 4 | 0. Anchors drifted; no `pull_request_target` on untrusted checkout. |
| `javascript:S4036` | 4 | False positive. `execSync`/`execFileSync` in release scripts, not untrusted. |
| `typescript:S9379` | 3 | 0. All `autoFocus` on custom components; anchors stale. |
| `typescript:S6852` | 3 | 0. Anchors stale. |
| `typescript:S7767` | 3 | False positive. `| 0` is a deliberate int32 wrap, not truncation. |
| `typescript:S2137` | 2 | 0. No shadowed `Error`. |
| `typescript:S6853` | 2 | 0. Anchors stale. |
| `typescript:S3516` | 2 | 0. Anchors stale. |
| `typescript:S3923` | 2 | 0. One stale, one a drifted ternary anchor. |
| `typescript:S6544` | 2 | 0. `FontFaceSet.ready` is awaited, never branched on. |
| `css:S4657` | 2 | 0. Anchors stale. |
| `typescript:S2871` | 1 | 0. Anchor stale. |
| `typescript:S6825` | 1 | 0. Anchor stale. |
| `githubactions:S8233` | 1 | 0. Anchor stale. |
| `typescript:S1523` | 1 | 0. No `eval`/`new Function` on user input in shipped source. |
| `javascript:S2871` | 1 | 0. Anchor stale. |

## S8786: no shipped regex is super-linear

Method: a scanner extracts every regex literal from `app/`, `components/`,
`features/`, `lib/`, `core/`, `scripts/` and `runtime/`, then times each against
inputs built from its own character classes, with and without a forced-fail
sentinel (`/workspace/phase2/sweep-all.cjs`). Result at HEAD: 2838 literals in
531 files, **0 super-linear & slow**.

The fix commits on this branch (`cb068156`, `94b761f2`, `ac1e3831`, and the
trailing-separator pass) already made the four genuinely quadratic shipped
regexes linear. The sweep's one remaining hit after those passes was
`features/command-palette/cmd-palette.tsx:165`, fixed in `fead28ba`:

```
shortcut.split(/\s*\+\s*/)              // quadratic: 771 ms on a 32 KB space run
shortcut.split(/(?:(?<!\s)\s*\+|\+)\s*/) // linear: 0.2 ms on the same input
```

Equivalence for that change is exhaustive over the relevant alphabet (55,987
strings) plus 500,000 random strings, zero differences
(`/workspace/phase2/fix-cmdpalette-equiv.cjs`). The earlier passes proved their
own equivalences the same way; see `.dump/s8786-regex-adjudication.md`.

The six `javascript:S8786` anchors are all in `.mjs` release/build scripts, which
the `.ts`/`.tsx` sweep does not reach. Each was timed directly at HEAD
(`/workspace/phase2/sweep-mjs.cjs`): all four sizes up to 16 KB run in under
0.11 ms with no doubling, so all six are linear.

## S9383: no floating promise

Method: the rule was run with type information
(`@typescript-eslint/no-floating-promises`, `ignoreVoid: true` to match what
SonarCloud accepts) across `features/`, `lib/`, `core/`, `components/`, `app/`
and `runtime/`. Zero findings at HEAD. The seven genuine drops the rule once
found were fixed; see `.dump/s9383-floating-promises.md`. The report's anchors
are stale.

## S6848 and S6845: no static-element interaction, no bad tabIndex

Method: `eslint-plugin-jsx-a11y` mapped to the two Sonar rules
(`no-static-element-interactions`, `no-noninteractive-tabindex`) run across the
tree via `a11y.config.mjs` / `scan-a11y.mjs`. Zero findings at HEAD. A positive
control (a `<div onClick tabIndex={0}>`) reports both errors, so the scanner is
not silently passing. The 60 raw hits a naive grep shows are all "rule definition
not found" noise from inline disable directives, not violations.

`features/chat/ui/message/item.tsx:392-396` already carries
`role="group" aria-label="Message" tabIndex={-1} onKeyDown`, which is why the
message container no longer trips either rule.

## S2819: postMessage always names a target origin

Six anchors are live (18 are stale). Each was read at HEAD:

- `features/preview/design/inspect-bar.tsx:68,82` pass `target.origin` /
  `authorization.origin`.
- `features/preview/design/shell.tsx:806,917,939` pass
  `designMessageOrigin(...)`, which returns the authorized origin or
  `OFF_DESIGN_ORIGIN` (`https://preview.bettershape.invalid`), never `"*"`.
- `features/chat/ui/design-capture.tsx:189` passes `expectedOrigin`, and the
  reply handler rejects any other origin (line 209).

The one `"*"` in the tree, `features/chat/ui/blocks/gallery.tsx:93`, posts into a
sandboxed iframe (`allow-scripts` only, so the document's origin is opaque
`"null"`) and `"*"` is the only deliverable target there; the receiving side
validates the message shape. No live defect.

## S7767: `| 0` is an intentional int32 wrap

`hashStr` in `features/preview/lib/project-warm.ts:65` uses
`(Math.imul(h, 31) + s.charCodeAt(i)) | 0` as a 32-bit string hash.
`Math.trunc` is not equivalent: it does not wrap at 2^31. On a constructed string
with code units `[7132,35712,45763,22616,18942,5334,13072,37776,21052,56670]`
the `| 0` form yields `-2147455725` and a `Math.trunc` form yields `2147511571`.
The same shape appears at `features/chat/lib/proposed-edits.ts:42` and
`lib/agent-preview/store.ts:137`, both also 32-bit hashes. The rule's premise
does not hold, so the finding is rejected, not silenced.

## The remaining families

- `S2245` (`Math.random`): the only occurrence in shipped source is a comment
  explaining that `crypto.getRandomValues` is used instead. 0 real uses.
- `S7773` (`parseInt`): no bare `parseInt`/`parseFloat` in shipped source; the
  one hit is inside a comment. 0 real uses.
- `S6324` (control characters): the "control chars" are `\u001b` escape sequences
  in `terminal-live.tsx` `stripAnsi`, which strips ANSI CSI/OSC from terminal
  output. There is no raw control character in the file.
- `S7637` (pin actions by SHA): every action is pinned to a full 40-char SHA with
  a `# vN` comment, e.g. `actions/checkout@11d5960a...  # v4`. False positive.
- `S6505` (untrusted checkout): the anchors drifted; the workflows check out
  repository code on `push`/`pull_request`/`tag`, not on
  `pull_request_target` with a fork's head.
- `S4036` (PATH lookup): the anchors are `execSync("git ...")` and
  `execFileSync("gh", ...)` in release scripts. The rule wants `PATH` restricted
  to fixed directories; these run on a maintainer's machine or a CI runner, not
  against untrusted input, so the finding is a false positive for this context.
- `S1523` (`eval`): no `eval` in shipped source. `runtime/entry.ts` compiles the
  user's own preview code with `new Function`, which is the preview's purpose and
  runs in the sandboxed preview origin.
- `S6544`: `lib/ui/wait-for-fonts.ts` awaits `doc.fonts?.ready` inside a
  try/catch and never branches on the promise; `runtime/entry.ts` and
  `design-capture.tsx` call it with `await`. No boolean conditional on a promise.
- `S2137`, `S3516`, `S3923`, `S6852`, `S6853`, `S6825`, `S2871`, `css:S4657`,
  `githubactions:S8233`, `javascript:S2871`: each anchor was read at HEAD and no
  longer holds the construct the rule names. Disposition: stale.

## Method notes for the next reviewer

- The ledger's "LIVE" column over-reports. `anchor_status.py` re-anchors with a
  per-rule regex probe, so a line that merely still matches the probe's shape is
  called live even when the construct is gone. Confirm each live anchor by reading
  the line, not by trusting the probe.
- SonarCloud's TypeScript rules that map cleanly to eslint plugins were re-run
  with the plugin rather than reasoned about by hand. That is what settles
  `S9383`, `S6848` and `S6845`.
- For `S8786` the only trustworthy verdict is a timing measurement with a forced
  fail. Shape reading both over- and under-reports.
