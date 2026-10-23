# PR #10 was closed on purpose; its content must NOT be absorbed (2026-10-23)

What happened: PR #10 (arena/de274efa-app) is closed-unmerged and its 3 commits are the
engineering dossier docs (engineering/dossiers/*, agent-handoff.md, issues/create_issues.py).
I saw 0 same-subject variants on mega and cherry-picked all 3 onto mega/absorb-all
(3c838eac, 90ab9316, c8f8a995). The human corrected me: PR #10 was PURPOSely closed; the
dossier plan content is intentionally excluded from the mega line.

Root cause: I used the working theory "closed and unmerged means not-yet-absorbed", but
some closed PRs on this repo were closed deliberately with absention intended. Closure state
alone does not decide absorb intent; only the human's word does for already-closed PRs.

Corrected behaviour: for closed PRs, ask the human (or rely on an explicit standing
exclusion) before absorbing. Standing exclusions so far: PR #10 entirely. Absorb targets are
the OPEN PRs (#3/#45/#46/#49/#50/#51) that the human asked to fully absorb and then close.

Action taken: reset local mega/absorb-all from c8f8a995 to f97ff6d5, dropping exactly the
3 picks. Nothing else was on top. Remote was not touched (no push after f97ff6d5).
