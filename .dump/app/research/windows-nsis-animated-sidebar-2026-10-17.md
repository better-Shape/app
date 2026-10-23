# Animated Windows installer sidebar

Facts, decisions and measurements behind `src-tauri/installer/`. Written for the
next person who has to touch the Windows installer. Asset checksums and the
regeneration recipe live in `src-tauri/installer/README.md` and are not repeated
here. The review of the change that introduced this is
`.dump/app/audits/windows-nsis-animated-sidebar-2026-10-17.md`.

## Conclusions

- MUI cannot animate. `MUI_WELCOMEFINISHPAGE_BITMAP` takes a BMP, loads it into
  an `SS_BITMAP` static at page creation, and has no frame loop. Animating needs
  a plug-in driven from the page callbacks.
- The supported way in is `bundle.windows.nsis.installerHooks`. Tauri includes it
  at `installer.nsi` line 29, after `MUI2.nsh` and before the welcome page, so a
  hook can define `MUI_PAGE_CUSTOMFUNCTION_SHOW` and `LEAVE` and the welcome page
  consumes and undefines both.
- MUI's bitmap has to be detached from the static before playback, for two
  independent reasons: the static's window procedure repaints it after every
  frame the plug-in paints, and MUI deletes it with `${NSD_FreeImage}` when the
  page closes, which would leave the control holding a freed handle.
- Every path inside a hook must be anchored to `${__FILEDIR__}` captured in a
  top-level `!define`. Tauri runs makensis with the working directory set to the
  generated-script folder, and it expands hook macros at the insertion point.
- A page callback is an ordinary function call from MUI's page function. NSIS has
  no callee-save convention, so the callback must push and pop every register it
  touches.

## Versions this was verified against

| Component | Version | Where it is pinned |
| --- | --- | --- |
| `@tauri-apps/cli` | 2.10.0 | `package.json`; its bundled `installer.nsi` is what CI compiles |
| `tauri` crate | 2.11.1 | `src-tauri/Cargo.toml` |
| NSIS toolset Tauri downloads | 3.11 | `crates/tauri-bundler/src/bundle/windows/nsis/mod.rs`, `NSIS_TOOLSET_URL` |
| AnimGif source | `nsis-community/plugin-animgif` at `e3b6084f69981eaf999931f925b0a1cf5a0d78af` | recorded in `AnimGif.LICENSE.txt` |
| AnimGif binary | `nsis-dev/plugin-corpus`, `tree/Plugins/x86-unicode/animgif.dll` | sha256 pinned in `tests/release/installer-art.test.ts` |

The CLI and the crate are not in lockstep. The template that ships in the
installed CLI binary is the one that gets compiled, so check the CLI version, not
the crate version, when reasoning about `installer.nsi`.

## Verified platform facts

Each line was read in source, not inferred. Line numbers are from the versions
above.

1. `crates/tauri-bundler/src/bundle/windows/nsis/mod.rs:346-359` canonicalizes
   `header_image`, `sidebar_image` and `installer_hooks` with `dunce`, so the
   hook sees an absolute `${__FILEDIR__}`. A path that does not exist fails
   `canonicalize`, which fails the bundle before makensis runs.
2. `mod.rs:660` runs makensis with `current_dir(output_path)`, the
   `target/.../nsis/<arch>` folder. Combined with NSIS bug 1264, where
   `!addplugindir` resolves a relative directory against the working directory at
   call time and silently skips one it cannot find, a relative plug-in directory
   in a hook points inside `target/` and produces a runtime `Plugin not found`.
3. The template's own `!addplugindir "${ADDITIONALPLUGINSPATH}"` is at line 89,
   after the hook include. Both directories are searched and there is no name
   collision, because that directory holds Tauri's stock plug-ins.
4. `Contrib/Modern UI 2/Pages/Welcome.nsh` in NSIS 3.11: `nsDialogs::Create 1044`
   at 125, `${NSD_CreateBitmap} 0u 0u 109u 193u` at 131,
   `MUI_INTERNAL_FULLWINDOW_LOADWIZARDIMAGE` at 133, `muiPageLoadFullWindow`,
   `MUI_PAGE_FUNCTION_CUSTOM SHOW` at 162, `nsDialogs::Show` at 163,
   `${NSD_FreeImage}` at 168, `MUI_PAGE_FUNCTION_CUSTOM LEAVE` at 177. The
   bitmap is therefore already on the control when SHOW runs, and the installer
   window is still hidden, because the main dialog is shown only after
   `nsDialogs::Show` reports ready.
