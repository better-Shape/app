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

// Hunk staging (tests/features/hunk-commands.test.tsx) and the save settings
// (tests/editor/save-formatting-settings.test.ts) both have behavioural tests:
// asserting a command exists or a source mentions a key proves nothing about
// whether the hunk or the setting is actually applied.
