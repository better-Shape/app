"use client";

import React, { useEffect } from "react";
import { usePathname } from "next/navigation";
import Main from "@/components/layout/main";
import { Titlebar } from "@/features/agent/workbench";
import { LoadingProvider } from "@/features/loading/context";
import { NotificationProvider } from "@/components/ui/notification";
import { GlobalContextMenu } from "@/core/providers/menu";
import { ChatStreamProvider } from "@/features/chat/lib/chat-stream-store";
import { acquireAiConfiguration } from "@/lib/ai/bootstrap";
import { installWindowCloseGuard } from "@/lib/window/close-guard";
import { notify } from "@/features/notifications";
import { initGitHubAuth } from "@/lib/github/store";
import { CheckpointRestoreDialog } from "@/features/chat/ui/shell/checkpoint-restore-dialog";
import { installBenignErrorFilters } from "@/lib/editor/benign-errors";
import { isMainTauriWindow, isTauriRuntime } from "@/lib/window/tauri-window";
import { FilterProvider } from "@/features/git/ui/manager/filter-context";
import { SuppressNativeTooltips } from "@/components/ui/suppress-native-tooltips";
import { CommandPaletteBridge } from "@/features/agent/palette";
import { DesignPreviewCaptureHost } from "@/features/chat/ui/design-capture";
import { WebviewReconnect } from "@/components/layout/webview-reconnect";
import { PreviewCrash } from "@/components/layout/error/preview-crash";

/**
 * A route base matches its own path and anything under it. The prod static export serves
 * trailing slashes (`/settings/`), so both forms have to match.
 */
const pathMatches = (pathname: string | null, base: string) => {
    if (!pathname) return false;
    return pathname === base || pathname === `${base}/` || pathname.startsWith(`${base}/`);
};

const ClientLayout = ({ children }: { children: React.ReactNode }) => {
    const pathname = usePathname();
    const isSettings = pathMatches(pathname, "/settings");
    const isBranch = pathMatches(pathname, "/branch") || pathMatches(pathname, "/git");

    const isPopout = pathMatches(pathname, "/popout");

    useEffect(() => {
        let cancelled = false;
        const configuration = acquireAiConfiguration();
        /** Wait for shared provider initialization before starting GitHub authentication and MCP synchronization. */
        const bootstrap = async () => {
            await configuration.ready;
            if (cancelled) return;
            initGitHubAuth();

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

        bootstrap().catch(() => {
            if (!cancelled) notify.error("Could not initialize app settings", "Reload the app to try again.");
        });
        return () => { cancelled = true; configuration.release(); };
    }, []);

    // Re-ensure benign error filters (idempotent; instrumentation-client runs earlier).
    useEffect(() => {
        installBenignErrorFilters();
    }, []);

    useEffect(installWindowCloseGuard, []);

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
        let cancelled = false;
        /** Show the main native window after settings hydration, unless this layout has already unmounted. */
        const init = async () => {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            if (cancelled) return;
            const currentWindow = getCurrentWindow();
            if (currentWindow.label !== "main") return;

            const { initSettings } = await import("@/lib/settings");
            await initSettings();
            if (!cancelled) await currentWindow.show();
        };
        init().catch((error) => {
            console.error("Failed to manage window flow:", error);
        });
        return () => { cancelled = true; };
    }, []);

    if (isPopout) return <PopoutShell>{children}</PopoutShell>;
    if (isBranch) return <SettingsShell kind="Git">{children}</SettingsShell>;
    if (isSettings) return <SettingsShell kind="Settings">{children}</SettingsShell>;

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
};

/** The shell the three route kinds share: providers, tooltip suppression, the menu host. */
const ProviderShell = ({ children }: { children: React.ReactNode }) => (
    <LoadingProvider>
        <NotificationProvider>
            <SuppressNativeTooltips />
            <GlobalContextMenu>{children}</GlobalContextMenu>
        </NotificationProvider>
    </LoadingProvider>
);

const PopoutShell = ({ children }: { children: React.ReactNode }) => (
    <ProviderShell>
        <div
            id="bettershape-popout"
            className="relative flex h-screen w-full flex-col overflow-hidden bg-titlebar font-sans text-sm text-text-primary select-none"
        >
            <Titlebar focus />
            <main className="min-h-0 flex-1 overflow-hidden bg-editor">{children}</main>
            <CommandPaletteBridge />
            <div id="bettershape-overlays" />
        </div>
    </ProviderShell>
);

const SettingsShell = ({ kind, children }: { kind: "Git" | "Settings"; children: React.ReactNode }) => {
    const body = (
        <div id="bettershape-settings" className="relative flex h-screen w-full flex-col overflow-hidden bg-background font-sans text-sm text-text-primary select-none">
            <Titlebar settings title={kind} />
            <main className="min-h-0 flex-1 overflow-hidden bg-background">{children}</main>
            <div id="bettershape-overlays" />
        </div>
    );
    return <ProviderShell>{kind === "Git" ? <FilterProvider initialSection="branches">{body}</FilterProvider> : body}</ProviderShell>;
};

const Content = ({ children }: { children: React.ReactNode }) => {
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
            </div>
            <WebviewReconnect />
            {/* Preview-only: `?crash=global` throws above the page boundary so the root
                error boundary can be inspected. Inert in a real build. */}
            <PreviewCrash scope="global" />
            <div id="bettershape-overlays" />
        </div>
    );
};

export default ClientLayout;
