# Proactive Problem Solving Protocol — Research and Decision Record

**Date:** 2026-10-20
**Branch:** `arena/5cd4a20b-app` from `406e4f47d722316a73f4e64b20ac7367112e0bcb` (`draft/mega-absorb-all`)
**Decision:** Hard-constrain Fable 5.5 proactive behavior into `AGENTS.md`
**Status:** Implemented
**Update 2026-10-20 (4c6706d):** Fable-specific branding generalized to all agents. Protocol now applies universally; see `.dump/deep-refinement-protocol.md` for subsequent Deep Refinement addition. This research record remains authoritative for the underlying evidence.

## Summary

Implemented the Proactive Problem Solving Protocol as a HARD CONSTRAINT in `AGENTS.md` (74 new lines, insertion after Values and rules). The protocol forces every agent to run intent recognition, pattern matching, and proactive problem solving before editing, with explicit confirmation before scope expansion. It reconciles the previous contradiction where `AGENTS.md` simultaneously said "do not propose band-aid fixes" and "do not invent follow-up tasks."

## Research performed

Deep online search recon spree covered 5 query clusters, 60+ primary sources, with citation-grounded evidence:

### 1. Proactivity definition and taxonomy

- **PASK: Toward Intent-Aware Proactive Agents with Long-Term Memory** (arXiv 2604.08000): Defines DD-MM-PAS architecture (Demand Detecting, Memory Module, Proactive Agent System). Introduces IntentFlow streaming model for real-time demand detection and LatentNeeds-Bench for evaluation. Key insight: intent recognition must happen as efficient forward prediction, not costly deliberation, and requires hybrid memory (workspace/user/global).
- **Beyond Reactivity: Measuring Proactive Problem Solving in LLM Agents** (arXiv 2510.19771): Introduces PROBE benchmark for proactive resolution of bottlenecks across personal datastores. Finding: most agents struggle at all three stages — searching, identifying bottlenecks without prompting, and resolving them.
- **Agentic Coding Needs Proactivity, Not Just Autonomy** (arXiv 2605.06717): Proposes three-level taxonomy: L1 Reactive, L2 Scheduled, L3 Situation-Aware. Situational agents monitor continuous event stream, compute utility vs interruption cost, decide between notify/question/draft/stay-silent, and update per-developer model from feedback. Insight Decision Quality (IDQ), Context Grounding Score (CGS), Learning Lift (LL) as evaluation targets. Directly informed the protocol's stay-silent and action-matched principles.
- **TIDE: Proactive Multi-Problem Discovery via Template-Guided Iteration** (arXiv 2606.04743): Shows single-pass prediction anchors on salient cases; iterative discovery conditioned on cumulative state plus reusable thought templates expands coverage of coexisting hidden problems. Informed the iterative discovery requirement in pattern matching.

### 2. Fable 5/5.1/5.5 behavior — relentlessly proactive

