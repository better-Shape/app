import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { gotoBracket } from "@/features/editor/lib/bracket-actions";

/**
 * `gotoBracket` only reads `state.doc` and hands `state` to `matchBrackets`,
 * so a real `EditorState` exercises the real logic. The language extension is
 * deliberately omitted: `matchBrackets` falls back to a text scan when no
 * syntax node claims the position, which is the worst case this has to handle.
 */

/** `|` marks the cursor, so a test reads as a document plus a caret position
 * rather than a hand-counted offset that drifts when a character is added. */
function jump(marked: string): number | null {
    const head = marked.indexOf("|");
    if (head < 0 || marked.indexOf("|", head + 1) >= 0) {
        throw new Error(`expected exactly one | in ${JSON.stringify(marked)}`);
    }
    const doc = marked.slice(0, head) + marked.slice(head + 1);
    return gotoBracket(EditorState.create({ doc, selection: { anchor: head } }), head);
}

describe("gotoBracket", () => {
    it("jumps from just after an opening paren to its partner", () => {
        expect(jump("a(|b)c")).toBe(3);
    });

    it("jumps back from just after a closing paren", () => {
        expect(jump("a(b|)c")).toBe(1);
    });

    it("handles square and curly brackets", () => {
        expect(jump("x|[y]z")).toBe(3);
        expect(jump("x|{y}z")).toBe(3);
        expect(jump("x{y}|z")).toBe(1);
    });

    it("prefers the bracket before the cursor over the one under it", () => {
        // The `(` is the bracket that matters, not the `b` under the caret.
        expect(jump("a|(b)c")).toBe(3);
    });

    it("finds the partner of an inner bracket", () => {
        expect(jump("f(a[g(b|)h]i)j")).toBe(5);
    });

    it("finds the partner of the outer bracket past the inner one", () => {
        expect(jump("f|(a[g(b)h]i)j")).toBe(11);
    });

    it("stops at its own bracket, not a deeper one", () => {
        // The caret sits just inside `[`, so the partner is the matching `]`
        // rather than either paren further out.
        expect(jump("f(a|[g(b)h]i)j")).toBe(9);
    });

    it("round-trips between a bracket and its partner", () => {
        expect(jump("call(|alpha, beta)")).toBe(16);
        expect(jump("call(alpha, beta|)")).toBe(4);
    });

    it("returns null when the cursor is not on a bracket", () => {
        expect(jump("plain te|xt")).toBeNull();
    });

    it("returns null for an unmatched bracket rather than guessing", () => {
        expect(jump("a(|bc")).toBeNull();
        expect(jump("abc|)")).toBeNull();
    });

    it("does not match across a mismatched nesting level", () => {
        // The `]` at 3 sits at the same depth as the `(` at 1 but is not its
        // pair. `matchBrackets` returns that position with `matched: false`, so
        // this pins that the caller honours the flag instead of jumping the
        // cursor somewhere arbitrary.
        expect(jump("a(|b]c)")).toBeNull();
    });

    it("returns null rather than throwing for an out-of-range cursor", () => {
        const state = EditorState.create({ doc: "a(b)", selection: { anchor: 0 } });
        expect(gotoBracket(state, 0)).toBeNull();
        expect(gotoBracket(state, 9999)).toBeNull();
    });

    it("returns null for an empty document", () => {
        expect(jump("|")).toBeNull();
    });
});