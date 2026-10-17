# Simulating a mutation without the test runner

**Fact.** A subagent that is forbidden from running vitest can still prove a new test
goes red, by running a faithful copy of the code under test plus the new test body
under bare `node`, importing the project's own dependencies with
`node --input-type=module -e`. That covers string and offset logic. It does not
cover TypeScript narrowing, the vitest environment, or anything the real suite
sets up.

**The trap.** The hand-written copy is itself untested code, and its bugs point in
the flattering direction. On 2026-10-17, triaging a byte-offset defect in
`features/preview/design/jsx-source.ts`, a copied `patchHtmlOpening` was missing
the `start < 0 || end > source.length || start >= end` guard, so the simulated
pre-fix run corrupted a fixture that the real pre-fix code leaves untouched. A
copied matcher also required `query.classes` to be present on the element, while
the real scorer treats a tag match alone as a hit, so the copy reported "no hit"
where the real function returns one.

Both errors inflated the apparent mutation count. Corrected, the same simulation
went from 6 of 6 red to 4 of 6, and the two survivors turned out to be the tests
that were deliberately non-discriminating regression guards.

**How to apply.** Before quoting a mutation count from a port, check the port
line by line against the original, guard by guard, and prefer a mutation count
that is *smaller* than the first run rather than larger. Report the count as
unverified until the central gate runs it.

## Extract the shipped source; do not hand-copy it

The copy-bug trap above disappears if the simulation transpiles the source that
is actually in the file. On 2026-10-17, triaging a review finding in
`features/chat/lib/use-chat-session.ts`, a node script sliced the helper out of
the module by its own delimiters (`src.indexOf("export function ...")`) and ran
`ts.transpileModule` on that slice plus the new assertions. No hand-written copy,
so no invented guard.

That run also paid for itself a second way: it reported the SHIPPED
implementation as 6/7 green and named the failing assertion, which turned out to
be my own expectation written backwards (`["b","a"]` for a restore that prepends
the missing file, so `["a","b"]` is correct). A mutation check that only runs
mutants is worthless; always print the unmutated baseline first, and treat a
baseline failure as a bug in the assertion, never in the code.