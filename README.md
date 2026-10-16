# Vendored sandbox toolchain

This is an orphan branch. It carries no source code from `better-Shape/app`. It holds a set of
binaries and source trees that a restricted agent sandbox cannot download for itself, so that the
sandbox can build and test the app through the git protocol alone.

It is not based on `main`, it must never be merged into `main`, and it must never enter a release
or CI workflow. Fetch it, read it, extract it to `/tmp`, and delete it. Nothing here is imported by
the application at build time or at run time.

## Who this is for

The consuming sandbox runs Debian 12 (bookworm), `x86_64`, glibc 2.36, and can reach only
`github.com`, `codeload.github.com`, `api.github.com`, `registry.npmjs.org` and `pypi.org`. It has
`xz`, `tar`, `unzip`, `gzip` and `bzip2`. It does not have `zstd`, `7z`, `cmake`, `pkg-config`,
`patchelf`, `file`, a C toolchain beyond what the base image provides, a Rust toolchain, or any
browser. Everything those steps need is on this branch.

Reference commit for every version below: `289b1344838fb5eea700505483125774ce6649be`.

## What is here

| Directory | What it holds | Packed size | On disk after extraction |
| --- | --- | --- | --- |
| `rust/toolchain/` | Official Rust 1.88.0 components (`rustc`, `rust-std`, `cargo`, `rustfmt`, `clippy`) and `channel-rust-1.88.0.toml` | 123 MB | 1330 MB across the five components |
| `rust/cargo-vendor.tar.xz` | The full cargo dependency tree for `src-tauri`, 759 crates | 99 MB | 344 MB |
| `rust/cargo-config.toml` | The source-replacement block `cargo vendor` prints | 130 bytes | n/a |
| `rust/Cargo.lock.sha256` | The lockfile hash this vendor tree was built from | 87 bytes | n/a |
| `system/debian12-dev-sysroot.tar.xz` | Debian 12 amd64 development sysroot for the Tauri GTK/WebKit stack, 496 packages, usr-merged, no absolute symlinks | 304 MB | 1305 MB |
| `system/PKGS.txt` | `Package` and `Version` for every `.deb` in the sysroot | 22 KB | n/a |
| `system/tools/` | `pkg-config`, `pkgconf`, `cmake`, `patchelf`, `file` and their runtime closure, with an `$ORIGIN/../lib` rpath | 86 MB | 86 MB |
| `chrome-deps/npm-chromium-153/` | Nine shared libraries for the Chromium 153 build npm supplies (NSS, NSPR, expat, sqlite, uuid) | 3.5 MB | 3.5 MB |
| `chrome-deps/cft-156/` | The shared-library closure Chrome for Testing 156 needs on Debian 12, 81 libraries | 30 MB | 30 MB |
| `browsers/browsers-playwright-1.64.1.tar.xz` | Playwright browser tree: Chrome for Testing 156.0.8078.4, the headless shell, and ffmpeg | 227 MB | 706 MB |
| `LICENSES/` | Licence text for every redistributed library, plus the Debian `copyright` file per package | 7.6 MB | 11 MB |

Measured total: 880 MB packed, 3777 files. Every file is under 90 MB. Three archives exceed 90 MB
and are split into `.part-NN` files; `FETCH.md` shows the one-line reassembly. `MANIFEST.sha256`
holds 3779 entries, the 3776 whole files plus the three split archives listed under their
reassembled names.

## How to consume it

`FETCH.md` holds copy-paste commands that were run and verified on the free box. The short version:

1. Download the branch with `codeload` or a depth-1 clone into `/tmp`. Never into the workspace;
   the workspace is snapshotted and a payload this size would blow the snapshot budget.
2. Reassemble the three split archives with `cat <asset>.part-* > <asset>`.
3. Run `sha256sum -c MANIFEST.sha256`. It covers every file in the tree and each reassembled
   archive, so this single check verifies both stages.
4. Wire up the Rust toolchain, the cargo vendor tree, the sysroot and the browser tree as
   `FETCH.md` shows.

## Verification performed before this branch was pushed

All of these ran inside a clean `debian:12` container with only the vendored inputs.

