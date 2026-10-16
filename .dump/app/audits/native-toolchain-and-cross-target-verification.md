# Native toolchain and cross-target verification

## What this environment can and cannot compile

The application crate (`src-tauri`) cannot be built here: crates.io is unreachable,
so `cargo test`/`cargo clippy` stop during dependency resolution and no Tauri,
`portable-pty`, `tokio` or `serde_json` versions can be fetched. That limit is
unchanged and is why the review record never claims an application build.

What *can* be done without the dependency graph is compile the branch's
dependency-free native modules with a real stable toolchain, for every target the
project ships to, and drive them from their own `#[cfg(test)]` suites. That is
what this document records.

## Toolchain: Rust 1.88 without rustup

The official installers are republished on the npm registry under the `@rustbin`
scope, one package per component and target, each shipping the standard
`install.sh`. That gives a real 1.88 toolchain in a sandbox that cannot reach
`static.rust-lang.org`:

```
npm pack @rustbin/rustc-1.88.0-x86_64-unknown-linux-gnu
npm pack @rustbin/rust-std-1.88.0-x86_64-unknown-linux-gnu
npm pack @rustbin/rust-std-1.88.0-aarch64-unknown-linux-gnu
npm pack @rustbin/rust-std-1.88.0-x86_64-unknown-linux-musl
npm pack @rustbin/rust-std-1.88.0-x86_64-pc-windows-msvc
npm pack @rustbin/rust-std-1.88.0-aarch64-pc-windows-msvc
npm pack @rustbin/rust-std-1.88.0-x86_64-apple-darwin
npm pack @rustbin/rust-std-1.88.0-aarch64-apple-darwin
npm pack @rustbin/rustfmt-1.88.0-x86_64-unknown-linux-gnu
npm pack @rustbin/clippy-1.88.0-x86_64-unknown-linux-gnu
npm pack @rustbin/cargo-1.88.0-x86_64-unknown-linux-gnu
# then, for each unpacked package: sh package/install.sh --prefix=<sysroot> --disable-ldconfig
```

Result: `rustc 1.88.0 (6b00bc388 2025-06-23)`, `rustfmt 1.8.0-stable`, Clippy
0.1.88 and Cargo 0.89.0, with `std` for seven targets. The Cargo registry cache
under `~/.cargo` is *not* usable for the application crate; this toolchain is for
the modules below and for `rustfmt`/`clippy` on the whole tree.

## Harnesses that compile production sources

Both harnesses use `#[path = "..."] mod` to compile the real files, so the code
under test is the code that ships (not a copy):

- native harness: `commands/pty/exit_status.rs`, `core/session_ownership.rs`,
  `core/turn_order.rs`, `core/bounded_text.rs`, `core/credential_match.rs`,
  `core/window_close.rs`, `commands/pty/preview_readiness.rs`,
  `commands/preview/registration_gate.rs` - 48 tests, all passing on Linux.
- settings harness: `core/settings_file.rs` and `core/provider_header_defaults.rs`
  against a minimal stand-in for the parts of `serde_json` they use - 10 tests, all
  passing on Linux. Its control copy, which reverts the entry-opened-by-path
  protection, fails exactly the swap test it should (9 passed, 1 failed), so the
  harness is discriminating rather than silently green.

`commands/pty/mod.rs`, `agent/models/mod.rs`, `agent/commands/*`, `core/ai_vault.rs`,
`browser/surface.rs`, `commands/shortcuts/mod.rs` and
`commands/preview/design_bridge.rs` import Tauri, `tokio`, `portable-pty`, `serde`
or `reqwest` and are **not** in either harness. Claims that depend on those files
are reasoning, not compilation, and are marked as such in the audit documents.

## Cross-target type-check and lint

`rustc --emit=metadata` (`--test`, so the `#[cfg(test)]` suites are type-checked
too) and `cargo clippy --all-targets -- -D warnings` both succeed for every target
below, for all ten modules above:

| target | rustc type-check | clippy `-D warnings` | executed |
| --- | --- | --- | --- |
| x86_64-unknown-linux-gnu | pass | pass | yes (48 + 10 tests) |
| aarch64-unknown-linux-gnu | pass | pass | no |
| x86_64-unknown-linux-musl | pass | pass | no |
| x86_64-pc-windows-msvc | pass | pass | no |
| aarch64-pc-windows-msvc | pass | pass | no |
| x86_64-apple-darwin | pass | pass | no |
| aarch64-apple-darwin | pass | pass | no |

Clippy is driven from a throwaway crate that re-exports the `serde_json` stand-in
at its root and aliases itself as `serde_json`, so `use serde_json::...` inside
`core/settings_file.rs` resolves to the stand-in and the file still compiles
against the real `std` for each target.

## Controls

A silent pass is not evidence, so both directions were checked:

- Adding `pub fn __clippy_probe() -> u32 { return 0; }` to `core/bounded_text.rs`
  failed the linux-gnu, windows-msvc and macos-arm64 Clippy runs with
  `clippy::needless_return` - the cross-target runs do lint.
- Changing the Windows-only argument in `core/settings_file.rs` from
  `custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)` to
  `custom_flags(FILE_FLAG_OPEN_REPARSE_POINT as u64)` failed windows-msvc and
  windows-arm64 with `E0308` while linux-gnu and macos-arm64 stayed clean - the
  `#[cfg(windows)]` branch is genuinely compiled for the Windows targets, not
  skipped.
- A standalone probe with a windows-only type error exits 1 for
  `--target x86_64-pc-windows-msvc` and 0 for the Linux target, which rules out a
  vacuous target switch.

## Limits

Type-checking and linting are not execution: no Windows or macOS binary was run,
no installer was produced, and the platform-specific *runtime* behavior (reparse
points, window management, PTY handles, file permissions) remains unverified here.
The application crate is still uncompiled. `rustfmt --edition 2021 --check` is
clean on all 39 `.rs` files this branch changes under `src-tauri`.

No hosted CI run has executed for this branch since 2026-10-14T21:01:47Z (`d0163597`),
and none of any workflow in the repository since 2026-10-14T22:20:13Z, so nothing
in this document should be read as a CI result.
