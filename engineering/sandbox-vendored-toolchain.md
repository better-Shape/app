# Vendored sandbox toolchain

Research date 2026-10-16. Sandbox: Debian 12 bookworm, x86_64, 2 vCPU, 3.9 GB RAM, uid 1001 with
sudo to root, 16 GB free on `/`.

This note records what an agent in the restricted sandbox can obtain for Rust, Playwright and
Chrome, what it cannot, and the exact payload another agent in a free network environment must
vendor onto a GitHub branch so the recipes in this repository work here. The companion brief to
paste into that free agent is `engineering/sandbox-vendor-handoff-prompt.md`.

## 1. Network reach, measured

Reachable:

| Host | Result | Use |
| --- | --- | --- |
| `github.com` | 200, git protocol works | `git ls-remote`, `git clone --depth 1`, `--filter=blob:none` |
| `codeload.github.com` | 200 | branch or commit tarball and zip in one request |
| `api.github.com` | 200 | contents API, git blobs API, search API |
| `registry.npmjs.org` | 200 | `npm ci`, `npm pack`, browser and toolchain packages |
| `pypi.org`, `files.pythonhosted.org` | reachable | Python packages |

Blocked, connection fails with curl exit 000 or EOF:

| Host | Consequence |
| --- | --- |
| `static.rust-lang.org`, `sh.rustup.rs` | rustup cannot run at all |
| `crates.io`, `index.crates.io`, `static.crates.io` | cargo cannot resolve or fetch dependencies |
| `cdn.playwright.dev`, `playwright.azureedge.net`, `playwright.download.prss.microsoft.com` | `npx playwright install` cannot download a browser |
| `dl.google.com`, `storage.googleapis.com`, `googlechromelabs.github.io` | no Google Chrome and no Chrome for Testing download |
| `raw.githubusercontent.com` | any recipe that curls raw file content fails |
| `release-assets.githubusercontent.com` | `gh release download` fails with EOF, verified against `jqlang/jq`. Release assets are not a delivery mechanism |
| `media.githubusercontent.com`, `github-cloud.s3.amazonaws.com` | Git LFS content is unreachable, so the vendored branch must not use LFS |
| `deb.debian.org`, `security.debian.org`, `snapshot.debian.org`, `archive.ubuntu.com` | `apt-get update` fails, so no system packages even though sudo works |

`git archive --remote=https://github.com/...` returns `fatal: operation not supported by protocol`.

Delivery paths that do work for a vendored branch, all verified:

1. Whole branch in one request: `curl -sL https://codeload.github.com/better-Shape/app/tar.gz/refs/heads/<branch>`.
2. Whole branch as a repository: `git clone --depth 1 --single-branch --branch <branch> <url>`.
3. A few files only: `git clone --filter=blob:none --no-checkout --depth 1 <url>` then `git checkout HEAD -- <path>`. Measured 152 KB of `.git` for this repository, and the single-file fetch works on demand.
4. One small file without cloning: `gh api repos/<owner>/<repo>/contents/<path> --jq .content | base64 -d`. The contents API returns base64 only up to 1 MB per file.

## 2. What already works in this box

### 2.1 Rust 1.88.0 from npm

`scripts/ci/install-rust-toolchain.sh` assembles a sysroot from the `@rustbin/*` npm packages and
runs a clippy probe. Re-run today, it produced:

| Tool | Version |
| --- | --- |
| rustc | 1.88.0 (6b00bc388 2025-06-23) |
| cargo | 1.88.0 (873a06493 2025-05-10) |
| rustfmt | 1.8.0-stable (6b00bc3880 2025-06-23) |
| clippy | 0.1.88 (6b00bc3880 2025-06-23) |

The clippy probe passes, which proves the toolchain links and lints a crate with no dependencies.
This version matches `rust-version = "1.88.0"` in `src-tauri/Cargo.toml`.

What the toolchain can and cannot do here:

| Command | Result | Reason |
| --- | --- | --- |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | works | needs sources and rustfmt only |
| `cargo metadata`, `cargo check`, `cargo clippy`, `cargo test` on `src-tauri` | cannot run | crates.io index blocked, and the GTK and WebKit build inputs are absent |

Install location must stay outside the workspace. The workspace root is persisted and snapshotted,
the toolchain is about 560 MB, and `CARGO_HOME` or `RUSTUP_HOME` under `/home/user` would be
snapshotted on every turn.

### 2.2 Playwright with a browser, no CDN

