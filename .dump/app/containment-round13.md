# Round 13 containment proof

Remote mega/absorb-all: b2184c4f0ed7b0a562799d70c02268349883efe2

Every commit that `git cherry` still reports as patch-unique (+) on a PR head has a
full-SHA `(cherry picked from commit ...)` trailer in mega history. The + count is
expected because conflict resolutions and deliberate ours-resolutions change patch-ids.

| PR | head | total commits | cherry + | missing trailer |
| --- | --- | --- | --- | --- |
| #3 | `ad555cc9` | 388 | 3 | 0 |
| #45 | `06f0da0d` | 341 | 4 | 0 |
| #46 | `2a58d045` | 348 | 10 | 0 |
| #49 | `4ae42361` | 351 | 10 | 0 |
| #50 | `5f61cad0` | 356 | 12 | 0 |
| #51 | `15dea734` | 360 | 21 | 0 |
| #53 | `041fd5bf` | 756 | 94 | 0 |

PR #53 tree equality: `git diff --stat 041fd5bf` is empty.

Absorption deviation records:
- `.dump/app/pr49-empty-pick-trailers.md`
- `.dump/app/pr50-absorb-deviations.md`
- `.dump/app/pr45-absorb-deviations.md`
