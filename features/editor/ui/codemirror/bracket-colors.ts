"use client";

import { RangeSetBuilder, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";

const OPENERS = "([{";
const CLOSERS = ")]}";
/** Three steps, cycled by nesting level. Kept in step with the CSS classes below. */
const DEPTH_STEPS = 3;
/**
 * The depth pass reads the whole document, so it is skipped on files where the
 * per-keystroke cost would be felt. Such a file keeps its plain bracket colour.
 */
const MAX_INDEXED_CHARS = 200_000;
/** Brackets inside these syntax nodes are text, not structure. */
const OPAQUE_NODE = /string|comment|regexp|template/i;

export type BracketMark = { pos: number; depth: number };

/**
 * Depth of every bracket in `text`.
 *
 * A closing bracket takes the depth of the bracket it closes, so an opening and
 * its partner share a colour. Unmatched closers clamp at zero instead of
 * going negative.
 */
export function bracketMarks(text: string): BracketMark[] {
    const marks: BracketMark[] = [];
    let depth = 0;
    for (let pos = 0; pos < text.length; pos += 1) {
        const char = text[pos];
        if (OPENERS.includes(char)) {
            marks.push({ pos, depth });
            depth += 1;
        } else if (CLOSERS.includes(char)) {
            depth = Math.max(0, depth - 1);
            marks.push({ pos, depth });
        }
    }
    return marks;
}

function marksFor(text: string): BracketMark[] {
    return text.length > MAX_INDEXED_CHARS ? [] : bracketMarks(text);
}

/** Rebuilt only when the document changes, so scrolling never rescans the text. */
const bracketIndex = StateField.define<BracketMark[]>({
    create: (state) => marksFor(state.doc.toString()),
    update: (value, tr) => (tr.docChanged ? marksFor(tr.state.doc.toString()) : value),
});

// Level 0 keeps the syntax highlight's own colour: colouring it would restyle
// every bracket in the file for a feature about telling levels apart.
const decorationsFor = [null, ...Array.from({ length: DEPTH_STEPS - 1 }, (_, step) =>
    Decoration.mark({ class: `cm-bracket-depth-${step + 1}` }),
)];

function decorate(view: EditorView): DecorationSet {
    const marks = view.state.field(bracketIndex);
    if (marks.length === 0) return Decoration.none;
    const ranges = view.visibleRanges;
    if (ranges.length === 0) return Decoration.none;
    const builder = new RangeSetBuilder<Decoration>();
    let rangeIndex = 0;
    for (const mark of marks) {
        while (rangeIndex < ranges.length && ranges[rangeIndex].to <= mark.pos) rangeIndex += 1;
        if (rangeIndex >= ranges.length) break;
        if (mark.pos < ranges[rangeIndex].from) continue;
        const node = syntaxTree(view.state).resolveInner(mark.pos, 1);
        if (OPAQUE_NODE.test(node.name)) continue;
        const decoration = decorationsFor[mark.depth % DEPTH_STEPS];
        if (!decoration) continue;
        builder.add(mark.pos, mark.pos + 1, decoration);
    }
    return builder.finish();
}

const bracketColorizer = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = decorate(view);
        }

        update(update: ViewUpdate) {
            if (
                update.docChanged ||
                update.viewportChanged ||
                update.startState.field(bracketIndex) !== update.state.field(bracketIndex)
            ) {
                this.decorations = decorate(update.view);
            }
        }
    },
    { decorations: (plugin) => plugin.decorations },
);

/** Colors brackets by nesting depth: Settings -> Editor -> Bracket colors. */
export function bracketColors(): import("@codemirror/state").Extension {
    return [bracketIndex, bracketColorizer];
}
