import { describe, expect, it } from "vitest";
import { countBoundShortcuts, groupShortcuts } from "@/features/shortcuts/lib/group-shortcuts";
import type { KeyBinding } from "@/lib/ui/shortcuts";

function binding(label: string, key: string, category = "View"): KeyBinding {
    return { id: label.toLowerCase(), label, key, when: "global", category, source: "default" };
}

describe("shortcut cheatsheet grouping", () => {
    const bindings = [
        binding("Save All", "Ctrl+K S", "File"),
        binding("Split Terminal", "", "Terminal"),
        binding("Terminal", "Ctrl+`", "View"),
        binding("Keyboard Shortcuts", "Ctrl+K Ctrl+S", "View"),
    ];

    it("groups by category and sorts both levels", () => {
        const groups = groupShortcuts(bindings, "");
        expect(groups.map((group) => group.category)).toEqual(["File", "Terminal", "View"]);
        expect(groups[2]!.list.map((entry) => entry.label)).toEqual(["Keyboard Shortcuts", "Terminal"]);
    });

    it("keeps unassigned commands visible when the query is empty", () => {
        const groups = groupShortcuts(bindings, "");
        const terminal = groups.find((group) => group.category === "Terminal");
        expect(terminal?.list[0]?.label).toBe("Split Terminal");
        expect(countBoundShortcuts(bindings)).toBe(3);
    });

    it("filters case-insensitively by label, chord and category", () => {
        expect(groupShortcuts(bindings, "SAVE")[0]!.list.map((entry) => entry.label)).toEqual(["Save All"]);
        expect(groupShortcuts(bindings, "ctrl+`")[0]!.list.map((entry) => entry.label)).toEqual(["Terminal"]);
        // Matches the Terminal category and the View "Terminal" command.
        expect(groupShortcuts(bindings, "terminal").map((group) => group.category)).toEqual([
            "Terminal",
            "View",
        ]);
    });

    it("returns no groups for an unmatched query", () => {
        expect(groupShortcuts(bindings, "does-not-exist")).toEqual([]);
    });

    it("ships a Keyboard Shortcuts binding for the cheatsheet itself", async () => {
        const { loadKeybindings } = await import("@/lib/ui/shortcuts");
        const sheet = loadKeybindings().find((entry) => entry.label === "Keyboard Shortcuts");
        expect(sheet?.key).toBe("Ctrl+K Ctrl+S");
        expect(sheet?.category).toBe("View");
    });
});
