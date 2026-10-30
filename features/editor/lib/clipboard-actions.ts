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
    const selection = view.state.selection.main;

    if (action === "paste") {
        if (!clipboard?.readText) return;
        void clipboard
            .readText()
            .then((text) => {
                if (text) view.dispatch(view.state.replaceSelection(text));
            })
            .catch(() => undefined);
        return;
    }

    if (selection.empty) return;
    const text = view.state.sliceDoc(selection.from, selection.to);
    if (!text) return;
    if (clipboard?.writeText) void clipboard.writeText(text).catch(() => undefined);
    if (action === "cut") {
        view.dispatch({ changes: { from: selection.from, to: selection.to, insert: "" } });
    }
}
