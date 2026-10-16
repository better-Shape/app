# I deleted the pack files during a disk recovery and broke the local history

Measured 2026-10-16 on `mega/absorb-all`, immediately after absorbing PR #3.

## What happened

The disk hit 100%. `npm ci` had pushed it from 2.1 GB free to 200 MB, because
`node_modules` was reinstalled at 1.7 GB while `cargo-target`, the npm cache and
the Playwright browser cache were all live at the same time.

Recovering, I ran `git gc --prune=now` to reclaim the 800 MB pack. It failed with
`fatal: sha1 file '.git/objects/pack/tmp_pack_2SMwaS' write error. Out of
diskspace` and left `.git` at 1.5 GB with the disk still at 100%.

The next command was `rm -f .git/objects/pack/*.pack`, intended to drop the failed
gc's temporary pack. The glob took every pack, not just the temporary one.

The repository lost 800 MB of packed history. `git log` printed the tip and then
failed to traverse: `error: Could not read ee90df4a...`.

## Why it was survivable

Two things had to be true, and both were luck rather than design:

1. The work since the last push was loose, because it had just been committed.
   Those 2616 loose objects, 12.3 MB, survived.
2. The base history still existed on the remote, so `git fetch` could bring the
   packs back.

Recovery, in order:

1. Freed space, because the first fetch failed on `No space left on device` and
   left its own `tmp_pack` behind.
2. Deleted the stale `refs/remotes/*` pointers, which referenced objects that no
   longer existed and made `git fetch --all` abort before it started.
3. `git fetch better-shape '+refs/heads/*:refs/remotes/better-shape/*'`.

After that `git rev-list --count HEAD` returned 402 and traversed back to
`34ee0b13 init`. All 41 cherry-pick provenance trailers were still present and
the working tree was clean. Nothing was lost.

## Changed behaviour

1. **Never `rm` a glob inside `.git/objects/pack`.** A pack file IS the history.
   If a gc has to be undone, the only safe move is to delete the specific
   `tmp_pack_*` file by name, and to check `df` first.
2. **Check disk headroom for `git gc` before running it, not after.** gc writes a
   new pack before removing the old ones, so it needs roughly the size of the
   existing pack set. At 800 MB of packs it needed 800 MB free and had none.
3. **A full disk makes `df`, `du` and `ls` return nothing.** That looks like a
   broken tool. It is the disk. Stop running diagnostics and free space with
   `rm` on paths you already know.
4. **On this box, deleting a 1 GB cache did not move `df`.** `/root/.cache/opencode/npm`
   went from 1019 MB to gone and free space stayed at 681 MB, because a failed
   `git fetch` had written its own pack in the same window. Always re-read `df`
   after a delete rather than assuming the space came back.
5. **Keep an unpushed-work escape hatch.** Before any destructive git operation,
   confirm the loose objects alone cover everything since the last push. The
   remote is a floor, not a backup of local work.
