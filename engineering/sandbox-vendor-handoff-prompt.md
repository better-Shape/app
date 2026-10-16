# Handoff prompt: vendor the sandbox toolchain onto a GitHub branch

Paste everything below the line into the free-network agent. It is written to be self-contained.
The research behind it is `engineering/sandbox-vendored-toolchain.md`.

---

You are working in a free network environment. An agent sandbox that can reach only `github.com`,
`codeload.github.com`, `api.github.com`, `registry.npmjs.org` and `pypi.org` needs a set of binaries
and source trees that it cannot download for itself. Your job is to produce one GitHub branch that
carries them as plain files, with hashes and provenance, so the sandbox agent can fetch it through
the git protocol.

Target repository: `better-Shape/app`. Branch name: `vendor/sandbox-toolchain`. Create it as an
orphan branch with a single commit. Do not base it on `main`, do not open a pull request into
`main`, do not merge it, and do not add it to any release or CI workflow. Push only that branch.

Reference commit for every version below: `289b1344838fb5eea700505483125774ce6649be`, the head of
`draft/mega-absorb-all` that the sandbox checkout is based on. If your tree differs, the lockfile
hash in item 1 tells you so.

## Hard constraints

1. One file per asset must stay under 100 MB, because GitHub rejects a push that contains a larger
   file. Split anything larger at 90 MB:
   `split -b 90M -d <asset> <asset>.part-` and reassemble with `cat <asset>.part-* > <asset>`.
2. No Git LFS. `media.githubusercontent.com` is unreachable from the sandbox, so LFS pointers are
   useless there.
3. No GitHub release assets. `gh release download` fails with EOF from the sandbox. Everything must
   be a plain blob in the branch tree.
4. No `raw.githubusercontent.com` URLs anywhere in your documentation, because that host is blocked.
5. Compress with `xz`, not `zstd` or `7z`. The sandbox has `xz`, `tar`, `unzip`, `gzip` and `bzip2`
   and does not have `zstd`, `7z`, `cmake` or `pkg-config`.
6. Hash every file. `MANIFEST.sha256` must contain entries for both the parts and the reassembled
   assets, so one `sha256sum -c` after reassembly verifies both stages.
7. Write `README.md` and `FETCH.md` on the branch. `README.md` states what each directory is, where
   each artifact came from, its licence, the measured size, and how much space it needs on disk
   after extraction. `FETCH.md` holds the copy-paste consumer commands you actually ran.
8. Include `LICENSES/`. NSS and NSPR are MPL 2.0, the GTK stack is LGPL, and Debian binaries carry
   per-package copyright files. The repository is public, so include the licence text for every
   library you ship and the `usr/share/doc/<package>/copyright` files for the Debian extractions.

## What to vendor

### 1. Cargo dependency tree for `src-tauri`, required

759 of the 760 package entries in the lockfile resolve to
`registry+https://github.com/rust-lang/crates.io-index`, the last one being the workspace's own
`app` crate. There are no git dependencies and no patches. Pin to it:

```text
src-tauri/Cargo.lock sha256 c4cece116c312de4cd5ff7a1a4b8c0e2583083b9997a6a63e05fed7b84b8c537
```

```bash
cargo vendor --locked --versioned-dirs --manifest-path src-tauri/Cargo.toml /tmp/cargo-vendor
tar -C /tmp/cargo-vendor -cJf rust/cargo-vendor.tar.xz .
```

Ship `rust/cargo-config.toml` with the source replacement block cargo prints, and
`rust/Cargo.lock.sha256` with the hash above. Use Rust 1.88.0 so the vendor tree matches the
sandbox toolchain. Do not commit a `.cargo/config.toml` into the repo tree, because CI expects
crates.io.

### 2. Debian 12 amd64 development sysroot for the Tauri build, required

Needed by `gtk-sys 0.18.2`, `webkit2gtk-sys 2.0.2`, `soup3-sys 0.5.0`,
`javascriptcore-rs-sys 1.1.1`, `libappindicator-sys 0.9.0`, `openssl-sys 0.9.117`,
`libgit2-sys 0.18.8+1.9.7`, `libz-sys 1.1.23` and `ring 0.17.14`. The sandbox is bookworm with
glibc 2.36, so build this on Debian 12 amd64, not on a newer distribution.

