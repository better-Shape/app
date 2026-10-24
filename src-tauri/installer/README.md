# Windows installer art

The Windows NSIS installer shows a static BetterShape sidebar on the welcome
and finish pages. Everything in this folder is a build input for
`src-tauri/tauri.conf.json`, which points `bundle.windows.nsis.sidebarImage`
at `installer/sidebar.bmp`.

| Path | Role |
| --- | --- |
| `sidebar.bmp` | 164x314, 24-bit, uncompressed, 151 KB |

## How the image reaches the installer

Tauri canonicalizes `sidebarImage` with `dunce` and writes it into the
template's `SIDEBARIMAGE` define (`crates/tauri-bundler/src/bundle/windows/nsis/mod.rs:350-355`).
The template maps that define to `MUI_WELCOMEFINISHPAGE_BITMAP` when it is not
empty (`installer.nsi:42` and `127-129`), and `!insertmacro MUI_PAGE_WELCOME`
at `installer.nsi:146` consumes it. MUI loads the file into an `SS_BITMAP`
static when it builds the page, and the uninstaller and finish pages reuse the
same define.

That is the whole mechanism. No hook, no plug-in and no runtime code is
involved, so a path that does not resolve fails the Windows build instead of
degrading quietly to the default art.

`MUI_WELCOMEFINISHPAGE_BITMAP` accepts a BMP only. It has no frame loop, so an
animated GIF cannot be passed to it at all.

## Why there is no animation here

This folder used to hold a 100-frame animated GIF, an NSIS hook that painted
it over the MUI static, and the vendored AnimGif plug-in that did the painting.
That was removed on 24 October 2026 and the sidebar is a plain image, the way
every other Windows installer does it.

The animation cost more than it returned. It needed a 3.9 MB committed asset
and a 3.9 MB extraction into `$PLUGINSDIR` on every visit to the welcome page,
it carried an unsigned 2010 third-party binary into the installer, and it could
not be made safe without forking that binary: `AnimGif::stop` ends its worker
with `TerminateThread` rather than a cooperative join
(plugin-animgif `winimage.cpp:236-240`), and because the shipped GIF looped
forever the worker condition was literally "while true"
(`winimage.cpp:130`), so skipping the call was not an option either. Its error
reporting is compiled out (`winimage.cpp:40`), which left failure modes the
hook could reach but not catch.

The full reasoning, the platform research behind it and the options that were
weighed are in `.dump/app/research/windows-installer-static-sidebar-2026-10-24.md`.
The earlier design is recorded in
`.dump/app/research/windows-nsis-animated-sidebar-2026-10-17.md` and its review
in `.dump/app/audits/windows-nsis-animated-sidebar-2026-10-17.md`. Both stay as
written because they describe the state that existed at the time.

If animation is ever wanted again, the supported route is a hook on
`bundle.windows.nsis.installerHooks`, which Tauri includes at
`installer.nsi:28-29` after `MUI2.nsh` and before the welcome page is
declared. Forking `bundle.windows.nsis.template` is not: it vendors the whole
installer script and needs re-diffing on every Tauri upgrade, and Tauri's own
issue tracker records that `installer.nsi` has changed meaningfully several
times across 2.x.

## Image limits

- The image slot is 164x314 at 96 DPI. MUI stretches the bitmap to fit, so
  other DPI settings scale the same asset.
- `.github/workflows/pr.yml` fails on any committed file above 5 MB. The
  installer is compressed as one LZMA block, so a large image costs download
  size for every target.

## Code signing

Nothing in this repository signs the Windows installer. `tauri.conf.json` sets
neither `bundle.windows.certificateThumbprint` nor `bundle.windows.signCommand`,
and the bundler signs the NSIS output only when one of them is present
(`settings.rs`, `can_sign`), so it logs a warning and skips signing.
`release.yml` applies the Tauri updater key to the payload, which is not an
Authenticode signature.

Two consequences are worth knowing before anyone treats a green installer job
as a usable build. Windows keys reputation on the file hash, so every CI run
starts from zero reputation and inherits none from the run before it. And
unsigned Windows binaries can be refused outright rather than merely warned
about, which presents to a user as a double-click that does nothing. The
options for changing that, with the eligibility constraints that were verified
for this project, are in the research file named above.

## Regenerating the asset

The source art is not on this branch. It lives on `bettershape-init` at commit
`4b8eaac6` as `bettershape assets/BetterShape (1).gif`, and it is 5.4 MB,
above the committed-file limit. Pull it with:

```bash
git show 4b8eaac6:'bettershape assets/BetterShape (1).gif' > source.gif
```

Run the steps from the repository root and delete `source.gif` afterwards.

The current BMP is frame zero of the resampled animation, so it carries that
frame's 256-colour palette rather than the source frame's full colour depth.
Reproducing it means following the same path: convert, resize with LANCZOS,
quantize to 256 colours with median cut and no dither, then save as BMP. With
Python and Pillow 13.0.0, the version that produced the pinned checksum:

```python
from PIL import Image, ImageSequence

frame = next(iter(ImageSequence.Iterator(Image.open("source.gif")))).convert("RGB")
frame.info = {}
frame = frame.resize((164, 314), Image.LANCZOS)
frame.info = {}
frame.quantize(colors=256, method=Image.MEDIANCUT, dither=Image.NONE) \
    .convert("RGB") \
    .save("src-tauri/installer/sidebar.bmp", format="BMP")
```

LANCZOS resampling and quantization shift bytes across Pillow releases, so a
regenerated BMP will not match the pinned checksum even when it looks
identical. Update the checksum in `tests/release/installer-art.test.ts` in the
same commit.

Current checksum:

```
sidebar.bmp  f49e79abe7bafedb7a253635c9889dfd0a1a29d389c330ea47f354638c67cd3e  154,542 bytes
```

## Verifying the art

`tests/release/installer-art.test.ts` parses the BMP header rather than
trusting its extension: signature, header size, dimensions, plane count, bit
depth, compression, and that the declared file size and pixel data extent agree
with the bytes on disk. It pins the checksum, checks that
`tauri.conf.json` still points at a file that exists, and asserts that no hook,
no GIF and no `plugins` directory comes back. The last of those lists the
directory instead of naming expected absences, so a vendored binary cannot be
added without a recorded decision.

Compiling the installer needs Windows or Wine and makensis.
`build-installers.yml` does that on `windows-latest` for every pull request,
against NSIS 3.11, the version Tauri CLI 2.10.0 downloads. When the Tauri CLI
is upgraded, compare the new
`crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi` with the lines
cited above. A change to the `SIDEBARIMAGE` define or to the welcome page
declaration is what can break this.
