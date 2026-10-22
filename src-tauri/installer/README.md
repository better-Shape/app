# Windows installer art

The Windows NSIS installer shows an animated BetterShape sidebar on the
welcome page. Everything in this folder is a build input for
`src-tauri/tauri.conf.json`, which points `bundle.windows.nsis` at
`installer/sidebar.bmp` and `installer/hooks.nsh`.

| Path | Role |
| --- | --- |
| `sidebar.gif` | 164x314, 100 frames, 100 ms per frame, 10 s cycle, loops forever, 3.9 MB |
| `sidebar.bmp` | Frame zero of `sidebar.gif` as a 24-bit BMP, 151 KB |
| `hooks.nsh` | NSIS hook that paints the GIF over the welcome-page image control |
| `plugins/x86-unicode/AnimGif.dll` | AnimGif plug-in, 8.7 KB, provenance in `AnimGif.LICENSE.txt` |

`sidebar.bmp` is what MUI renders as the page is built, and it is also what
the finish page shows. To animate, the hook clears the image from the static
before playback. Two things require that. The static's own window procedure
paints its stored bitmap after the plug-in's subclass paints a frame, which
would cover the animation, and MUI deletes that bitmap with `${NSD_FreeImage}`
once the page closes, which would otherwise leave the control holding a freed
handle. Clearing it also means the plug-in must load for the welcome-page
sidebar to show anything, so the hook leaves the finish page untouched.

## Why a plug-in

MUI's `MUI_WELCOMEFINISHPAGE_BITMAP` accepts a BMP only. It loads the file
into an `SS_BITMAP` static at page creation and MUI has no frame loop, so an
animated GIF cannot be passed to it. `hooks.nsh` lets MUI build the page as
usual, then finds that static and hands its window handle to AnimGif, which
paints the GIF into the control's client area and stops on page leave. The
callbacks are declared once and only the welcome page consumes them, so the
finish page keeps the static bitmap.

Forking `bundle.windows.nsis.template` was rejected. It would vendor the whole
installer script and need re-diffing on every Tauri upgrade, and Tauri's own
issue tracker records that `installer.nsi` has changed meaningfully several
times across 2.x. The hook is the supported extension point and it does not
copy any template text.

The hook is included by Tauri at `installer.nsi` line 29, after `MUI2.nsh`
and before the welcome page is declared, so its
`MUI_PAGE_CUSTOMFUNCTION_SHOW` define is picked up by that page and
unset immediately afterwards. The uninstaller pages later in the same template
define their own callbacks and are unaffected.

## Paths inside the hook

Both asset paths are built from `${__FILEDIR__}`, and the GIF path is captured
in a top-level `!define` rather than written inline. Tauri expands hook macros
at the point where it inserts them into the generated script, so
`${__FILEDIR__}` inside a macro body would resolve to the generated script's
directory under `target/` instead of this folder. A bare relative
`!addplugindir` is worse than useless: makensis resolves plugin directories
against the current directory when the plug-in is called, and it silently skips
the copy when the directory is missing, which surfaces at runtime as a
`Plugin not found` failure. Tauri canonicalizes `installerHooks` with `dunce`
before it writes the include line, so `${__FILEDIR__}` is absolute here.

## Runtime behaviour

- The welcome page callback runs before `nsDialogs::Show`, so the installer
  window is still hidden and clearing the bitmap cannot flash.
- NSIS destroys the previous page dialog before it creates the next one, so
  the `#32770` dialog the hook finds is the welcome page. AnimGif performs the
  same lookup when it is called without `/HWND`.
- `AnimGif::play` calls its own `stop` first, so returning to the welcome page
  with Back cannot subscribe the control twice. Back and Cancel do not run the
  leave callback, and the plug-in handles that: its `stop` checks its own state
  and the window handle, and `DllMain` stops the animation when the installer
  unloads it.
- In passive mode the template's `SkipIfPassive` aborts the welcome page before
  the show callback, and silent mode has no UI, so neither leaves an animation
  running.