| Check | Command | Result |
| --- | --- | --- |
| Toolchain and crates | `cargo clippy --ignore-rust-version --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | passed, exit 0 |
| Cargo tests | `CARGO_BUILD_JOBS=1 cargo test --ignore-rust-version --manifest-path src-tauri/Cargo.toml` and with `--all-features` | passed, exit 0, 313 tests |
| Sysroot resolves the Tauri stack | `pkg-config --modversion` for `gtk+-3.0 webkit2gtk-4.1 libsoup-3.0 javascriptcoregtk-4.1 openssl gdk-3.0` | `3.24.38`, `2.50.6`, `3.2.3`, `2.50.6`, `3.0.22`, `3.24.38` |
| Sysroot symlinks | `find /tmp/gtk-sysroot -xtype l \| grep '\.so'` and `find /tmp/gtk-sysroot -type l -lname '/*'` | no broken library symlink, zero absolute symlinks |
| Sysroot links the A1 libraries | `gcc` with `-ldbus-1 -lffi -luuid -lpcre2-8 -lzstd -lmount -lblkid -ludev` against the sysroot | passed, exit 0 |
| Architecture | `readelf -h` on every ELF file in the tree | 137 files, all `ELF 64-bit` / `X86-64` |
| Chrome closure | `ldd chrome-linux64/chrome \| grep "not found"` with the two `chrome-deps` directories on `LD_LIBRARY_PATH` | empty, and `chrome --version` prints `Google Chrome for Testing 156.0.8078.4` |
| Archives | `tar tJf` on each reassembled archive | no errors, 44511 / 31388 / 610 entries |
| Manifest | `sha256sum -c MANIFEST.sha256` on a fresh copy after reassembly | 3779 of 3779 OK |
| Vendored tools | run `pkg-config`, `cmake`, `patchelf`, `file` from `system/tools/` in a clean container | all run, zero missing libraries |

### Things the consumer must know

**The clippy invocation in the spec does not work.** The spec writes
`cargo --offline --config <path> clippy ...`. `cargo clippy` is an external subcommand binary, and
cargo does not forward the global `--config` or `--offline` flags to it. `cargo check`,
`cargo metadata` and `cargo tree` are built into cargo and do honour `--config`; external
subcommands such as `clippy` and `nextest` do not, and `clippy` fails with
`no matching package named base64 found`. Verified against cargo 1.88.0. Put the source replacement
in `$CARGO_HOME/config.toml` and set `CARGO_NET_OFFLINE=true` instead. `FETCH.md` uses that form.
`CARGO_HOME` must stay outside the workspace, as the spec requires.

**`--ignore-rust-version` is required for every cargo build command.** `notify-rust@4.18.0`, pulled
in by `tauri-plugin-notification`, declares `rust-version = "1.89.0"`, while the pinned toolchain is
1.88.0 to match `src-tauri/Cargo.toml`. It is the only crate in the lockfile that asks for 1.89 or
newer, and it compiles and lints cleanly on 1.88.0. Without the flag, cargo refuses to start the
build before it compiles anything. This applies to `clippy` and to both `test` invocations.

**`CARGO_BUILD_JOBS=1` is required for `cargo test`.** Linking the two test binaries in parallel
peaks above the 3.9 GB a sandbox has, and the linker is killed with `signal 9`. Serial linking
completes the gate in about 36 seconds on a warm target. The clippy and fmt gates do not need it.

The two commands to run are:

```bash
cargo clippy --ignore-rust-version \
  --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
CARGO_BUILD_JOBS=1 cargo test --ignore-rust-version \
  --manifest-path src-tauri/Cargo.toml --all-features
```

## Provenance

Upstream URL, upstream hash where one is published, and the command used, per artifact.

### Rust 1.88.0 components

From `https://static.rust-lang.org/dist/`, named `<component>-1.88.0-x86_64-unknown-linux-gnu.tar.xz`.
The upstream `xz_hash` in `channel-rust-1.88.0.toml` matches the shipped file exactly for all five.

| Component | Upstream `xz_hash` (matches the shipped file) |
| --- | --- |
| `rustc` | `b049fd57fce274d10013e2cf0e05f215f68f6580865abc52178f66ae9bf43fd8` |
| `rust-std` | `36d7eacf46bd5199cb433e49a9ed9c9b380d82f8a0ebc05e89b43b51c070c955` |
| `cargo` | `856962610ee821648cee32e3d6abac667af7bb7ea6ec6f3d184cc31e66044f6b` |
| `rustfmt` | `55f4c150a865cae19cfa5f5f2b5eec84ed98dc3a1c1c406d4323c63d896c3f1d` |
| `clippy` | `db09c9e4a8a0b486781d87403f74a203a58d9ef0a58ba10c39264916d93ac603` |

