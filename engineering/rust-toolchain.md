# Rust toolchain in agent sandboxes

Agent sandboxes cannot reach `sh.rustup.rs`, `static.rust-lang.org`, `index.crates.io`
or `static.crates.io`, and they have no sudo. This note records what works there,
what does not, and why.

## Install (works)

```bash
scripts/ci/install-rust-toolchain.sh              # install into /tmp/rust-tools and verify
eval "$(scripts/ci/install-rust-toolchain.sh --env)"   # load the tools in the current shell
```

The script downloads the `@rustbin` 1.88.0 packages for `x86_64-unknown-linux-gnu`
with `npm pack`, which only fetches tarballs. It assembles a sysroot (`bin/` plus
`lib/rustlib`) and runs a clippy probe on a crate with no dependencies. It never runs
`npm install`, so `package.json` and `package-lock.json` stay unchanged.

Verified in this sandbox (Debian 12, uid 1001, no sudo):

| Tool | Version |
| --- | --- |
| rustc | 1.88.0 (6b00bc388) |
| cargo | 1.88.0 (873a06493) |
| rustfmt / cargo-fmt | 1.8.0-stable |
| clippy / cargo-clippy | 0.1.88 |

Matches `rust-version = "1.88.0"` in `src-tauri/Cargo.toml`.

## What runs here and what does not

| Check | Here | Why |
| --- | --- | --- |
| `cargo fmt --check` on `src-tauri` | Works. Passes on this branch: 0 diffs across 157 `.rs` files. | Needs only sources and rustfmt. |
| `cargo clippy` on `src-tauri` | Cannot run. | Needs crate dependencies from `index.crates.io`, which is blocked (TLS failure). |
| `cargo test --lib` on `src-tauri` | Cannot run. | Same crate-fetch block. Also needs GTK, WebKit and related system libraries, which are not installed and cannot be installed without root. |
| Tauri build | Cannot run. | Same as above. |

Run clippy and tests on `src-tauri` in CI, not in agent sandboxes.

## Do not repeat these mistakes

- Do not run `npm install @rustbin/... --save-dev` in the repo. It edits `package.json` and `package-lock.json`. The toolchain does not need to be a project dependency.
- Do not run rustfmt over every `src-tauri/**/*.rs` file. The tree is already formatted, and a repo-wide reformat is an unrelated change that needs a decision first.
- Do not treat `echo "Exit code: $?"` after a pipe as the cargo result. Pipes such as `cargo ... | head` hide the real exit code. Redirect to a file and check `$?` directly.
- Do not set `CARGO_HOME` or `RUSTUP_HOME` inside `/home/user`. Everything under the workspace root is persisted, and the toolchain is about 560 MB. Keep it in `/tmp`.
- Do not copy `cargo-fmt` into the cargo bin directory. Both `cargo-fmt` and `cargo-clippy` are on `PATH` once the sysroot `bin/` is.
- The Ubuntu apt steps in the mausVoice guide (`docs/Installing-cargo-toolchain-for-kilocode-bot-agents-in-a-linux-sandbox.md`, commit 3c179b48) assume root and the Debian/Ubuntu mirrors. Those are not available in this sandbox.