Measured on this branch, no browser download:

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund   # 868 packages, 53 s
```

Browser: `@sparticuz/chromium@153.0.0`, an npm-hosted Amazon Linux build. Its
`executablePath()` decompresses `bin/chromium.br` to `/tmp/chromium`, 209,022,176 bytes,
sha256 `53a15d6c3a3d27dfb54c4ba60278b1683136f70cf1e67e989da7dfbd3d451ef0`, and reports
`Chromium 153.0.8010.0`.

`ldd /tmp/chromium` reports three missing objects, and the directory that made it run holds nine
files, 3,679,664 bytes in total. The first six rows below are the objects the loader needs. The last
three rows travel in the same npm tarball and are optional here because the host already has expat
and sqlite3.

| Library | Bytes | sha256 | Source that worked |
| --- | --- | --- | --- |
| libnss3.so | 1353688 | af877ac050653dd2b13dcbcf0aeab8d52c47f5e34c936786910aff48c462a007 | npm `chrome-aws-lambda@10.1.0`, `bin/aws.tar.br`, brotli |
| libnssutil3.so | 200160 | f8364ad2fadde6f312088478e55b48e32bc0e0a47f298f2e3b3362f84095cce6 | same |
| libnspr4.so | 343512 | 13f7f8364d90cd75904500c7fdeadd5bac454bd634e1cdf72d25bec62283262f | built from `servo/nspr` source, commit 8219c5c5137b94ae93cfb4afc1dc10a94384e1c6 |
| libplc4.so | 31456 | 83314dcb5c89dfd1d9d2b71d0fa7e7b8e15294c6c6cb46a40b873d3c4b076293 | same build |
| libplds4.so | 22120 | 88afc76bf517b20e2f29f9bc401bfc74ba4c247ad159dfd5da5c02131fba8786 | same build |
| libsoftokn3.so | 278648 | ca0b1022278d1b2c01e98f551f2a929e363d3b7d706389987c71539cb602d4f2 | npm `chrome-aws-lambda@10.1.0` |
| libexpat.so.1 | 243840 | not needed here | same |
| libsqlite3.so.0 | 1175000 | not needed here | same |
| libuuid.so.1 | 31240 | not needed here | same |

The NSS libraries in that tarball are the only npm-reachable copy, and they need NSPR that the
tarball does not contain. NSPR is not on npm and not reachable as a plain file, so it had to be
compiled from source here. `servo/nspr` builds with the tools this box
already has, `gcc` and `make`, but its configure misdetects i386 and fails on
`bits/libc-header-start.h`, so it needs `USE_64=1 ./configure --enable-64bit`. That build works, and
the result satisfies the 2018 NSS libraries. A vendored copy is the better source; see G4.

Result with `LD_LIBRARY_PATH=/tmp/chrome-deps` and `PLAYWRIGHT_CHROMIUM_PATH=/tmp/chromium`:

| Run | Result |
| --- | --- |
| `npx playwright test e2e/smoke.spec.ts` | 6 of 6 passed, 1.1 min |
| `npx playwright test --grep-invert "@visual\|@audit"` | 17 of 17 passed, 2.2 min |

Version skew to keep in mind: `playwright-core@1.64.1` pins Chrome for Testing 156.0.8078.4, and the
npm browser is Chromium 153. The suite passes anyway. The mismatch is a risk, not a blocker, and it
is the reason G3 wants the CfT 156 build in the branch.

### 2.3 Recipe defects found, and what this branch did

1. `PLAYWRIGHT_SANDBOX_LIBS` was applied only inside `sandboxChromium()` in `playwright.config.ts`.
   When `PLAYWRIGHT_CHROMIUM_PATH` was set, `resolveChromium()` returned early and the directory was
   never prepended to `LD_LIBRARY_PATH`. The suite then failed with
   `/tmp/chromium: error while loading shared libraries: libnspr4.so`. Fixed here: the prepend now
   runs once at the top of `resolveChromium()`, before the explicit-path branch, and the duplicate
   call inside `sandboxChromium()` is gone. Verified by running the suite with
   `PLAYWRIGHT_CHROMIUM_PATH` and `PLAYWRIGHT_SANDBOX_LIBS` set and no exported `LD_LIBRARY_PATH`.
2. `docs/developing/browser-preview.mdx:26` told the reader to run
   `npx playwright install chromium`, which cannot work here and gave no alternative. Fixed here:
   the page now names `PLAYWRIGHT_CHROMIUM_PATH`, `PLAYWRIGHT_SANDBOX_LIBS` and this document.
3. `e2e/README.md` described the npm fallback but never named a source for the browser libraries,
   and did not say that the explicit browser path used to skip the library directory. Fixed here:
   the section now states that the directory applies to all three paths and points at this document
   as the source of the files.

## 3. Items this box cannot obtain

Priority classes: must means a gate in `AGENTS.md` or `.agents/PREFLIGHT.md` cannot run without it.
Should means fidelity or robustness. Optional means provenance or polish.

| Id | Item | Blocks | Priority |
| --- | --- | --- | --- |
| G1 | crates.io dependency set for `src-tauri` | `cargo check`, `cargo clippy`, `cargo test`, `tauri build` | must |
| G2 | Debian 12 Tauri system development stack | the same Rust gates, because `gtk-sys`, `webkit2gtk-sys`, `soup3-sys`, `libappindicator-sys` and `openssl-sys` build scripts need pkg-config and headers | must |
| G3 | Browser matched to Playwright 1.64.1, Chrome for Testing 156.0.8078.4 | supported Playwright runs and visual fidelity | should |
| G4 | NSS, NSPR and the CfT shared-library closure | any Chrome or Chromium launch without apt | must |
| G5 | `pkg-config`, `cmake`, `patchelf`, `file` | Rust build scripts, `tauri build` bundling | must for G2 |
| G6 | Font set beyond DejaVu | text rendering differences against CI | optional |
| G7 | Official Rust 1.88.0 tarballs and the channel manifest | provenance of a toolchain that today comes from the third-party `@rustbin` repackaging | optional |

### G1 crates.io dependency set

Why it cannot be obtained here: 759 of the 760 package entries in `src-tauri/Cargo.lock` resolve to
`registry+https://github.com/rust-lang/crates.io-index`, the last one being this workspace's own
`app` crate. There is no `[patch]` section and no git dependency, and `crates.io`, `index.crates.io`
and `static.crates.io` all fail to connect. Pin the set to this lockfile:

