# Windows installer will not open, and the removal of the animated sidebar

Written for the next person who has to decide anything about distributing
BetterShape on Windows. Two things are recorded here: what stops an unsigned
Windows build from running, and why the animated installer sidebar was removed.
The plug-in and hook facts behind the animation stay in
`.dump/app/research/windows-nsis-animated-sidebar-2026-10-17.md`, which is not
repeated here.

## Conclusions

- A green `build-installers.yml` Windows job proves a bundle was produced and
  collected. It proves nothing about whether a user can run it. No Windows
  artifact from this repository has ever been confirmed to install on a real
  machine.
- Nothing in this repository signs the Windows installer. `tauri.conf.json` sets
  neither `bundle.windows.certificateThumbprint` nor `bundle.windows.signCommand`,
  and `WindowsSettings::can_sign` is exactly
  `sign_command.is_some() || certificate_thumbprint.is_some()`. When it is false
  the bundler skips `try_sign` on the NSIS output and logs a warning.
- Every CI build produces a new file hash and Windows keys reputation on the
  hash, so no build inherits reputation from the one before it. There is no
  amount of rebuild that accumulates trust.
- "Double-click does nothing, no dialog at all" cannot originate in an NSIS
  hook. Tauri includes the hook at `installer.nsi:28-29` and the earliest
  runtime effect a hook can have on the welcome page is
  `MUI_PAGE_CUSTOMFUNCTION_SHOW`, consumed by `!insertmacro MUI_PAGE_WELCOME`
  at `installer.nsi:146`. That callback runs after `nsDialogs::Create` and
  `MUI_INTERNAL_FULLWINDOW_LOADWIZARDIMAGE` have built the page. A hook failure
  therefore produces a visible wizard with a broken sidebar, never silence.
- The symptom is consistent with Windows refusing to start the process. Three
  mechanisms do that and they are distinguishable only from the machine, which
  is why the diagnostic below exists.
- Removing the animated sidebar is a product decision, not a fix for the above.
  It removes one unsigned third-party binary and one pattern antivirus
  heuristics are documented to flag, so it plausibly lowers heuristic risk. It
  does not sign the installer and it cannot change a Smart App Control decision
  about the outer executable.

## The diagnostic that was never run

The maintainer declined to run it, so the cause stays unconfirmed. This is the
smallest thing that would settle it, and it should be run before anyone writes
another line of installer code.

```powershell
$path = "C:\full\path\to\BetterShape_1.0.3_x64-setup.exe"
Get-Item $path | Select-Object Length
Get-Item $path -Stream * -ErrorAction SilentlyContinue | Select-Object Stream, Length
Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-CodeIntegrity/Operational'; Id = 3033, 3076, 3077 } -MaxEvents 20 -ErrorAction SilentlyContinue
Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Id = 1000 } -MaxEvents 10 -ErrorAction SilentlyContinue
```

- CodeIntegrity `3077` naming the installer is an enforced block. `3076` is the
  same decision in audit or evaluation mode, logged but not enforced. `3033`
  accompanies both.
- Application `1000` naming `setup.exe` means the installer started and then
  crashed, which is a different bug and the only outcome that is this
  repository's fault.
- No `Zone.Identifier` stream means the file is not marked as downloaded, which
  rules SmartScreen out.
- A `Length` below what the build published means a truncated download.

Smart App Control state is on the Settings page: **Windows Security**, **App &
browser control**, **Smart App Control settings**. Do not read it from
`HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy\VerifiedAndReputablePolicyState`
in advice given to users. Microsoft's own documented mapping is `0` off, `1`
enforce, `2` evaluation, and third-party write-ups publish the opposite
mapping for `1` and `2`. Never write that value.

## Verified platform facts

Smart App Control:

- It blocks execution of unsigned files unless the file has a positive
  reputation, and its signature checks apply to all executable files, not only
  Internet downloads. https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- There is no per-app bypass. Microsoft External Staff, moderated: "Smart App
  Control does not support bypassing protection for a single app or script."
  https://learn.microsoft.com/en-us/answers/questions/5913253 and
  https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions
- A silent block is the reported behaviour, not a corner case: "Launching from
  the Start menu, desktop shortcut or directly does nothing, no window, no
  error dialog. Microsoft-Windows-CodeIntegrity/Operational logs events 3033
  and 3077 on every attempt." https://github.com/logseq/og/issues/55
- Every component that can be loaded has to be signed, including installers,
  files an installer drops, and uninstallers.
  https://learn.microsoft.com/en-us/answers/questions/5791210 and
  https://learn.microsoft.com/en-us/answers/questions/6039110
- Reversibility of the toggle changed. Before KB5083769 (14 April 2026) turning
  SAC off was permanent without a reset or reinstall. After it, on and off are
  both available from the Settings page. The October 2026 update greyed the
  toggle out again for some machines, with a documented two-value
  `FeatureManagement\Overrides` workaround.
  https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation,
  https://www.computerworld.com/article/4043925/windows-11-smart-app-control-explained.html,
  https://www.windowsdigitals.com/smart-app-control-grayed-out-kb5127648/
