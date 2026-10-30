import { beforeEach, describe, expect, it } from "vitest";

import { dispatchShortcutAction } from "@/lib/ui/shortcut-actions";
import { iconFor, type TabKind } from "@/features/agent/workspace/model";
import { workbenchTabItemClass } from "@/features/editor/ui/tabs/workbench-tab-styles";

const MOUNTED_KINDS: TabKind[] = ["all-changes", "design", "agents"];

describe("workspace tab mounts", () => {
    it("gives every newly mounted surface a glyph", () => {
        for (const kind of MOUNTED_KINDS) {
            expect(iconFor(kind)).toBeDefined();
        }
    });

    it("keeps compact tabs narrower than the default tab", () => {
        const normal = workbenchTabItemClass(false, false);
        const compact = workbenchTabItemClass(false, false, true);
        expect(normal).toContain("px-2.5");
        expect(compact).toContain("px-1.5");
        expect(compact).not.toBe(normal);
    });
});

describe("design mode shortcut", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
    });

    it("opens the design workspace tab instead of the file tree", () => {
        const events: CustomEvent[] = [];
        const record = (event: Event) => events.push(event as CustomEvent);
        window.addEventListener("bettershape-set-active-tab", record);
        expect(dispatchShortcutAction("Toggle Design Mode", "Ctrl+Shift+D")).toBe(true);
        window.removeEventListener("bettershape-set-active-tab", record);
        expect(events.map((event) => event.detail)).toContain("design");
        expect(events.map((event) => event.detail)).not.toContain("files");
    });
});

describe("hunk staging wiring", () => {
    it("exposes the hunk commands the diff pane calls", async () => {
        const { commands } = await import("@/lib/backend/commands");
        expect(typeof commands.gitListHunks).toBe("function");
        expect(typeof commands.gitStageHunk).toBe("function");
        expect(typeof commands.gitUnstageHunk).toBe("function");
        expect(typeof commands.gitRestoreHunk).toBe("function");
    });
});

describe("settings readers", () => {
    it("keeps the save settings out of the unread list", async () => {
        const source = await import("node:fs").then((fs) =>
            fs.readFileSync("lib/editor/save-pipeline.ts", "utf8"),
        );
        expect(source).toContain("formatOnSave");
        expect(source).toContain("trimTrailingWhitespace");
        expect(source).toContain("insertFinalNewline");
    });
});
