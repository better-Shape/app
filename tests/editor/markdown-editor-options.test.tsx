import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { MarkdownLiveEditor } from "@/features/editor/ui/markdown/live-editor";
import { resetSettings, updateSettingSection } from "@/lib/settings";
import { claimEditorSurface, createSurfaceOwner, releaseEditorSurface } from "@/lib/editor/editor-surface";

vi.mock("@/lib/backend", () => ({
    commands: {
        gitBlameFile: vi.fn(async () => []),
        readFile: vi.fn(async () => ""),
        saveFile: vi.fn(async () => undefined),
    },
    getProjectPath: () => "/repo",
}));

const DOC = [
    "# Notes about spaces",
    "",
    "A line with several gaps between words.",
    "Nested call: outer(inner(value))",
    "This line ends in blanks   ",
    "",
].join("\n");

let host: HTMLDivElement;
let root: Root | undefined;
/** The pane that owns the surface claim in these tests. */
let pane: string;

beforeEach(() => {
    resetSettings();
    pane = createSurfaceOwner();
    // jsdom ships no 2D context and logs a "Not implemented" line for every
    // request. The minimap only needs the element to exist here.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    // jsdom has no layout, and CodeMirror measures ranges when it scrolls a
    // jumped-to position into view.
    if (!("getClientRects" in Range.prototype)) {
        Object.defineProperty(Range.prototype, "getClientRects", {
            configurable: true,
            value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
        });
    }
    if (!("getBoundingClientRect" in Range.prototype)) {
        Object.defineProperty(Range.prototype, "getBoundingClientRect", {
            configurable: true,
            value: () => new DOMRect(),
        });
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    releaseEditorSurface(pane);
    vi.restoreAllMocks();
    act(() => root?.unmount());
    host.remove();
    resetSettings();
});

async function mount() {
    await act(async () => {
        root?.render(
            <MarkdownLiveEditor content={DOC} onChange={() => undefined} path="/repo/notes.md" />,
        );
    });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(host.querySelector(".cm-editor"), "editor did not mount").not.toBeNull();
}

const whitespaceMarks = () => host.querySelectorAll(".cm-highlightSpace").length;
/** Brackets nested one level deep, which is the second colour step. */
const nestedBracketMarks = () => host.querySelectorAll(".cm-bracket-depth-1").length;

/** The view the editor is using now, which a re-render can replace. */
const currentView = () => {
    const content = host.querySelector(".cm-content");
    if (!(content instanceof HTMLElement)) throw new Error("editor content missing");
    const view = EditorView.findFromDOM(content);
    if (!view) throw new Error("editor view missing");
    return view;
};

describe("markdown editor jumps", () => {
    it("moves the caret when the palette asks for a line", async () => {
        await mount();
        await act(async () => {
            window.dispatchEvent(
                new CustomEvent("bettershape-editor-jump", {
                    detail: { path: "/repo/notes.md", line: 3, column: 1 },
                }),
            );
            // The listener is installed by the mount effect; give a slow runner
            // the settle it needs before reading the caret.
            await new Promise((resolve) => setTimeout(resolve, 100));
        });
        // Line 3 is "A line with several gaps..." in DOC; the caret must be there
        // rather than at the top where the document started.
        const view = currentView();
        expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(3);
    });

    it("answers Go to Line when the document editor holds the surface", async () => {
        await mount();
        claimEditorSurface(pane, "document");
        await act(async () => {
            window.dispatchEvent(
                new CustomEvent("bettershape-editor-action", {
                    detail: { action: "editor.action.jumpToPosition", line: 4, column: 1 },
                }),
            );
            await new Promise((resolve) => setTimeout(resolve, 100));
        });
        // The palette's line mode dispatches this id, not the jump event.
        const view = currentView();
        expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(4);
    });

    it("leaves Go to Line to the code editor when it holds the surface", async () => {
        await mount();
        claimEditorSurface(pane, "codemirror");
        const before = currentView().state.selection.main.head;
        await act(async () => {
            window.dispatchEvent(
                new CustomEvent("bettershape-editor-action", {
                    detail: { action: "editor.action.jumpToPosition", line: 4, column: 1 },
                }),
            );
            await new Promise((resolve) => setTimeout(resolve, 100));
        });
        expect(currentView().state.selection.main.head).toBe(before);
    });

    it("ignores a jump aimed at another file", async () => {
        await mount();
        const before = currentView().state.selection.main.head;
        await act(async () => {
            window.dispatchEvent(
                new CustomEvent("bettershape-editor-jump", {
                    detail: { path: "/repo/other.md", line: 4, column: 1 },
                }),
            );
        });
        expect(currentView().state.selection.main.head).toBe(before);
    });
});

describe("markdown editor options", () => {
    it("draws whitespace markers when Render whitespace is All", async () => {
        updateSettingSection("editor", { renderWhitespace: "all" });
        await mount();

        expect(whitespaceMarks()).toBeGreaterThan(0);
    });

    it("leaves whitespace bare when Render whitespace is None", async () => {
        updateSettingSection("editor", { renderWhitespace: "none" });
        await mount();

        expect(whitespaceMarks()).toBe(0);
    });

    it("picks the setting up on an open document, not only on the next one", async () => {
        updateSettingSection("editor", { renderWhitespace: "none" });
        await mount();
        expect(whitespaceMarks()).toBe(0);

        await act(async () => {
            updateSettingSection("editor", { renderWhitespace: "all" });
        });

        expect(whitespaceMarks()).toBeGreaterThan(0);
    });

    it("colours nested brackets when Bracket colors is on", async () => {
        updateSettingSection("editor", { bracketPairColorization: true });
        await mount();

        expect(nestedBracketMarks()).toBeGreaterThan(0);
    });

    it("leaves brackets in the plain text colour when Bracket colors is off", async () => {
        updateSettingSection("editor", { bracketPairColorization: false });
        await mount();

        expect(host.querySelectorAll('[class*="cm-bracket-depth-"]').length).toBe(0);
    });

    it("marks only trailing blanks when Render whitespace is Trailing", async () => {
        updateSettingSection("editor", { renderWhitespace: "trailing" });
        await mount();

        expect(host.querySelectorAll(".cm-trailingSpace").length).toBeGreaterThan(0);
        // "Trailing" is not "All": gaps between words stay undecorated.
        expect(whitespaceMarks()).toBe(0);
    });

    it("indents with the configured tab size instead of Markdown's own default", async () => {
        updateSettingSection("editor", { tabSize: 4, insertSpaces: true });
        await mount();

        const content = host.querySelector(".cm-content")!;
        await act(async () => {
            content.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
        });

        const line = host.querySelector(".cm-line")!.textContent ?? "";
        expect(line.startsWith("    ")).toBe(true);
    });

    it("inserts a tab character when Insert spaces is off", async () => {
        updateSettingSection("editor", { tabSize: 4, insertSpaces: false });
        await mount();

        const content = host.querySelector(".cm-content")!;
        await act(async () => {
            content.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
        });

        const line = host.querySelector(".cm-line")!.textContent ?? "";
        expect(line.startsWith("\t")).toBe(true);
    });

    it("adds and removes the minimap with the setting on an open document", async () => {
        updateSettingSection("editor", { minimap: false });
        await mount();
        expect(host.querySelector(".cm-minimap")).toBeNull();

        await act(async () => {
            updateSettingSection("editor", { minimap: true });
        });
        expect(host.querySelector(".cm-minimap")).not.toBeNull();

        await act(async () => {
            updateSettingSection("editor", { minimap: false });
        });
        expect(host.querySelector(".cm-minimap")).toBeNull();
    });
});
