# PR #45 absorption notes (branch `arena/0eb73176-app`, head `06f0da0d`)

PR #45 proposed an animated Windows NSIS welcome sidebar: a vendored AnimGif
plug-in, a 3.9 MB GIF, an `installerHooks` script and a test suite for that
hook. The mega line removed that design on 24 October 2026 and replaced it with
a static `sidebar.bmp`; `src-tauri/installer/README.md` records why (unsigned
2010 binary, `TerminateThread` in the plug-in's stop path, a 3.9 MB extraction
on every welcome-page visit, and a 5 MB per-file CI limit).

All three commits were therefore cherry-picked with `-x` and resolved entirely
to the mega implementation, producing empty commits that keep the provenance
trailers:

- `9cc6d23e` -> `a9088f66` (animation, assets, hook, tests)
- `38ec6bce` -> `2d98759c` (hook hardening review)
- `06f0da0d` -> `73a8aeff` (documentation corrections about that hook)

No animation asset, hook, plug-in or hook test is present on `mega/absorb-all`.
The static sidebar implementation and its installer-art test remain the current
design. The branch's older research and audit documents are already on the mega
line as historical records of the removed design, so their content is preserved
there rather than reintroduced.
