"use client";

import { useEffect, useState } from "react";
import type { Window } from "@tauri-apps/api/window";


/** Expose native titlebar actions and mirror maximized/fullscreen state into the window chrome. */
export function useWindowControls() {
    const [isMaximized, setIsMaximized] = useState(false);
    const [appWindow, setAppWindow] = useState<Window | null>(null);

    useEffect(() => {
        let disposed = false;
        let unlisten: (() => void) | undefined;

        void import("@tauri-apps/api/window").then(async (module) => {
            const win = module.getCurrentWindow();
            if (disposed) return;
            setAppWindow(win);
            const syncChrome = async () => {
                const maximized = await win.isMaximized();
                const fullscreen = await win.isFullscreen().catch(() => false);
                if (disposed) return;
                setIsMaximized(maximized);
                document.documentElement.toggleAttribute(
                    "data-window-maximized",
                    maximized || fullscreen,
                );
            };
            await syncChrome();
            unlisten = await win.listen("tauri://resize", () => {
                void syncChrome();
            });
        });

        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);

    return {
        isMaximized,
        minimize: () => void appWindow?.minimize(),
        toggleMaximize: async () => {
            if (!appWindow) return;
            const maximized = await appWindow.isMaximized();
            if (maximized) await appWindow.unmaximize();
            else await appWindow.maximize();
            setIsMaximized(!maximized);
        },
        close: () => {
            if (appWindow) void appWindow.close();
        },
        closeWindow: () => {
            if (appWindow) void appWindow.close();
        },
    };
}
