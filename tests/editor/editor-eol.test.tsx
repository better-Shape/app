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
    return { view, saved, dirty };
}

it("reports the CRLF the file was loaded with, not the LF default", async () => {
    updateSettingSection("files", { defaultEol: "LF" });
    const { view } = await mount("one\ntwo", "one\r\ntwo");
    expect(view.state.lineBreak).toBe("\r\n");
    expect(reported.at(-1)).toEqual({ eol: "CRLF" });
});

it("takes the ending of a file that loads after the editor opened", async () => {
    updateSettingSection("files", { defaultEol: "LF" });
    // The first open starts empty; the read lands afterwards.
    await mount("", "");
    const view = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement);
    if (!view) throw new Error("Editor view is missing");
    await act(async () => {
        root?.render(
            <Suspense fallback={null}>
                <CodeMirrorEditor
                    path="/repo/file.txt"
                    content={"one\r\ntwo"}
                    setContent={() => undefined}
                    savedContentRef={{ current: "one\r\ntwo" }}
                    isDirtyRef={{ current: false }}
                    bufferVersionRef={{ current: 0 }}
                />
            </Suspense>,
        );
    });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(view.state.lineBreak).toBe("\r\n");
    expect(reported.at(-1)).toEqual({ eol: "CRLF" });
});

it("reports LF for an LF file even when the default is CRLF", async () => {
    updateSettingSection("files", { defaultEol: "CRLF" });
    const { view } = await mount("one\ntwo", "one\ntwo");
    expect(view.state.lineBreak).toBe("\n");
    expect(reported.at(-1)).toEqual({ eol: "LF" });
});

it("takes the ending of a refreshed file whose text is otherwise unchanged", async () => {
    const { saved } = await mount("one\ntwo", "one\ntwo");
    await act(async () => {
        // The file was rewritten on disk with CRLF while the buffer kept LF.
        saved.current = "one\r\ntwo";
        root?.render(
            <Suspense fallback={null}>
                <CodeMirrorEditor
                    path="/repo/file.txt"
                    content={"one\r\ntwo"}
                    setContent={() => undefined}
                    savedContentRef={saved}
                    isDirtyRef={{ current: false }}
                    bufferVersionRef={{ current: 0 }}
                />
            </Suspense>,
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const view = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement);
    if (!view) throw new Error("Editor view is missing");
    expect(view.state.lineBreak).toBe("\r\n");
});

it("marks a clean file unsaved when the ending is changed", async () => {
    const { dirty } = await mount("one\ntwo", "one\ntwo");
    expect(dirty.current).toBe(false);
    await act(async () => {
        window.dispatchEvent(
            new CustomEvent("bettershape-editor-action", { detail: { action: "setEol", value: "CRLF" } }),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // The conversion only reaches the disk through a save, so the file is dirty.
    expect(dirty.current).toBe(true);
    expect(backend.markFileDirty).toHaveBeenCalledWith("/repo/file.txt", true);
});

it("keeps an ending the user picked before the file finished loading", async () => {
    updateSettingSection("files", { defaultEol: "LF" });
    // Pick the ending that already matches the provisional default, while the
    // buffer is still empty and the read is in flight.
    await mount("", "");
    await act(async () => {
        window.dispatchEvent(
            new CustomEvent("bettershape-editor-action", { detail: { action: "setEol", value: "LF" } }),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
        root?.render(
            <Suspense fallback={null}>
                <CodeMirrorEditor
                    path="/repo/file.txt"
                    content={"one\r\ntwo"}
                    setContent={() => undefined}
                    savedContentRef={{ current: "one\r\ntwo" }}
                    isDirtyRef={{ current: false }}
                    bufferVersionRef={{ current: 0 }}
                />
            </Suspense>,
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const view = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement);
    if (!view) throw new Error("Editor view is missing");
    // The explicit choice wins over the ending the file turned out to have.
    expect(view.state.lineBreak).toBe("\n");
});

it("writes the file's own ending on a save and keeps it in the baseline", async () => {
    const { view, saved, dirty } = await mount("one\ntwo", "one\r\ntwo");
    dirty.current = true;
    await act(async () => {
        view.contentDOM.dispatchEvent(
            new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(backend.saveFile).toHaveBeenCalledWith("/repo/file.txt", "one\r\ntwo\r\n");
    // The preview reads its ending from this ref, so it has to keep the disk one.
    expect(saved.current).toBe("one\r\ntwo\r\n");
});
