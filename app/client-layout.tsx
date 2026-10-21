"use client";

import React, { useEffect } from "react";
import { usePathname } from "next/navigation";
import Main from "@/components/layout/main";
import { Titlebar } from "@/features/agent/workbench";
import { LoadingProvider } from "@/features/loading/context";
import { NotificationProvider } from "@/components/ui/notification";
import { GlobalContextMenu } from "@/core/providers/menu";
import { ChatStreamProvider } from "@/features/chat/lib/chat-stream-store";
import { initSettings } from "@/lib/settings";
import { initGitHubAuth } from "@/lib/github/store";
import { CheckpointRestoreDialog } from "@/features/chat/ui/shell/checkpoint-restore-dialog";
import { installBenignErrorFilters } from "@/lib/editor/benign-errors";
import { isMainTauriWindow, isTauriRuntime } from "@/lib/window/tauri-window";
import { FilterProvider } from "@/features/git/ui/manager/filter-context";
import { SuppressNativeTooltips } from "@/components/ui/suppress-native-tooltips";
import { CommandPaletteBridge } from "@/features/agent/palette";
import { DesignPreviewCaptureHost } from "@/features/chat/ui/design-capture";
import { WebviewReconnect } from "@/components/layout/webview-reconnect";
import { KeyboardShortcutsCheatsheet } from "@/features/shortcuts/ui/cheatsheet";
import { useKeyboardShortcuts } from "@/lib/ui/shortcuts";

