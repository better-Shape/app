import { act, Suspense } from "react";
import { EditorView } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeMirrorEditor } from "@/features/editor/ui/codemirror/editor";
import { updateSettingSection } from "@/lib/settings";

const backend = vi.hoisted(() => ({
    gitBlameFile: vi.fn(async () => []),
    markFileDirty: vi.fn(async () => undefined),
    saveFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ""),
}));

vi.mock("@/lib/backend", () => ({
    commands: backend,
    getProjectPath: () => "/repo",
}));
vi.mock("@/features/editor/ui/codemirror/syntax-lint", () => ({ betterShapeSyntaxLinter: () => [] }));

const SOURCE = ["function a() {", "  if (x) {", "    return 1;", "  }", "}"].join("\n");
const saved = { current: SOURCE };
const dirty = { current: false };
const version = { current: 0 };

let host: HTMLDivElement;
let root: Root | undefined;
let events: Array<{ spaces?: number; insertSpaces?: boolean }> = [];

const listen = (event: Event) => {
    const detail = (event as CustomEvent<{ spaces?: number; insertSpaces?: boolean }>).detail;
    if (typeof detail?.spaces === "number") events.push({ spaces: detail.spaces, insertSpaces: detail.insertSpaces });
};

beforeEach(() => {
    events = [];
    window.addEventListener("bettershape-editor-status", listen);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    window.removeEventListener("bettershape-editor-status", listen);
    act(() => root?.unmount());
    host.remove();
    updateSettingSection("editor", { detectIndentation: true, tabSize: 4, insertSpaces: true, wordWrap: "off" });
});

async function mount() {
    await act(async () => {
        root?.render(
            <Suspense fallback={null}>
                <CodeMirrorEditor
                    path="/repo/a.ts"
                    content={SOURCE}
                    setContent={() => undefined}
                    savedContentRef={saved}
                    isDirtyRef={dirty}
                    bufferVersionRef={version}
                />
            </Suspense>,
        );
    });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
    });
    const element = host.querySelector(".cm-editor");
    if (!(element instanceof HTMLElement)) throw new Error("Editor did not mount");
    const view = EditorView.findFromDOM(element);
    if (!view) throw new Error("Editor view is missing");
    // The status report is published on focus (and on every update while the
    // editor has focus), so a headless test has to say it has focus.
    await act(async () => {
        view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
}

describe("editor indentation", () => {
    it("matches the buffer when Detect indentation is on", async () => {
        updateSettingSection("editor", { detectIndentation: true, tabSize: 4, insertSpaces: true });
        await mount();
        expect(host.querySelector(".cm-editor"), "editor did not mount").not.toBeNull();
        expect(events.at(-1)).toEqual({ spaces: 2, insertSpaces: true });
    });

    it("keeps the configured tab size when Detect indentation is off", async () => {
        updateSettingSection("editor", { detectIndentation: false, tabSize: 4, insertSpaces: true });
        await mount();
        expect(events.at(-1)).toEqual({ spaces: 4, insertSpaces: true });
    });

    it("detects the indentation of a file that loads after the editor opened", async () => {
        // The first open starts with an empty buffer while the read is in flight.
        updateSettingSection("editor", { detectIndentation: true, tabSize: 4, insertSpaces: true });
        const emptySaved = { current: "" };
        const render = (text: string) =>
            root?.render(
                <Suspense fallback={null}>
                    <CodeMirrorEditor
                        path="/repo/a.ts"
                        content={text}
                        setContent={() => undefined}
                        savedContentRef={emptySaved}
                        isDirtyRef={dirty}
                        bufferVersionRef={version}
                    />
                </Suspense>,
            );
        await act(async () => {
            render("");
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 150));
        });
        const view = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement);
        if (!view) throw new Error("Editor view is missing");
        await act(async () => {
            render(SOURCE);
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 150));
            view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        });
        expect(events.at(-1)).toEqual({ spaces: 2, insertSpaces: true });
    });

    it("applies an indentation change to the open document", async () => {
        updateSettingSection("editor", { detectIndentation: false, tabSize: 4, insertSpaces: true });
        await mount();
        const view = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement);
        if (!view) throw new Error("Editor view is missing");

        // Settings -> Editor is a global switch: it has to reach the file that is
        // already open, not only the next one.
        await act(async () => {
            updateSettingSection("editor", { tabSize: 2, insertSpaces: false });
        });
        expect(view.state.tabSize).toBe(2);
        expect(events.at(-1)).toEqual({ spaces: 2, insertSpaces: false });
    });

    it("keeps the detected indentation when an unrelated setting changes", async () => {
        updateSettingSection("editor", { detectIndentation: true, tabSize: 4, insertSpaces: true });
        await mount();
        // A two-space file is open; changing the configured tab size must not
        // reindent it, because Detect indentation is still on.
        await act(async () => {
            updateSettingSection("editor", { tabSize: 2, insertSpaces: false });
        });
        expect(events.at(-1)).toEqual({ spaces: 2, insertSpaces: true });
    });

    it("keeps a manual tab size across an unrelated settings change", async () => {
        updateSettingSection("editor", { detectIndentation: false, tabSize: 4, insertSpaces: true });
        await mount();
        // The status bar's Indentation picker changes the live value, not the
        // setting; a later settings emission must not put the configured one back.
        await act(async () => {
            window.dispatchEvent(
                new CustomEvent("bettershape-editor-action", { detail: { action: "setTabSize", value: 2 } }),
            );
        });
        expect(events.at(-1)).toEqual({ spaces: 2, insertSpaces: true });
        await act(async () => {
            updateSettingSection("editor", { renderWhitespace: "all" });
        });
        expect(events.at(-1)).toEqual({ spaces: 2, insertSpaces: true });
    });

    it("applies a word-wrap change to the open document", async () => {
        updateSettingSection("editor", { wordWrap: "off" });
        await mount();
        const view = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement);
        if (!view) throw new Error("Editor view is missing");
        expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);

        await act(async () => {
            updateSettingSection("editor", { wordWrap: "on" });
        });
        expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
    });
});
