import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchShortcutAction } from "@/lib/ui/shortcut-actions";
import { listenCustomEvent, listenWindowEvent } from "../helpers/events";

vi.mock("@/lib/backend/commands", () => ({
    commands: {
        setProjectPath: vi.fn(),
        newWindow: vi.fn(),
        closeAllFiles: vi.fn(),
        getProjectState: vi.fn(),
        readFile: vi.fn(),
        saveFile: vi.fn(),
        openFile: vi.fn(),
    },
}));

import { commands } from "@/lib/backend/commands";

describe("dispatchShortcutAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns false for unknown actions", () => {
        expect(dispatchShortcutAction("Unknown", "Ctrl+Q")).toBe(false);
    });

    it("dispatches save", () => {
        const save = listenWindowEvent("save-request");
        expect(dispatchShortcutAction("Save", "Ctrl+S")).toBe(true);
        expect(save.events).toHaveLength(1);
        save.off();
    });

    it("dispatches new text file", () => {
        const create = listenCustomEvent<{ type: string }>("bettershape-explorer-create");
        expect(dispatchShortcutAction("New Text File", "Ctrl+N")).toBe(true);
        expect(create.events[0]?.detail).toEqual({ type: "file" });
        create.off();
    });

    it("dispatches open file request", () => {
        const open = listenWindowEvent("open-file-request");
        expect(dispatchShortcutAction("Open File", "Ctrl+O")).toBe(true);
        expect(open.events).toHaveLength(1);
        open.off();
    });

    it("delegates close tab to rust", () => {
        expect(dispatchShortcutAction("Close Tab", "Ctrl+W")).toBe(false);
    });

    it("closes all tabs locally", () => {
        expect(dispatchShortcutAction("Close All Tabs", "Ctrl+K E")).toBe(true);
        expect(commands.closeAllFiles).toHaveBeenCalled();
    });

    it("handles open folder", () => {
        const open = listenWindowEvent("bettershape-open-project-pick");
        expect(dispatchShortcutAction("Open Folder", "Ctrl+K Ctrl+O")).toBe(true);
        expect(open.events).toHaveLength(1);
        open.off();
    });

    it("dispatches recent files palette", () => {
        const palette = listenCustomEvent<{ mode?: string; recent?: boolean }>("bettershape-command-palette");
        expect(dispatchShortcutAction("Recent Files", "Ctrl+E")).toBe(true);
        expect(palette.events[0]?.detail).toEqual({
            mode: "files",
            recent: true,
            placeholder: "Recent files...",
        });
        palette.off();
    });

    it("dispatches zen mode only for zen mode", () => {
        const zen = listenWindowEvent("bettershape-toggle-zen-mode");
        expect(dispatchShortcutAction("Zen Mode", "Ctrl+K Z")).toBe(true);
        expect(zen.events).toHaveLength(1);
        zen.off();
    });

    it("dispatches save all", () => {
        const saveAll = listenWindowEvent("save-all-request");
        expect(dispatchShortcutAction("Save All", "Ctrl+K S")).toBe(true);
        expect(saveAll.events).toHaveLength(1);
        saveAll.off();
    });

    it("dispatches explorer", () => {
        const tab = listenCustomEvent("bettershape-set-active-tab");
        expect(dispatchShortcutAction("Explorer", "Ctrl+Shift+E")).toBe(true);
        expect(tab.events[0]?.detail).toBe("files");
        tab.off();
    });

    it("dispatches search, find in files and replace in files to the search tab", () => {
        // These three used to open the generic file palette, which is why the project-wide
        // search panel had no reachable entry point despite both keybindings existing.
        const tab = listenCustomEvent("bettershape-set-panel-tab");
        const layout = listenCustomEvent("bettershape-layout-toggle");
        const focus = listenCustomEvent("bettershape-focus-search-field");

        expect(dispatchShortcutAction("Search", "Ctrl+Shift+F")).toBe(true);
        expect(dispatchShortcutAction("Find in Files", "Ctrl+Shift+F")).toBe(true);
        expect(dispatchShortcutAction("Replace in Files", "Ctrl+H")).toBe(true);

        expect(tab.events.map((e) => e.detail)).toEqual(["search", "search", "search"]);
        expect(layout.events).toHaveLength(3);
        expect(layout.events[0]?.detail).toMatchObject({ id: "panel", value: true });
        expect(focus.events.map((e) => e.detail)).toEqual(["search", "search", "replace"]);

        tab.off();
        layout.off();
        focus.off();
    });

    it("dispatches source control", () => {
        const tab = listenCustomEvent("bettershape-set-active-tab");
        expect(dispatchShortcutAction("Source Control", "Ctrl+Shift+G")).toBe(true);
        expect(tab.events[0]?.detail).toBe("source");
        tab.off();
    });

    it("opens problems panel", () => {
        const layout = listenCustomEvent("bettershape-layout-toggle");
        const panel = listenCustomEvent("bettershape-set-panel-tab");
        expect(dispatchShortcutAction("Problems", "Ctrl+Shift+M")).toBe(true);
        expect(layout.events[0]?.detail).toMatchObject({ id: "panel", value: true });
        expect(panel.events[0]?.detail).toBe("problems");
        layout.off();
        panel.off();
    });

    it("routes split commands to the editor split event", () => {
        const split = listenCustomEvent("bettershape-editor-split");
        expect(dispatchShortcutAction("Split Editor Right", "Ctrl+\\")).toBe(true);
        expect(split.events[0]?.detail).toMatchObject({ action: "right" });
        expect(dispatchShortcutAction("Close Split", "Ctrl+W Ctrl+W")).toBe(true);
        expect(split.events[1]?.detail).toMatchObject({ action: "close" });
        split.off();
    });

    it("dispatches command palette variants", () => {
        const palette = listenCustomEvent("bettershape-command-palette");
        expect(dispatchShortcutAction("Command Palette", "Ctrl+Shift+P")).toBe(true);
        expect(dispatchShortcutAction("Command Palette...", "Ctrl+Shift+P")).toBe(true);
        expect(palette.events.length).toBe(2);
        palette.off();
    });

    it("dispatches go to file palette", () => {
        const palette = listenCustomEvent<{ mode?: string }>("bettershape-command-palette");
        expect(dispatchShortcutAction("Go to File...", "Ctrl+P")).toBe(true);
        expect(palette.events[0]?.detail).toEqual({ mode: "files" });
        palette.off();
    });

    it("dispatches go to line palette", () => {
        const palette = listenCustomEvent<{ mode?: string }>("bettershape-command-palette");
        expect(dispatchShortcutAction("Go to Line/Column...", "Ctrl+G")).toBe(true);
        expect(palette.events[0]?.detail?.mode).toBe("goto_line");
        palette.off();
    });

    it("dispatches editor undo", () => {
        const editor = listenCustomEvent<{ action: string }>("bettershape-editor-action");
        expect(dispatchShortcutAction("Undo", "Ctrl+Z")).toBe(true);
        expect(editor.events[0]?.detail).toEqual({ action: "undo" });
        editor.off();
    });

    it("dispatches format document", () => {
        const editor = listenCustomEvent<{ action: string }>("bettershape-editor-action");
        expect(dispatchShortcutAction("Format Document", "Alt+Shift+F")).toBe(true);
        expect(editor.events[0]?.detail).toEqual({ action: "format" });
        editor.off();
    });

    it("calls close folder command", () => {
        expect(dispatchShortcutAction("Close Folder", "Ctrl+K F")).toBe(true);
        expect(commands.setProjectPath).toHaveBeenCalledWith(null);
    });

    it("calls new window command", () => {
        expect(dispatchShortcutAction("New Window", "Ctrl+Shift+N")).toBe(true);
        expect(commands.newWindow).toHaveBeenCalled();
    });

    it("dispatches terminal shortcuts", () => {
        const terminal = listenCustomEvent<{ action: string }>("bettershape-terminal-shortcut");
        expect(dispatchShortcutAction("Terminal", "Ctrl+`")).toBe(true);
        expect(dispatchShortcutAction("New Terminal", "Ctrl+Shift+`")).toBe(true);
        expect(terminal.events[0]?.detail).toEqual({ action: "open" });
        expect(terminal.events[1]?.detail).toEqual({ action: "new" });
        terminal.off();
    });
});
