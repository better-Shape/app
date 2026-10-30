import { describe, expect, it } from "vitest";
import { getAppCommands } from "@/features/command-palette/cmd-palette";
import { editorActionImplemented } from "@/lib/editor/action-contract";

/**
 * The palette and the CodeMirror handler are two halves of one contract with
 * nothing else tying them together: a row that dispatches an unhandled action
 * closes the palette and does nothing.
 */
describe("command palette editor commands", () => {
    const commands = getAppCommands();

    it("only offers editor actions the handler answers", () => {
        const dead = commands
            .filter((command) => command.editorAction && !editorActionImplemented(command.editorAction))
            .map((command) => `${command.id} -> ${command.editorAction}`);
        expect(dead).toEqual([]);
    });

    it("keeps the fold commands the menubar spelling used to miss", () => {
        const labels = commands.map((command) => command.label);
        expect(labels).toContain("Fold All Regions");
        expect(labels).toContain("Unfold All Regions");
    });

    it("does not claim the language-server commands", () => {
        const labels = commands.map((command) => command.label);
        expect(labels).not.toContain("Rename Symbol");
        expect(labels).not.toContain("Go to Definition");
        expect(labels).not.toContain("Quick Fix…");
        expect(labels).not.toContain("Editor: Toggle Inlay Hints");
    });

    it("uses unique ids", () => {
        const ids = commands.map((command) => command.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