- `InitPluginsDir` runs before the extraction. `$PLUGINSDIR` is empty until
  something creates it, and `File /oname=$PLUGINSDIR\...` against an empty
  variable would land in `$OUTDIR` instead. MUI stages its own sidebar with the
  same pair, `InitPluginsDir` then `File /oname=$PLUGINSDIR\modern-wizard.bmp`
  (`Contrib/Modern UI 2/Pages/Welcome.nsh:44-45`). The call costs one
  comparison and a return once the directory exists, and it saves `$0` and `$1`
  when it does have to create it (`Source/build.cpp:3805-3842`), so MUI's page
  function is unaffected either way. Keeping it here means the hook does not
  depend on `nsDialogs::Create` happening to run first.
- The GIF is extracted to `$PLUGINSDIR` each time the show callback runs. That
  is a 3.9 MB write on Back navigation, which is cheaper than a guard that
  could skip a re-extract after an interrupted one.
- An `IfFileExists` guard follows the extraction. A `File` that cannot create
  its target offers abort, retry and ignore, and ignore continues the install
  without the file (`Source/exehead/exec.c:562-573`, with ignore as the default
  button per `Source/script.cpp:5445-5449`). The guard takes that exit and
  leaves MUI's static bitmap attached instead of clearing it for an animation
  that cannot start.
- Registers `$R0` to `$R3` are pushed and popped. These callbacks run inside
  MUI's own page function, and nsDialogs macros use the same register block.

## Residual risks

Three failure modes stay open. The hook reaches all three, because it runs
`File`, `AnimGif::play` and `AnimGif::stop` itself. It cannot recover from any
of them, because the behaviour lives in the vendored plug-in or in NSIS. A
maintainer debugging an installer failure should read these as outcomes this
hook can produce and cannot catch.

- `AnimGif::stop` ends the animation worker with `TerminateThread`
  (plugin-animgif `winimage.cpp:236-240`) rather than a cooperative join, which
  is the pattern Microsoft documents as unsafe. Calling it is still the only
  correct option here: the shipped GIF loops forever, its loop count is 0, so
  the worker condition is literally "while true" (`winimage.cpp:130`), and
  skipping the call would leave that thread painting into a destroyed window
  for the rest of the process. Fixing the termination itself means forking and
  rebuilding the plug-in, which trades a hash-pinned vendored binary for a
  build obligation. That trade belongs to a maintainer, and it is recorded here
  rather than made silently in the hook.
- A GIF that reaches the plug-in but fails to decode leaves the sidebar blank.
  `play` returns without pushing a result when `LoadGIF` yields no frames
  (`animgif.cpp:203-204`), and its `ERRORMSG` is compiled out
  (`winimage.cpp:40`), so the hook cannot detect that failure and restore the
  bitmap it already cleared. The `IfFileExists` guard covers the case that can
  happen in the field, a skipped extraction. A corrupt asset in the repository
  is covered by the test suite, which parses every frame.
- Extracting 3.9 MB raises the free space the installer needs on the volume
  behind `$TEMP` by that much. A `File` that opens its target and then fails to
  write is fatal for every `File` instruction in NSIS
  (`Source/exehead/exec.c:596-605`), and no hook can intercept that message
  box. The Tauri CLI 2.10.0 template already puts the WebView2 bootstrapper on
  that volume, by download at `installer.nsi:541` in the default
  `downloadBootstrapper` mode or by `File` at `installer.nsi:555` in
  `embedBootstrapper` mode, so an install that cannot spare 3.9 MB is close to
  the point where it cannot finish anyway.

## Frame and file limits

- The image slot is 164x314 at 96 DPI. AnimGif stretches with `/FIT=BOTH`,
  so other DPI settings scale the same asset.
- AnimGif clamps any frame delay under 50 ms to 100 ms. The 300-frame source
  uses 30 and 40 ms frames and would run for 30 s instead of 10 s, so it is
  resampled to 10 fps, where each output frame sums exactly 100 ms.
- Every frame must cover the full canvas. AnimGif blits each frame at its own
  descriptor offset into a memory DC the size of the logical screen, so a
  partial frame leaves the previous one visible underneath.
- `.github/workflows/pr.yml` fails on any committed file above 5 MB, and the
  installer is compressed as one LZMA block, so the GIF is kept just under
  4 MB. Lossless compression cannot shrink it further because the gradient
  changes across the full frame.

## Code signing

`release.yml` signs the installer payload with the Tauri updater key and does
not apply Authenticode signing. If Authenticode signing is added later,
`AnimGif.dll` will not be covered by it: Tauri signs the stock plug-ins it
copies into its own additional plug-ins directory, and this DLL is added by
`!addplugindir` from this folder. An unsigned DLL inside a signed installer is
what antivirus heuristics flag, so that change would need to sign this file too.

