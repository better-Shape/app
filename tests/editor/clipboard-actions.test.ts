import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { runClipboardAction } from "@/features/editor/lib/clipboard-actions";

function mountView(doc: string, from?: number, to?: number): EditorView {
    const state = EditorState.create({
        doc,
        selection: from === undefined ? undefined : EditorSelection.single(from, to ?? from),
    });
    return new EditorView({ state });
}

describe("clipboard actions", () => {
    let writeText: ReturnType<typeof vi.fn>;
    let readText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        writeText = vi.fn().mockResolvedValue(undefined);
        readText = vi.fn().mockResolvedValue("pasted");
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText, readText },
            configurable: true,
        });
    });

    afterEach(() => {
        delete (navigator as { clipboard?: unknown }).clipboard;
    });

    it("copies the selection without touching the document", () => {
        const view = mountView("hello world", 0, 5);

        runClipboardAction(view, "copy");

        expect(writeText).toHaveBeenCalledWith("hello");
        expect(view.state.doc.toString()).toBe("hello world");
        view.destroy();
    });

    it("cuts the selection once the clipboard accepted it", async () => {
        const view = mountView("hello world", 0, 6);

        runClipboardAction(view, "cut");

        expect(writeText).toHaveBeenCalledWith("hello ");
        await vi.waitFor(() => expect(view.state.doc.toString()).toBe("world"));
        view.destroy();
    });

    it("keeps the text when the clipboard refuses the write", async () => {
        writeText.mockRejectedValueOnce(new Error("denied"));
        const view = mountView("hello world", 0, 6);

        runClipboardAction(view, "cut");
        await Promise.resolve();
        await Promise.resolve();

        expect(view.state.doc.toString()).toBe("hello world");
        view.destroy();
    });

    it("does nothing without a clipboard at all", () => {
        delete (navigator as { clipboard?: unknown }).clipboard;
        const view = mountView("hello world", 0, 6);

        runClipboardAction(view, "cut");
        runClipboardAction(view, "copy");

        expect(writeText).not.toHaveBeenCalled();
        expect(view.state.doc.toString()).toBe("hello world");
        view.destroy();
    });

    it("does nothing when the selection is empty", () => {
        const view = mountView("hello", 2, 2);

        runClipboardAction(view, "copy");
        runClipboardAction(view, "cut");

        expect(writeText).not.toHaveBeenCalled();
        expect(view.state.doc.toString()).toBe("hello");
        view.destroy();
    });

    it("pastes the clipboard at the selection once it resolves", async () => {
        const view = mountView("hello", 5, 5);

        runClipboardAction(view, "paste");
        await vi.waitFor(() => expect(view.state.doc.toString()).toBe("hellopasted"));
        view.destroy();
    });

    it("swallows a clipboard the platform refuses to read", async () => {
        readText.mockRejectedValueOnce(new Error("denied"));
        const view = mountView("hello", 0, 0);

        runClipboardAction(view, "paste");
        await Promise.resolve();

        expect(view.state.doc.toString()).toBe("hello");
        view.destroy();
    });
});
