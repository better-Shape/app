import { describe, expect, it } from "vitest";
import { loadKeybindings } from "@/lib/ui/shortcuts";

describe("keybinding chords", () => {
    // A chord is a bare prefix (Ctrl+K) followed by a key (Ctrl+K S). The
    // dispatcher resolves the longest matching prefix, so what matters is
    // that the longer chords are registered and that no bare prefix shadows
    // them.
    it("registers Ctrl+K chords to their commands", () => {
        const bindings = loadKeybindings();
        expect(bindings.find((b) => b.key === "Ctrl+K S")?.label).toBe("Save All");
        expect(bindings.find((b) => b.key === "Ctrl+K Ctrl+O")?.label).toBe("Open Folder");
    });

    it("leaves Ctrl+K as a bare chord root", () => {
        // Inline Edit used to own the bare Ctrl+K, which made it ambiguous
        // with every Ctrl+K <key> chord. It was removed because the editor has
        // no handler for it, so the prefix is now unambiguous.
        const bindings = loadKeybindings();
        expect(bindings.some((b) => b.key === "Ctrl+K")).toBe(false);
        expect(bindings.filter((b) => b.key.startsWith("Ctrl+K ")).length).toBeGreaterThan(1);
    });

    it("assigns every command a unique chord", () => {
        const chords = loadKeybindings()
            .map((b) => b.key)
            .filter((key) => key !== "");
        expect(new Set(chords).size).toBe(chords.length);
    });
});