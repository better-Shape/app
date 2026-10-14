# .dump

The durable engineering memory of BetterShape. Not a trash folder, not a transcript, not a scratchpad: decisions, audits, research, rejected approaches and baselines that outlive the session. Write for the next engineer (or agent) who has to make the adjacent decision. Conclusions first, evidence second, narrative only where it changes the decision.

## Structure

- `global/`: project-wide principles, naming, decisions and open questions.
- `app/`: the app capability. Each holds `research/`, `plans/`, `decisions/`, `audits/` and `benchmarks/`, plus a `second-brain.md` once one is needed, stating what is true today.

## Rules

- A file belongs here only if it is useful to someone who never saw the session, and it states a fact, decision, plan or measurement rather than a narrative of what was done.
- A fact lives in exactly one file. Other files link to it.
- Write versions, SHAs, paths and sources, so a claim can be re-verified.
- Update the file in the same change that changes the understanding.
- Record rejected approaches and the reason, so they are not re-litigated.
- Superseded files are deleted or marked superseded with a link to the replacement.
- Never write secrets, tokens or raw provider output here. Redact, and name the store that holds the real value.
- Plans, triage records, research notes, audits and baselines belong here, never in a PR description.

Anything here is tracked by Git. Large datasets and generated artifacts stay out of the repository.