```text
src-tauri/Cargo.lock sha256 c4cece116c312de4cd5ff7a1a4b8c0e2583083b9997a6a63e05fed7b84b8c537
```

What the free agent produces, run on the same commit with Rust 1.88.0:

```bash
cargo vendor --locked --versioned-dirs --manifest-path src-tauri/Cargo.toml /tmp/cargo-vendor
tar -C /tmp/cargo-vendor -cJf cargo-vendor.tar.xz .
```

Requirements on the artifact:

- `cargo vendor` prints a `[source.crates-io] replace-with = "vendored-sources"` block. Save that
  block in the branch as `rust/cargo-config.toml` so consumers do not have to regenerate it. A file
  path in `cargo --config <path>` is accepted and applied, verified with cargo 1.88.0 and a vendor
  directory that did not exist, which failed with `failed to load source for dependency backoff`.
- Keep the consume side on Rust 1.88.0, because `src-tauri/Cargo.toml` sets
  `rust-version = "1.88.0"` and the sandbox toolchain is 1.88.0.
- Ship the lockfile hash next to the tarball so a consumer can refuse a mismatched lockfile.
- Keep `CARGO_HOME` out of the workspace when consuming. Point it at a directory under `/tmp`.
- `src-tauri/Cargo.toml` has no `.cargo/config.toml` today and CI expects crates.io, so the consume
  step should pass the config on the command line with `cargo --config /tmp/cargo-vendor-config.toml`
  and set `CARGO_NET_OFFLINE=true`, rather than committing a source-replacement file into the repo.

Size: unknown until vendor runs. Expect roughly 300 to 900 MB extracted and 60 to 150 MB as a
`.tar.xz`. Split it if a single file would exceed 90 MB. Use xz, not zstd, because `zstd` and `7z`
are not installed here. `xz`, `tar`, `unzip`, `zip`, `gzip` and `bzip2` are.

### G2 Debian 12 Tauri system development stack

Why it cannot be obtained here: `apt-get update` cannot reach any Debian mirror, and `pkg-config`,
`libwebkit2gtk-4.1-dev`, `libgtk-3-dev` and the rest are absent. `pkg-config` itself is not
installed, so no `-sys` crate can locate system libraries even if the headers were present.

The list has two parts.

The exact list CI installs, from `.github/actions/setup/action.yml`:

```text
libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev libxdo-dev
build-essential curl wget file patchelf
```

Plus what the build scripts in the lockfile need for the GTK stack to resolve:

```text
pkg-config libgtk-3-dev libglib2.0-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
libcairo2-dev libpango1.0-dev libgdk-pixbuf-2.0-dev libharfbuzz-dev libatk1.0-dev
libatspi2.0-dev libdbus-1-dev libx11-dev libxext-dev libxrandr-dev libxi-dev libxcursor-dev
libenchant-2-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev cmake
```

Crates in the lockfile that drive that need: `gtk-sys 0.18.2`, `webkit2gtk-sys 2.0.2`,
`soup3-sys 0.5.0`, `javascriptcore-rs-sys 1.1.1`, `libappindicator-sys 0.9.0`,
`openssl-sys 0.9.117`, `libgit2-sys 0.18.8+1.9.7`, `libz-sys 1.1.23`, `ring 0.17.14`.

Method for the free agent, on Debian 12 amd64 so the glibc matches this box's 2.36. Run it in a
clean `debian:12` container. On a host that already has these packages installed, `--download-only`
skips what is present and the archive directory comes out incomplete.

