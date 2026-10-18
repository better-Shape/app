import { dirtyOpenFiles } from "@/lib/workspace/dirty-buffers";
import { commands } from "@/lib/backend";
import { HELP_LINKS } from "@/lib/errors/help-links";
import { isPopoutPath } from "@/lib/window/tauri-window";
import { ensureWorkspaceTrust, notifyWorkspaceClosed, notifyWorkspaceOpened } from "@/lib/workspace/trust";
import { clearExtraWorkspaceFolders } from "@/lib/workspace/folders";
import { dispatchShortcutAction } from "@/lib/ui/shortcut-actions";
import type { MenuActionContext } from "./types";
import { getFileExtension, isImageExtension, isFontExtension } from "@/features/editor/lib/image-types";

function getFileName(path: string) {
    return path.split(/[\\/]/).pop() || path;
}

function getDirectoryName(path: string) {
    const normalized = path.replace(/\\/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash < 0) return null;
    return normalized.slice(0, lastSlash);
}

/** Binary assets must not be round-tripped through UTF-8 text save. */
function isBinaryAssetPath(path: string): boolean {
    const ext = getFileExtension(path);
    return isImageExtension(ext) || isFontExtension(ext);
}

const EDITOR_ACTION_MAP: Record<string, string> = {
    Undo: "undo",
    Redo: "redo",
    Cut: "cut",
    Copy: "copy",
    Paste: "paste",
    "Select All": "selectAll",
    "Format Document": "format",
    "Go to Definition": "definition",
    "Go to Declaration": "declaration",
    "Go to Type Definition": "typeDefinition",
    "Go to Implementations": "implementation",
    "Go to Line/Column...": "goToLine",
    "Go to Symbol in Editor...": "goToSymbolInEditor",
    "Go to Symbol in Workspace...": "goToSymbolInWorkspace",
    "Go to References": "goToReferences",
    "Go to Bracket": "goToBracket",
    Back: "back",
    Forward: "forward",
    "Last Edit Location": "lastEditLocation",
};

