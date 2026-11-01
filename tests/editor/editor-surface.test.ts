/**
 * Two panes can hold an editor at once, and only the one the user last touched
 * should decide which commands the palette offers. A claim carries its owner for
 * exactly that reason.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
    claimEditorSurface,
    createSurfaceOwner,
    getActiveEditorSurface,
    releaseEditorSurface,
} from "@/lib/editor/editor-surface";

describe("editor surface claims", () => {
    let left: string;
    let right: string;

    beforeEach(() => {
        left = createSurfaceOwner();
        right = createSurfaceOwner();
        releaseEditorSurface(left);
        releaseEditorSurface(right);
    });

    it("keeps another pane's claim when a different pane leaves", () => {
        claimEditorSurface(left, "codemirror");
        claimEditorSurface(right, "document");
        // The other viewer switching file or mode must not undo this one.
        releaseEditorSurface(left);
        expect(getActiveEditorSurface()).toBe("document");
    });

    it("releases a claim its owner made", () => {
        claimEditorSurface(right, "document");
        releaseEditorSurface(right);
        expect(getActiveEditorSurface()).toBeNull();
    });

    it("follows the pane that took focus last", () => {
        claimEditorSurface(left, "codemirror");
        claimEditorSurface(right, "document");
        expect(getActiveEditorSurface()).toBe("document");
        claimEditorSurface(left, "codemirror");
        expect(getActiveEditorSurface()).toBe("codemirror");
    });

    it("names the rendered preview separately from the document editor", () => {
        // The pane beside a split document editor answers no editor action, so a
        // claim of its own keeps the palette from offering one there.
        claimEditorSurface(right, "rendered");
        expect(getActiveEditorSurface()).toBe("rendered");
        releaseEditorSurface(right);
        expect(getActiveEditorSurface()).toBeNull();
    });

    it("hands out distinct owners", () => {
        expect(left).not.toBe(right);
    });
});