```bash
apt-get update
apt-get install -y --download-only $(apt-get install -s libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev libssl-dev libxdo-dev pkg-config cmake patchelf \
  build-essential file | awk '/^Inst /{print $2}' | sed 's/:[a-z0-9]*$//' | sort -u)
mkdir -p /tmp/gtk-sysroot
for d in /var/cache/apt/archives/*.deb; do dpkg-deb -x "$d" /tmp/gtk-sysroot; done
tar -C /tmp/gtk-sysroot -cJf debian12-dev-sysroot.tar.xz .
```

If you cannot use a container, use `apt-get download` with a recursive dependency list instead,
because `apt-get download` fetches a package whether or not it is installed:

```bash
apt-get download $(apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts \
  --no-breaks --no-replaces --no-enhances libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev libxdo-dev pkg-config cmake patchelf build-essential file \
  | grep '^[a-z0-9]' | sed 's/:[a-z0-9]*$//' | sort -u)
```

`dpkg-deb -x` preserves the absolute layout, which lets the consumer use a sysroot prefix instead of
rewriting paths in the `.pc` files:

```bash
export PKG_CONFIG_SYSROOT_DIR=/tmp/gtk-sysroot
export PKG_CONFIG_PATH=/tmp/gtk-sysroot/usr/lib/x86_64-linux-gnu/pkgconfig:/tmp/gtk-sysroot/usr/share/pkgconfig
export PKG_CONFIG=/tmp/gtk-sysroot/usr/bin/pkg-config
export CPATH=/tmp/gtk-sysroot/usr/include:/tmp/gtk-sysroot/usr/include/x86_64-linux-gnu
export LIBRARY_PATH=/tmp/gtk-sysroot/usr/lib/x86_64-linux-gnu
export LD_LIBRARY_PATH=/tmp/gtk-sysroot/usr/lib/x86_64-linux-gnu
```

Include `PKGS.txt` with `dpkg-deb -f <deb> Package Version` output for every package in the
sysroot. Size estimate 200 to 400 MB extracted, tens of thousands of files, so ship one `.tar.xz`
and never lay it out inside the repository.

Acceptance test, and this matters: this item is the most fragile of the set. Before the branch is
declared done, the free agent must run

```bash
cargo --offline --config /tmp/cargo-vendor-config.toml clippy \
  --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

inside a clean Debian 12 container with only the vendored cargo tree and the vendored sysroot on
the environment. If that fails, say so in `README.md` on the branch and keep the Rust gates on CI
rather than shipping a sysroot that looks complete and is not.

### G3 Browser matched to Playwright

`playwright-core@1.64.1` does not download the old `chrome-linux` layout any more. Its
`browsers.json` for Linux x64 wants three downloads, and every host that serves them is blocked
here:

| Browser | Revision | Version | Asset path | Upstream URL |
| --- | --- | --- | --- | --- |
| chromium | 1248 | 156.0.8078.4 | `builds/cft/156.0.8078.4/linux64/chrome-linux64.zip` | `https://cdn.playwright.dev/builds/cft/156.0.8078.4/linux64/chrome-linux64.zip` |
| chromium-headless-shell | 1248 | 156.0.8078.4 | `builds/cft/156.0.8078.4/linux64/chrome-headless-shell-linux64.zip` | same host |
| ffmpeg | 1013 | none | `builds/ffmpeg/1013/ffmpeg-linux.zip` | same host |

The same builds exist on Google's Chrome for Testing endpoint,
`https://storage.googleapis.com/chrome-for-testing-public/156.0.8078.4/linux64/chrome-linux64.zip`,
which is also blocked here. Either source is acceptable to vendor. Prefer the Playwright-hosted copy
so the artifact is the one Playwright itself validates.

On-disk layout Playwright accepts, with `PLAYWRIGHT_BROWSERS_PATH` pointing at the root:

```text
<root>/chromium-1248/INSTALLATION_COMPLETE
<root>/chromium-1248/chrome-linux64/chrome
<root>/chromium_headless_shell-1248/INSTALLATION_COMPLETE
<root>/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
<root>/ffmpeg-1013/ffmpeg-linux
```

Directory names follow `name.replace(/-/g, "_") + "-" + revision`, so the headless shell directory
is `chromium_headless_shell-1248`, not `chromium-headless-shell-1248`. The marker file lives in the
browser directory, not inside `chrome-linux64/`, and `playwright install` treats a browser as
installed only when the marker exists. `executablePath()` does not require the marker, so a launch
works without it, but `install` would try to re-download.

Simplest artifact for the branch: unzip into a staged root on the free box, create the marker files,
then ship

```bash
tar -C /tmp/pw-browsers -cJf browsers-playwright-1.64.1.tar.xz .
```

