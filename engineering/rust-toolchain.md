# Rust toolchain in agent sandboxes

A restricted sandbox reaches `github.com`, `codeload.github.com`, `api.github.com`,
`registry.npmjs.org` and `pypi.org`. It cannot reach `sh.rustup.rs`, `static.rust-lang.org`,
`crates.io`, `index.crates.io` or `static.crates.io`. `apt-get update` fails against every Debian
mirror, so system packages cannot be installed even though `sudo` works.

Two sources cover the toolchain. Use them in this order.

## Source 1, the vendor branch, everything works

The orphan branch `vendor/sandbox-toolchain` on `better-Shape/app` carries the Rust 1.88.0
components, the cargo dependency tree for `src-tauri`, a Debian 12 development sysroot for the
Tauri stack, and the missing command line tools. Fetch it, extract it to `/tmp`, and follow its
`FETCH.md`. Measured with it on 2026-10-16:

| Gate | Command | Result |
| --- | --- | --- |
| Format | `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | clean |
| Lints | `cargo clippy --ignore-rust-version --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | exit 0, 5m 19s |
| Tests | `CARGO_BUILD_JOBS=1 cargo test --ignore-rust-version --manifest-path src-tauri/Cargo.toml` | 313 passed, 0 failed |

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

The versions match `rust-version = "1.88.0"` in `src-tauri/Cargo.toml` and the components on the
vendor branch. Without the vendor branch this source supports the format check only, because cargo
cannot resolve dependencies from `crates.io`.

Keep the two sources in separate prefixes. The vendor branch runs each component's own `install.sh`,
which puts the binaries flat in `$PREFIX/bin`. This script assembles a sysroot under
`$RUST_TOOLS_DIR/sysroot/bin`. Point one source's `--env` output at the other source's directory and
the tools are simply not found. Pick one source per shell and do not mix them.

## Two flags every Rust gate needs here

`cargo clippy` and `cargo test` fail before compiling anything without them.

```bash
export CARGO_HOME=/tmp/cargo-home        # holds config.toml with the vendored source replacement
export CARGO_NET_OFFLINE=true
export CARGO_TARGET_DIR=/tmp/cargo-target # keeps a multi-gigabyte target directory out of the workspace
cargo clippy --ignore-rust-version --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
CARGO_BUILD_JOBS=1 cargo test --ignore-rust-version --manifest-path src-tauri/Cargo.toml
```

- `--ignore-rust-version` is required because `notify-rust@4.18.0`, pulled in by
  `tauri-plugin-notification`, declares `rust-version = "1.89.0"` while the pin is 1.88.0. It is the
  only crate in the lockfile above 1.88.0, and it compiles and tests cleanly on 1.88.0.
- `CARGO_BUILD_JOBS=1` is required because linking the two test binaries in parallel peaks above the
  memory a sandbox has, and the linker is killed with `signal 9`.
- `cargo --config <path> clippy` does not work. Cargo does not forward the global `--config` flag to
  external subcommands, so clippy resolves against crates.io and fails with
  `no matching package named base64`. Built-in commands such as `metadata` and `check` do honour the
  flag. Put the replacement in `$CARGO_HOME/config.toml` instead.

`npm run test:rust`, `npm run test:all` and the cargo lines in `.agents/PREFLIGHT.md` run cargo
without `--ignore-rust-version`, so they fail here on the version check. Report them in the PR body
as failed with that reason, and paste the output of the equivalent command that passed.

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
