# Floating Rust stable under `-D warnings` breaks CI with no commit

Recorded 24 October 2026 from PR #52, where `Rust Lints (fmt, clippy)` failed on
a line this PR never touched.

## The trap

Three facts combine so that CI can go red with zero commits to the repository:

- `src-tauri/Cargo.toml:9` declares `rust-version = "1.89.0"`.
- There is no `rust-toolchain.toml` anywhere in the tree, and
  `.github/actions/setup/action.yml:76` installs `toolchain: stable` through
  `dtolnay/rust-toolchain`. The toolchain therefore floats.
- `.github/workflows/ci.yml:248` runs
  `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`,
  so any new deprecation in a newer stable becomes a hard error.

`ci.yml` triggers on `pull_request` and on `push: branches: [main]`. It does not
run on pushes to `mega/absorb-all`, so work absorbed there is never linted until
someone opens a PR based on it. PR #52 was the first PR based on
`mega/absorb-all`, and it surfaced a failure that had been sitting in that
branch's Rust since Rust 1.99.0 reached the runner images.

## The instance

```
error: use of deprecated method `std::sync::atomic::Atomic::<u64>::fetch_update`:
       renamed to `try_update` for consistency
  --> src/core/turn_order.rs:13:10
   = note: `-D deprecated` implied by `-D warnings`
```

Rust 1.99.0, stable from 2026-10-01, deprecated `Atomic*::fetch_update`. The
line is byte-identical at commit `ae262b9b`, so no change in PR #52 caused it.
The same job passed 14 minutes earlier on an older runner image in an unrelated
project (`peters/horizon#1348`), and a re-run stays on the new image, so
retrying does not help (`warmblood-kr/remuda#608`).

## Why the suggested fix is wrong here

Clippy offers a one-line rename, and most projects took it. This one cannot.

- `try_update` is `#[stable(feature = "atomic_try_update", since = "1.95.0")]`.
- `fetch_update` is `#[stable(since = "1.53.0")]` plus
  `#[deprecated(since = "1.99.0", note = "renamed to `try_update` for consistency")]`,
  and in std its body is literally `self.try_update(set_order, fetch_order, f)`,
  so the two are semantically identical.
- This project's declared MSRV is 1.89.0, below 1.95.0, and
  `engineering/rust-toolchain.md:69-70` records that the vendored sandbox
  toolchain on `vendor/sandbox-toolchain` is 1.89.0 specifically to match that
  pin, as is `notify-rust@4.18.0`'s own `rust-version`.

Renaming would break the declared MSRV, break the documented sandbox toolchain,
and be rejected by clippy's own `incompatible_msrv` lint. It trades a
`deprecated` error for a compile error on 1.89 through 1.94.

Upstream splits exactly on this line. Projects at MSRV 1.95 or above did the
pure rename (`peters/horizon#1351`, `atusy/kakehashi#1182`,
`diazoxide/charter#831`, `ricktaylor/hardy#761`). Projects below 1.95 suppressed
and deferred (`valkey-io/valkey-glide#7253`, `apache/datafusion-comet#6507`,
`cheerc/agend-terminal#4`, `sturnus-dev/sturnus#80`,
`googleapis/google-cloud-rust#7108`, which keeps `fetch_update` with
`#[allow(deprecated)]` plus a TODO until its MSRV moves).

## The options, none applied

1. `#[allow(deprecated)]` on `advance` in `src-tauri/src/core/turn_order.rs`
   with a TODO naming the removal condition, MSRV reaching 1.95. Smallest change,
   keeps the MSRV honest, matches what sub-1.95 projects did. It is a
   suppression, which `FULL-REVIEW.md` section 7.4 lists as an anti-pattern when
   added to pass CI, so it needs a recorded reason rather than being silent.
2. Raise `rust-version` to 1.95.0 and rename. Correct long term, but it moves
   the MSRV, invalidates the 1.89.0 vendored toolchain and
   `engineering/rust-toolchain.md`, and needs `notify-rust` and the vendor
   branch checked against the new floor.
3. Add a `rust-toolchain.toml` pin. This addresses the root cause rather than
   the symptom, because a pinned toolchain cannot drift under a `-D warnings`
   gate. It costs security fixes and can diverge from whatever the release jobs
   use.

Whichever is chosen, the underlying exposure stays: an unpinned `stable` plus
`-D warnings` means any future Rust release can red the build with no commit, on
any branch, and the failure will look like the current PR's fault. Expect this
to recur and expect it to be misattributed.

## How to tell this class apart from a real failure

- `git diff --name-only <base>..HEAD -- '*.rs'` is empty, so the PR changed no
  Rust.
- `git show <base>:<path>` shows the offending line unchanged at the branch
  point.
- `Test Rust (Cargo)` passes while `Rust Lints` fails, so the crate compiles and
  only a lint gate is red.
- The workflow posts the full clippy output as a PR comment
  (`ci.yml`, step `Comment clippy results on PR`), which is the way to read it
  when the job log blob host is unreachable from a sandbox.