Each installs with its own `install.sh --prefix=<dir> --disable-ldconfig`, exactly as rustup would.

### Cargo vendor tree

```bash
cargo vendor --locked --versioned-dirs --manifest-path src-tauri/Cargo.toml /tmp/cargo-vendor
tar -C /tmp/cargo-vendor -cJf rust/cargo-vendor.tar.xz .
```

`src-tauri/Cargo.lock` sha256 `c4cece116c312de4cd5ff7a1a4b8c0e2583083b9997a6a63e05fed7b84b8c537`,
recorded in `rust/Cargo.lock.sha256`. 759 crates, `registry+https://github.com/rust-lang/crates.io-index`
only, no git dependencies and no patches.

### Debian 12 development sysroot

Built in a clean `debian:12` container:

```bash
rm -f /etc/apt/apt.conf.d/docker-clean
apt-get update
apt-get install -y --no-install-recommends libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev libxdo-dev pkg-config cmake patchelf build-essential file \
  libgtk-3-dev libglib2.0-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libcairo2-dev \
  libpango1.0-dev libgdk-pixbuf-2.0-dev libharfbuzz-dev libatk1.0-dev libatspi2.0-dev \
  libdbus-1-dev libx11-dev libxext-dev libxrandr-dev libxi-dev libxcursor-dev \
  libenchant-2-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev curl wget
mkdir -p /tmp/gtk-sysroot
for d in /var/cache/apt/archives/*.deb; do dpkg-deb -x "$d" /tmp/gtk-sysroot; done
# Rewrite every absolute and every dangling library symlink to a relative one.
python3 fix-sysroot-links.py /tmp/gtk-sysroot
tar -C /tmp/gtk-sysroot -cJf system/debian12-dev-sysroot.tar.xz .
```

496 packages. `system/PKGS.txt` lists `Package` and `Version` for each.
`LICENSES/debian/<package>/copyright` holds the per-package copyright file.

Two corrections over the first build. `debian:12` ships
`/etc/apt/apt.conf.d/docker-clean`, which runs `apt-get clean` after every install, so the first
build's `--download-only` set was extracted with the runtime packages (already present in the base
image) missing; removing the hook keeps the full archive. The second is the one that mattered:
Debian 12 is usr-merged, `/lib`, `/bin` and `/sbin` are symlinks into `/usr`, but `dpkg-deb -x`
creates real directories at those paths. Runtime SONAMEs such as `libexpat.so.1` therefore landed
under `lib/`, off the linker search path the recipe sets, and linking the Tauri stack failed with
`undefined reference to XML_Parse`. The fixer folds `lib`, `lib64`, `bin` and `sbin` into `usr` and
replaces each with the symlink the base image ships, rewrites every absolute symlink and every
library symlink whose target is absent to a relative link, copies the real file in when the target
lives outside the extracted tree, and drops the static `libdbus-1.a`, `libffi.a`, `libuuid.a`,
`libpcre2-8.a`, `libzstd.a`, `libmount.a`, `libblkid.a`, `libudev.a` and `libselinux.a`. Those
static archives are the trap that turns a symlink problem into a link error, and nothing in this
build links them statically. The result is a usr-merged tree with no absolute symlink and no
dangling library symlink.

### Command line tools

Built in a clean `debian:12` container. The four binaries and their full loader closure were copied
from the installed packages, then every binary got an `$ORIGIN/../lib` rpath so the tree runs
without `LD_LIBRARY_PATH`. `system/tools/TOOLS.txt` lists the owning package and version for every
shipped file. Versions: `pkg-config` 1.8.1, `cmake` 3.25.1, `patchelf` 0.14.3.

### Chrome dependency libraries, set A

For the Chromium 153 build that npm can supply, under `chrome-deps/npm-chromium-153/`.