5. `Contrib/nsDialogs/nsDialogs.nsh` in 3.11: `__NSD_Bitmap_STYLE` is
   `DEFAULT_STYLES|SS_BITMAP|SS_NOTIFY` at 270, `${NSD_SetStretchedImage}` is
   `LoadAndSetImage /STRINGID /RESIZETOFIT ... IMAGE_BITMAP` at 1004,
   `${NSD_FreeImage}` is `System::Call gdi32::DeleteObject` at 1010, and
   `${NSD_ClearImage}` is `SendMessage STM_SETIMAGE IMAGE_BITMAP 0` at 1023. The
   idiomatic clear and the raw message are the same instruction.
6. `Source/script.cpp` `TOK_FINDWINDOW` at 3345: the positional order is
   `out class text hwndparent hwndafter`. `Source/exehead/exec.c` `EW_FINDWINDOW`
   at 838 passes `buf0[0]?buf0:NULL`, so an empty class or title matches
   anything and the child enumeration idiom works.
7. `Source/exehead/Ui.c` destroys `m_curwnd` before it creates the next page
   dialog, and nsDialogs pages arrive through `WM_NOTIFY_CUSTOM_READY`. One page
   dialog exists at a time, so the first `#32770` child of `$HWNDPARENT` during a
   page callback is that page. AnimGif performs the same lookup when called
   without `/HWND`.
8. `Source/build.cpp:272` sets `build_plugin_unload=0` and `Source/script.cpp:5178`
   stores `nounload|build_plugin_unload`, so NSIS 3 does not unload a plug-in
   after each call. `/NOUNLOAD` is parsed as the first token only
   (`script.cpp:5151-5171`, warning 6080 when misplaced) and is not passed
   through to the plug-in as a parameter.
9. ReactOS `win32ss/user/user32/controls/static.c`, `STATIC_SetBitmap`, guards the
   control resize with `if (hBitmap && ...)`, so clearing with a NULL bitmap does
   not collapse the control and `GetClientRect` still returns the real slot for
   `/FIT=BOTH`. `STATIC_GetImage` returns NULL unless `wParam == IMAGE_BITMAP`
   (0) on an `SS_BITMAP` control, and NULL for every text static, which is what
   makes the child walk selective.
10. `Contrib/AnimGif/animgif.cpp` and `winimage.cpp`: `play` calls `stop` first,
    so a second play cannot double-subscribe; `/FIT` accepts `WIDTH`, `HEIGHT` or
    `BOTH` case-insensitively; `/HALIGN` and `/VALIGN` are percentages parsed with
    `_tcstoul` base 0 and default to 50 and 100; `/HWND` is parsed the same way
    from the decimal string NSIS prints; frames run on a `CreateThread` loop with
    `Sleep(Delay>50?Delay:100)` where `Delay` is the GIF centisecond value times
    10, and `nLoops` 0 loops forever; the subclassed `WM_PAINT` paints a frame and
    then chains to the original static procedure; `LoadGIF` opens with
    `FILE_SHARE_READ` and closes the handle on the success path, so re-extracting
    over the same `$PLUGINSDIR` name works; `DllMain` stops on
    `DLL_PROCESS_DETACH` and `stop` checks `IsWindow` and the stored procedure
    before restoring; bits per pixel come from the local colour table when a frame
    has one.
11. The Tauri template declares `MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive`
    immediately before `MUI_PAGE_WELCOME`, and `SkipIfPassive` aborts when
    `$PassiveMode = 1`. In passive mode SHOW never runs, and silent mode has no
    UI, so neither leaves an animation running.
12. The uninstaller pages later in the same template define their own
    `MUI_PAGE_CUSTOMFUNCTION_SHOW` and `LEAVE` (`un.ConfirmShow`,
    `un.ConfirmLeave`). Because MUI undefines the hook's symbols when it inserts
    the welcome page, the two sets cannot collide.

## The vendored binary is the Unicode build