```bash
apt-get update
apt-get install -y --download-only $(apt-get install -s \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev libxdo-dev \
  pkg-config cmake patchelf build-essential file | awk '/^Inst /{print $2}' \
  | sed 's/:[a-z0-9]*$//' | sort -u)
mkdir -p /tmp/gtk-sysroot
for d in /var/cache/apt/archives/*.deb; do dpkg-deb -x "$d" /tmp/gtk-sysroot; done
tar -C /tmp/gtk-sysroot -cJf system/debian12-dev-sysroot.tar.xz .
```

Run this in a clean `debian:12` container. On a host that already has the packages installed,
`--download-only` skips them and the archive directory comes out incomplete.

Keep the absolute layout from `dpkg-deb -x`. The consumer uses `PKG_CONFIG_SYSROOT_DIR` so the
paths inside the `.pc` files do not need rewriting. Also write `system/PKGS.txt` with the
`Package` and `Version` of every `.deb` you extracted.

This item is the fragile one. Before you call the branch done, prove it: in a clean Debian 12
container with only this sysroot and the cargo vendor tree, run

```bash
cargo --offline --config /tmp/cargo-vendor-config.toml clippy \
  --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

If it does not pass, say exactly what failed in `README.md` instead of implying the sysroot is
complete.

### 3. Playwright browsers matched to 1.64.1, required for browser fidelity

`playwright-core@1.64.1` needs Chrome for Testing 156.0.8078.4 and the headless shell, both
revision 1248, plus ffmpeg revision 1013. Upstream URLs, all blocked from the sandbox:

```text
https://cdn.playwright.dev/builds/cft/156.0.8078.4/linux64/chrome-linux64.zip
https://cdn.playwright.dev/builds/cft/156.0.8078.4/linux64/chrome-headless-shell-linux64.zip
https://cdn.playwright.dev/builds/ffmpeg/1013/ffmpeg-linux.zip
```

Google hosts the same browser builds at
`https://storage.googleapis.com/chrome-for-testing-public/156.0.8078.4/linux64/chrome-linux64.zip`.
Prefer the Playwright-hosted copy.

Stage the tree in the exact layout Playwright accepts, then ship it as one archive:

```text
<root>/chromium-1248/INSTALLATION_COMPLETE
<root>/chromium-1248/chrome-linux64/chrome
<root>/chromium_headless_shell-1248/INSTALLATION_COMPLETE
<root>/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
<root>/ffmpeg-1013/ffmpeg-linux
```

```bash
tar -C /tmp/pw-browsers -cJf browsers/browsers-playwright-1.64.1.tar.xz .
```

The headless shell directory name uses underscores. The marker file is an empty file inside the
browser directory, not inside `chrome-linux64/`. Record measured sizes and upstream sha256 values in
`browsers/BROWSERS.txt`. ffmpeg is optional for this repo, which sets `video: "off"`.

### 4. Shared libraries, required

Set A, for the Chromium 153 build that npm can supply. Nine files, 3,679,664 bytes. Ship them under
`chrome-deps/npm-chromium-153/`. The NSS files come from npm package `chrome-aws-lambda@10.1.0`,
`bin/aws.tar.br`, which is brotli. NSPR is not on npm. Build it from `servo/nspr` at commit
`8219c5c5137b94ae93cfb4afc1dc10a94384e1c6`, using `USE_64=1 ./configure --enable-64bit`, because the
default configure misdetects i386, then `make -j2 && make install`. Hashes produced here:

```text
libnss3.so     af877ac050653dd2b13dcbcf0aeab8d52c47f5e34c936786910aff48c462a007
libnssutil3.so f8364ad2fadde6f312088478e55b48e32bc0e0a47f298f2e3b3362f84095cce6
libsoftokn3.so ca0b1022278d1b2c01e98f551f2a929e363d3b7d706389987c71539cb602d4f2
libnspr4.so    13f7f8364d90cd75904500c7fdeadd5bac454bd634e1cdf72d25bec62283262f
libplc4.so     83314dcb5c89dfd1d9d2b71d0fa7e7b8e15294c6c6cb46a40b873d3c4b076293
libplds4.so    88afc76bf517b20e2f29f9bc401bfc74ba4c247ad159dfd5da5c02131fba8786
```