- Store-distributed apps bypass SAC because Microsoft re-signs them.
  https://learn.microsoft.com/en-us/answers/questions/5791210

SmartScreen and antivirus:

- Two reputation levels exist, file hash and certificate, and an EV certificate
  stopped granting instant reputation in 2024.
  https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- NSIS installers are a documented false-positive class. AV vendors sign the
  NSIS stub itself, and the recommended responses are report the false
  positive, sign the installer, or patch NSIS.
  https://nsis.sourceforge.io/NSIS_False_Positives
- "There are no code changes you can make to remove the warnings. NSIS produces
  an application that extracts compressed files and executes interpreted code
  on the fly." https://stackoverflow.com/questions/48833995
- The real malware pattern AV heuristics target is an NSIS package that drops a
  DLL to temp and `LoadLibrary`s it, which is structurally what any NSIS
  plug-in does. https://www.mcafee.com/blogs/other-blogs/mcafee-labs/malware-hides-in-installer-to-avoid-detection/
- Mark-of-the-Web propagates from an archive to everything extracted from it,
  so unblocking the archive before extracting is what keeps SmartScreen quiet
  for the extracted files. https://github.com/chrplr/note-about-windows-unsigned-apps

Tauri signing behaviour:

- `bundle.windows.signCommand` takes `%1` as the file path.
  `certificateThumbprint`, `digestAlgorithm` and `timestampUrl` are the
  signtool route. https://v2.tauri.app/distribute/sign/windows/
- Even with signing configured, stock NSIS plug-ins ship unsigned, because
  makensis does not read `NSISPLUGINS` for the copies Tauri signs. Only
  `nsis_tauri_utils.dll`, added through `!addplugindir`, gets signed.
  https://github.com/tauri-apps/tauri/issues/16208, independently confirmed by a
  shipped pipeline at https://github.com/CasaVargas/DebridDownloader/pull/31

## Ruled out

The silent-crash class is real and worth knowing, and it does not apply here.

electron-builder's `multiUser.nsh` reads `SHGetKnownFolderPath` output with an
unconditional `&w${NSIS_MAX_STRLEN}` dereference, a roughly 2 KB heap over-read
that faults in `System.dll` at offset `0x1581` with no wizard window and no
dialog. Fixed upstream in electron-builder#9769 and 26.12.0 by switching to
`lstrcpynW`. https://github.com/logseq/logseq/issues/13524,
https://github.com/electron-userland/electron-builder/issues/7921,
https://github.com/electron-userland/electron-builder/issues/8536

It does not apply for two independent reasons. `grep -rn` for
`SHGetKnownFolderPath`, `System::Store`, `&w` and `NSIS_MAX_STRLEN` across Tauri
CLI 2.10.0's `nsis/` directory returns only bounded `System::Call` struct
patterns, and Tauri pins NSIS 3.11
(`NSIS_SHA1 = EF7FF767E5CBD9EDD22ADD3A32C9B8F4500BB10D`), not the 2018-era
build those crashes were traced to.

## Signing options, eligibility verified for this project

- Azure Artifact Signing. Basic is $9.99/month for 5,000 signatures. Public
  Trust for individuals is limited to the United States and Canada.
  Organizations need one of 12 listed regions and 3+ years of verifiable tax
  history. Not available to this maintainer.
  https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart
- Certum Open Source code signing. From EUR 49/year, individuals, no country
  restriction, publisher reads "Open Source Developer, name", commercial use
  forbidden. SimplySign wants a phone app per signing session, which makes
  headless CI signing awkward. The realistic paid route.
  https://my-ssl.com/learn/open-source-code-signing-certificate
- SignPath Foundation. Free for qualifying open source, but the project must
  already be released in the form to be signed and must show verifiable
  reputation, with per-release manual approval and a published code-signing
  policy. Blocked today: this repository has zero published releases, and
  rejections for insufficient external traction are on record.
  https://signpath.org/terms.html, https://github.com/Arsarneq/docent/issues/72
- Microsoft Store MSIX. Free individual developer registration since 10
  September 2025 in roughly 200 markets, Microsoft re-signs the package, and
  Store apps bypass Smart App Control. The only route that is free, available
  from this maintainer's region, and actually defeats the block. It needs MSIX
  packaging, which Tauri does not emit. A Store MSI or EXE submission, by
  contrast, must already be Authenticode-signed by the publisher.
  https://blogs.windows.com/windowsdeveloper/2025-09-10/free-developer-registration-for-individual-developers-on-microsoft-store/,
  https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- Self-signed. Worthless for public distribution.

## Rejected approaches

- Sign the vendored AnimGif DLL. Rejected on two independent grounds. No
  certificate is obtainable by this maintainer, and `tauri-apps/tauri#16208`
  shows a configured `signCommand` does not reach plug-ins that makensis
  resolves outside Tauri's own directory. The DLL is now gone, which makes the
  question moot, but the reasoning is recorded so it is not re-litigated if
  animation returns.
