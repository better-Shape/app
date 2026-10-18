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
