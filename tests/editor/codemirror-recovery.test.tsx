import { resetDirtyBufferRecovery } from "../helpers/dirty-buffers";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodeMirrorEditor } from "@/features/editor/ui/codemirror/editor";
import { loadDirtyBuffer, saveDirtyBuffer } from "@/lib/workspace/dirty-buffers";

const native = vi.hoisted(() => ({ markFileDirty: vi.fn(async () => undefined), saveFile: vi.fn(async () => undefined) }));
vi.mock("@/lib/backend", () => ({ commands: native, getProjectPath: () => null }));
vi.mock("@/features/editor/ui/codemirror/syntax-lint", () => ({ betterShapeSyntaxLinter: () => [] }));
let host: HTMLDivElement;
let root: Root | undefined;
let saved: { current: string };
let dirty: { current: boolean };
let version: { current: number };
const change = vi.fn();

beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); resetDirtyBufferRecovery();
    saved = { current: "disk text" }; dirty = { current: true }; version = { current: 0 };
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root?.unmount()); host.remove(); resetDirtyBufferRecovery(); vi.useRealTimers(); });
async function mount(content = "recovered text", path = "/draft.txt") {
    await act(async () => root?.render(<CodeMirrorEditor path={path} content={content} setContent={change}
        savedContentRef={saved} isDirtyRef={dirty} bufferVersionRef={version} />));
    const element = host.querySelector(".cm-editor");
    if (!(element instanceof HTMLElement)) throw new Error("Editor did not mount");
    const view = EditorView.findFromDOM(element);
    if (!view) throw new Error("Editor view is missing");
    return view;
}

it("keeps the disk baseline when mounting a recovered draft", async () => {
    await mount();
    expect(saved.current).toBe("disk text");
});

it("retains the last keystroke when unmounted before its broadcast timer", async () => {
    const view = await mount();
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } }));
    act(() => root?.unmount()); root = undefined;
    expect(loadDirtyBuffer("/draft.txt")).toMatchObject({ content: "recovered text!", savedContent: "disk text" });
});

it("clears an older recovery copy when the current document was saved", async () => {
    await mount("latest text");
    saveDirtyBuffer("/draft.txt", "older recovery", "disk text");
    act(() => window.dispatchEvent(new CustomEvent("bettershape-file-saved", { detail: { path: "/draft.txt", content: "latest text" } })));
    expect(saved.current).toBe("latest text");
    expect(dirty.current).toBe(false);
    expect(loadDirtyBuffer("/draft.txt")).toBeNull();
});

it("retains a newer document when an earlier save finishes", async () => {
    const view = await mount("first edit");
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "newer edit" } }));
    act(() => window.dispatchEvent(new CustomEvent("bettershape-file-saved", { detail: { path: "/draft.txt", content: "first edit" } })));
    expect(saved.current).toBe("first edit");
    expect(dirty.current).toBe(true);
    expect(loadDirtyBuffer("/draft.txt")).toMatchObject({ content: "newer edit", savedContent: "first edit" });
});

it("flushes the previous file's draft with its own baseline when switching paths", async () => {
    const first = await mount("first draft", "/first.txt");
    act(() => first.dispatch({ changes: { from: first.state.doc.length, insert: "!" } }));
    saved.current = "second disk";
    const second = await mount("second disk", "/second.txt");
    expect(second.state.doc.toString()).toBe("second disk");
    expect(loadDirtyBuffer("/first.txt")).toMatchObject({ content: "first draft!", savedContent: "disk text" });
    expect(loadDirtyBuffer("/second.txt")).toBeNull();
});

it("does not create a user draft or edit signal for an external content refresh", async () => {
    await mount("disk text");
    native.markFileDirty.mockClear();
    const edited = vi.fn(); window.addEventListener("bettershape-editor-changed", edited);
    try {
        saved.current = "refreshed disk";
        const view = await mount("refreshed disk");
        expect(view.state.doc.toString()).toBe("refreshed disk");
        expect(native.markFileDirty).not.toHaveBeenCalled();
        expect(edited).not.toHaveBeenCalled();
        expect(loadDirtyBuffer("/draft.txt")).toBeNull();
    } finally { window.removeEventListener("bettershape-editor-changed", edited); }
});