- Remove the animation to fix "the installer will not open". This was the
  previous agent's conclusion and it does not follow. Windows evaluates the
  file it is asked to execute. Deleting one unsigned 8,704-byte DLL from inside
  an unsigned installer leaves the setup executable, the application
  executable, the uninstaller and every stock NSIS plug-in unsigned. The
  removal happened anyway, for the reasons in the next section, not because it
  fixes the block.
- `Sleep` before `AnimGif::stop` to narrow the `TerminateThread` race.
  Probability-neutral, so it buys a 100 ms delay on page leave and nothing
  else. The worker calls
  `Sleep(curImg->Delay > 50 ? curImg->Delay : 100)` at `winimage.cpp:161` and
  spends microseconds per cycle in `SetDIBitsToDevice`, `CreateRectRgn` and
  `InvalidateRgn`, so it is already asleep for essentially the whole cycle. The
  instant `TerminateThread` fires is uncorrelated with that phase, and shifting
  the sample point does not narrow the window.
- A documentation-only fix. Writing the block into user-facing install docs
  asserts an unconfirmed cause as fact, advises users to consider disabling a
  security feature, and fixes nothing. Rejected by the maintainer and reverted.
- Forking `bundle.windows.nsis.template`. Vendors the whole installer script
  and needs re-diffing on every Tauri upgrade.

## Why the animation was removed

The maintainer's decision, 24 October 2026: "make it come without gif sidebar
make it to just be an image like every other normal installer".

It is defensible on its own merits, independently of the reported symptom. The
animation cost a 3.9 MB committed asset and a 3.9 MB extraction into
`$PLUGINSDIR` on every visit to the welcome page, carried an unsigned 2010
third-party binary into the installer, and could not be made safe without
forking that binary. Its two worst properties, both verified in source:

- `C_AnimationWindow::Stop` ends the worker with `TerminateThread`
  (`winimage.cpp:236-240`), the pattern Microsoft documents as unsafe, and it
  then calls `DeleteDC` and `DeleteObject` on resources the killed thread may
  still be inside.
- Its header check is `memcmp(szSignature, "GIF", 2)` at `winimage.cpp:301`,
  two bytes, under a comment on line 299 claiming it checks "GIF87a or
  GIF89a". A payload that passes it but decodes to no frames makes `play`
  return at `animgif.cpp:203-204` without painting and without pushing a
  result, because `ERRORMSG` is compiled out at `winimage.cpp:40`. Since the
  hook had already run `${NSD_ClearImage}`, the visible outcome was a blank
  sidebar with nothing to explain it.

The loop count offered a real fix for the first property and was not taken,
because it needs the assets regenerated and changes a recorded design decision.
For the record: `Stop` only calls `TerminateThread` when `bAnimationPlaying` is
true, and `fnThread` sets it false when its own loop ends
(`winimage.cpp:130`). A finite loop count therefore makes `Stop` a no-op once
the animation has finished by itself, eliminating the unsafe termination for
any user who stays on the welcome page that long. It costs a bounded GDI leak,
because `Stop` also skips its `DeleteDC` and `DeleteObject` calls on that path.

## Versions and artifacts this was verified against

- Tauri CLI 2.10.0, `crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi`
  and `mod.rs`, and `crates/tauri-bundler/src/bundle/settings.rs`.
- NSIS 3.11, the version Tauri CLI 2.10.0 downloads.
- plugin-animgif at `e3b6084f`.
- Actions run `39965520148`, push to `mega/absorb-all`, head
  `f97ff6d54918e9707f6a8742974224e909480304`, conclusion success. All 11 steps
  of `Build Installer (windows-x86_64)` succeeded, including the bundle and the
  collector. The only annotation was a Node 20 deprecation warning.
- Artifact `12507950694` `bettershape-windows-x86_64`, 17,889,657 bytes.
  Artifact `12508292396` `bettershape-windows-aarch64`, 17,139,111 bytes.
- Run `38624859970` of 14 October, before the animation, produced 13,882,782
  and 13,136,893 bytes for the same two targets. The growth of 4,006,875 and
  4,002,218 bytes is consistent with the incompressible 3,933,635-byte GIF
  arriving in both, and with nothing else changing.

## Open questions

- Which mechanism blocked the installer is unconfirmed. No diagnostic was ever
  run on the machine.
- The artifact itself was never inspected.
  `productionresultssa2.blob.core.windows.net` and
  `release-assets.githubusercontent.com` are outside this sandbox's allowlist,
  so the actual `BetterShape_1.0.3_x64-setup.exe` could not be downloaded. A
  defect inside the produced executable has not been ruled out by inspection,
  only by the size evidence above.
- The repository has zero published releases, while `docs/help/install.mdx`
  tells users to get the installer from a releases page. That URL redirects to
  `better-Shape/app`, whose releases list is empty. Left untouched because the
  maintainer asked for no documentation changes in this round. It is a real
  defect and it is unresolved.
