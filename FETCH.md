# Fetch and use the vendored toolchain

Every command here was run on the free box. Extract to `/tmp` only. The workspace is snapshotted
and a payload this size would blow the snapshot budget, and a `git fetch` of it would grow `.git`
inside the workspace.

## 1. Download the branch

Option 1, one request, no git objects:

```bash
BRANCH=vendor/sandbox-toolchain
mkdir -p /tmp/sandbox-vendor
curl -sSL -o /tmp/sandbox-vendor.tar.gz \
  "https://codeload.github.com/better-Shape/app/tar.gz/refs/heads/${BRANCH}"
tar xzf /tmp/sandbox-vendor.tar.gz -C /tmp/sandbox-vendor --strip-components=1
```

Option 2, repository clone, single branch, no history:

```bash
git clone --depth 1 --single-branch --branch vendor/sandbox-toolchain \
  https://github.com/better-Shape/app.git /tmp/sandbox-vendor
```

## 2. Reassemble the split archives and verify

Three archives exceed 90 MB and are split. Reassemble first, then verify everything in one pass.

```bash
cd /tmp/sandbox-vendor

for f in $(grep -o '^[a-f0-9]\{64\}  .*\.part-00$' MANIFEST.sha256 | sed 's/.*  //; s/\.part-00$//'); do
  cat "$f".part-* > "$f"
done
sha256sum -c MANIFEST.sha256
```

Expect zero failures. The manifest lists both the parts and the reassembled assets, so this single
check covers both stages. It was verified at 3779 of 3779 OK.

For one or two small files, skip the whole download:

```bash
gh api repos/better-Shape/app/contents/chrome-deps/npm-chromium-153/libnspr4.so \
  --jq .content | base64 -d > /tmp/libnspr4.so
```

## 3. Wire up the Rust toolchain

```bash
RUST_PREFIX=/tmp/rust-tools; mkdir -p "$RUST_PREFIX"
for t in /tmp/sandbox-vendor/rust/toolchain/*.tar.xz; do
  d=$(mktemp -d); tar xJf "$t" -C "$d"; "$d"/*/install.sh --prefix="$RUST_PREFIX" --disable-ldconfig
  rm -rf "$d"
done
export PATH="$RUST_PREFIX/bin:$PATH"
export LD_LIBRARY_PATH="$RUST_PREFIX/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
rustc --version   # rustc 1.88.0
cargo --version   # cargo 1.88.0
```

## 4. Wire up the cargo vendor tree, offline

`cargo clippy` is an external subcommand and cargo does not forward `--config` or `--offline` to it.
Only cargo's built-in commands such as `metadata` and `check` honour `cargo --config <path>`; external
subcommands such as `clippy` and `nextest` do not. Put the source replacement in
`CARGO_HOME/config.toml` and use `CARGO_NET_OFFLINE=true` instead. Keep `CARGO_HOME` outside the
workspace.

```bash
mkdir -p /tmp/cargo-vendor && tar xJf /tmp/sandbox-vendor/rust/cargo-vendor.tar.xz -C /tmp/cargo-vendor

export CARGO_HOME=/tmp/cargo-home
mkdir -p "$CARGO_HOME"
printf '[source.crates-io]\nreplace-with = "vendored-sources"\n\n[source.vendored-sources]\ndirectory = "/tmp/cargo-vendor"\n' \
  > "$CARGO_HOME/config.toml"
export CARGO_NET_OFFLINE=true

# Refuse a lockfile that does not match the vendor tree.
echo "c4cece116c312de4cd5ff7a1a4b8c0e2583083b9997a6a63e05fed7b84b8c537  src-tauri/Cargo.lock" \
  | sha256sum -c -
```

## 5. Wire up the Debian 12 development sysroot

