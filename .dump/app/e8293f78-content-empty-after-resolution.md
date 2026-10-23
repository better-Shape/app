# e8293f78 resolved to zero content (2026-10-23)

Situation: cherry-picking PR #3 arena/6d4df4bf commit e8293f78 "fix: bound preview and
configuration work and clarify save recovery" onto the taken-over remote line
mega/absorb-all (fc2b0ef9). Its indexed conflicts (components/ui/notification.tsx,
features/preview/design/shell.tsx, lib/ai/sync.ts, tests/lib/ai-sync.test.ts,
.dump/app/audits/bounded-preview-and-configuration-work.md) were resolved toward the
stage-2 (ours) side because HEAD implementations were strict supersets:

- notification.tsx: HEAD carries the fuller doc comment and the same contract.
- shell.tsx: HEAD carries the two explanatory comments and `silent: true` on
  bettershape-design-set-text postMessage; both predate and supersede incoming.
- lib/ai/sync.ts: HEAD grew the settle-budget implementation (CONFIG_SETTLE_ATTEMPTS=8
  plus a 2000 ms deadline); incoming is the older fixed-cap-only version.
- ai-sync.test.ts: HEAD's test "waits out a configuration burst that outlasts the fixed
  retry count" and the churn test asserting `edits >= 8` match the budget implementation;
  incoming's `edits < 32` assertion contradicts it.
- the audit doc: ours equals theirs plus an extra "Preview document lifecycle
  invariants" section.

After staging, the sequencer reported the cherry-pick EMPTY (resolved tree equals HEAD
tree), so the patch carried no new content and was skipped rather than committed empty.
Provenance: superseded by absorb; recorded here instead of an empty commit. Read the
incoming side once more before any later re-merge of PR #3 (still OPEN).