so the consumer does `tar xJf` and one `PLAYWRIGHT_BROWSERS_PATH=...` export. Sizes: measure and
record in `BROWSERS.txt`. The chromium zip is expected to be around 170 MB, which is over the
100 MB GitHub file limit, so split at 90 MB. Check the headless shell before assuming it fits, and
check the compressed archive of the staged tree, because a full tree of around 350 MB will compress
to roughly 100 MB and may need splitting too. ffmpeg is only needed for video, and this repo sets
`video: "off"`, so treat ffmpeg as optional.

### G4 NSS, NSPR and the CfT shared-library closure

Two sets, for two strategies.

Set A, the minimum for the npm Chromium 153 path already proven in section 2.2. Nine files,
3,679,664 bytes in total, with the six the loader needs accounting for 2.2 MB. Hashes are in the
table above. The NSS files come from npm and NSPR had to be compiled, so a vendored copy is worth
having even for this path. They belong in a directory such as `chrome-deps/npm-chromium-153/` and
are consumed through `LD_LIBRARY_PATH`.

Set B, the closure a Chrome for Testing build needs on Debian 12. Compute it on a pristine
bookworm box rather than trusting a list:

```bash
unzip -q chrome-linux64.zip
ldd chrome-linux64/chrome | grep "not found"          # the direct needs
npx playwright install-deps --dry-run chromium        # Playwright's own apt package list
readelf -d chrome-linux64/chrome | grep NEEDED
```

Then fetch each provider package with `apt-get download` and `dpkg-deb -x`, and copy only the
`.so` and `.so.N` files the closure needs into `chrome-deps/cft-156/`. The list below is a starting
point, not the answer. It combines the library names in Playwright's own `lib2package` table for
`debian12-x64`, which lives in `node_modules/playwright-core/lib/coreBundle.js`, with the NSS
runtime modules and the X11 shm and keyboard companions a CfT build links at run time. The closure
commands above decide.

```text
libasound.so.2 libatk-1.0.so.0 libatk-bridge-2.0.so.0 libatspi.so.0 libcairo-gobject.so.2
libcairo.so.2 libcups.so.2 libdbus-1.so.3 libdbus-glib-1.so.2 libdrm.so.2 libEGL.so.1
libepoxy.so.0 libevdev.so.2 libfontconfig.so.1 libfreetype.so.6 libgbm.so.1
libgdk_pixbuf-2.0.so.0 libgdk-3.so.0 libgio-2.0.so.0 libGLESv2.so.2 libglib-2.0.so.0
libGLX.so.0 libgmodule-2.0.so.0 libgobject-2.0.so.0 libgtk-3.so.0 libgtk-4.so.1
libgudev-1.0.so.0 libharfbuzz.so.0 libjpeg.so.8 liblcms2.so.2 libnotify.so.4 libnspr4.so
libnss3.so libnssutil3.so libOpenGL.so.0 libopus.so.0 libpango-1.0.so.0 libpangocairo-1.0.so.0
libpng16.so.16 libsecret-1.so.0 libsmime3.so libsoftokn3.so libuuid.so.1 libwayland-client.so.0
libwayland-egl.so.1 libX11-xcb.so.1 libX11.so.6 libxcb-shm.so.0 libxcb.so.1 libXcomposite.so.1
libXcursor.so.1 libXdamage.so.1 libXext.so.6 libXfixes.so.3 libXi.so.6 libxkbcommon.so.0
libxkbcommon-x11.so.0 libXrandr.so.2 libXrender.so.1 libXtst.so.6 libxshmfence.so.1
```

`libEGL.so.1`, `libGLESv2.so.2`, `libvk_swiftshader.so` and `libvulkan.so.1` ship inside the CfT
folder itself, so do not duplicate them. This box already has `libX11.so.6`, `libxcb.so.1`,
`libffi.so.8`, `libexpat.so.1`, `libsqlite3.so.0` and `libudev.so.1`, so skip those when collecting
for this sandbox. Total size estimate 25 to 40 MB, small enough that every file fits under the
GitHub limit without splitting.

Licence note that applies to G2 and G4 both. NSS and NSPR are MPL 2.0, the GTK stack is LGPL, and
Debian binaries carry per-package copyright files. This repository is public, so the branch is
world-readable and redistribution obligations attach. Include `LICENSES/` with the licence text for
every library shipped, and the `usr/share/doc/<package>/copyright` files collected by the extraction
step in G2. If the maintainers prefer not to publish redistributed binaries, push the branch to a
private mirror repository instead and parameterise the fetch script on the repository URL.

### G5 Missing command line tools