The NSS libraries come from the npm package `chrome-aws-lambda@10.1.0`, `bin/aws.tar.br`, which is
brotli-compressed. NSPR is not on npm, so it was built from `servo/nspr` at commit
`8219c5c5137b94ae93cfb4afc1dc10a94384e1c6` with `USE_64=1 ./configure --enable-64bit`, then
`make -j2 && make install`, in a Debian 12 container with gcc 12.2.0, and stripped.

The three NSS hashes match the published tarball. The three NSPR hashes are outputs of this build
and differ from the reference, which the spec permits; the build is recorded here so the difference
is explainable. All nine libraries load, proven by the Chrome closure check.

| File | sha256 | Origin |
| --- | --- | --- |
| `libnss3.so` | `af877ac050653dd2b13dcbcf0aeab8d52c47f5e34c936786910aff48c462a007` | `chrome-aws-lambda@10.1.0` |
| `libnssutil3.so` | `f8364ad2fadde6f312088478e55b48e32bc0e0a47f298f2e3b3362f84095cce6` | `chrome-aws-lambda@10.1.0` |
| `libsoftokn3.so` | `ca0b1022278d1b2c01e98f551f2a929e363d3b7d706389987c71539cb602d4f2` | `chrome-aws-lambda@10.1.0` |
| `libnspr4.so` | `c65e96df5faaabe2805c8995217312912a7afb7711f6a3029667ee78678e671b` | built from `servo/nspr` |
| `libplc4.so` | `4528b6c93219c6b9c7a3cd495b26e31c8f165b008507fe5af3448d8bcb8c6fc7` | built from `servo/nspr` |
| `libplds4.so` | `05e0f8e7bfdcf87856bb072bfac1d7694261449f7d3e66a9716af14ba2f6e94a` | built from `servo/nspr` |
| `libexpat.so.1` | `07d66ad3076e0470a68f28abe3daaf6cf8715af987f2f8ce4b8d6430bd455108` | `chrome-aws-lambda@10.1.0` |
| `libsqlite3.so.0` | `feaabe63253c7cf6b43bf351ae0f5356c872346d86b143e03b8ac6ac2b55103c` | `chrome-aws-lambda@10.1.0` |
| `libuuid.so.1` | `d0e4acd42a197d7fc7a3aaa647fe68d14c188b426fc076babb368dab79ac25e6` | `chrome-aws-lambda@10.1.0` |

### Chrome dependency libraries, set B

For Chrome for Testing 156, under `chrome-deps/cft-156/`. The closure was computed, not guessed:

```bash
unzip -q chrome-linux64.zip
ldd chrome-linux64/chrome | grep "not found"
readelf -d chrome-linux64/chrome | grep NEEDED
```

81 libraries. The glibc family, the loader and the C++ runtime are excluded because the consuming
base image provides them. The EGL, GLESv2 and Vulkan libraries are excluded because the CfT archive
already ships them. `chrome-deps/cft-156/PACKAGES.txt` lists the owning Debian package and version
for every library.

### Playwright browsers

Versions, revisions, upstream URLs and measured sizes are in `browsers/BROWSERS.txt`.

```bash
tar -C /tmp/pw-browsers -cJf browsers/browsers-playwright-1.64.1.tar.xz .
```

The tree matches the layout Playwright accepts, including the empty `INSTALLATION_COMPLETE` marker
inside each browser directory, not inside `chrome-linux64/`. The headless shell directory name uses
underscores.

## Licences

`LICENSES/` carries the licence text for every redistributed library.

- NSS and NSPR: Mozilla Public License 2.0, `LICENSES/MPL-2.0.txt`.
- The GTK, GLib, WebKit, cairo, pango and related stack: LGPL and permissive licences. The Debian
  packages carry the authoritative text.
- Every Debian package extracted into the sysroot and into `system/tools/` has its
  `usr/share/doc/<package>/copyright` file at `LICENSES/debian/<package>/copyright`. There are 470
  such files.
- Chromium, Chrome for Testing and ffmpeg carry their own licences inside the browser archive and
  inside the CfT archives, which are unmodified upstream builds.

## Size notes

The workspace is snapshotted. Extract everything to `/tmp`, never into the workspace. Extracted
sizes are in the table above. The largest single consumer is the Rust toolchain at about 1.33 GB,
then the sysroot at about 1.30 GB, then the browser tree at about 706 MB.
