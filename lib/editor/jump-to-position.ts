"use client";

import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Moves the caret to a 1-based line and column and centres it.
 *
 * Two editors answer jump requests: the code editor and the Markdown live
 * editor. The Markdown one ignored them, so choosing a symbol in the palette
 * over an open Markdown file left the caret where it was.
 */
export function jumpToPosition(view: EditorView, line: number, column = 1): void {
    const total = view.state.doc.lines;
    const target = Math.min(Math.max(Math.trunc(line) || 1, 1), total);
    const info = view.state.doc.line(target);
    const offset = Math.max(0, Math.trunc(column) - 1);
    const pos = Math.min(info.from + offset, info.to);
    // Focus first: focusing an unfocused editor moves the DOM selection to its
    // start, and a caret placed before that would be dragged back with it.
    view.focus();
    view.dispatch({
        selection: EditorSelection.cursor(pos),
        effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
}
