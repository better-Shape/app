# A PR base is a property of the branch, not of the work

Recorded 24 October 2026 after PR #52 opened against the wrong base.

## Root cause

The base was chosen by copying a sibling PR instead of reading it from the
branch. PR #45 ran `arena/0eb73176-app` into `draft/mega-absorb-all`, so that
branch looked like "the base this line of work uses". It is not. PR #45's head
was cut from `draft/mega-absorb-all`. This branch was cut from `ae262b9b`,
which `git ls-remote --heads origin` confirms is the tip of `mega/absorb-all`.
Two branches holding identical content can need different bases, because the
base is where the branch diverged, not what the change is about.

`AGENTS.md` line 34 already states the rule: stack the branch on its inherited
base and open the PR against that base, and because Git does not record where a
branch was cut from, ask the human when the task does not name the base. Here
the task did name it, so the base was knowable and the guess was unnecessary.

## Measured consequence

`draft/mega-absorb-all` sat at `f2cefa62` and `mega/absorb-all` at `ae262b9b`,
547 commits apart. The same head SHA produced these two PRs:

| Base | Commits | Changed files | Additions | Deletions | Mergeable |
| --- | --- | --- | --- | --- | --- |
| `draft/mega-absorb-all` | 547 | 2539 | 374,816 | 103,849 | false, state dirty |
| `mega/absorb-all` | 1 | 9 | 422 | 763 | true, state unstable |

Four automated reviewers degraded or refused on the wrong base, and each one
failed differently, which is what made the cause hard to see:

- CodeAnt skipped the review entirely: "this PR changes more than 100 files,
  which usually means a migration, codemod, or vendor drop".
- Sourcery refused: "The GitHub API does not allow us to fetch diffs exceeding
  300 files, and this pull request has 2539".
- DeepSource reviewed `f2cefa6...7cb249d`, the whole divergence rather than the
  change.
- SonarCloud set its new-code period against the wrong base, so its Quality Gate
  failed on 20 issues in files this PR never touched. The gate read as a failure
  introduced by the change when none of it was. Scoping the issues API to the
  files actually changed returned zero.

A wrong base therefore does not just make a diff ugly. It silently invalidates
the review evidence, and it invalidates it in a way that looks like the author's
own defect.

## Corrected understanding

Check the base against the branch, not against a comparable PR. Two cheap
commands settle it before the PR is opened:

```bash
git rev-parse HEAD^                              # the cut point for a one-commit branch
git rev-list --count <candidate-base>..HEAD      # must equal the commits this work added
```

If the count exceeds the work, the base is wrong. After opening, read
`changed_files`, `commits`, `mergeable` and `mergeable_state` from
`gh api repos/<owner>/<repo>/pulls/<n>` before doing anything else. An absurd
file count and `mergeable_state: dirty` appear before any reviewer complains, so
they are the earliest and cheapest signal.

## Retargeting does not restart CI

This cost a separate round of confusion and is worth its own record. Changing a
PR's base fires the `edited` event only. A `pull_request` trigger that omits
`types` defaults to `[opened, synchronize, reopened]`, so those workflows do not
re-run. Verified in this repository on the same retarget:

| Workflow | Trigger as written | Ran on the base edit |
| --- | --- | --- |
| `pr.yml` (PR Hygiene) | `types: [opened, edited, synchronize, reopened]` | yes |
| `ci.yml` (CI) | bare `pull_request:` | no |
| `build-installers.yml` | bare `pull_request:` | no |
| `pr-policy.yml` | `pull_request_target`, `types: [opened, edited, synchronize, reopened]` | no run observed |

So retargeting a base alone cannot produce build or compile evidence from the
automatic `pull_request` workflows. Those require a `synchronize` event, usually
produced by pushing a commit. A manually dispatched workflow or maintainer
rerun may also produce evidence where configured and permitted. Plan the retarget
and next real commit together rather than waiting on automatic checks that will
not start from the retarget event alone.

## Change in behaviour

Read the base from the environment or the task, confirm it with the two commands
above, and verify the four PR fields immediately after opening. When a base has
to change afterwards, treat every review that already ran as invalid and say so,
because it was produced against a different diff, and expect to push a commit to
restart the workflows that matter.
