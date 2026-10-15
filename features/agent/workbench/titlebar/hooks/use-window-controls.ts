"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Window } from "@tauri-apps/api/window";
import { notify } from "@/features/notifications";
import { isTauriRuntime } from "@/lib/window/tauri-window";

/** Expose native titlebar actions and mirror maximized/fullscreen state into the window chrome. */
export function useWindowControls() {
    const [isMaximized, setIsMaximized] = useState(false);
    const [appWindow, setAppWindow] = useState<Window | null>(null);
    const syncChromeRef = useRef<(() => Promise<void>) | null>(null);

    useEffect(() => {
        if (!isTauriRuntime()) return;
        let disposed = false;
        let revision = 0;
        let unlisten: (() => void) | undefined;
        const report = () => { if (!disposed) notify.error("Could not synchronize window controls"); };
        import("@tauri-apps/api/window").then(async (module) => {
            const win = module.getCurrentWindow();
            if (disposed) return;
            setAppWindow(win);
            const syncChrome = async () => {
                const requestedRevision = ++revision;
                const maximized = await win.isMaximized();
                const fullscreen = await win.isFullscreen().catch(() => false);
                if (disposed || requestedRevision !== revision) return;
                setIsMaximized(maximized);
                document.documentElement.toggleAttribute("data-window-maximized", maximized || fullscreen);
            };
            syncChromeRef.current = syncChrome;
            // An initial read failure must not disable future resize updates.
            await syncChrome().catch(report);
            if (disposed) return;
            const stop = await win.listen("tauri://resize", () => {
                syncChrome().catch(report);
            });
            if (disposed) stop();
            else unlisten = stop;
        }).catch(report);
        return () => {
            disposed = true;
            syncChromeRef.current = null;
            unlisten?.();
        };
    }, []);

    const minimize = useCallback(() => {
        appWindow?.minimize().catch(() => notify.error("Could not minimize the window"));
    }, [appWindow]);
    const toggleMaximize = useCallback(async () => {
        if (!appWindow) return;
        try {
            const maximized = await appWindow.isMaximized();
            if (maximized) await appWindow.unmaximize();
            else await appWindow.maximize();
            await syncChromeRef.current?.();
        } catch { notify.error("Could not resize the window"); }
    }, [appWindow]);
    const close = useCallback(() => {
        appWindow?.close().catch(() => notify.error("Could not close the window", "Try again after saving your changes."));
    }, [appWindow]);
    return { isMaximized, minimize, toggleMaximize, close, closeWindow: close };
}