| Tool | Needed by | How to vendor |
| --- | --- | --- |
| `pkg-config` | every `-sys` crate build script | `apt-get download pkg-config` on bookworm, or `pkgconf` from source. Ship the binary plus `share/pkgconfig` |
| `cmake` | build scripts that opt into it, for example parts of the native dependency chain | `apt-get download cmake` plus its data directory, or extract from the sysroot |
| `patchelf` | `tauri build` bundling | `apt-get download patchelf` |
| `file` | `tauri build` bundling and artifact checks | `apt-get download file` and `libmagic1` |

Do not standardise on `zstd` or `7z` in any recipe. Neither is installed here and neither is in the
payload. `xz`, `tar`, `unzip`, `gzip` and `bzip2` are all present.

### G6 Fonts, optional

`/usr/share/fonts/truetype/dejavu` has six DejaVu faces and the suite renders correctly with them.
CI renders with the Ubuntu runner's font set, and the visual baselines are excluded from CI for
exactly that reason. If visual parity with CI matters later, vendor the same font packages CI has,
otherwise leave this alone.

### G7 Official Rust toolchain, optional

`@rustbin/*` works today and is the only way to get a toolchain from npm. Vendoring the upstream
1.88.0 components gives a first-party source and upstream-published hashes:

```text
https://static.rust-lang.org/dist/rustc-1.88.0-x86_64-unknown-linux-gnu.tar.xz
https://static.rust-lang.org/dist/rust-std-1.88.0-x86_64-unknown-linux-gnu.tar.xz
https://static.rust-lang.org/dist/cargo-1.88.0-x86_64-unknown-linux-gnu.tar.xz
https://static.rust-lang.org/dist/rustfmt-1.88.0-x86_64-unknown-linux-gnu.tar.xz
https://static.rust-lang.org/dist/clippy-1.88.0-x86_64-unknown-linux-gnu.tar.xz
https://static.rust-lang.org/dist/channel-rust-1.88.0.toml
```

`channel-rust-1.88.0.toml` carries the sha256 and xz hash for each component, so ship it and let
the fetch script verify against upstream-published hashes. Each component tarball is between 3 MB
and 70 MB, so no splitting is needed. The consumer extracts each component with its own
`install.sh --prefix=<dir>`, exactly as rustup would.

## 4. Contract for the vendored branch

Branch name: `vendor/sandbox-toolchain`. If the payload after compression exceeds about 1.5 GB,
split it into `vendor/sandbox-browsers` and `vendor/sandbox-rust` and say so in each `README.md`.

Shape:

```text
README.md                     what this branch is, source URLs, licences, how to consume
FETCH.md                      copy-paste consumer commands, verified on the free box
MANIFEST.sha256               sha256 for every file in the tree and for each reassembled asset
LICENSES/                     licence text per redistributed library
rust/toolchain/               G7 components and channel-rust-1.88.0.toml
rust/cargo-vendor.tar.xz      G1 vendor tree, split if over 90 MB
rust/cargo-config.toml        the source replacement block cargo vendor prints
rust/Cargo.lock.sha256        c4cece116c312de4cd5ff7a1a4b8c0e2583083b9997a6a63e05fed7b84b8c537
system/debian12-dev-sysroot.tar.xz   G2, split as needed
system/PKGS.txt               package and version list for the sysroot
chrome-deps/npm-chromium-153/ G4 set A, nine files
chrome-deps/cft-156/          G4 set B, closure for the CfT build
browsers/browsers-playwright-1.64.1.tar.xz  G3, the laid-out tree including markers
browsers/BROWSERS.txt         versions, revisions, upstream URLs, measured sizes
```

Rules the free agent must follow:

1. Create the branch as an orphan with a single commit. Never base it on `main` and never merge it
   into `main`. The binary payload must not enter the release pipeline.
2. Every file must be smaller than 100 MB, because GitHub rejects a push containing a larger file.
   Split at 90 MB with `split -b 90M -d <asset> <asset>.part-` and reassemble with
   `cat <asset>.part-* > <asset>`. This pair of commands is verified.
3. Hash everything. `MANIFEST.sha256` must contain entries for the parts and for the reassembled
   assets, so a consumer can verify at both stages with `sha256sum -c`.
4. No Git LFS. `media.githubusercontent.com` is blocked, so LFS pointers resolve to unusable files.
5. No release assets. `gh release download` fails here. Files must be plain blobs in the tree.
6. No recipes that point at `raw.githubusercontent.com`. Use codeload, the git protocol, or the
   contents API.
7. Record provenance per artifact: upstream URL, upstream sha256 where the upstream publishes one,
   the command used, and for Debian files the `Package` and `Version` from `dpkg-deb -f`.
8. Verify architecture and closure before pushing: `readelf -h` on every binary must report
   `x86-64`, and `ldd chrome-linux64/chrome | grep "not found"` must be empty inside the staged
   layout after applying the vendored library directory.
9. State the measured total branch size in `README.md`, plus the size each directory needs on disk
   after extraction. Consumers extract to `/tmp`, never into the workspace.