```bash
mkdir -p /tmp/gtk-sysroot && tar xJf /tmp/sandbox-vendor/system/debian12-dev-sysroot.tar.xz -C /tmp/gtk-sysroot
export PKG_CONFIG_SYSROOT_DIR=/tmp/gtk-sysroot
export PKG_CONFIG_PATH=/tmp/gtk-sysroot/usr/lib/x86_64-linux-gnu/pkgconfig:/tmp/gtk-sysroot/usr/share/pkgconfig
export PKG_CONFIG=/tmp/gtk-sysroot/usr/bin/pkg-config
export CPATH=/tmp/gtk-sysroot/usr/include:/tmp/gtk-sysroot/usr/include/x86_64-linux-gnu
export LIBRARY_PATH=/tmp/gtk-sysroot/usr/lib/x86_64-linux-gnu
export LD_LIBRARY_PATH=/tmp/gtk-sysroot/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
```

## 6. Command line tools

`system/tools/` is a self-contained tree with an `$ORIGIN/../lib` rpath. Put `bin` on `PATH`; no
`LD_LIBRARY_PATH` is needed.

```bash
export PATH=/tmp/sandbox-vendor/system/tools/bin:$PATH
pkg-config --version   # 1.8.1
cmake --version        # 3.25.1
patchelf --version     # 0.14.3
```

## 7. Playwright browsers and the library closure

```bash
export PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers
mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"
tar xJf /tmp/sandbox-vendor/browsers/browsers-playwright-1.64.1.tar.xz -C "$PLAYWRIGHT_BROWSERS_PATH"
export LD_LIBRARY_PATH=/tmp/sandbox-vendor/chrome-deps/cft-156${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
```

Then run `npm ci` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` so Playwright uses the vendored tree.

## 8. Build, lint and test

```bash
cd /path/to/src

# Lint. --ignore-rust-version is required: notify-rust@4.18.0 declares rust-version 1.89.0
# while the pinned toolchain is 1.88.0. It is the only such crate in the lockfile.
cargo clippy --ignore-rust-version \
  --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings

# Format check
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check

# Test. CARGO_BUILD_JOBS=1 is required: linking the two test binaries in parallel peaks
# above the 3.9 GB a sandbox has and the linker is killed with signal 9. Serial linking
# finishes in about 36 seconds on a warm target.
CARGO_BUILD_JOBS=1 cargo test --ignore-rust-version \
  --manifest-path src-tauri/Cargo.toml --all-features
```

`--ignore-rust-version` is required for every cargo build command, `clippy` and `test` alike.
`CARGO_BUILD_JOBS=1` is only needed for `test`; `clippy` and `fmt` do not need it.

## Sanity checks

```bash
# Sysroot resolves the Tauri stack
for m in gtk+-3.0 webkit2gtk-4.1 libsoup-3.0 javascriptcoregtk-4.1 openssl gdk-3.0; do
  printf '%-24s %s\n' "$m" "$("$PKG_CONFIG" --modversion "$m")"
done

# The sysroot carries no absolute symlink and no dangling library symlink
find /tmp/gtk-sysroot -xtype l | grep -E '\.so' || echo "no broken library symlinks"

# The eight libraries A1 was about link cleanly
printf 'int main(){return 0;}\n' > /tmp/t.c
gcc /tmp/t.c -o /tmp/t.out -L/tmp/gtk-sysroot/usr/lib/x86_64-linux-gnu \
  -ldbus-1 -lffi -luuid -lpcre2-8 -lzstd -lmount -lblkid -ludev && echo "link ok"

# Chrome closure is complete
export LD_LIBRARY_PATH=/tmp/sandbox-vendor/chrome-deps/cft-156:/tmp/sandbox-vendor/chrome-deps/npm-chromium-153
ldd "$PLAYWRIGHT_BROWSERS_PATH/chromium-1248/chrome-linux64/chrome" | grep "not found" || echo "closure complete"
```

## Cautions

- Do not extract into the workspace. Use `/tmp`.
- Do not commit `.cargo/config.toml` into the repository. CI expects crates.io.
- Do not point `CARGO_HOME` at the workspace.
- `system/tools/bin/pkg-config` is a symlink to `pkgconf` in the same directory. Copy the whole
  `system/tools/` tree, not individual files.
