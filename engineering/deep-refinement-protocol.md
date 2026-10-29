# Deep Refinement — Elaboration (Authoritative)

Elaboration for Deep Refinement Protocol HARD CONSTRAINT in `AGENTS.md`. Authoritative when main file is truncated.

## Mindset

- Treat first-pass success as draft; hypothesis is that detail may be low, edge cases rough, feature missing — investigate with evidence, allow evidence-backed "none missing" to satisfy pass.

## Attention to detail

- For UI: states, transitions, empty/loading/disabled/hover, focus, keyboard, touch, contrast, typography, spacing, radius, density, motion against DESIGN.md tokens.
- For non-UI: naming, consistency, error messages, platform conventions; skip UI design docs.
- Apply unslop/antislop; check all user-visible messages.

## Edge cases

- Enumerate: empty/maximal, boundaries/off-by-one, failure/cancellation/abort/retry/disconnect/shutdown, ordering/races, platform differences, all consumers of changed contract.
- Watch hiding-failure patterns; state expected behavior + verification per edge; add tests without weakening existing.
- For broad UI, layout, streaming, markdown, editor, git, or cross-route work, run multiple external research rounds and execute a Playwright Chromium visual stress campaign per `engineering/visual-stress-and-upstream-issue-verification.md` across wild adversarial scenarios and real bug reports from comparable repositories across narrow, default, wide, and short viewports, pairing DOM geometry probes with direct screenshot inspection until zero visual defects remain.

## Missing features

- Compare against intent + comparable shipped products (2+ external refs when relevant and authorized).
- Rank must/should/nice; for must-have name file/behavior/verification.
- Use Proactive 3-point proposal + confirmation; implement confirmed with minimal correct change.
- Holistic integration pass after.

## Execution

- Loop: implement -> detail audit -> edge sweep -> missing search -> propose -> implement -> focused verify -> repeat.
- Bound one improvement per iteration; fresh-context re-read each time.
- After each iteration, focused verification relevant to change; full Verification Gate only on final tree.
- Stop when evidence-backed pass finds no new gaps; shallow pass with no findings requires deeper digging.
- Record only durable lessons in .dump/, not work logs.

