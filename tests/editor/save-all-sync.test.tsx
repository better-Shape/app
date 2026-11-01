/**
 * Save All runs the save pipeline from the titlebar, not from the editor. The
 * mounted editor used to keep showing the unformatted text and stay dirty over a
 * file that was already written, with no draft left to recover it from.
 */
import { act, Suspense } from "react";
import { EditorView } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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

import { CodeMirrorEditor } from "@/features/editor/ui/codemirror/editor";
import { createMenuActionHandler } from "@/features/agent/workbench/titlebar/menu-actions";
import { loadDirtyBuffer, clearDirtyBuffer } from "@/lib/workspace/dirty-buffers";
import { resetSettings, updateSettingSection } from "@/lib/settings";

const PATH = "/repo/file.txt";
let host: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
    resetSettings();
    // Trim trailing whitespace and Insert final newline are on by default, which
    // is what makes the written text differ from the buffer here.
    updateSettingSection("editor", { trimTrailingWhitespace: true, insertFinalNewline: true });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root?.unmount());
    host.remove();
    clearDirtyBuffer(PATH);
    resetSettings();
    vi.clearAllMocks();
});

async function mount(content: string) {
    const saved = { current: content };
    const dirty = { current: true };
    const version = { current: 0 };
    await act(async () => {
        root?.render(
            <Suspense fallback={null}>
                <CodeMirrorEditor
                    path={PATH}
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
    return { view, dirty };
}

it("adopts the text a menu save wrote", async () => {
    const { view, dirty } = await mount("one   \ntwo");
    const handler = createMenuActionHandler({
        projectPath: "/repo",
        activeFile: PATH,
        openFiles: [{ path: PATH, is_dirty: true }],
        readLatestContent: async () => "one   \ntwo",
        closeWindow: vi.fn(),
    });
    await act(async () => {
        await handler("Save All");
    });
    expect(backend.saveFile).toHaveBeenCalledWith(PATH, "one\ntwo\n");
    expect(view.state.doc.toString()).toBe("one\ntwo\n");
    expect(dirty.current).toBe(false);
    // The draft describes the saved bytes, not the text from before the save.
    expect(loadDirtyBuffer(PATH)?.content ?? "one\ntwo\n").toBe("one\ntwo\n");
});

it("leaves edits typed during the save alone", async () => {
    const { view } = await mount("one   \ntwo");
    const handler = createMenuActionHandler({
        projectPath: "/repo",
        activeFile: PATH,
        openFiles: [{ path: PATH, is_dirty: true }],
        // The buffer moved on between the read and the write.
        readLatestContent: async () => "one   \ntwo",
        closeWindow: vi.fn(),
    });
    backend.saveFile.mockImplementationOnce(async () => {
        await act(async () => {
            view.dispatch({ changes: { from: 0, insert: "typed " } });
        });
    });
    await act(async () => {
        await handler("Save All");
    });
    expect(view.state.doc.toString()).toContain("typed ");
});
