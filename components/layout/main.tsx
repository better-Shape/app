"use client";

import { useState, useEffect } from "react";
import { useProjectState, commands, getProjectSnapshot } from "@/lib/backend";
import { usePathname } from "next/navigation";
import { AgentLayout, openProject } from "@/features/agent";
import { dispatchShortcutAction } from "@/lib/ui/shortcut-actions";
import { upsertRepoHistory } from "@/lib/workspace/repo-history";
import { saveLastProject, loadLastProject } from "@/lib/workspace/last-project";
import { clearClosedTabs } from "@/lib/workspace/closed-tabs";
import { isMainTauriWindow, isTauriRuntime } from "@/lib/window/tauri-window";

/** Native menu / global-shortcut actions that never reach a JS keydown handler. */
function TauriShortcutBridge() {
    useEffect(() => {
        let disposed = false;
        const unlisteners: Array<() => void> = [];

        void import("@tauri-apps/api/event").then(({ listen }) => {
            const register = (event: string, handler: (payload: unknown) => void) => {
                void listen(event, (e) => handler(e.payload)).then((fn) => {
                    // Unmount can win the race against `listen`; never leak the listener.
                    if (disposed) fn();
                    else unlisteners.push(fn);
                });
            };
            register("open-find-in-files", () => {
                dispatchShortcutAction("Find in Files", "Ctrl+Shift+F");
            });
            register("open-replace-in-files", () => {
                dispatchShortcutAction("Replace in Files", "Ctrl+H");
            });
            register("save-all-request", () => {
                window.dispatchEvent(new Event("save-all-request"));
            });
            // File menu / Ctrl+S, Ctrl+O, Ctrl+N from the native menu.
            register("save-request", () => {
                window.dispatchEvent(new Event("save-request"));
            });
            register("open-file-request", () => {
                window.dispatchEvent(new Event("open-file-request"));
            });
            register("new-file", () => {
                window.dispatchEvent(new CustomEvent("bettershape-explorer-create", { detail: { type: "file" } }));
            });
            // F12 / Alt+Shift+F — the backend forwards the raw accelerator.
            register("editor-shortcut", (payload) => {
                const key = typeof payload === "string" ? payload : "";
                const action = key === "F12" ? "definition" : key === "Alt+Shift+F" ? "format" : "";
                if (!action) return;
                window.dispatchEvent(new CustomEvent("bettershape-editor-action", { detail: { action } }));
            });
            register("toggle-zen-mode", () => {
                window.dispatchEvent(new Event("bettershape-toggle-zen-mode"));
            });
            // Ctrl+E / Recent Files from the native menu.
            register("bettershape-command-palette", (payload) => {
                const detail = payload && typeof payload === "object" ? payload : { mode: "files" };
                window.dispatchEvent(new CustomEvent("bettershape-command-palette", { detail }));
            });
        });

        return () => {
            disposed = true;
            for (const fn of unlisteners) fn();
            unlisteners.length = 0;
        };
    }, []);

    return null;
}

function ProjectOpenHost() {
    const { project_path } = useProjectState();

    useEffect(() => {
        if (!project_path) return;
        upsertRepoHistory(project_path);
        saveLastProject(project_path);
        clearClosedTabs();
    }, [project_path]);

    useEffect(() => {
        const handleEvent = (e: Event) => {
            const custom = e as CustomEvent<{ path: string }>;
            if (custom.detail?.path) void openProject(custom.detail.path);
        };
        window.addEventListener("bettershape-open-project", handleEvent);
        return () => window.removeEventListener("bettershape-open-project", handleEvent);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                if (getProjectSnapshot().project_path) return;
                if (!isTauriRuntime()) return;
                const isMain = await isMainTauriWindow();
                if (!isMain || cancelled) return;
                const fresh = await commands.isFreshWindow().catch(() => false);
                if (fresh || cancelled) return;
                const last = loadLastProject();
                if (!last || cancelled) return;
                await openProject(last, { promptTrust: false });
            } catch {
                /* ignore */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    return null;
}

export default function Main({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    useEffect(() => {
        const handleOpenSettings = () => {
            void import("@/lib/window/open-settings").then(({ openSettingsWindow }) => openSettingsWindow());
        };
        const handleOpenFileRequest = async () => {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const selected = await open({ directory: false, multiple: false });
            if (typeof selected === "string") {
                const name = selected.split(/[\\/]/).pop() || selected;
                await commands.grantIpcPath(selected).catch(() => undefined);
                await commands.openFile(selected, name);
            }
        };
        const handleOpenFolderRequest = () => {
            window.dispatchEvent(new Event("bettershape-open-project-pick"));
        };

        window.addEventListener("bettershape-open-settings", handleOpenSettings);
        window.addEventListener("open-file-request", handleOpenFileRequest);
        window.addEventListener("open-folder-request", handleOpenFolderRequest);

        return () => {
            window.removeEventListener("bettershape-open-settings", handleOpenSettings);
            window.removeEventListener("open-file-request", handleOpenFileRequest);
            window.removeEventListener("open-folder-request", handleOpenFolderRequest);
        };
    }, []);

    if (
        pathname === "/settings" || pathname === "/settings/" || pathname.startsWith("/settings/")
        || pathname === "/branch" || pathname === "/branch/" || pathname.startsWith("/branch/")
        || pathname === "/git" || pathname === "/git/" || pathname.startsWith("/git/")
        || pathname === "/popout" || pathname.startsWith("/popout/")
    ) {
        return <main className="flex h-full w-full flex-col overflow-hidden">{children}</main>;
    }

    return (
        <div
            className="relative flex min-h-0 flex-1 flex-row overflow-hidden bg-transparent text-md text-text-primary"
            data-workbench-main
        >
            <div className="relative z-10 flex min-w-0 flex-1 overflow-hidden">
                <AgentLayout>{children}</AgentLayout>
            </div>
            <ProjectOpenHost />
            <TauriShortcutBridge />
        </div>
    );
}
