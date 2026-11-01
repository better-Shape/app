/**
 * A save must keep the line ending the file already had. The editor used to seed
 * its line ending from the Settings default alone, so a CRLF file saved under the
 * LF default was rewritten with LF on every line.
 */
import { act, Suspense } from "react";
import { EditorView } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodeMirrorEditor } from "@/features/editor/ui/codemirror/editor";
import { resetSettings, updateSettingSection } from "@/lib/settings";

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

let host: HTMLDivElement;
let root: Root | undefined;
let reported: Array<{ eol?: string }> = [];

const listen = (event: Event) => {
    const detail = (event as CustomEvent<{ eol?: string }>).detail;
    if (detail?.eol) reported.push({ eol: detail.eol });
};

beforeEach(() => {
    resetSettings();
    reported = [];
    window.addEventListener("bettershape-editor-status", listen);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    window.removeEventListener("bettershape-editor-status", listen);
    act(() => root?.unmount());
    host.remove();
    resetSettings();
});

async function mount(content: string, diskContent: string) {
    const saved = { current: diskContent };
    const dirty = { current: false };
    const version = { current: 0 };
    await act(async () => {
        root?.render(
            <Suspense fallback={null}>
                <CodeMirrorEditor
                    path="/repo/file.txt"
                    content={content}
                    setContent={() => undefined}
                    savedContentRef={saved}
                    isDirtyRef={dirty}
                    bufferVersionRef={version}
                />
            </Suspense>,
        );
    });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const element = host.querySelector(".cm-editor");
    if (!(element instanceof HTMLElement)) throw new Error("Editor did not mount");
    const view = EditorView.findFromDOM(element);
    if (!view) throw new Error("Editor view is missing");
    await act(async () => {
        view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    return view;
}

it("reports the CRLF the file was loaded with, not the LF default", async () => {
    updateSettingSection("files", { defaultEol: "LF" });
    const view = await mount("one\ntwo", "one\r\ntwo");
    expect(view.state.lineBreak).toBe("\r\n");
    expect(reported.at(-1)).toEqual({ eol: "CRLF" });
});

it("reports LF for an LF file even when the default is CRLF", async () => {
    updateSettingSection("files", { defaultEol: "CRLF" });
    const view = await mount("one\ntwo", "one\ntwo");
    expect(view.state.lineBreak).toBe("\n");
    expect(reported.at(-1)).toEqual({ eol: "LF" });
});
