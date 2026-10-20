# S8786: only four of the 103 flagged regexes are super-linear

SonarCloud reports 103 `typescript:S8786` plus 6 `javascript:S8786`. The rule is a
shape heuristic, and 47 of the reported line numbers no longer hold a regex at
HEAD (the report was generated against an older commit), so a line-by-line trust
of the report is wrong.

Measured, not assumed. A scanner extracted every regex literal in the source tree
and timed each against a battery of adversarial inputs. A self-test on the
pre-fix `item.tsx` pattern confirmed the scanner detects a known quadratic. Four
regexes were genuinely quadratic on a 32 KB input:

- `features/chat/ui/message/item.tsx` bare-path painter, quadratic on `a/` runs.
- `features/editor/lib/image-types.ts` `.*[/\\]` filename cut, quadratic on `a.`.
- `features/preview/design/css.ts` `parseCssFunctions`, quadratic on letter runs.
- `lib/diagnostics/scrub.ts` `EMAIL_RE`, quadratic on letter runs and dot runs.

The other flagged regexes are linear: the inner repetition in shapes like
`(\.[\w-]+)+` must consume a literal separator each round, so it cannot re-split
the same text. Timing confirms sub-millisecond behaviour on 60 KB inputs.

The fix for each is a leading boundary that stops the engine retrying an interior
start. For the path painter the boundary is two lookbehinds, one rejecting a
preceding word or dot character and one rejecting a preceding separator that
follows one. For `.*[/\\]` the equivalent form is `^[^\n]*[/\\]` with the `m`
flag, which keeps the original first-line behaviour.

Language preservation was proven two ways. Exhaustive enumeration over a small
alphabet (349,524 strings for the email rule, 97,655 for the CSS rule) found no
difference, and differential fuzzing over the full character set found none for
the path painter. Random sampling alone was not enough: it missed `a@b..cd`,
which exhaustive enumeration caught.

## A fifth quadratic, in the test harness (2026-10-20)

A second, wider pass extracted every regex literal from the files the report
names and timed each against inputs built from its own character classes. It
found one the first pass missed:

- `tests/ui/hover-rungs.test.ts` `FILL`, quadratic on `a:` runs. The first pass
  flagged only shipped source, and this regex is in a test helper that scans the
  `.tsx` tree, so a long variant chain in any source line stalls it.

`(?<![\w:-])` anchors the chain start, the same shape the earlier fixes use. It
is language-identical here: across all 274 `.tsx` files the two regexes return
the same 323 matches in the same order, and 200,000 random strings over the
relevant alphabet produce no difference. Timing drops from 1004 ms to 0.3 ms on
a 16 KB input, and the doubling ratio falls from 3.98 to 2.02.

The same pass confirmed the remaining `S8786` anchors are not exploitable. The
`[\\/]+$` and `\s+$` path-trim family is quadratic only when a forced-fail
sentinel follows a long run, because the engine retries the `$` anchor at each
start; the inputs those regexes see are paths and identifiers, and the whole
tree of them runs in under a millisecond. `STATE_FILL` in the same test file is
linear despite its nested-looking shape, because its inner group must consume a
literal `:` each round.
