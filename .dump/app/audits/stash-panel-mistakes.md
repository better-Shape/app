# Stash panel mistakes, root causes and behaviour changes

Written while adding the Stash section to the git side panel
(`features/git/ui/stash/`). Each entry is a mistake made in that work, what caused
it, and what changed so the next agent does not repeat it.

## 1. A literal control byte written into a TypeScript source file

**What happened.** The first write of `features/git/ui/stash/model.ts` contained a raw
`0x07` byte inside the `GIT_ESCAPES` map, written as `a: "",` where the intent was the
escape sequence `a: <BEL>,`. The file was then classified as binary and the read tool
refused to open it.

**Root cause.** The escape sequence was emitted as a literal byte rather than as the
six characters `\` `u` `0` `0` `0` `7`. Any source file written through a tool that
interprets escapes will fail the same way, and the failure looks like a file problem,
not a content problem.

**Change in behaviour.** After any write to a `.ts` or `.tsx` file that handles escape
sequences, check for stray control bytes before moving on:

```
LC_ALL=C grep -cP '[\x00-\x08\x0b\x0c\x0e-\x1f]' <file>
```

Zero is the only acceptable answer. Repair is a targeted substitution, not a rewrite:

```
perl -i -pe 's/a: "\x07"/a: "\\u0007"/' <file>
```

## 2. Diff headers were matched inside an open hunk

**What happened.** `parseStashDiff` checked for the `--- ` and `+++ ` header lines
before it checked whether a hunk was open. A removed source line whose own text starts
with `-- ` prints as `--- ` in a unified diff, so `-- SELECT 1` in a SQL file was read
as a path header and never counted as a deletion.

**Root cause.** Header syntax and hunk body syntax share their first characters, so the
parser has to know which section of the diff it is in before it looks at the line. The
parser carried `inHunk` but consulted it too late.

**Change in behaviour.** In a unified diff parser, header matching is gated on the
parser not being inside a hunk. Once `@@` has been seen, `+`, `-` and ` ` lines are body
content no matter what they spell. `features/git/ui/stash/model.ts` does this, and
`tests/git/stash/model.test.ts` pins it with a removed `-- SELECT 1` line and an added
`++ preprocessor_thing();` line.

## 3. Test assertions written against a guess instead of the real behaviour

**What happened.** Three assertions were wrong before any suite ran: a 45 second old
timestamp rendered as `0m ago` because the "just now" threshold was 45, not 60; the
subject `WIP on main: 1a2b3c4d` rendered as its own label because the hash strip
required trailing whitespace; and relative-time labels were pinned against a hardcoded
2023 epoch, which the real clock turns into `2y ago`.

**Root cause.** The tests encoded what the implementation was expected to produce rather
than what git and the clock produce. Assertions written from the implementation under
test can only confirm the implementation.

**Change in behaviour.** Write the expectation from the behaviour the caller depends on,
with the inputs spelled out. For anything clock-dependent, derive the input from
`Date.now()` in the test rather than pinning an epoch. For anything format-dependent,
copy the real output shape into the fixture.

## 4. `useId()` result treated as a ref

**What happened.** `const previewId = useId();` followed by `previewId.current` in two
places. `useId()` returns a string, so both uses read `undefined`.

**Root cause.** Skimming the surrounding `useRef` code and carrying the `.current`
access over. It type checks as an error rather than as a silent `undefined`, so a single
`tsc` run catches it, but only if one is run.

**Change in behaviour.** After writing a hook call, read the line again and check the
return type against how it is used. Element ids come from `useId()` directly, and
`Math.random()` never goes inside a `useRef` initialiser because that argument is
evaluated on every render.