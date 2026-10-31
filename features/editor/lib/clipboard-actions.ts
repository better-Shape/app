import type { EditorView } from "@codemirror/view";

export type ClipboardAction = "cut" | "copy" | "paste";

/**
 * Edit -> Cut / Copy / Paste from the menubar and the command palette.
 *
 * The keyboard shortcuts are handled by the browser inside the content element,
 * so they never reach the editor action bus. A menu click has no such native
 * path, and the dispatches used to fall through the switch untouched. Doing the
 * edit through a normal transaction keeps it in the undo history, which
 * `document.execCommand` in a webview cannot promise.
 */
export function runClipboardAction(view: EditorView, action: ClipboardAction): void {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    // The buffer as it was when the action started. The clipboard is
    // asynchronous, so every offset below belongs to this document and stops
    // being usable the moment the user edits.
    const doc = view.state.doc;
    const ranges = view.state.selection.ranges;

    if (action === "paste") {
        if (!clipboard?.readText) return;
        void clipboard
            .readText()
            .then((text) => {
                if (!text || view.state.doc !== doc) return;
                view.dispatch(view.state.replaceSelection(text));
            })
            .catch(() => undefined);
        return;
    }

    // Every range, not only the main one: a multi-cursor selection copies and
    // cuts what the keyboard would, one line per range.
    const selected = ranges.map((range) => view.state.sliceDoc(range.from, range.to));
    const text = selected.filter(Boolean).join("\n");
    if (!text || !clipboard?.writeText) return;
    if (action === "copy") {
        void clipboard.writeText(text).catch(() => undefined);
        return;
    }
    // Cut removes the text only once the clipboard accepted it: a denied write
    // used to take the selection with it. A buffer that moved in the meantime
    // keeps its text rather than losing whatever now sits at those offsets.
    void clipboard
        .writeText(text)
        .then(() => {
            if (view.state.doc !== doc) return;
            view.dispatch({
                changes: ranges
                    .filter((range) => !range.empty)
                    .map((range) => ({ from: range.from, to: range.to, insert: "" })),
            });
        })
        .catch(() => undefined);
}