## 5. Fetch recipe that works here

Extract to `/tmp` only. The workspace is snapshotted and a fetched payload would blow the snapshot
budget, and a `git fetch` of a payload this size would grow `.git` inside the workspace.

```bash
BRANCH=vendor/sandbox-toolchain
mkdir -p /tmp/sandbox-vendor

# Option 1, one request, no git objects
curl -sSL -o /tmp/sandbox-vendor.tar.gz \
  "https://codeload.github.com/better-Shape/app/tar.gz/refs/heads/${BRANCH}"
tar xzf /tmp/sandbox-vendor.tar.gz -C /tmp/sandbox-vendor --strip-components=1

# Option 2, repository clone, single branch, no history
git clone --depth 1 --single-branch --branch "$BRANCH" \
  https://github.com/better-Shape/app.git /tmp/sandbox-vendor

cd /tmp/sandbox-vendor

# Reassemble split payloads first, then verify the parts and the assembled assets
for f in $(grep -o '^[a-f0-9]\{64\}  .*\.part-00$' MANIFEST.sha256 | sed 's/.*  //; s/\.part-00$//'); do
  cat "$f".part-* > "$f"
done
sha256sum -c MANIFEST.sha256
```

Expect zero failures. If the manifest lists both the parts and the assembled assets, this single
check covers both stages.

For one or two small files, skip the download:

```bash
gh api repos/better-Shape/app/contents/chrome-deps/npm-chromium-153/libnspr4.so \
  --jq .content | base64 -d > /tmp/libnspr4.so
```

Then wire it up, in the order the payloads come in:

```bash
# Rust toolchain
RUST_PREFIX=/tmp/rust-tools; mkdir -p "$RUST_PREFIX"
for t in /tmp/sandbox-vendor/rust/toolchain/*.tar.xz; do
  d=$(mktemp -d); tar xJf "$t" -C "$d"; "$d"/*/install.sh --prefix="$RUST_PREFIX" --disable-ldconfig
done
export PATH="$RUST_PREFIX/bin:$PATH" LD_LIBRARY_PATH="$RUST_PREFIX/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# Cargo dependencies, offline
mkdir -p /tmp/cargo-vendor && tar xJf /tmp/sandbox-vendor/rust/cargo-vendor.tar.xz -C /tmp/cargo-vendor
printf '[source.crates-io]\nreplace-with = "vendored-sources"\n\n[source.vendored-sources]\ndirectory = "/tmp/cargo-vendor"\n' \
  > /tmp/cargo-vendor-config.toml
export CARGO_HOME=/tmp/cargo-home CARGO_NET_OFFLINE=true

# Tauri system stack
mkdir -p /tmp/gtk-sysroot && tar xJf /tmp/sandbox-vendor/system/debian12-dev-sysroot.tar.xz -C /tmp/gtk-sysroot
export PKG_CONFIG_SYSROOT_DIR=/tmp/gtk-sysroot
export PKG_CONFIG_PATH=/tmp/gtk-sysroot/usr/lib/x86_64-linux-gnu/pkgconfig:/tmp/gtk-sysroot/usr/share/pkgconfig
export PKG_CONFIG=/tmp/gtk-sysroot/usr/bin/pkg-config
export CPATH=/tmp/gtk-sysroot/usr/include:/tmp/gtk-sysroot/usr/include/x86_64-linux-gnu
export LIBRARY_PATH=/tmp/gtk-sysroot/usr/lib/x86_64-linux-gnu

# Playwright browsers and the library closure
export PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers
mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" && tar xJf /tmp/sandbox-vendor/browsers/browsers-playwright-1.64.1.tar.xz -C "$PLAYWRIGHT_BROWSERS_PATH"
export LD_LIBRARY_PATH=/tmp/sandbox-vendor/chrome-deps/cft-156:${LD_LIBRARY_PATH:-}
```