The three NSS hashes must match because they come from a published tarball. The three NSPR hashes
are outputs of this build and may differ if your compiler or flags differ. If they do, record your
own hashes in `MANIFEST.sha256`, note the compiler version, and confirm the libraries load with
`LD_LIBRARY_PATH=/path ldd chrome-linux64/chrome | grep "not found"` returning nothing.

Set B, the closure the Chrome for Testing build needs on Debian 12. Compute it instead of guessing:

```bash
unzip -q chrome-linux64.zip
ldd chrome-linux64/chrome | grep "not found"
readelf -d chrome-linux64/chrome | grep NEEDED
npx playwright install-deps --dry-run chromium
```

Then fetch each provider package with `apt-get download` and `dpkg-deb -x`, and copy only the
`.so` and `.so.N` files the closure needs into `chrome-deps/cft-156/`. The authoritative library to
package mapping ships inside `node_modules/playwright-core/lib/coreBundle.js` in the `lib2package`
table for `debian12-x64`. Do not duplicate the EGL, GLESv2 and Vulkan libraries, because the CfT
archive already contains them. Expect 25 to 40 MB total.

### 5. Command line tools, required

From the same sysroot extraction, ship `pkg-config`, `cmake`, `patchelf` and `file` plus
`libmagic1`, under `system/tools/`. The sandbox has none of them and no way to install them.

### 6. Optional

- Official Rust 1.88.0 components from `https://static.rust-lang.org/dist/`, named
  `rustc-1.88.0-x86_64-unknown-linux-gnu.tar.xz`, `rust-std-`, `cargo-`, `rustfmt-`, `clippy-`, plus
  `channel-rust-1.88.0.toml`, which carries the upstream sha256 values. Each file is between 3 MB
  and 70 MB, so no splitting is needed. This replaces the third-party `@rustbin` npm repackaging
  that the sandbox uses today.
- A font set, only if the maintainers want visual parity with CI.

## Branch layout

```text
README.md
FETCH.md
MANIFEST.sha256
LICENSES/
rust/toolchain/                 optional official 1.88.0 components and channel manifest
rust/cargo-vendor.tar.xz
rust/cargo-config.toml
rust/Cargo.lock.sha256
system/debian12-dev-sysroot.tar.xz
system/PKGS.txt
system/tools/                   pkg-config, cmake, patchelf, file, libmagic1
chrome-deps/npm-chromium-153/   nine libraries
chrome-deps/cft-156/            library closure for the CfT build
browsers/browsers-playwright-1.64.1.tar.xz
browsers/BROWSERS.txt
```

If the total payload after compression exceeds about 1.5 GB, split it into two branches,
`vendor/sandbox-browsers` and `vendor/sandbox-rust`, and say so in both `README.md` files.

## Verification to run before you push

1. `readelf -h` on every binary in the branch reports `ELF 64-bit` and `x86-64`.
2. `ldd chrome-linux64/chrome | grep "not found"` is empty inside the staged browser tree once the
   vendored library directory is on `LD_LIBRARY_PATH`.
3. `tar tJf` lists every archive without error, and each archive gets the sha256 recorded in
   `MANIFEST.sha256`.
4. `sha256sum -c MANIFEST.sha256` passes on a fresh clone of the branch.
5. `git count-objects -vH` and the sum of file sizes are recorded in `README.md`.
6. The clippy command in item 2 passes in a clean Debian 12 container with vendored inputs only.

## What to report back

The branch name and URL, the single commit SHA, the measured total size, a table of every artifact
with its upstream URL, upstream hash where one exists, measured size and sha256, the licences
shipped, and the exact output of the verification steps. If any item could not be produced, say
which one and what it needs, rather than shipping a partial artifact without a note.
