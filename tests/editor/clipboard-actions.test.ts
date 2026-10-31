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

function mountMultiCursorView(doc: string, ranges: Array<[number, number]>): EditorView {
    const state = EditorState.create({
        doc,
        selection: EditorSelection.create(ranges.map(([from, to]) => EditorSelection.range(from, to))),
        // CodeMirror keeps one range unless the facet allows more.
        extensions: [EditorState.allowMultipleSelections.of(true)],
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

    it("copies every range of a multi-cursor selection", () => {
        const view = mountMultiCursorView("one two three", [[0, 3], [8, 13]]);

        runClipboardAction(view, "copy");

        expect(writeText).toHaveBeenCalledWith("one\nthree");
        expect(view.state.doc.toString()).toBe("one two three");
        view.destroy();
    });

    it("cuts every range of a multi-cursor selection", async () => {
        const view = mountMultiCursorView("one two three", [[0, 3], [7, 13]]);

        runClipboardAction(view, "cut");

        await vi.waitFor(() => expect(view.state.doc.toString()).toBe(" two"));
        view.destroy();
    });

    // The write is asynchronous: a keystroke in between must not make the cut
    // delete whatever has since moved into those offsets.
    it("leaves a buffer that changed while the cut was being written", async () => {
        let resolveWrite: () => void = () => undefined;
        writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveWrite = resolve; }));
        const view = mountView("hello world", 0, 6);

        runClipboardAction(view, "cut");
        view.dispatch({ changes: { from: 0, insert: "X" } });
        resolveWrite();
        await Promise.resolve();
        await Promise.resolve();

        expect(view.state.doc.toString()).toBe("Xhello world");
        view.destroy();
    });

    it("drops a paste whose target moved while the clipboard was read", async () => {
        let resolveRead: (text: string) => void = () => undefined;
        readText.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveRead = resolve; }));
        const view = mountView("hello", 5, 5);

        runClipboardAction(view, "paste");
        view.dispatch({ changes: { from: 0, insert: "X" } });
        resolveRead("pasted");
        await Promise.resolve();
        await Promise.resolve();

        expect(view.state.doc.toString()).toBe("Xhello");
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
