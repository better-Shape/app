import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
    applyCaseToText,
    joinSelectedLines,
    sortSelectionLines,
    transformSelectionCase,
} from "@/features/editor/lib/line-actions";

/**
 * The commands only touch `view.state` and `view.dispatch`, so a real
 * `EditorState` plus a recording stub exercises the actual logic without
 * needing a DOM (CodeMirror's view requires layout APIs jsdom does not
 * fully implement).
 */
function makeView(doc: string, from: number, to: number) {
    let state = EditorState.create({ doc, selection: { anchor: from, head: to } });
    const dispatched: ReturnType<typeof state.update>[] = [];
    const view = {
        get state() {
            return state;
        },
        dispatch(spec: Parameters<typeof state.update>[0]) {
            const tr = state.update(spec as never);
            state = tr.state;
            dispatched.push(tr);
        },
    } as unknown as EditorView;
    return { view, dispatched };
}

const text = (v: EditorView) => v.state.doc.toString();

describe("editor line actions", () => {
    describe("case transforms", () => {
        it("lowercases, uppercases and title-cases", () => {
            expect(applyCaseToText("helloWorld", "lower")).toBe("helloworld");
            expect(applyCaseToText("helloWorld", "upper")).toBe("HELLOWORLD");
            expect(applyCaseToText("hello wide world", "title")).toBe("Hello Wide World");
        });

        it("applies to the selected range only", () => {
            const doc = "const A = 1;\nconst b = 2;\n";
            const { view, dispatched } = makeView(doc, doc.indexOf("b"), doc.indexOf("b") + 1);
            expect(transformSelectionCase("upper")(view)).toBe(true);
            expect(text(view)).toBe("const A = 1;\nconst B = 2;\n");
            expect(dispatched).toHaveLength(1);
        });

        it("reports false for an empty cursor selection", () => {
            const { view, dispatched } = makeView("abc", 1, 1);
            expect(transformSelectionCase("upper")(view)).toBe(false);
            expect(dispatched).toHaveLength(0);
        });

        it("reports false when the text is already in that case", () => {
            const { view, dispatched } = makeView("ABC", 0, 3);
            expect(transformSelectionCase("upper")(view)).toBe(false);
            expect(dispatched).toHaveLength(0);
        });
    });

    describe("sort lines", () => {
        it("sorts ascending", () => {
            const doc = "banana\napple\ncherry\n";
            const { view } = makeView(doc, 0, doc.length);
            expect(sortSelectionLines("asc")(view)).toBe(true);
            expect(text(view)).toBe("apple\nbanana\ncherry\n");
        });

        it("sorts descending", () => {
            const doc = "apple\ncherry\nbanana\n";
            const { view } = makeView(doc, 0, doc.length);
            expect(sortSelectionLines("desc")(view)).toBe(true);
            expect(text(view)).toBe("cherry\nbanana\napple\n");
        });

        it("leaves the trailing newline in place", () => {
            const doc = "b\na\n";
            const { view } = makeView(doc, 0, doc.length);
            sortSelectionLines("asc")(view);
            expect(text(view)).toBe("a\nb\n");
        });

        it("does not drag in the phantom line at end of document", () => {
            // A selection ending at doc.length resolves to a trailing empty
            // line. Including it would consume the final newline.
            const doc = "b\na\n";
            const { view } = makeView(doc, 0, doc.length);
            expect(sortSelectionLines("asc")(view)).toBe(true);
            expect(text(view).endsWith("\n")).toBe(true);
        });

        it("does nothing for a single line", () => {
            const { view, dispatched } = makeView("only\n", 0, 4);
            expect(sortSelectionLines("asc")(view)).toBe(false);
            expect(dispatched).toHaveLength(0);
        });
    });

    describe("join lines", () => {
        it("joins the selected lines into one", () => {
            const doc = "  alpha  \n  beta  \n  gamma\n";
            const { view } = makeView(doc, 0, doc.length);
            expect(joinSelectedLines(view)).toBe(true);
            expect(text(view)).toBe("alpha beta gamma\n");
        });

        it("drops empty lines while joining", () => {
            const doc = "a\n\n\nb\n";
            const { view } = makeView(doc, 0, doc.length);
            expect(joinSelectedLines(view)).toBe(true);
            expect(text(view)).toBe("a b\n");
        });

        it("does nothing when only one line is selected", () => {
            const { view, dispatched } = makeView("a\nb\n", 0, 1);
            expect(joinSelectedLines(view)).toBe(false);
            expect(dispatched).toHaveLength(0);
        });
    });
});