The Playwright path is then `npm ci` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` and a plain
`npx playwright test`. No `PLAYWRIGHT_CHROMIUM_PATH` is needed, because the vendored tree sits in
the registry layout Playwright expects.

## 6. Reference map for the branch and the docs

Rows marked done landed with this document. The rest need the vendored branch to exist first,
because they reference it as the source of toolchains and libraries.

| File | Current state | Change | State |
| --- | --- | --- | --- |
| `engineering/sandbox-vendored-toolchain.md` | this file | keep as the specification and record the fetch results | done |
| `engineering/sandbox-vendor-handoff-prompt.md` | companion brief | the brief to hand to the free agent | done |
| `playwright.config.ts` | `applySandboxLibs()` was called inside `sandboxChromium()` only, so `PLAYWRIGHT_CHROMIUM_PATH` skipped the library directory | call it at the top of `resolveChromium()` and drop the duplicate call | done |
| `e2e/README.md` | section `Sandboxed / CI environments without browser downloads` listed the three Chromium resolutions and did not name a source for the libraries | state that the library directory applies to all three paths, and point at this document | done |
| `docs/developing/browser-preview.mdx` | line 26 said `npx playwright install chromium` once per machine with no alternative | name `PLAYWRIGHT_CHROMIUM_PATH`, `PLAYWRIGHT_SANDBOX_LIBS` and this document | done |
| `engineering/rust-toolchain.md` | documents `@rustbin` from npm and says clippy and tests are CI only | add the vendored branch as source one, keep npm as fallback, and document the offline cargo build with G1 and G2 | pending |
| `scripts/ci/install-rust-toolchain.sh` | npm `@rustbin` only, closing note says crates.io is unreachable | add a vendored-branch mode, or a sibling script that consumes `rust/toolchain/` and verifies hashes | pending |
| `scripts/dev/rust-toolchain.sh` | npm `@rustbin` only | same, or re-point at the shared installer | pending |
| `.github/actions/setup/action.yml` | apt list for CI | add a comment naming the vendored sysroot as the sandbox mirror of this list so the two do not drift | pending |
| `.github/RELEASE_READINESS.md` | lines 19 and 101 to 106 say Rust is CI only | update to the offline cargo path once G1 and G2 are proven | pending |
| `.agents/PREFLIGHT.md`, `AGENTS.md` | gates list `npm run test:rust` and the cargo commands | add the sandbox invocation with the vendored toolchain and vendored crates | pending |
| `README.md` or `CONTRIBUTING.md` | setup instructions assume a normal network | one pointer to `engineering/sandbox-vendored-toolchain.md` | pending |

Do not touch `.dump/app/browser-preview-audit-2026-10-14.md`. It is a dated record, not a recipe.

## 7. Evidence log

Every claim above was produced in this sandbox on 2026-10-16. The commands worth repeating:

```bash
# reachability sweep
for h in github.com codeload.github.com api.github.com registry.npmjs.org pypi.org \
         static.rust-lang.org sh.rustup.rs crates.io index.crates.io static.crates.io \
         cdn.playwright.dev dl.google.com storage.googleapis.com raw.githubusercontent.com \
         media.githubusercontent.com release-assets.githubusercontent.com deb.debian.org; do
  printf '%s %s\n' "$h" "$(curl -s -o /dev/null -m 8 -w '%{http_code}' "https://$h/")"
done

# release assets are not a delivery path
gh release download jq-1.7.1 --repo jqlang/jq --pattern jq-linux-amd64 --dir /tmp/ghdl   # EOF

# Rust from npm
RUST_TOOLS_DIR=/tmp/rust-tools bash scripts/ci/install-rust-toolchain.sh

# browser from npm, then the library gap
npm i @sparticuz/chromium@153.0.0
node -e "require('@sparticuz/chromium').default.executablePath().then(console.log)"
ldd /tmp/chromium | grep 'not found'      # libnspr4.so libnss3.so libnssutil3.so

# NSPR from source, after the default configure picks i386
USE_64=1 ./configure --prefix=/tmp/nspr-out --enable-64bit && make -j2 && make install

# end to end
LD_LIBRARY_PATH=/tmp/chrome-deps PLAYWRIGHT_CHROMIUM_PATH=/tmp/chromium \
  npx playwright test --grep-invert "@visual|@audit"     # 17 passed

# proof of the config fix in 2.3, with no exported LD_LIBRARY_PATH
PLAYWRIGHT_CHROMIUM_PATH=/tmp/chromium PLAYWRIGHT_SANDBOX_LIBS=/tmp/chrome-deps \
  npx playwright test e2e/smoke.spec.ts                  # 6 passed

# the split and reassembly pair, on a throwaway file
head -c 8M /dev/urandom > asset.zip && split -b 3M -d asset.zip asset.zip.part-
sha256sum asset.zip asset.zip.part-* > MANIFEST.sha256 && rm asset.zip
for f in $(grep -o '^[a-f0-9]\{64\}  .*\.part-00$' MANIFEST.sha256 | sed 's/.*  //; s/\.part-00$//'); do
  cat "$f".part-* > "$f"
done
sha256sum -c MANIFEST.sha256                            # all OK

# the marker file rule, from playwright-core
# node_modules/playwright-core/lib/coreBundle.js, browserFetcher.ts
#   if (await existsAsync(browserDirectoryToMarkerFilePath(browserDirectory))) return;
```

Measured environment facts: `/dev/shm` is 2 GB, fonts are six DejaVu faces, `cmake`, `zstd`, `7z`,
`pkg-config` and `file` are absent, `gcc`, `make`, `perl`, `python3`, `tar`, `unzip`, `xz`, `jq`,
`sha256sum`, `git`, `curl`, `wget` and `node` 22.22.3 are present.