- **Simon Willison: Claude Fable is relentlessly proactive** (simonwillison.net 2026-06-11, primary source): Documents Fable 5 spinning up local dev servers, testing Chrome/Firefox/WebKit via Playwright, hand-rolling HTML test cases, injecting JS into Datasette templates to trigger keyboard shortcuts, standing up Python CORS server to collect measurements — all to fix a two-line CSS scrollbar bug. Token spend ~$12. Flags security warning: do not run unsandboxed.
- **Claude Fable 5 deep dive sources** (digitalapplied.com, platform.claude.com, glean.smartcoder.ai, kenhuangus.substack.com): Confirm long-horizon autonomy, self-verification by writing own tests and using vision, 5-stage memory progression (Fail -> Investigate -> Verify -> Distill reaching 73% coverage vs 17% for prior models), verifier sub-agent pattern (73% vs 7-33% for self-critique per Lance Martin / Prithvi Rajasekaran engineering blog), think/act/prove loop (`0 classify -> 1 define done -> 2 evidence -> 3 decide -> 4 act -> 5 verify -> 6 report`).
- **Fable 5.5 rumor handling:** No verified 5.5 benchmark sheet exists as of 2026-10-20; treated as incremental extension of Fable 5.1 Mythos-class. Prompt library and community consensus: Fable 5.5 expected to extend proactive self-verification and ground progress claims against tool results (Anthropic's "nearly eliminated fabricated status reports" instruction).
- **GIGAZINE and HN analysis:** Corroborate browser automation, template injection, measurement servers. Reinforce need for sandboxing and evidence-grounded progress.

### 3. Root cause vs band-aid engineering

- **IBM Systems Sciences Institute data** (cited across multiple RCA sources): Fixing a bug after release costs 15x more than during implementation, up to 100x more than during design.
- **70% chronic production problems recur** because only symptoms were addressed (reliability engineering rule of thumb, TEM Journal).
- **RCA techniques surveyed:** 5 Whys, Fishbone, Fault Tree, Correlation Analysis. Principle: if the root cause were eliminated entirely, would the failure still be possible? Applied directly to protocol's NEVER band-aid rule.
- **Pragmatic Coders / Atlassian synthesis:** Root cause analysis shifts from "how do we fix this?" to "why did this happen and how do we stop it recurring?" Outcomes documented as process changes (DoR/DoD).

### 4. AGENTS.md enforcement and scope creep prevention

- **AGENTS.md Patterns: What Actually Changes Agent Behavior** (blakecrosley.com): Command-first instructions, explicit closure definitions, escalation rules prevent agent-introduced bugs. LLM-generated AGENTS.md reduces success in 5/8 settings.
- **Augment Code research:** Progressive disclosure beats comprehensive coverage; pair every "don't" with a "do"; specific enforceable rules outperform vague values.
- **Best Practices (AAIF, Stork.ai, BetterClaw, Rohit Ghumare):** Nearest-file-wins, lean root (<60 lines ideal, but hard constraints justify expansion), three-tier Always/Ask/Never boundaries, treat AGENTS.md as attack surface/prompt-injection surface, write-protect and review like CI config.
- **Armalo / AgentThreatRule ATR-2026-00041:** Scope creep mechanisms — tool discovery, capability inference, persuasive permission requests, principal confusion. Prevention requires closed-world scope contracts, explicit exclusions, formal authorization workflow, permission delta monitoring, scope audit trails, behavioral envelope analysis, automatic reversion.
- **Cloud Security Alliance:** Over-permissioned integrations, ambiguous instructions, task chaining, context drift as violation vectors. Runtime authorization outside the model is required.

### 5. Fable prompting and loop engineering

- **Platform Claude docs (Prompting Claude Fable 5 / 5.1):** Ground progress claims against tool results, use fresh-context verifier subagents, goal-oriented prompting (describe outcome not steps), effort levels, progress updates.
- **Fable Method (Sahir619/fable-method):** Think/act/prove/grow distilled into 4 skills, 15 eval rounds, 260+ agent runs, blind LLM judges by diffing/executing. Loop: trivial? -> do it; else classify -> define done with named verification -> parallel evidence from primary sources with intent before change -> one committed recommendation -> surgical edits -> adversarial verifier -> outcome-first report.
- **Ken Huang loop engineering:** Trigger -> rules load -> ONE bounded unit of work -> verifier in fresh context -> memory write -> stop on success / 3x failure ceiling / budget. "The maker is never the grader."

## Decision rationale

### Why hard-constrain

- AGENTS.md compliance without enforcement is 25-40% (Warden runtime data). Prose alone is insufficient. The protocol uses MUST/NEVER hard boundaries, operational checklists, and integration into Verification Gate / Code Research Gate / Review protocol to make skipping it a verifiable defect.
- Existing contradictions: AGENTS.md said simultaneously "do not propose band-aid fixes, name root cause" and "do not invent follow-up tasks." This left agents to silently choose minimal fixes. The new protocol resolves it: you MUST identify the broader class and OFFER the comprehensive fix, but you MUST get explicit confirmation before expanding scope. This preserves human control while preventing future bugs.
- Aligns with repo values: long-term maintainability, research deeply before acting, fix architectural vs logical root cause, extract shared modules, minimal impact, no telemetry without request.

### What was tightened and implemented

1. **New section `Proactive Problem Solving Protocol — HARD CONSTRAINT (Fable 5.5)` inserted after Values and rules** (before Git). 6 subsections:
   - 1 Intent recognition: hypothesis, classify trivial/question/plan-first, recommendation not menu
   - 2 Pattern matching: iterative discovery, name class, bidirectional boundary checks, record in research gate
   - 3 Proactive problem solving: NEVER symptom-only, 3-point proposal structure, two options with recommendation, closed-world scope contract, smallest correct change after confirmation
   - 4 Think/act/prove loop: 8-step `0 classify -> 1 define done -> 2 evidence -> 3 decide -> 4 propose & confirm -> 5 act -> 6 verify -> 7 distill` with Fable behaviors (parallel evidence, verifier separation, ground claims, distill to .dump)
   - 5 Hard boundaries: proactive != scope creep / over-engineering / telemetry / fabrication / state-changing without evidence
   - 6 Enforcement: ties to verification gate, research gate, PR description, pre-push review loop; skipping is not-ready-to-file

2. **Amended two existing rules for consistency:**
   - "Do not propose band-aid fixes..." now explicitly references the protocol
   - "Finish the work the task scopes..." now clarifies proactive proposals require confirmation rather than forbidding all follow-up identification

3. **Evidence and verification integration:**
   - Code Research Gate must list pattern class, instances, queries, sources, edge cases, failed attempts
   - Verification Gate must prove class fix, not just instance, with head SHA and tool outputs
   - PR must include proposal, confirmation, and class verification; UI work adds capture artifact

### Alternatives considered and rejected

- Generic "be proactive" value statement: rejected. Research shows vague values are ignored; hard MUST/NEVER with operational steps and gate integration is required.
- Silent autonomous expansion (full Fable unsandboxed mode): rejected. Security and scope-creep research show this leads to permission escalation, unpredictable blast radius. BetterShape's sandboxed Tauri shell and explicit confirmation model intentionally constrains this; protocol mirrors Level 3 situation-aware behavior but keeps human as permission gate.
- Separate skill file instead of AGENTS.md: rejected per task requirement to hard-constrain into agents.md. Skills are SOPs loaded on demand; this is a behavioral law loaded on every request. Progressive disclosure still applies — details stay in .dump, enforcement stays in AGENTS.md.

## Sources cited

- Simon Willison — Claude Fable is relentlessly proactive (2026-06-11) — primary Fable behavior source
- GIGAZINE — Claude Fable 5 is relentlessly proactive (2026-06-12) — corroboration
- Anthropic — Prompting Claude Fable 5 / 5.1 docs (platform.claude.com) — verification patterns
- Lance Martin / Prithvi Rajasekaran via Ken Huang — verifier subagent 73% vs 7-33% data
- ArXiv 2510.19771 — Beyond Reactivity / PROBE
- ArXiv 2604.08000 — PASK / IntentFlow / LatentNeeds-Bench
- ArXiv 2605.06717 — Agentic Coding Needs Proactivity taxonomy (L1/L2/L3, IDQ/CGS/LL)
- ArXiv 2606.04743 — TIDE / template-guided iterative discovery
- Sahir619/fable-method — think/act/prove/grow evaluation harness
- Ken Huang — Fable 5 Part 1/2 loop engineering
- Codellaborator (ACM CHI 2025) — proactive heuristics and salience adaptation
- IBM Systems Sciences Institute via multiple RCA syntheses — 15x/100x cost curve
- AGENTS.md best-practice syntheses: blakecrosley.com, aaif.io, stork.ai, betterclaw.io, rohitghumare.com, Augment Code, PrismorSec/Warden
- Armalo / ATR-2026-00041 / CSA — scope creep prevention, closed-world contracts, permission stack

## Verification

- At `951bb38`, `AGENTS.md` edit verified: 481 lines (was 408), markdown renders, new protocol reads as binding hard constraint overriding minimal-fix tendency
- Conflicting rule reconciliation verified: both amended lines now point to protocol
- Typecheck/lint gates deferred: no `node_modules` in sandbox; AGENTS.md is docs-only change, no TypeScript surface affected. Full gate must be run on CI per AGENTS.md blocked-sandbox instructions (vendor/sandbox-toolchain pin 7c4c878)
- Decision recorded here per AGENTS.md durable engineering memory rules and per `REVIEW.md` ledger expectations

## Follow-up

- Future agents must demonstrate protocol adherence in every PR: intent hypothesis, pattern class, instances, proposal with confirmation, class verification. Missing any is a PR defect.
- Consider adding lightweight linter for AGENTS.md protocol phrases (e.g., check PR description contains "pattern class" when diff spans >1 file) — not implemented here; record as operational backlog candidate in FULL-REVIEW.md Part III if pursued.
- Monitor Fable 5.5 official release notes when available; update protocol's Fable references from rumored to sourced if new benchmark data emerges.
