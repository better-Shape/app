# PR #50 absorption notes (branch `better-shape/arena/a719e75b-app`, tip `5f61cad0`)

All 15 commits were absorbed with `git cherry-pick -x` in order. Every commit keeps the
full-SHA trailer. Two picks produced no textual change because the mega line already
carried an equivalent from PR #53 / the first PR #50 pick; they are recorded as empty
commits with their original message and trailer.

## Intentional deviations

- `6df23eb7` ("scan leaked tool tags without per-tag regex construction"): resolved
  entirely to the mega implementation. Our line already precompiles the tag patterns
  once (`STRIP_ACROSS_FENCES_PATTERNS`, `LEAKED_TAG_PATTERNS`, `ESCAPE_RE`) which is the
  pick's stated goal; the incoming `findOpenTag`/`findCloseTag`/`stripPairedBlocks`
  scanners were not adopted. The pick's new equivalence assertions in
  `tests/features/chat-stream-strip-equiv.test.ts` were kept and pass against our code.
- `15385a47` ("handle the floating probes Sonar flagged"): empty. Our line already
  routes every probe through the warm-cache helpers with `.then(...).catch(() => undefined)`.
- `3b7f730e` ("close CodeAnt nitpicks"): resolved to the mega implementation except for
  the live fixes: `useKeyboardShortcuts()` moved out of the titlebar into
  `ClientLayout`, terminal search now maps string offsets to cell columns
  (`toCellSelection`/`searchLinesRef`), and `parseFenceLine`'s scanner intent is already
  satisfied by `readStreamFenceMarker`. Docs-only JSDoc additions that no longer apply
  after our refactors were skipped.
- `5f61cad0` ("close the remaining DeepSource doc and lint findings"): resolved to the
  mega shells; the three doc-only additions that still applied were taken.

## Follow-up fix

`repairStreamGlitches` keeps its guarded implementation from the mega line (the branch's
z-array version deletes ordinary repeated prose, which `tests/chat/stream-transcript-and-bridges.test.ts`
forbids). The branch's later boundary tests required two adjustments, made in a follow-up
commit: the glued-chunk suffix rule runs before the 40-character early return, and the
prefix replay requires `start < length - 20` to match the reference.
