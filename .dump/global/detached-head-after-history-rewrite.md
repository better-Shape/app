# Detached HEAD after a second history rewrite

Recorded while restarting the goal, before touching the remote.

## What the state looked like

`git status` was clean and the work was all there, but three things were wrong at once.

1. **HEAD was detached at `a845abe` and no branch referenced it.** The reflog showed why:
   `a845abe` is the tip of the *second* `filter-branch` pass. The first pass left the tip on
   `mega/absorb-all` at `9559e90`, then the second rewrite ran while HEAD was detached and only
   the dangling commit advanced. Every commit since the rewrite, including the one that records
   the fabricated co-author, existed only as an unreachable object reachable from the reflog.

   A `git gc`, a `git checkout` of anything else, or a crash would have dropped them. The tip was
   also newer than anything the remote holds, so it was the only copy.

2. **`mega/absorb-all` was stale.** It pointed at `9559e90`, the tip of the *first* rewrite.
   HEAD is strictly ahead of it and they are not the same history line:

   ```
   git merge-base HEAD mega/absorb-all   ->  ee90df4 "chore: release v0.0.1"
   commits only on mega/absorb-all: 346
   commits only on HEAD:           348
   ```

   So the two branches looked unrelated. They are not. The 346 are the same work under different
   SHAs, because `filter-branch` replaced every commit object in the range. The 2 extra on HEAD are
   `core: fetch_update was renamed to try_update` (the reworded version of `fix(core): ...`) and the
   dump commit itself. Proof that HEAD is the correct tip:

   ```
   diff <(git log --format=%s mega/absorb-all | sort) <(git log --format=%s HEAD | sort)
   > core: fetch_update was renamed to try_update
   > dump: record the fabricated co-author and the partial verification gate
   ```

   Two subjects added, nothing removed. The tree diff between the two tips is only
   `.dump/global/agent-identity-and-gate.md` (new) and `src-tauri/src/core/turn_order.rs` (one line,
   the commit-message-only fix).

3. **The branch's upstream pointed at the wrong repository.**
   `branch.mega/absorb-all.remote` was `shape`, merging `refs/heads/arena/0c0f702a-shape`. That is
   `https://github.com/Owie6789/Shape.git`, the *upstream* project, not `better-Shape/app`. A bare
   `git push` would have targeted upstream's branch, 244 commits away, and created or moved a branch
   in a repository this fork does not own. Fixed with
   `git branch --set-upstream-to=better-shape/draft/mega-absorb-all`.

## What was done

Local only. No remote was touched.

```
git tag -a pre-anchor -m "tip before re-anchoring ..." a845abe
git branch -f mega/absorb-all a845abe
git checkout mega/absorb-all
git branch --set-upstream-to=better-shape/draft/mega-absorb-all mega/absorb-all
```

Verified afterwards: on branch `mega/absorb-all` at `a845abe`, working tree clean, upstream
`better-shape/draft/mega-absorb-all`.

## Why the remote still holds the fabricated trailers

`better-shape/draft/mega-absorb-all` is at `289b134`, which is the pre-rewrite original. Pushing the
corrected history needs a force push, because `filter-branch` changed every SHA in the range:

```
git merge-base --is-ancestor better-shape/draft/mega-absorb-all HEAD   ->  false
commits only on HEAD:      348
commits only on the remote: 305
```

The remote tip's trailer is the genuine upstream one,
`Co-authored-by: arena-agent <297053741+arena-agent@users.noreply.github.com>`. The 23 invented
trailers are on commits in the middle of the range, not the tip.

AGENTS.md requires the human's explicit go ahead for a force push, so none was made.

## The lesson

A `git status` that reads clean says nothing about whether the work is *reachable*. After any
history rewrite the checks that matter are:

```
git rev-parse --abbrev-ref HEAD                                  # detached?
git branch --contains HEAD                                       # does anything point here?
git branch -vv                                                   # is the upstream the right repo?
git merge-base --is-ancestor <remote> HEAD                       # will this be a force push?
```

The first session after the rewrite checked the gates and the tree and declared the work safe. The
gates passed because the files were right. What was wrong had nothing to do with the files.