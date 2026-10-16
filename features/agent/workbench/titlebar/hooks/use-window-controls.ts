"use client";

import { useEffect, useState } from "react";
import type { Window } from "@tauri-apps/api/window";

/**
 * Closes this window, or quits the app when this window is the main one.
 *
 * Closing the main window closes every secondary window first: a settings or git window left
 * open while the process exits would otherwise come back as a dead frame on the next launch.
 * Any failure on the way falls through to closing this window, which is the one outcome the
 * user asked for and the only one that always applies.
 */
const closeAppOrWindow = async (appWindow: Window) => {
    try {
        if (appWindow.label === "main") {
            const { getAllWindows } = await import("@tauri-apps/api/window");
            const windows = await getAllWindows();
            await Promise.all(
                windows
                    .filter((window) => window.label !== "main")
                    .map((window) => window.close().catch(() => undefined)),
            );
            const { exit } = await import("@tauri-apps/plugin-process");
            await exit(0);
            return;
        }
    } catch {
        // Fall through to closing this window.
    }
    await appWindow.close();
};

/**
 * The window's own controls, and the maximized state the chrome has to mirror.
 *
 * The handle arrives asynchronously, so every control is a no-op until it does: a press in
 * the first frames of a window cannot be answered yet, and answering with an error would be
 * worse than answering with nothing.
 */
export const useWindowControls = () => {
    const [isMaximized, setIsMaximized] = useState(false);
    const [appWindow, setAppWindow] = useState<Window | null>(null);

    useEffect(() => {
        let disposed = false;
        let unlisten: (() => void) | undefined;

        import("@tauri-apps/api/window")
            .then(async (module) => {
                const win = module.getCurrentWindow();
                if (disposed) return;
                setAppWindow(win);

                /**
                 * Mirrors the window's size into the chrome, which draws its own controls.
                 *
                 * Fullscreen counts as maximized because the shell styles both the same way,
                 * and a fullscreen window whose chrome still draws the restore glyph is a
                 * button that lies about what it will do.
                 */
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
                    syncChrome().catch(() => undefined);
                });
            })
            .catch(() => undefined);

        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);

    /** Maximizes, or restores when the window is already maximized. */
    const toggleMaximize = async () => {
        if (!appWindow) return;
        const maximized = await appWindow.isMaximized();
        if (maximized) await appWindow.unmaximize();
        else await appWindow.maximize();
        setIsMaximized(!maximized);
    };

    return {
        isMaximized,
        minimize: () => {
            appWindow?.minimize().catch(() => undefined);
        },
        toggleMaximize: () => {
            toggleMaximize().catch(() => undefined);
        },
        close: () => {
            if (appWindow) closeAppOrWindow(appWindow).catch(() => undefined);
        },
        closeWindow: () => {
            if (appWindow) closeAppOrWindow(appWindow).catch(() => undefined);
        },
    };
};
