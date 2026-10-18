# Rust toolchain in agent sandboxes

A restricted sandbox reaches `github.com`, `codeload.github.com`, `api.github.com`,
`registry.npmjs.org` and `pypi.org`. It cannot reach `sh.rustup.rs`, `static.rust-lang.org`,
`crates.io`, `index.crates.io` or `static.crates.io`. `apt-get update` fails against every Debian
mirror, so system packages cannot be installed even though `sudo` works.

Two sources cover the toolchain. Use them in this order.

## Source 1, the vendor branch, everything works

The orphan branch `vendor/sandbox-toolchain` on `better-Shape/app` carries the Rust 1.89.0
components, the cargo dependency tree for `src-tauri`, a Debian 12 development sysroot for the
Tauri stack, and the missing command line tools. Fetch it, extract it to `/tmp`, and follow its
`FETCH.md`. Measured with it on 2026-10-17:

| Gate | Command | Result |
| --- | --- | --- |
| Format | `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | clean |
| Lints | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | exit 0, 2m 23s |
| Tests | `CARGO_BUILD_JOBS=1 cargo test --manifest-path src-tauri/Cargo.toml --all-features` | 313 passed, 0 failed |

Full detail, including the two known payload defects and their workarounds, is in
`engineering/sandbox-vendored-toolchain.md`. Read section 7 before running the gates.

## Source 2, npm, format only

`scripts/ci/install-rust-toolchain.sh` assembles a toolchain from the `@rustbin` npm packages. It
never runs `npm install`, so `package.json` and `package-lock.json` stay unchanged.

```bash
scripts/ci/install-rust-toolchain.sh                     # install into /tmp/rust-tools and verify
eval "$(scripts/ci/install-rust-toolchain.sh --env)"     # load the tools in the current shell
```

`scripts/dev/rust-toolchain.sh` does the same with a smaller footprint for local use.

| Tool | Version |
| --- | --- |
| rustc | 1.88.0 (6b00bc388 2025-06-23) |
| cargo | 1.88.0 (873a06493 2025-05-10) |
| rustfmt / cargo-fmt | 1.8.0-stable (6b00bc3880 2025-06-23) |
| clippy / cargo-clippy | 0.1.88 (6b00bc3880 2025-06-23) |

The npm mirror `@rustbin/*` publishes no 1.89.0, so this source tops out at 1.88.0, behind the
`rust-version = "1.89.0"` pin in `src-tauri/Cargo.toml`. It still covers the format check, which
does not resolve dependencies and ignores the pin. Without the vendor branch it cannot run
`cargo clippy` or `cargo test`, both because it is behind the pin and because cargo cannot resolve
dependencies from `crates.io`.

Keep the two sources in separate prefixes. The vendor branch runs each component's own `install.sh`,
which puts the binaries flat in `$PREFIX/bin`. This script assembles a sysroot under
`$RUST_TOOLS_DIR/sysroot/bin`. Point one source's `--env` output at the other source's directory and
the tools are simply not found. Pick one source per shell and do not mix them.

## The cargo flag every Rust gate needs here

`cargo test` needs it; `cargo clippy` runs without it.

```bash
SV="${SV:?export SV to the payload root printed by the section 5 fetch recipe}"
export CARGO_HOME="$SV/cargo-home"       # section 5 writes config.toml here, pointing at $SV/cargo-vendor
export CARGO_NET_OFFLINE=true
export CARGO_TARGET_DIR="$SV/cargo-target" # keeps a multi-gigabyte target directory out of the workspace and out of shared /tmp
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
CARGO_BUILD_JOBS=1 cargo test --manifest-path src-tauri/Cargo.toml --all-features
```

- The vendored toolchain is Rust 1.89.0, matching the `src-tauri/Cargo.toml` pin and
  `notify-rust@4.18.0`'s `rust-version = "1.89.0"`, so no `--ignore-rust-version` is needed. That
  crate is the only one in the lockfile above 1.88.0.
- `CARGO_BUILD_JOBS=1` is required because linking the two test binaries in parallel peaks above the
  memory a sandbox has, and the linker is killed with `signal 9`.
- `cargo --config <path> clippy` does not work. Cargo does not forward the global `--config` flag to
  external subcommands, so clippy resolves against crates.io and fails with
  `no matching package named base64`. Built-in commands such as `metadata` and `check` do honour the
  flag. Put the replacement in `$CARGO_HOME/config.toml` instead.

`npm run test:rust` and `npm run test:all` run cargo without `--ignore-rust-version`, and with the
vendored 1.89.0 toolchain they pass as they are.

## Do not repeat these mistakes

- Do not run `npm install @rustbin/... --save-dev` in the repo. It edits `package.json` and
  `package-lock.json`. The toolchain does not need to be a project dependency.
- Do not run rustfmt over every `src-tauri/**/*.rs` file. The tree is already formatted, and a
  repo-wide reformat is an unrelated change that needs a decision first.
- Do not treat `echo "Exit code: $?"` after a pipe as the cargo result. Pipes such as `cargo ... | head`
  hide the real exit code. Redirect to a file and check `$?` directly.
- Do not set `CARGO_HOME`, `RUSTUP_HOME`, `CARGO_TARGET_DIR` or the extracted payload inside
  `/home/user`. Everything under the workspace root is persisted and snapshotted. Keep all of it in
  `/tmp`.
- Do not copy `cargo-fmt` into the cargo bin directory. Both `cargo-fmt` and `cargo-clippy` are on
  `PATH` once the toolchain `bin/` is.
- Do not claim a Rust gate is unrunnable before fetching the vendor branch. It has run here.
