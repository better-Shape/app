# Proactive Problem Solving — Elaboration (Authoritative)

This document is the elaboration for the Proactive Problem Solving Protocol HARD CONSTRAINT in `AGENTS.md`. It is authoritative when `AGENTS.md` is truncated by tooling limits (e.g., Codex 32 KiB). The concise rule in `AGENTS.md` governs; this file provides the full operational detail that tooling may not load.

## Intent recognition

- Write 1-2 sentence hypothesis of underlying goal before editing.
- Treat initial message as evidence, not spec; consult repo context and `.dump/`.
- Ambiguous intent: offer recommendation, not menu, and get confirmation.

## Pattern matching

- Iterative discovery: after salient instance, re-search conditioned on findings.
- Name class explicitly, check boundaries bidirectionally, record instances + evidence in Research Gate.
- PR without class name is incomplete.

## Proactive solving

- NEVER symptom-only; trace via 5 Whys, name architectural vs logical root cause.
- NEVER silently expand scope; use 3-point proposal (minimal risk, comprehensive file list, verification for class) with two options + recommendation, closed-world enumeration, wait for explicit confirmation.
- If human confirms minimal for multi-instance pattern, document remaining gap with follow-up issue.

## Enforcement detail

- Evidence gathering: parallel reads of file + consumers + tests + analogues; web search only when relevant and authorized, otherwise repo evidence + reason.
- Verification: tie every claim to tool output from this session; fresh-context re-read as verifier.
- Research Gate must include pattern class, instances, queries, sources, edge cases, failed attempts.
- PR description must include proposal + (when scope expanded) confirmation + class verification; when no expansion, state no expansion needed with evidence.

