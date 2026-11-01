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
        claimEditorSurface(right, "preview");
        // The other viewer switching file or mode must not undo this one.
        releaseEditorSurface(left);
        expect(getActiveEditorSurface()).toBe("preview");
    });

    it("releases a claim its owner made", () => {
        claimEditorSurface(right, "preview");
        releaseEditorSurface(right);
        expect(getActiveEditorSurface()).toBeNull();
    });

    it("follows the pane that took focus last", () => {
        claimEditorSurface(left, "codemirror");
        claimEditorSurface(right, "preview");
        expect(getActiveEditorSurface()).toBe("preview");
        claimEditorSurface(left, "codemirror");
        expect(getActiveEditorSurface()).toBe("codemirror");
    });

    it("hands out distinct owners", () => {
        expect(left).not.toBe(right);
    });
});
