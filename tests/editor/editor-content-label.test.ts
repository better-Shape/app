import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { editorContentLabel } from "@/features/editor/ui/codemirror/theme";
import { DiffView } from "@/features/editor/ui/diff/diff-view";

const mount = (getPath: () => string | undefined, role?: string) =>
    new EditorView({ state: EditorState.create({ extensions: [editorContentLabel(getPath, role)] }) });

describe("editor text surface accessible name", () => {
    it("names the surface after the edited file for POSIX and Windows paths", () => {
        for (const [path, expected] of [
            ["/preview/bettershape-demo/README.md", "README.md editor"],
            ["C:\\work\\src\\App.tsx", "App.tsx editor"],
        ] as const) {
            const view = mount(() => path);
            expect(view.contentDOM.getAttribute("aria-label")).toBe(expected);
            // The scroller's focusable content, stated explicitly for assistive technology.
            expect(view.contentDOM.getAttribute("tabindex")).toBe("0");
            view.destroy();
        }
    });

    it("falls back to a generic name and follows the path on the next update", () => {
        const open: { path?: string } = {};
        const view = mount(() => open.path, "diff");
        expect(view.contentDOM.getAttribute("aria-label")).toBe("Text diff");
        open.path = "/repo/lib/selection.ts";
        view.dispatch({ changes: { from: 0, insert: "x" } });
        expect(view.contentDOM.getAttribute("aria-label")).toBe("selection.ts diff");
        view.destroy();
    });
});

describe("diff view surface names", () => {
    const labelsFor = (mode: "split" | "unified") => {
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        act(() =>
            root.render(
                createElement(DiffView, {
                    path: "/repo/src/App.tsx",
                    originalContent: "const a = 1;\n",
                    content: "const a = 2;\n",
                    mode,
                }),
            ),
        );
        const labels = [...host.querySelectorAll(".cm-content")].map((el) => el.getAttribute("aria-label"));
        act(() => root.unmount());
        host.remove();
        return labels;
    };

    it("tells the two sides of a split diff apart and names the unified view a diff", () => {
        expect(labelsFor("split")).toEqual(["App.tsx original", "App.tsx modified"]);
        expect(labelsFor("unified")).toEqual(["App.tsx diff"]);
    });
});
