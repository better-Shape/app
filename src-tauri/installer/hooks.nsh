; Animated welcome-page sidebar for the Windows installer.
;
; MUI only accepts a static BMP for the welcome and finish image
; (MUI_WELCOMEFINISHPAGE_BITMAP), so the animation is painted over that
; control by the AnimGif plug-in. The static BMP named in tauri.conf.json is
; what MUI draws until the hook attaches, and it stays on the finish page.
;
; Both callbacks run inside MUI's own welcome page function, so every register
; this file touches is pushed and popped again.

!addplugindir /x86-unicode "${__FILEDIR__}\plugins\x86-unicode"

; Captured at include time. Tauri expands hook macros where it inserts them, so
; ${__FILEDIR__} inside a macro body would point at the generated script instead.
!define BETTERSHAPE_SIDEBAR_GIF "${__FILEDIR__}\sidebar.gif"

; Extracted copy of the GIF, written by the show callback before playback.
!define BETTERSHAPE_SIDEBAR_EXTRACTED "$PLUGINSDIR\bettershape-sidebar.gif"

; MUI2 builds the welcome page as a #32770 dialog holding one SS_BITMAP static
; for the sidebar (Contrib/Modern UI 2/Pages/Welcome.nsh, unchanged in NSIS
; 3.11). NSIS destroys the previous page dialog before it creates the next one
; (Source/exehead/Ui.c), so that dialog is the only #32770 child of $HWNDPARENT
; while this callback runs, which is also the lookup AnimGif performs when no
; /HWND is given. The handle is found by walking the page children and testing
; STM_GETIMAGE rather than by naming $mui.WelcomePage.Image, because MUI
; declares that variable after Tauri includes this file.
Function BetterShapeSidebarShow
    Push $R0
    Push $R1
    Push $R2
    Push $R3

    ; MUI stages its own sidebar exactly this way, InitPluginsDir followed by
    ; File /oname=$PLUGINSDIR\modern-wizard.bmp (Pages/Welcome.nsh:44-45), so
    ; the pair is the documented pattern rather than an invention here. The
    ; call costs one comparison and a return once $PLUGINSDIR exists, and it
    ; saves $0 and $1 when it does have to create the directory
    ; (Source/build.cpp:3805-3812 and 3838-3842), so MUI's page function is
    ; unaffected either way. Keeping it here means this file does not depend on
    ; nsDialogs::Create happening to run first.
    InitPluginsDir
    File /oname=${BETTERSHAPE_SIDEBAR_EXTRACTED} "${BETTERSHAPE_SIDEBAR_GIF}"

    ; A File that cannot create its target offers abort, retry and ignore, and
    ; ignore continues the install without the file (Source/exehead/exec.c:562-
    ; 573, with ignore as the default button per Source/script.cpp:5445-5449).
    ; Quit here in that case and leave MUI's static bitmap attached, because a
    ; still sidebar beats a blank one. Playback failures inside the plug-in
    ; cannot be caught the same way: play returns without pushing a result when
    ; LoadGIF yields no frames (plugin-animgif animgif.cpp:203-204, whose
    ; ERRORMSG is compiled out at winimage.cpp:40). A write error after the
    ; file opened is fatal for any File instruction in NSIS
    ; (Source/exehead/exec.c:596-605) and no hook can intercept it.
    IfFileExists "${BETTERSHAPE_SIDEBAR_EXTRACTED}" 0 BetterShapeSidebarDone

    ; Fall back to the installer window itself if the page is not nested in a
    ; dialog of its own.
    FindWindow $R0 "#32770" "" $HWNDPARENT
    StrCmp $R0 0 0 BetterShapeSidebarHavePage
        StrCpy $R0 $HWNDPARENT
    BetterShapeSidebarHavePage:
    StrCmp $R0 0 BetterShapeSidebarDone

    StrCpy $R1 0
    BetterShapeSidebarFind:
        FindWindow $R2 "" "" $R0 $R1
        StrCmp $R2 0 BetterShapeSidebarDone
        ; wParam 0 is IMAGE_BITMAP. Only the sidebar static holds a bitmap;
        ; the title and body labels return 0 and are skipped.
        SendMessage $R2 ${STM_GETIMAGE} 0 0 $R3
        StrCmp $R3 0 BetterShapeSidebarNext
            ; Two reasons to detach MUI's bitmap before playback. The static's
            ; own window procedure paints it after AnimGif paints a frame, and
            ; MUI deletes it with ${NSD_FreeImage} once the page closes, which
            ; would leave the control holding a freed handle.
            ${NSD_ClearImage} $R2
            AnimGif::play /NOUNLOAD /HWND=$R2 /FIT=BOTH /HALIGN=0 /VALIGN=0 "${BETTERSHAPE_SIDEBAR_EXTRACTED}"
            Goto BetterShapeSidebarDone
    BetterShapeSidebarNext:
        StrCpy $R1 $R2
        Goto BetterShapeSidebarFind
    BetterShapeSidebarDone:
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
FunctionEnd

; AnimGif::stop is safe when play never ran: the plug-in checks its own state
; and the window handle before it restores anything. play also calls stop
; first, so returning to this page with Back cannot double-subscribe.
;
; stop does end the animation worker with TerminateThread rather than a
; cooperative join (plugin-animgif winimage.cpp:236-240), which is the risk
; every reviewer of this file should know about. Calling it is still the only
; correct option from a hook: this GIF's loop count is 0, so the worker's
; condition is literally "while true" (winimage.cpp:130) and skipping stop
; would leave it painting into a destroyed window for the rest of the process.
; Fixing the termination itself means rebuilding the plug-in, which is a
; decision for a maintainer and is recorded in installer/README.md.
Function BetterShapeSidebarLeave
    AnimGif::stop
FunctionEnd

; Consumed by the welcome page, which the template declares immediately after
; this include. MUI undefines both symbols once that page is inserted, so they
; cannot leak into the uninstaller pages that define their own callbacks later
; in the same template.
!define MUI_PAGE_CUSTOMFUNCTION_SHOW BetterShapeSidebarShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE BetterShapeSidebarLeave
