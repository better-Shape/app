/**
 * Closing a file with an after-delay autosave writes the buffer instead of
 * dropping it. That write is asynchronous, so the file can be reopened and
 * edited before it lands; the newer text owns the dirty marker and the late
 * save must not clear it.
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
import { clearDirtyBuffer, saveDirtyBuffer } from "@/lib/workspace/dirty-buffers";
import { resetDirtyBufferRecovery } from "../helpers/dirty-buffers";
import { resetSettings, updateSettingSection } from "@/lib/settings";

const PATH = "/repo/notes.md";
let host: HTMLDivElement;
let root: Root | undefined;

/** A promise the test settles when it wants the save to land. */
const deferredWrite = () => {
    let resolve!: () => void;
    const promise = new Promise<undefined>((yes) => {
        resolve = () => yes(undefined);
    });
    return { promise, resolve };
};

beforeEach(() => {
    resetDirtyBufferRecovery();
    resetSettings();
    updateSettingSection("editor", { autoSave: "afterDelay", autoSaveDelay: 5000 });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root?.unmount());
    host.remove();
    clearDirtyBuffer(PATH);
    resetDirtyBufferRecovery();
    resetSettings();
    vi.clearAllMocks();
});

it("keeps a newer buffer dirty when the closing save lands after it", async () => {
    const saved = { current: "on disk" };
    const dirty = { current: false };
    const version = { current: 0 };
    await act(async () => {
        root?.render(
            <Suspense fallback={null}>
                <CodeMirrorEditor
                    path={PATH}
                    content="on disk"
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
        view.dispatch({ changes: { from: 0, insert: "edited " } });
        dirty.current = true;
    });

    const write = deferredWrite();
    backend.saveFile.mockReturnValueOnce(write.promise);
    await act(async () => {
        root?.unmount();
        root = undefined;
    });
    // The file came back with newer text while the write was still in flight.
    saveDirtyBuffer(PATH, "newer text", "edited on disk");
    await act(async () => {
        write.resolve();
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(backend.markFileDirty).not.toHaveBeenCalledWith(PATH, false);
});
