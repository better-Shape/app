# PR #46 `.qa` artifacts excluded from the absorption (2026-10-25)

Cherry-picking PR #46 commit 6a27b0a8 "fix: address motion-system review findings" onto
mega/absorb-all. The commit carried a tracked `.qa/PR #46 - Implement the app-wide motion
system/` tree of review screenshots and captured pages. `.qa/` is absent from mega/absorb-all
and from every other branch that has been absorbed; it is working evidence, not source.

Decision: the `.qa` tree was dropped with `git rm -r --cached` plus `rm -rf` before staging,
so the record commit adds no `.qa` paths and the worktree carries none. `.gitignore` already
ignores `/.dump/app/qa/` and `/.qa-artifacts/`; `.qa/` itself is simply not part of the line.

If PR #46 is re-read later, do not re-add these artifacts.
