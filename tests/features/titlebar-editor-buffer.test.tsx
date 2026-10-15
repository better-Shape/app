import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveDirtyBuffer } from "@/lib/workspace/dirty-buffers";
import { useEditorBuffer } from "@/features/agent/workbench/titlebar/hooks/use-editor-buffer";
const readFile = vi.hoisted(() => vi.fn(async () => "disk text"));
vi.mock("@/lib/backend", () => ({ commands: { readFile } }));
let host: HTMLDivElement;
let root: Root;
let readLatestContent: (path: string) => Promise<string>;
function Consumer() {
    const { readLatestContent: read } = useEditorBuffer();
    useEffect(() => { readLatestContent = read; }, [read]);
    return null;
}
beforeEach(async () => {
    localStorage.clear(); readFile.mockClear();
    host = document.createElement("div"); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<Consumer />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); });

it("saves a restored dirty buffer instead of overwriting it with disk text", async () => {
    saveDirtyBuffer("/restored.txt", "unsaved work", "disk text");
    expect(await readLatestContent("/restored.txt")).toBe("unsaved work");
    expect(readFile).not.toHaveBeenCalled();
});

it("prefers the current editor buffer over its older recovery copy", async () => {
    saveDirtyBuffer("/edited.txt", "older work", "disk text");
    const flush = () => window.dispatchEvent(new CustomEvent("bettershape-editor-buffer", { detail: { path: "/edited.txt", content: "latest work" } }));
    window.addEventListener("bettershape-editor-flush-buffer", flush);
    try { expect(await readLatestContent("/edited.txt")).toBe("latest work"); }
    finally { window.removeEventListener("bettershape-editor-flush-buffer", flush); }
    expect(readFile).not.toHaveBeenCalled();
});

it("keeps an intentionally emptied editor buffer", async () => {
    window.dispatchEvent(new CustomEvent("bettershape-editor-buffer", { detail: { path: "/empty.txt", content: "" } }));
    expect(await readLatestContent("/empty.txt")).toBe("");
    expect(readFile).not.toHaveBeenCalled();
});

it("reads disk only when no live or restored draft exists", async () => {
    expect(await readLatestContent("/clean.txt")).toBe("disk text");
    expect(readFile).toHaveBeenCalledWith("/clean.txt");
});

it("requests the current document before consulting a debounced buffer", async () => {
    window.dispatchEvent(new CustomEvent("bettershape-editor-buffer", { detail: { path: "/editing.txt", content: "older broadcast" } }));
    const flush = () => window.dispatchEvent(new CustomEvent("bettershape-editor-buffer", { detail: { path: "/editing.txt", content: "latest keystroke" } }));
    window.addEventListener("bettershape-editor-flush-buffer", flush);
    try { expect(await readLatestContent("/editing.txt")).toBe("latest keystroke"); }
    finally { window.removeEventListener("bettershape-editor-flush-buffer", flush); }
});

it("prefers a newer recovery draft over a broadcast cached before the editor unmounted", async () => {
    window.dispatchEvent(new CustomEvent("bettershape-editor-buffer", { detail: { path: "/hidden.txt", content: "older broadcast" } }));
    saveDirtyBuffer("/hidden.txt", "last keystroke", "disk text");
    expect(await readLatestContent("/hidden.txt")).toBe("last keystroke");
    expect(readFile).not.toHaveBeenCalled();
});
