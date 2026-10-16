# An inverted conflict-resolution map silently reverted four files

Measured 2026-10-16 while absorbing PR #3 into `mega/absorb-all`.

## What happened

Absorbing 41 commits from `arena/6d4df4bf-app` produced four files with conflicts.
I resolved them with a script:

```python
def repl(m):
    return (m.group(2) if path in pick_ours else m.group(1))
```

`re` puts the `<<<<<<< HEAD` side in `group(1)` and the `=======`/`>>>>>>>`
side in `group(2)`. In a cherry-pick, `HEAD` is this branch, so "ours" is
`group(1)`. The predicate read `pick_ours -> group(2)`, which is the incoming
side. Every one of the four files was resolved backwards.

## Why it nearly went unnoticed

Git reported the resolution as clean. No marker survived, the files parsed, and
`git cherry-pick --continue` succeeded. The damage was semantic:

- `features/agent/workspace/browser.tsx` lost `notificationStore` and
  `BrowserTab` from its import list.
- `features/git/ui/manager/git-manager.tsx` lost `StashPanel` and
  `readStoredGitSection`.
- `features/git/ui/source/source.tsx` lost three extracted hooks and went back
  to the inline bodies, while the incoming side's cleanly-applied hunks left a
  render-phase guard and an inline `useCallback` sitting in the same component.
- `app/welcome-screen.tsx` kept the old `useState` reader while its imports had
  already been replaced with `useSyncExternalStore`.

Only reading each file's imports and call sites after resolving exposed it.

## Changed behaviour

1. **A conflict resolution script must name the capture group, not the side.**
   Write `group(1)` for HEAD and `group(2)` for the incoming side, then choose by
   name in the call site. A variable called `pick_ours` that returns `group(2)` is
   a bug that reads as correct.
2. **After resolving conflicts, read each conflicted file.** `git status` proves
   the markers are gone, not that the surviving code is the code you meant.
3. **When one side refactored code the other side edited, port the edit.** The
   incoming `fead3a96` changed the inline diff-loading effect in `source.tsx`;
   taking this branch's side wholesale would have dropped that fix. The two fixes
   were re-applied inside the extracted hooks instead, which is what "keep both
   sides" actually means.
4. **Amending a cherry-picked commit's message drops its provenance trailer.**
   `git commit --amend -F` replaces the whole message, so the
   `(cherry picked from commit ...)` line went with it. Restored with a bounded
   `git filter-branch --msg-filter` over the 41-commit range and verified by
   matching all 41 SHAs against the trailers in the log.
