import { matchBrackets } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/**
 * `Go to Bracket` for the Edit menu and the command palette.
 *
 * CodeMirror ships `matchBrackets`, but no command wrapping it, so the action
 * was dispatched and silently did nothing. It is kept here rather than inline
 * in the editor because the cursor-position rules are the interesting part and
 * they are testable against a plain `EditorState` without a DOM.
 */

const BRACKET = /^[([{)\]}]$/;

const OPENING: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

function isOpening(ch: string): boolean {
    return ch in OPENING;
}

/**
 * Where `matchBrackets` expects the cursor for a bracket token at `pos`.
 *
 * Scanning forward it reads the character *at* `pos`; scanning backward it
 * reads the one *before* `pos`. So an opening bracket is passed as-is and a
 * closing bracket is passed as the offset just past it.
 */
function matchOffset(ch: string): { pos: number; dir: 1 | -1 } | null {
    return isOpening(ch) ? { pos: 0, dir: 1 } : { pos: 1, dir: -1 };
}

/**
 * Document offset of the bracket matching the one at or just before `head`,
 * or `null` when the cursor is not on a navigable bracket.
 *
 * The character *before* the cursor is tried first: that is where the cursor
 * sits after typing an opening bracket, which is the common case. Falling back
 * to the character under the cursor covers a selection made by dragging right
 * to left.
 */
export function gotoBracket(state: EditorState, head: number): number | null {
    const doc = state.doc;
    for (const at of [head - 1, head]) {
        if (at < 0 || at >= doc.length) continue;
        const ch = doc.sliceString(at, at + 1);
        if (!BRACKET.test(ch)) continue;
        const offset = matchOffset(ch);
        if (!offset) continue;
        const result = matchBrackets(state, at + offset.pos, offset.dir);
        // `matched` is false when a bracket of the same nesting was found but
        // it is the wrong partner; moving there would be worse than doing
        // nothing, and a false positive here reads as a random jump.
        if (result?.matched && result.end) return result.end.from;
    }
    return null;
}