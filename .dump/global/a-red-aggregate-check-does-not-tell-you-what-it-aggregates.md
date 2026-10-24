# A red aggregate check does not tell you what it aggregates

## Conclusion

An aggregate check such as `CI Success` is red because one of the jobs in its
`needs:` list is red, and only those jobs. Red checks that are absent from
`needs:` cannot redden it, however prominent they look in the check list. Read
`needs:` before naming a cause. Do not infer the composition of a gate from the
set of failures displayed next to it.

## The gate in this repository

`.github/workflows/ci.yml:399`:

```yaml
needs: [lint, test-js, test-rust, rust-lints, build, version-sync]
```

`ci.yml:92-96` states the exclusion explicitly in a comment above the browser
job:

```
# Runs the full UI in headless Chromium against the static Browser
# Preview bundle (see e2e/README.md). NOT in ci-success `needs` yet -
# additive while the suite is new, same as static-macos below. Promote
# it into the gate once it has a few weeks of green history.
```

So `Test Browser (Playwright)`, `Browser Preview` and `Static Checks (macOS)`
are advisory. `Build Installers` is a separate workflow file and is not in the
list either.

Measured, not inferred. On head `a1d0076453327314331ef70bf34fb8013f3a15ec` of
`arena/4d3e2c3d-app` (run `40054305369`):

| check | conclusion |
| --- | --- |
| Test Browser (Playwright) | failure |
| Browser Preview | failure |
| Build Installer (macos-x86_64) | failure |
| Rust Lints (fmt, clippy) | success |
| CI Success | success |

Three checks red, aggregate green. That is the control which proves the reading
of `needs:`.

## The mistake this record exists to prevent

PR #52's body and its self-review comment both stated that `CI Success` failed
as the "aggregate of the three above", attributing the red aggregate to clippy
plus the two browser jobs. The real cause was clippy alone, in
`rust-lints`. Both claims were corrected in the body at head `a1d0076`.

Root cause of the mistake: the failing checks were enumerated first, and the
aggregate was described as their sum without opening the job definition. The
number three in the prose came from counting rows in a table I had built, not
from reading the workflow.

Why it is not a cosmetic error:

- It changes what has to be fixed to turn the gate green. Under the wrong
  reading, two browser jobs blocked the PR and needed work inside it. Under the
  correct reading, one clippy error did, and it was one line.
- It inflates the apparent blast radius of a change. A ten-file installer PR
  looked responsible for three failures instead of none.
- It misdirects the maintainer to pre-existing failures that the gate already
  tolerates on purpose.

## Rule

Before writing why an aggregate or required check is red:

1. Open the job definition and read `needs:` and any `if:` on the checking
   step. `.github/workflows/ci.yml` keeps a prose comment beside advisory jobs,
   so read the surrounding lines too.
2. Separate the red checks into needed and not needed. Only the needed ones can
   be the cause.
3. Where a head exists with the aggregate green and a non-needed job red, cite
   it. That observation settles the question without access to branch
   protection, which this token cannot read: `GET
   /repos/better-Shape/app/branches/<branch>/protection` returns 403
   `Resource not accessible by integration`, so "is it a required check" is
   unanswerable directly and `needs:` is the available evidence.

`mergeable_state` corroborates. `unstable` means a non-required check failed and
the PR is still mergeable; `blocked` means a required one failed. It was
`unstable` throughout, which was consistent with the browser jobs being
advisory and should have prompted the check earlier.

Related: `floating-rust-stable-breaks-ci-with-no-commit.md` for the clippy
failure itself, and `pr-base-is-a-property-of-the-branch.md` for the other way
this PR published a claim that later proved false.
