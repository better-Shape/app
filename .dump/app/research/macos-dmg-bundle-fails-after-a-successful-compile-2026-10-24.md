# macOS DMG bundling fails in CI after a successful compile

## Conclusion

`Build Installer (macos-x86_64)` can fail inside `bundle_dmg.sh` after the crate
has compiled, the `.app` has been bundled and nothing in the change is
implicated. It is a packaging failure at the last step of the macOS target, not
a build failure. Treat it as a flake only after the discriminators below all
hold, because the same step also reports genuine breakage.

## Observation

Run `40054305420`, job `120753766389`, head
`a1d0076453327314331ef70bf34fb8013f3a15ec` of `arena/4d3e2c3d-app`, step 6
`Build Tauri bundle`. From the check-run annotation:

```
> tauri build --bundles dmg --target x86_64-apple-darwin
   ...
✓ Compiled successfully in 10.5s
  Finished TypeScript in 25.6s ...
✓ Generating static pages using 3 workers (9/9) in 1754ms
    Updating crates.io index
   Compiling app v1.0.3 (/Users/runner/work/app/app/src-tauri)
    Finished `release` profile [optimized] target(s) in 14m 44s
       Built application at: .../target/x86_64-apple-darwin/release/app
    Bundling BetterShape.app (.../bundle/macos/BetterShape.app)
    Bundling BetterShape_1.0.3_x64.dmg (.../bundle/dmg/BetterShape_1.0.3_x64.dmg)
     Running bundle_dmg.sh
failed to bundle project error running bundle_dmg.sh: `failed to run .../bundle_dmg.sh`
       Error failed to bundle project error running bundle_dmg.sh
```

`next build` succeeded, TypeScript succeeded, static generation succeeded, the
Rust release compile succeeded in 14m 44s, the application binary was built and
the `.app` bundle was produced. The only failing operation is DMG assembly.

Also present and unrelated: a warning that the bundle identifier
`com.bettershape.app` ends with `.app`, which Tauri advises against because it
collides with the macOS application bundle extension. It is a warning, it does
not fail the build, and it predates this branch.

## Discriminators that made this a flake rather than a regression

All four held:

1. The sibling architecture ran the same script on the same head and passed.
   `Build Installer (macos-aarch64)` is `success` on `a1d0076`.
2. The same target passed on the immediately preceding head. `macos-x86_64` is
   `success` on `5a1cb9b` (run `40049499891`), whose macOS-relevant
   configuration is byte-identical.
3. The delta between those two heads cannot reach macOS packaging.
   `git diff --name-only 5a1cb9b..a1d0076` is
   `src-tauri/src/core/turn_order.rs` (one `#[allow(deprecated)]` plus a doc
   comment) and `.dump/global/floating-rust-stable-breaks-ci-with-no-commit.md`.
   The Rust file compiled successfully in the failing job, so it is exonerated
   by the job's own log.
4. The change to `src-tauri/tauri.conf.json` in this branch touches only the
   `bundle.windows.nsis` block, removing `installerHooks`. The `bundle.macOS`
   block is unchanged, verifiable with
   `git diff ae262b9b..HEAD -- src-tauri/tauri.conf.json`.

The step that fails matters more than the job that fails. A failure before
`Finished release profile` is a code or dependency problem. A failure at
`Running bundle_dmg.sh` after it is a packaging problem.

## A flaked job cannot be re-run with this token

```
POST /repos/better-Shape/app/actions/runs/40054305420/rerun-failed-jobs  -> 403
POST /repos/better-Shape/app/actions/runs/40054305420/rerun              -> 403
{"message":"Resource not accessible by integration"}
```

`gh run rerun <id> --failed` reports `run ... cannot be rerun; its workflow file
may be broken`, which is misleading. The workflow file is intact and five of six
targets ran from it successfully; the real cause is the missing `actions:write`
scope, the same reason `workflow_dispatch` and the branch-protection and
actions-permissions endpoints all return 403. Do not chase a broken workflow
file on that message.

Consequence: the only way to obtain a fresh attempt at a flaked job is to push a
commit, which re-triggers the `pull_request` workflows for the new head. A
content-free push purely to re-roll CI is worse than recording the flake and
letting the maintainer re-run, so pair the push with a change that is owed
anyway.

## Diagnosing CI failures when the logs are unreachable

Job logs redirect to `*.blob.core.windows.net`, which is outside this sandbox's
allowlist, so `gh run view --log` cannot be used. The check-run annotations
endpoint carries the tail of the failing step and is reachable:

```
GET /repos/better-Shape/app/check-runs/{job_id}/annotations
```

The job id comes from `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs`,
whose `steps[]` gives the failing step number and name. That combination
produced everything above. Where a workflow posts its own comment, as
`rust-lints` does with the clippy output, the comment is a second source and is
what recovered the deprecation text.

Note the annotation truncates. `jq` on `.message` returns the whole text; a
`.[0:600]` slice cut this one off before `bundle_dmg.sh` appeared and pointed at
`next build` instead, which would have been the wrong conclusion.

## Related

`../../global/floating-rust-stable-breaks-ci-with-no-commit.md` for the clippy
deprecation that commit `a1d0076` fixed, and for why the 1.88 `@rustbin`
toolchain cannot reproduce a deprecation introduced in 1.99.
`../audits/native-toolchain-and-cross-target-verification.md` for what the
sandbox can and cannot compile.
`../../global/a-red-aggregate-check-does-not-tell-you-what-it-aggregates.md` for
why this failure does not redden `CI Success`.
