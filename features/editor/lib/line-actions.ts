import type { ChangeSpec, EditorState, SelectionRange } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";

/**
 * Line/selection transforms that the command palette offers under
 * `editor.action.*` but that `@codemirror/commands` does not ship. Each one
 * builds its changes up front and dispatches them in a single transaction, so
 * a multi-cursor selection is transformed atomically and the selection maps
 * correctly instead of being re-read mid-loop.
 */

export type CaseMode = "lower" | "upper" | "title";

/**
 * Line numbers covered by a selection range.
 *
 * A range that ends at the very end of the document resolves to a phantom
 * trailing empty line (`lineAt(doc.length)`). Including it would consume the
 * final newline and drag an empty line into the sort or join, so step back one
 * line when that is all the range added.
 */
function selectedLineRange(state: EditorState, range: SelectionRange): [number, number] | null {
    const first = state.doc.lineAt(range.from);
    let lastNumber = state.doc.lineAt(range.to).number;
    if (lastNumber > first.number && state.doc.line(lastNumber).length === 0) {
        lastNumber -= 1;
    }
    if (lastNumber === first.number) return null;
    return [first.number, lastNumber];
}

function toCase(text: string, mode: CaseMode): string {
    switch (mode) {
        case "lower":
            return text.toLowerCase();
        case "upper":
            return text.toUpperCase();
        case "title":
            return text.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    }
}

function applyChanges(view: EditorView, changes: ChangeSpec[], userEvent: string): boolean {
    if (changes.length === 0) return false;
    view.dispatch({ changes, userEvent });
    return true;
}

/** Pure helper so the transform can be unit-tested without an EditorView. */
export function applyCaseToText(text: string, mode: CaseMode): string {
    return toCase(text, mode);
}

/** VS Code's Transform to Lowercase / Uppercase / Title Case. */
export const transformSelectionCase =
    (mode: CaseMode): Command =>
    (view) => {
        const changes: ChangeSpec[] = [];
        for (const range of view.state.selection.ranges) {
            if (range.empty) continue;
            const original = view.state.sliceDoc(range.from, range.to);
            const next = toCase(original, mode);
            if (next === original) continue;
            changes.push({ from: range.from, to: range.to, insert: next });
        }
        return applyChanges(view, changes, "input.italic");
    };

/** VS Code's Sort Lines Ascending / Descending over the selected lines. */
export const sortSelectionLines =
    (direction: "asc" | "desc"): Command =>
    (view) => {
        const changes: ChangeSpec[] = [];
        for (const range of view.state.selection.ranges) {
            const span = selectedLineRange(view.state, range);
            if (!span) continue;
            const [firstNumber, lastNumber] = span;
            const lines: string[] = [];
            for (let n = firstNumber; n <= lastNumber; n++) {
                lines.push(view.state.doc.line(n).text);
            }
            const sorted = [...lines].sort((a, b) =>
                direction === "asc" ? a.localeCompare(b) : b.localeCompare(a),
            );
            if (lines.every((line, i) => line === sorted[i])) continue;
            const first = view.state.doc.line(firstNumber);
            const last = view.state.doc.line(lastNumber);
            // `last.to` stops before the final line terminator, so joining with
            // "\n" reproduces the block without swallowing the trailing newline.
            changes.push({ from: first.from, to: last.to, insert: sorted.join("\n") });
        }
        return applyChanges(view, changes, "input.indent");
    };

/**
 * VS Code's Join Lines. Every selected line becomes one: each line is trimmed
 * and empty lines are dropped, then the survivors are joined with a single
 * space. The terminator after the last line is preserved because the change
 * stops at `last.to`.
 */
export const joinSelectedLines: Command = (view) => {
    const changes: ChangeSpec[] = [];
    for (const range of view.state.selection.ranges) {
        const span = selectedLineRange(view.state, range);
        if (!span) continue;
        const [firstNumber, lastNumber] = span;
        const parts: string[] = [];
        for (let n = firstNumber; n <= lastNumber; n++) {
            const text = view.state.doc.line(n).text.trim();
            if (parts.length === 0 || text) parts.push(text);
        }
        if (parts.length < 2) continue;
        const first = view.state.doc.line(firstNumber);
        const last = view.state.doc.line(lastNumber);
        changes.push({ from: first.from, to: last.to, insert: parts.join(" ") });
    }
    return applyChanges(view, changes, "input.indent");
};