## Regenerating the assets

The source GIF is not on this branch, it is 5.4 MB. It lives on
`bettershape-init` at commit `4b8eaac6` as `bettershape assets/BetterShape (1).gif`.
Pull it with:

```bash
git show 4b8eaac6:'bettershape assets/BetterShape (1).gif' > source.gif
```

Run both steps from the repository root and delete `source.gif` afterwards. At
5.4 MB it is above the committed-file limit in `.github/workflows/pr.yml`.

Then, with Python and Pillow 13.0.0 (the version that produced the pinned
checksums; LANCZOS resampling and quantization can shift bytes across
releases):

```python
from PIL import Image, ImageSequence
import io

frames, durations = [], []
for frame in ImageSequence.Iterator(Image.open("source.gif")):
    rgb = frame.convert("RGB"); rgb.info = {}
    frames.append(rgb); durations.append(frame.info.get("duration", 30))

step, size = 3, (164, 314)
palette, delays = [], []
for i in range(0, len(frames), step):
    image = frames[i].resize(size, Image.LANCZOS); image.info = {}
    palette.append(image.quantize(colors=256, method=Image.MEDIANCUT, dither=Image.NONE))
    delays.append(sum(durations[i:i + step]))

out = io.BytesIO()
palette[0].save(out, format="GIF", save_all=True, append_images=palette[1:],
                duration=delays, loop=0, optimize=False, disposal=1,
                interlace=False)
open("src-tauri/installer/sidebar.gif", "wb").write(out.getvalue())

Image.open("src-tauri/installer/sidebar.gif").seek(0)
Image.open("src-tauri/installer/sidebar.gif").convert("RGB").save(
    "src-tauri/installer/sidebar.bmp", format="BMP")
```

Generate the BMP from the written GIF, not from the source frame, so the
finish-page image matches the first animated frame pixel for pixel.

Current checksums:

```
sidebar.gif  19994d877cb2356c0d2d8e6faa87446ab2b19baf7af767b2f0147666ada5640a  3,933,635 bytes
sidebar.bmp  f49e79abe7bafedb7a253635c9889dfd0a1a29d389c330ea47f354638c67cd3e    154,542 bytes
AnimGif.dll  a1fa2e0191f986824f5fc0ef62aee8b4b25695cc56d4b00fecdc1c92f8ea237f      8,704 bytes
```

## Verifying the hook

`tests/release/installer-art.test.ts` checks the asset dimensions, the GIF
frame count, delay and per-frame geometry, the BMP dimensions and bit depth,
the plug-in hash, and that `tauri.conf.json` still points at all of it. Every
read the GIF parser makes is bounds-checked, and one test feeds it a truncated
stream to prove that a malformed asset fails with a message instead of walking
off the end of the buffer and taking the worker with it.

For the hook it checks structure rather than literal lines. It reads the file
the way makensis does, with comments stripped and the hook's own `!define`
values expanded, so a commented out instruction cannot satisfy an assertion and
the paths under test are the ones the installer really uses. On top of that it
checks that both callback slots resolve through their defines to functions the
file defines, that the two targets differ, that `play` sits in the callback the
SHOW slot names and `stop` in the one the LEAVE slot names, that the register
AnimGif targets is the one `FindWindow` writes and the one `NSD_ClearImage`
detaches, that the pushes and pops balance, that no exit instruction can bypass
the pops and no branch reaches a label outside the function, that
`InitPluginsDir` precedes the first use of `$PLUGINSDIR`, that the
`IfFileExists` guard tests the path `File` wrote and bails to the label the
pops follow, and that both asset paths are anchored to `${__FILEDIR__}`.

Compiling the installer needs Windows or Wine and makensis. `build-installers.yml`
does that on `windows-latest` for every pull request, against NSIS 3.11, the
version Tauri CLI 2.10.0 downloads. Actions was disabled in this repository
while this hook was written, so the compile evidence in `.dump/app/audits/` is
a local makensis build of the generated script. It has been re-enabled, and
from here the pull request check runs are the authority. When the Tauri CLI is upgraded, compare the new
`crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi` with the version
this hook targets. A change to the `installer_hooks` include point, to the
welcome page declaration, or to the welcome page image control is what can
break it.