/** True when `pathname` is `base` itself or a route nested under it. */
function pathMatches(pathname: string | null, base: string) {
    if (!pathname) return false;
    return pathname === base || pathname === `${base}/` || pathname.startsWith(`${base}/`);
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    // One window-level instance per window. The titlebar used to own this, which
    // left the workbench (no titlebar) and the browser preview with no bindings.
    useKeyboardShortcuts();
    // Prod static export uses trailing slashes (`/settings/`); match both forms.
    const isSettings = pathMatches(pathname, "/settings");
    const isBranch = pathMatches(pathname, "/branch") || pathMatches(pathname, "/git");

    const isPopout = pathMatches(pathname, "/popout");

    useEffect(() => {
        const bootstrap = async () => {
            void initSettings();
            initGitHubAuth();
            void import("@/lib/ai/sync").then(({ initAiConfigSync }) => initAiConfigSync());

            // MCP: sync user mcp.json so the agent sees tools without visiting Settings.
            void (async () => {
                try {
                    const { syncActiveMcpServers } = await import("@/lib/mcp/registry");
                    await syncActiveMcpServers();
                } catch {
                    /* ignore */
                }
            })();

            const isMain = !isTauriRuntime() || await isMainTauriWindow();
            if (!isMain) return;
        };

        void bootstrap();
    }, []);

    // Re-ensure benign error filters (idempotent; instrumentation-client runs earlier).
    useEffect(() => {
        installBenignErrorFilters();
    }, []);

    // Dev-only performance overlay; a no-op in production builds.
    useEffect(() => {
        if (process.env.NODE_ENV === "production") return;
        let unmount: (() => void) | undefined;
        let cancelled = false;
        import("@/lib/dev/perf-hud-overlay")
            .then(({ mountPerfHud }) => {
                if (!cancelled) unmount = mountPerfHud();
            })
            // A missing chunk only costs the overlay, never the app shell.
            .catch(() => {});
        return () => {
            cancelled = true;
            unmount?.();
        };
    }, []);

    useEffect(() => {
        if (isSettings || isBranch || isPopout) return;
        let unlisten: (() => void) | undefined;
        let cancelled = false;

        void (async () => {
            try {
                const { getCurrentWindow } = await import("@tauri-apps/api/window");
                const { confirm } = await import("@tauri-apps/plugin-dialog");
                const win = getCurrentWindow();
                if (win.label !== "main") return;

                unlisten = await win.onCloseRequested(async (event) => {
                    const { hasGeneratingChats } = await import("@/features/chat/lib/generating-chats");
                    if (hasGeneratingChats()) {
                        event.preventDefault();
                        await win.hide();
                        return;
                    }
                    const { getProjectSnapshot, commands } = await import("@/lib/backend");
                    const dirty = getProjectSnapshot().open_files.filter((f) => f.is_dirty);
                    if (dirty.length === 0) return;

                    event.preventDefault();
                    const save = await confirm(
                        dirty.length === 1
                            ? `Save changes to ${dirty[0].name || dirty[0].path} before closing?`
                            : `Save changes to ${dirty.length} files before closing?`,
                        {
                            title: "Unsaved changes",
                            kind: "warning",
                            okLabel: "Save",
                            cancelLabel: "Don't save",
                        },
                    );

                    if (save) {
                        window.dispatchEvent(new Event("save-all-request"));
                        // Give save-all a moment; then close.
                        await new Promise((r) => setTimeout(r, 400));
                    } else {
                        const { clearDirtyBuffer } = await import("@/lib/workspace/dirty-buffers");
                        for (const f of dirty) {
                            clearDirtyBuffer(f.path);
                            void commands.markFileDirty(f.path, false);
                        }
                    }
                    if (!cancelled) await win.destroy();
                });
            } catch {
                /* browser / non-tauri */
            }
        })();

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, [isSettings, isBranch, isPopout]);

    // Block the native WebView context menu without breaking Radix menus.
    // Must be bubble phase: Radix opens on the target first; capture+preventDefault
    // made Radix skip open (it ignores events that are already defaultPrevented).
    useEffect(() => {
        const blockNative = (e: Event) => {
            e.preventDefault();
        };
        window.addEventListener("contextmenu", blockNative, false);
        return () => window.removeEventListener("contextmenu", blockNative, false);
    }, []);

    useEffect(() => {
        const init = async () => {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");

            try {
                const currentWindow = getCurrentWindow();
                if (currentWindow.label !== "main") return;

                const { initSettings } = await import("@/lib/settings");
                await initSettings();
                await currentWindow.show();
            } catch (e) {
                console.error("Failed to manage window flow:", e);
            }
        };
        void init();
    }, []);

    if (isPopout) {
        return (
            <LoadingProvider>
                <NotificationProvider>
                    <SuppressNativeTooltips />
                    <GlobalContextMenu>
                        <KeyboardShortcutsCheatsheet />
                        <div
                            id="bettershape-popout"
                            className="relative flex h-screen w-full flex-col overflow-hidden bg-titlebar font-sans text-sm text-text-primary select-none"
                        >
                            <Titlebar focus />
                            <main className="min-h-0 flex-1 overflow-hidden bg-editor">
                                {children}
                            </main>
                            <CommandPaletteBridge />
                            <div id="bettershape-overlays" />
                        </div>
                    </GlobalContextMenu>
                </NotificationProvider>
            </LoadingProvider>
        );
    }

    if (isSettings || isBranch) {
        const windowTitle = isBranch ? "Git" : "Settings";
        const body = (
            <div id="bettershape-settings" className="relative flex h-screen w-full flex-col overflow-hidden bg-background font-sans text-sm text-text-primary select-none">
                <Titlebar settings title={windowTitle} />
                <main className="min-h-0 flex-1 overflow-hidden bg-background">
                    {children}
                </main>
                <div id="bettershape-overlays" />
            </div>
        );
        return (
            <LoadingProvider>
                <NotificationProvider>
                    <SuppressNativeTooltips />
                    <GlobalContextMenu>
                        <KeyboardShortcutsCheatsheet />
                        {isBranch ? <FilterProvider>{body}</FilterProvider> : body}
                    </GlobalContextMenu>
                </NotificationProvider>
            </LoadingProvider>
        );
    }

    return (
        <LoadingProvider>
            <NotificationProvider>
                <SuppressNativeTooltips />
                <GlobalContextMenu>
                    <ChatStreamProvider>
                        <Content>{children}</Content>
                    </ChatStreamProvider>
                </GlobalContextMenu>
            </NotificationProvider>
        </LoadingProvider>
    );
}

function Content({ children }: { children: React.ReactNode }) {
    return (
        <div
            id="bettershape-workbench"
            className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-background select-none"
        >
            <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col">
                <Main>{children}</Main>
                <CheckpointRestoreDialog />
                <CommandPaletteBridge />
                <DesignPreviewCaptureHost />
                <KeyboardShortcutsCheatsheet />
            </div>
            <WebviewReconnect />
            <div id="bettershape-overlays" />
        </div>
    );
}