export function createMenuActionHandler(ctx: MenuActionContext) {
    return async (label: string) => {
        switch (label) {
            case "New Window":
                await commands.newWindow();
                break;
            case "New Chat":
                window.dispatchEvent(new CustomEvent("bettershape-chat-new"));
                window.dispatchEvent(new CustomEvent("bettershape-chat-focus-input"));
                break;
            case "Open File": {
                const { open } = await import("@tauri-apps/plugin-dialog");
                const selected = await open({
                    directory: false,
                    multiple: false,
                    defaultPath: ctx.projectPath || undefined,
                });
                if (typeof selected === "string") {
                    const selectedDir = getDirectoryName(selected);
                    if (!ctx.projectPath && selectedDir) {
                        await commands.setProjectPath(selectedDir);
                        await clearExtraWorkspaceFolders();
                        await ensureWorkspaceTrust(selectedDir);
                        notifyWorkspaceOpened(selectedDir);
                    }
                    await commands.grantIpcPath(selected).catch(() => undefined);
                    await commands.openFile(selected, getFileName(selected));
                }
                break;
            }
            case "Open Folder":
                window.dispatchEvent(new Event("bettershape-open-project-pick"));
                break;
            case "Add Folder to Workspace": {
                const { open } = await import("@tauri-apps/plugin-dialog");
                const selected = await open({ directory: true, multiple: false });
                if (selected && typeof selected === "string") {
                    const { addWorkspaceFolder } = await import("@/lib/workspace/folders");
                    addWorkspaceFolder(selected);
                    window.dispatchEvent(new Event("bettershape-workspace-folders-changed"));
                }
                break;
            }
            case "Close Folder":
                window.dispatchEvent(new Event("bettershape-design-exit"));
                await commands.closeAllFiles();
                const { saveLastProject } = await import("@/lib/workspace/last-project");
                saveLastProject(null);
                await commands.setProjectPath(null);
                notifyWorkspaceClosed();
                break;
            case "Close Tab":
                if (ctx.activeFile) void commands.closeFile(ctx.activeFile);
                break;
            case "Close All Tabs":
                void commands.closeAllFiles();
                break;
            case "New Text File":
                window.dispatchEvent(new CustomEvent("bettershape-explorer-create", { detail: { type: "file" } }));
                break;
            case "Save":
                window.dispatchEvent(new Event("save-request"));
                break;
            case "Save As": {
                if (!ctx.activeFile) break;
                if (isBinaryAssetPath(ctx.activeFile)) {
                    // Image/font editors own their own save path (bytes), not UTF-8 text.
                    window.dispatchEvent(new Event("save-request"));
                    break;
                }
                const { save } = await import("@tauri-apps/plugin-dialog");
                const selected = await save({
                    defaultPath: ctx.projectPath
                        ? `${ctx.projectPath}/${getFileName(ctx.activeFile)}`
                        : getFileName(ctx.activeFile),
                });
                if (typeof selected === "string") {
                    const content = await ctx.readLatestContent(ctx.activeFile);
                    await commands.grantIpcPath(selected).catch(() => undefined);
                    await commands.saveFile(selected, content);
                    await commands.openFile(selected, getFileName(selected));
                }
                break;
            }
            case "Save All": {
                for (const file of dirtyOpenFiles(ctx.openFiles)) {
                    if (isBinaryAssetPath(file.path)) continue;
                    const content = await ctx.readLatestContent(file.path);
                    await commands.saveFile(file.path, content);
                }
                break;
            }
            case "Undo":
            case "Redo":
            case "Cut":
            case "Copy":
            case "Paste":
            case "Select All":
            case "Format Document":
            case "Back":
            case "Forward":
            case "Last Edit Location":
            case "Go to Symbol in Workspace...":
            case "Go to Symbol in Editor...":
            case "Go to Line/Column...":
            case "Go to Bracket":
            case "Go to Definition":
            case "Go to Declaration":
            case "Go to Type Definition":
            case "Go to Implementations":
            case "Go to References": {
                const action = EDITOR_ACTION_MAP[label];
                if (action) {
                    window.dispatchEvent(new CustomEvent("bettershape-editor-action", { detail: { action } }));
                }
                break;
            }
            case "Word Wrap":
                window.dispatchEvent(
                    new CustomEvent("bettershape-editor-action", { detail: { action: "toggleWordWrap" } }),
                );
                break;
            case "Reset Layout":
                window.dispatchEvent(
                    new CustomEvent("bettershape-layout-toggle", { detail: { id: "primary-sidebar", value: true } }),
                );
                window.dispatchEvent(
                    new CustomEvent("bettershape-layout-toggle", { detail: { id: "panel", value: true } }),
                );
                window.dispatchEvent(
                    new CustomEvent("bettershape-layout-toggle", {
                        detail: { id: "secondary-sidebar", value: false },
                    }),
                );
                window.dispatchEvent(new Event("bettershape-layout-reset"));
                break;
            case "Git Graph":
                window.dispatchEvent(new CustomEvent("bettershape-set-active-tab", { detail: "graph" }));
                break;
            case "AI Chat":
                window.dispatchEvent(
                    new CustomEvent("bettershape-layout-toggle", {
                        detail: { id: "secondary-sidebar", value: true },
                    }),
                );
                break;
            case "Zen Mode":
                if (!isPopoutPath()) {
                    window.dispatchEvent(new Event("bettershape-toggle-zen-mode"));
                }
                break;
            case "Explorer":
                window.dispatchEvent(new CustomEvent("bettershape-set-active-tab", { detail: "files" }));
                break;
            case "Search":
                window.dispatchEvent(
                    new CustomEvent("bettershape-command-palette", {
                        detail: { mode: "files", placeholder: "Search files…" },
                    }),
                );
                break;
            case "Git Manager":
                window.dispatchEvent(
                    new CustomEvent("bettershape-layout-toggle", {
                        detail: { id: "secondary-sidebar", value: true },
                    }),
                );
                window.dispatchEvent(new CustomEvent("bettershape-set-active-tab", { detail: "graph" }));
                break;
            case "Open View...":
            case "Go to File...":
                window.dispatchEvent(new CustomEvent("bettershape-command-palette", { detail: { mode: "files" } }));
                break;
            case "Preview":
                window.dispatchEvent(new CustomEvent("bettershape-set-active-tab", { detail: "preview" }));
                break;
            case "Terminal":
                window.dispatchEvent(
                    new CustomEvent("bettershape-layout-toggle", { detail: { id: "panel", value: true } }),
                );
                window.dispatchEvent(
                    new CustomEvent("bettershape-terminal-shortcut", { detail: { action: "open" } }),
                );
                break;
            case "Command Palette...":
                window.dispatchEvent(new CustomEvent("bettershape-command-palette"));
                break;
            // Keep one implementation: the shortcut dispatcher owns search entry.
            case "Find in Files":
                dispatchShortcutAction("Find in Files", "Ctrl+Shift+F");
                break;
            case "Replace in Files":
                dispatchShortcutAction("Replace in Files", "Ctrl+H");
                break;
            case "New Terminal":
                window.dispatchEvent(
                    new CustomEvent("bettershape-layout-toggle", { detail: { id: "panel", value: true } }),
                );
                window.dispatchEvent(
                    new CustomEvent("bettershape-terminal-shortcut", { detail: { action: "new" } }),
                );
                break;
            case "Close Terminal":
                window.dispatchEvent(
                    new CustomEvent("bettershape-layout-toggle", { detail: { id: "panel", value: false } }),
                );
                break;
            case "Kill Current Terminal":
                window.dispatchEvent(
                    new CustomEvent("bettershape-terminal-shortcut", { detail: { action: "close_tab" } }),
                );
                break;
            case "Toggle Full Screen": {
                const { getCurrentWindow } = await import("@tauri-apps/api/window");
                const win = getCurrentWindow();
                await win.setFullscreen(!(await win.isFullscreen()));
                break;
            }
            case "Settings":
                void import("@/lib/window/open-settings").then(({ openSettingsWindow }) => openSettingsWindow());
                break;
            case "Release Notes":
                void commands.openUrlExternal(HELP_LINKS.changelog);
                break;
            case "Documentation":
                void commands.openUrlExternal(HELP_LINKS.documentation);
                break;
            case "Report Issue":
                void commands.openUrlExternal(HELP_LINKS.reportIssue);
                break;
            case "Check for Updates":
            case "Check for Updates...": {
                const { checkForAppUpdates, downloadAndInstallUpdate, getUpdateStatus, relaunchToApplyUpdate } =
                    await import("@/lib/window/updater");
                const { ask, message } = await import("@tauri-apps/plugin-dialog");
                const status = await checkForAppUpdates({ force: true });
                if (status.kind === "available") {
                    const confirmed = await ask(
                        `BetterShape ${status.version} is available. Download and install now?`,
                        { title: "Update available", kind: "info" },
                    );
                    if (confirmed) {
                        await downloadAndInstallUpdate();
                        if (getUpdateStatus().kind === "ready") {
                            const restart = await ask("Update installed. Restart BetterShape now?", {
                                title: "Restart required",
                                kind: "info",
                            });
                            if (restart) await relaunchToApplyUpdate();
                        }
                    }
                } else if (status.kind === "upToDate") {
                    await message("You're on the latest version.", { title: "Check for Updates", kind: "info" });
                } else if (status.kind === "error") {
                    await message(status.message, { title: "Check for Updates", kind: "error" });
                } else if (status.kind === "ready") {
                    const restart = await ask("An update is ready. Restart BetterShape now?", {
                        title: "Restart required",
                        kind: "info",
                    });
                    if (restart) await relaunchToApplyUpdate();
                }
                break;
            }
            case "View License":
                void commands.openUrlExternal(HELP_LINKS.license);
                break;
            case "Privacy Statement":
                void commands.openUrlExternal(HELP_LINKS.privacy);
                break;
            case "Close Window":
            case "Exit":
                ctx.closeWindow();
                break;
            case "About": {
                const { message } = await import("@tauri-apps/plugin-dialog");
                try {
                    const { getVersion, getName } = await import("@tauri-apps/api/app");
                    await message(`${await getName()}\nVersion: ${await getVersion()}`, {
                        title: "About",
                        kind: "info",
                    });
                } catch {
                    await message("BetterShape\nVersion: 0.2.0", { title: "About", kind: "info" });
                }
                break;
            }
            case "Onboarding":
            case "Welcome":
                break;
            default:
                console.warn(`[titlebar] Unhandled menu action: "${label}"`);
        }
    };
}