`AnimGif.dll` was inspected through its PE headers rather than trusted from its
folder name. Machine `0x14c` (x86 32-bit, which is what NSIS's installer stub is
on every Windows target, including `aarch64-pc-windows-msvc`), subsystem 2 (GUI),
exports exactly `play` and `stop`, and every string-handling import is the wide
variant: `CreateFileW`, `lstrcmpiW`, `lstrcpyW`, `PostMessageW`, `CallWindowProcW`,
`FindWindowExW`, `GetWindowLongW`, `SetWindowLongW`, plus `wcstoul` and `wcschr`
from MSVCRT. That matches `animgif.cpp` compiled with `UNICODE` and `_UNICODE`,
which `nsis-dev/release-package` defines for `-unicode` targets, and which the
plug-in author announced when the Unicode build was added. An ANSI build in
`x86-unicode` would marshal stack strings wrongly, so this check is the one that
proves the directory name is not a lie. `TerminateThread` and `FindWindowExW` in
the import table also confirm the two behaviours the hook relies on: `stop`
terminates the frame thread, and the plug-in's own default target lookup is the
same `#32770` search the hook performs.

## Asset constraints and why these numbers

- 164x314 is the MUI slot: `0u 0u 109u 193u` in dialog units at 96 DPI.
- AnimGif clamps a frame delay below 50 ms to 100 ms. The 300-frame source uses 30
  and 40 ms frames, so playing it unchanged would take 30 s and stutter. It is
  resampled to 100 frames of 100 ms, a 10 s cycle.
- Every frame descriptor must be full canvas at offset 0,0. AnimGif blits each
  frame at its own descriptor offset into a memory DC the size of the logical
  screen, so a partial frame leaves the previous frame showing underneath.
- No transparency index and disposal method 1. Transparency would make AnimGif
  sample the target window for a background colour, and the window is hidden when
  SHOW runs, so it would fall back to `COLOR_BTNFACE`.
- `.github/workflows/pr.yml` fails the build on any committed file above 5 MB.

## Rejected approaches

- Fork `bundle.windows.nsis.template`. It vendors the whole installer script and
  needs re-diffing on every upgrade. `tauri-apps/tauri#15983` records that
  `installer.nsi` changed meaningfully several times across 2.x, covering NSIS 3.8
  to 3.11, plug-in signing, `!addplugindir`, DPI and RTL, and that drift is
  silent: a stale fork keeps building and stops receiving fixes.
- Animate on every page. The user chose welcome only. The finish page shares
  `MUI_WELCOMEFINISHPAGE_BITMAP` with the welcome page and keeps the static BMP.
- Use `$mui.WelcomePage.Image` instead of walking children. MUI declares that
  variable inside `MUI_WELCOMEPAGE_INTERFACE`, which expands when the welcome page
  is inserted, after the hook include at line 29. Referencing it from the hook does
  not compile. Declaring the variables in the hook and pre-defining
  `MUI_WELCOMEPAGE_INTERFACE` would work but would couple the hook to MUI's exact
  variable list across versions.
- `newadvsplash`, `EBanner` or `Animate`. The first owns a modal window of its own,
  the other two need an AVI. None can paint into MUI's existing sidebar control.
- Relative `!addplugindir`. See fact 2.
- Guard the GIF extraction with `IfFileExists`. It saves a 3.9 MB write on Back
  navigation but would skip re-extraction after an interrupted one, leaving a
  truncated GIF that `LoadGIF` rejects.
- Restore MUI's bitmap on leave. MUI deletes it as soon as the page closes and NSIS
  destroys the dialog, so there is nothing to restore into.
- Call `AnimGif::stop` at the start of SHOW, which some community scripts do for
  Back navigation. `play` already calls `stop` first.

## Open risks

- No Windows and no Wine in the sandbox, so playback is a source trace plus a
  successful compile, not a runtime observation. `build-installers.yml` compiles
  the installer on every pull request and is the first real check; a human install
  is the only proof of motion.
- AnimGif stops its thread with `TerminateThread`. That is upstream design and this
  change does not alter it, but it is the one part of the plug-in that can misbehave
  under load.
- The installer is not Authenticode signed today. `release.yml` uses the Tauri
  updater key only. If signing is added, `AnimGif.dll` will not be covered, because
  Tauri signs the stock plug-ins it copies into its own additional plug-ins
  directory. See `tauri-apps/tauri#16208` and `#11673`.
- NSIS has no ARM64 build, so the `x86-unicode` plug-in is also what the
  `aarch64-pc-windows-msvc` job in `build-installers.yml` packs. That is correct,
  not an oversight.
