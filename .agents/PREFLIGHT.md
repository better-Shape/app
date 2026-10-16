# Preflight checklist

Use this before every push. Paste the results and head SHA into the PR Verification Gate section.

## Required local checks

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build:runtime`
- [ ] `npm run test:all`
- [ ] `npm run test:rust` if you touched `src-tauri/`
- [ ] `npm run skills:verify`

## Blocked sandbox

If `sh.rustup.rs`, `crates.io`, `cdn.playwright.dev` or `dl.google.com` are unreachable, fetch the
orphan branch `vendor/sandbox-toolchain` first and follow its `FETCH.md`. It carries the toolchain,
the crate registry, the Tauri sysroot, the browser, and the shared libraries each needs. Then:

- [ ] I set `$CARGO_HOME/config.toml` with the vendored source replacement and `CARGO_NET_OFFLINE=true`, because `cargo --config <path>` does not reach `cargo clippy`.
- [ ] I exported `CARGO_TARGET_DIR=/tmp/cargo-target` so a multi-gigabyte target directory stays out of the workspace.
- [ ] I ran the Rust gates with `--ignore-rust-version`, because `notify-rust@4.18.0` declares `rust-version = "1.89.0"` while the pin is 1.88.0.
- [ ] I ran `cargo test` with `CARGO_BUILD_JOBS=1`, because parallel linking is killed with `signal 9` on a small sandbox.
- [ ] I ran the browser suite with `PLAYWRIGHT_BROWSERS_PATH` pointing at the extracted browser tree and `npm ci` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
- [ ] For every gate that still cannot run, I said so in the PR body with the reason and the substitute command I ran, rather than marking it passed.

Detail, measured results and the known payload defects: `engineering/sandbox-vendored-toolchain.md`,
with the toolchain notes in `engineering/rust-toolchain.md`.

## Rust checks

If you changed Rust, also run:

- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- [ ] `cargo clippy --ignore-rust-version --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- [ ] `CARGO_BUILD_JOBS=1 cargo test --ignore-rust-version --all-features --manifest-path src-tauri/Cargo.toml`

Drop `--ignore-rust-version` on a host whose toolchain is 1.89.0 or newer. CI runs stable, so it
runs the plain commands. On a blocked host, repair the vendored sysroot before any link step: the
delivered tarball keeps Debian's absolute development symlinks, and without the section 7.1 repair
in `engineering/sandbox-vendored-toolchain.md`, `cargo test` fails to link.

## Branch and review rules

- [ ] Work is on a focused branch, not `main`.
- [ ] The PR base matches the branch's inherited base.
- [ ] I confirmed `PR Policy Check` is required directly by branch protection, or noted the maintainer action needed to configure it. The workflow must be present on the default branch before GitHub runs it.
- [ ] The PR body includes `@codeant-ai review`.
- [ ] I posted a standalone `@codeant-ai review` comment and recorded its link and head SHA.
- [ ] I set `Substantially critical` to Yes or No and gave a reason when Yes.
- [ ] If the PR is substantially critical, I included and posted `@coderabbitai review` and recorded its link and head SHA.
- [ ] If the PR is not substantially critical, I did not manually request CodeRabbit. Automatic reviews for non-draft PRs targeting `main` still run and must finish before reporting the PR ready; drafts are excluded.
- [ ] Before reporting ready, I confirmed CodeAnt approved the current head, all applicable CodeRabbit reviews completed (manual for substantially critical PRs and automatic for non-draft PRs targeting `main`), required checks passed, no review thread remains unresolved, and the ten-minute quiet window passed.

A PR is substantially critical if it changes a public contract in a breaking way, fixes a security issue, changes major architecture or protocol, makes a new platform support claim, or materially changes repository policy or workflows.

## UI rule

- [ ] For a UI change, I read `DESIGN.md`, `engineering/design-system-baseline.md`, and any relevant surface design file before editing.
