## Summary

Describe what this change does, why it is needed, and which part of the repository it touches. Keep this opening paragraph clear to someone who has not seen the code before.

## Changes

<details>
<summary>Files and behavior</summary>

- Files changed:
- Behavior or policy changed:

</details>

## Verification Gate

Head SHA: `0000000000000000000000000000000000000000`

Replace the zero placeholder with the current 40-character hexadecimal PR head SHA.

- `npm ci`: <passed, failed, or not run with reason>
- `npm run lint`: <passed, failed, or not run with reason>
- `npm run typecheck`: <passed, failed, or not run with reason>
- `npm run build:runtime`: <passed, failed, or not run with reason>
- `npm run test:all`: <passed, failed, or not run with reason>
- `npm run test:rust`: <passed, failed, or not applicable>
- `npm run skills:verify`: <passed, failed, or not run with reason>
- Rust formatting and clippy, when Rust changed: <one combined status: passed, failed, not run with reason, or not applicable; or both fmt: passed; clippy: passed>

Use either one combined status (`passed`, `failed`, `not run with reason`, or `not applicable`) or both `fmt:` and `clippy:` statuses. Every `Not run` result needs its own reason.

Use the head SHA from the run. A result from an earlier edit does not verify this head.

## Code Research Gate

<details>
<summary>Research notes</summary>

- Queries searched:
- Sources:
- Edge cases considered:
- Failed attempts:

Only Failed attempts may say `None` when there were no failures. Queries, sources, and edge cases must contain actual entries.

</details>

## Proactive and Deep Refinement Evidence

<details>
<summary>Proactive protocol</summary>

- Intent hypothesis (1-2 sentences):
- Pattern class and instances found (with search evidence):
- Proposal presented: minimal vs comprehensive scope, file list, verification for class:
- Human confirmation evidence (link or quote) — only when scope expansion was proposed; otherwise state no expansion needed with evidence:

</details>

<details>
<summary>Deep refinement evidence</summary>

- Detail gaps checked (visible/invisible surfaces, design tokens, messages):
- Edge cases enumerated and dispositioned (with verification per edge):
- Missing features researched (sources, ranked must/should/nice) and outcome (implemented with confirmation or deferred with reason):
- Refinement verification (focused checks per iteration, full gate on final tree):

</details>

## Design confirmations

- Product UI touched: <yes or no>
- Design files read for UI changes: `DESIGN.md`, `engineering/design-system-baseline.md`, and any owning surface design file, or <not applicable>

## Review classification

Substantially critical: No

Reason if yes: <explain the applicable criterion>

<!-- Set Yes for a breaking change, security fix, major architecture or protocol change, a new platform support claim, or a repo policy or workflow change that materially affects future work. -->

## Review requests

- CodeAnt body tag: `@codeant-ai review`
- CodeAnt comment link and head SHA: <link and SHA>
- CodeRabbit comment link and head SHA, for substantially critical PRs only: <link and SHA, or not requested>

Post each required tag as a separate PR comment containing only the tag. After each push or fix round, request review again and record the new comment link and head SHA here. For a substantially critical PR, add the CodeRabbit tag to this section and post it as a separate comment. Do not request CodeRabbit manually for other PRs. Automatic CodeRabbit reviews for non-draft PRs targeting `main` remain active and must complete before reporting the PR ready; drafts are excluded by `.coderabbit.yaml`.

## Checklist

- [ ] I confirmed the target base branch.
- [ ] I ran the applicable Verification Gate commands on the head SHA above.
- [ ] I recorded the Code Research Gate notes.
- [ ] I posted the required standalone bot comment or comments.
- [ ] I checked that CodeRabbit is requested only for a substantially critical PR.

## Footer

BetterShape-Agent | Filed by `<model slug or platform name>`, with `@<verified GitHub username>`, on `<YYYY-MM-DD>`
