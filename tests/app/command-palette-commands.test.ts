import { describe, expect, it } from "vitest";
import { getAppCommands } from "@/features/command-palette/cmd-palette";
import { editorActionImplemented } from "@/lib/editor/action-contract";
import { claimEditorSurface, releaseEditorSurface } from "@/lib/editor/editor-surface";

const OWNER = "command-palette-test";

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

    it("drops file-editor commands while the document editor holds focus", () => {
        claimEditorSurface(OWNER, "preview");
        const inPreview = getAppCommands();
        const previewLabels = inPreview.map((command) => command.label);
        // The document editor answers neither, so offering them closes the
        // palette and does nothing.
        expect(previewLabels).not.toContain("Fold All Regions");
        expect(previewLabels).not.toContain("Format Document");
        expect(previewLabels).toContain("File: New Text File");
        claimEditorSurface(OWNER, "codemirror");
        const labels = getAppCommands().map((command) => command.label);
        expect(labels).toContain("Fold All Regions");
        expect(labels).toContain("Format Document");
        releaseEditorSurface(OWNER);
    });

    it("keeps Go to Line offerable where the document editor answers it", () => {
        // Enter in line mode dispatches `jumpToPosition`, so the row is gated on
        // that action and has to survive the document editor's filter.
        claimEditorSurface(OWNER, "preview");
        const previewLabels = getAppCommands().map((command) => command.label);
        releaseEditorSurface(OWNER);
        expect(previewLabels).toContain("Go to Line/Column...");
    });

    it("uses unique ids", () => {
        const ids = commands.map((command) => command.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
