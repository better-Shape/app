#!/usr/bin/env bash
# Install a Rust 1.88.0 toolchain (rustc, cargo, rustfmt, clippy) for agent sandboxes
# that cannot reach static.rust-lang.org or sh.rustup.rs, using only the npm registry.
#
# Installs OUTSIDE the repository and workspace: into $RUST_TOOLS_DIR (default
# /tmp/rust-tools). It never runs `npm install`, so package.json and package-lock.json
# are not touched. Re-running is safe: an existing sysroot is reused.
#
# Usage:  source <(scripts/ci/install-rust-toolchain.sh --env)   # put tools on PATH
#         scripts/ci/install-rust-toolchain.sh                   # install and verify
set -euo pipefail

VERSION="1.88.0"
TARGET="x86_64-unknown-linux-gnu"
TOOLS="${RUST_TOOLS_DIR:-/tmp/rust-tools}"
SYSROOT="$TOOLS/sysroot"

print_env() {
  echo "export PATH=\"$SYSROOT/bin:\$PATH\""
  echo "export LD_LIBRARY_PATH=\"$SYSROOT/lib\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}\""
  echo "export CARGO_HOME=\"$TOOLS/cargo-home\""
  echo "export RUSTUP_HOME=\"$TOOLS/rustup-home\""
}

if [[ "${1:-}" == "--env" ]]; then
  print_env
  exit 0
fi

command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }

if [[ ! -x "$SYSROOT/bin/cargo" ]]; then
  mkdir -p "$TOOLS/pkgs" "$TOOLS/unpacked"
  cd "$TOOLS/pkgs"
  for pkg in rustc cargo rustfmt clippy rust-std; do
    # `npm pack` downloads the tarball only. It does not install into any project.
    npm pack "@rustbin/$pkg-$VERSION-$TARGET" --silent >/dev/null
  done
  for tgz in "$TOOLS"/pkgs/*.tgz; do
    dir="$TOOLS/unpacked/$(basename "$tgz" .tgz)"
    mkdir -p "$dir"
    tar xzf "$tgz" -C "$dir"
  done
  U="$TOOLS/unpacked"
  mkdir -p "$SYSROOT/bin" "$SYSROOT/lib"
  cp -a "$U"/rustbin-rustc-*/package/rustc/bin/. "$SYSROOT/bin/"
  cp -a "$U"/rustbin-rustc-*/package/rustc/lib/. "$SYSROOT/lib/"
  cp -a "$U"/rustbin-rust-std-*/package/rust-std-$TARGET/lib/rustlib "$SYSROOT/lib/"
  cp -a "$U"/rustbin-cargo-*/package/cargo/bin/cargo "$SYSROOT/bin/"
  cp -a "$U"/rustbin-rustfmt-*/package/rustfmt-preview/bin/. "$SYSROOT/bin/"
  cp -a "$U"/rustbin-clippy-*/package/clippy-preview/bin/. "$SYSROOT/bin/"
  chmod +x "$SYSROOT/bin/"*
fi

eval "$(print_env)"

echo "== versions"
rustc --version
cargo --version
rustfmt --version
cargo clippy --version

echo "== clippy probe (no dependencies, proves the toolchain links and lints)"
PROBE="$TOOLS/clippy-probe"
rm -rf "$PROBE" && mkdir -p "$PROBE/src"
printf '[package]\nname = "probe"\nversion = "0.0.0"\nedition = "2021"\n' > "$PROBE/Cargo.toml"
echo 'fn main() { let v: Vec<u8> = Vec::new(); println!("{}", v.len()); }' > "$PROBE/src/main.rs"
(cd "$PROBE" && cargo clippy --quiet -- -D warnings)
echo "clippy probe passed"

echo
echo "Toolchain ready. Load it in a new shell with:"
echo "  eval \"\$($0 --env)\""
echo
echo "This source supports cargo fmt only: crates.io and the Debian mirror are unreachable,"
echo "so cargo cannot resolve dependencies and no -sys crate can find its system libraries."
echo "For cargo clippy, cargo test and the browser suite, fetch the vendor branch"
echo "vendor/sandbox-toolchain and follow its FETCH.md. See engineering/sandbox-vendored-toolchain.md"
echo "and engineering/rust-toolchain.md."
