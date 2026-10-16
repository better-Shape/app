#!/usr/bin/env bash
# A working rustc + cargo + rustfmt without rustup and without crates.io.
#
# Why this exists: `rustup` needs to download from static.rust-lang.org, and
# some sandboxes only allow github.com / npm / pypi. The `@rustbin/*` npm
# packages ship the same official toolchain binaries, so this script assembles a
# usable toolchain out of npm alone.
#
# What it gives you:
#   rustc --version          -> 1.88.0
#   cargo fmt --check        -> works (cargo-fmt + rustfmt installed into cargo's bin)
#   cargo metadata / build   -> needs the vendor branch below, because dependency
#                               resolution needs the crates.io index, which is
#                               blocked here.
#
# For cargo clippy, cargo test and the Tauri build, fetch the orphan branch
# vendor/sandbox-toolchain on better-Shape/app and follow its FETCH.md. It carries
# the crate registry, a Debian 12 dev sysroot for the GTK and WebKit stack, and the
# command line tools. See engineering/rust-toolchain.md and
# engineering/sandbox-vendored-toolchain.md.
#
# Usage:
#   bash scripts/dev/rust-toolchain.sh          # install
#   . /tmp/rust-toolchain/env.sh                # put it on PATH
#   cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check

set -euo pipefail

VERSION="1.88.0"
TARGET="x86_64-unknown-linux-gnu"
ROOT="${RUST_TOOLCHAIN_DIR:-/tmp/rust-toolchain}"
PKGS=(rustc cargo rustfmt)

mkdir -p "$ROOT/pkgs" "$ROOT/extract"
cd "$ROOT/pkgs"
for pkg in "${PKGS[@]}"; do
    tarball=$(npm pack "@rustbin/${pkg}-${VERSION}-${TARGET}" --silent 2>/dev/null | tail -1)
    if [ -z "$tarball" ] || [ ! -f "$tarball" ]; then
        echo "failed to fetch @rustbin/${pkg}-${VERSION}-${TARGET}" >&2
        exit 1
    fi
done

cd "$ROOT/extract"
rm -rf "$ROOT/extract"/*
for tarball in "$ROOT"/pkgs/*.tgz; do
    # Every package unpacks to `package/`; keep them apart by renaming first.
    tar xzf "$tarball"
    case "$tarball" in
        *rustc*) mv package rustc ;;
        *cargo*) mv package cargo ;;
        *rustfmt*) mv package rustfmt ;;
    esac
done

# cargo finds subcommands in its own bin directory; rustfmt and cargo-fmt have
# to live there, and rustfmt needs the rustc shared libraries at runtime.
cp "$ROOT/extract/rustfmt/rustfmt-preview/bin/rustfmt" "$ROOT/extract/cargo/cargo/bin/"
cp "$ROOT/extract/rustfmt/rustfmt-preview/bin/cargo-fmt" "$ROOT/extract/cargo/cargo/bin/"
chmod +x "$ROOT/extract/cargo/cargo/bin/rustfmt" "$ROOT/extract/cargo/cargo/bin/cargo-fmt"

cat > "$ROOT/env.sh" <<EOF
export PATH="$ROOT/extract/cargo/cargo/bin:$ROOT/extract/rustc/rustc/bin:\$PATH"
export LD_LIBRARY_PATH="$ROOT/extract/rustc/rustc/lib:\${LD_LIBRARY_PATH:-}"
export RUSTC="$ROOT/extract/rustc/rustc/bin/rustc"
EOF

# shellcheck disable=SC1091
. "$ROOT/env.sh"
echo "rustc:   $(rustc --version)"
echo "cargo:   $(cargo --version)"
echo "rustfmt: $(rustfmt --version)"
echo
echo "Installed. Next time:  . $ROOT/env.sh"
