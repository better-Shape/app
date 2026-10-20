# Deep Refinement Protocol — Decision Record

**Date:** 2026-10-20
**Branch:** `arena/5cd4a20b-app`
**Commit base:** `951bb38` (proactive protocol) -> new
**Decision:** Generalize proactive protocol to all agents and harden deep refinement behavior

## Summary of changes

1. **Removed Fable 5.5 specificity from AGENTS.md**
   - Title: `HARD CONSTRAINT (Fable 5.5)` -> `HARD CONSTRAINT`
   - Intro: removed "documented for Fable 5/5.1/5.5" -> generic "implements relentlessly proactive behavior: investigate before acting..."
   - Added explicit universal scope sentence: "This applies to every agent operating in this repository."
   - 5 internal references updated:
     - `Classify per the Fable method` -> `per the Think/Act/Prove method`
     - `Fable loop` -> `proactive loop`
     - `Fable 5's memory progression` -> `the memory progression`
     - `In Fable 5 experiments` -> `In controlled experiments`
     - `verifier subagent` -> `verifier`
   - Verified: `grep -n Fable AGENTS.md` returns no results. Protocol is now agent-agnostic.

2. **Added Deep Refinement Protocol — HARD CONSTRAINT (new section 123-220 in new AGENTS.md)**
   - Applies after proactive protocol, before Git
   - Total AGENTS.md: 481 -> 554 lines, 2 HARD CONSTRAINT sections
   - Content implements user verbatim hardening: "everything you've achieved so far in this session but you still need to go into deep refinement a lot of the implementations on first glance look good but you know there's very little attention to detail and very some very rough edge cases that can be further improved and also there are some features that me that are also missing that you that should be there research and implement and refine the entire implementation of everything so far"
   - Operationalized into 7 subsections mirroring proactive structure for consistency:
     - 1. Deep refinement mindset — first-pass is never done (mandatory refinement pass, refinement assumption)
     - 2. Attention to detail — visible surfaces, invisible surfaces, messages, design tokens, ui-capture, Delivery Gate
     - 3. Edge cases — exhaustive enumeration, patterns that look correct, test additions, full gate re-run
     - 4. Missing features — external references, ranked list, confirmation-gated implementation, holistic integration
     - 5. Refinement execution — loop `implement -> detail audit -> edge case sweep -> missing feature search -> propose -> implement -> verify -> repeat`
     - 6. Hard boundaries — not gold-plating, not silent scope expansion, not skipping verification, not weakening tests
     - 7. Enforcement — verification gate re-run per iteration, research gate must list detail gaps/edge cases/missing features, PR must include refinement summary, pre-push re-review entire diff

## Rationale

- **Generalization:** Prior protocol was tied to rumored model name. User clarified it is for all agents. Generic language increases durability across model rotations, per AGENTS.md rule "Do not encode a fact that changes often."
- **Deep refinement:** Addresses observed failure mode where first-pass implementations pass happy-path checks but fail on detail, edge cases, and completeness. Same class of issue as proactive protocol — shallow first pass vs system-wide correctness. Research cited in prior decision record (70% chronic recurrence, 15x-100x cost later, verifier 73% vs 33% catch rate) supports mandatory refinement pass.

## Integration points

- Proactive Protocol defines *scope* (intent -> pattern -> propose comprehensive fix with confirmation). Deep Refinement defines *depth* (detail -> edge -> missing -> iterate).
- Both feed into existing gates: Code Research Gate now must list detail gaps/edge cases/missing features + sources; Verification Gate must be re-run after each refinement iteration with new head SHA.
- Confirmation rule shared: both protocols use closed-world scope contract, minimal vs comprehensive options, explicit human confirmation before expansion.

## Verification

- `grep Fable` clean on AGENTS.md
- `grep "HARD CONSTRAINT"` count 2, `grep "Deep Refinement"` present
- Line count 554, markdown renders, prior proactive content preserved verbatim aside from generic replacements
- .dump file created per AGENTS.md durable memory rules

## Future work

- None required before commit. Refinement loop is bounded: must eventually declare evidence-backed completeness. Prevents infinite polish by defining stop condition explicitly.
