import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
    events: new Map<string, (event: { payload: unknown }) => void>(),
    commands: { getCachedFileContent: vi.fn(), readFile: vi.fn(), gitGetCommitFileContent: vi.fn(), gitGetItemContent: vi.fn(), invalidateFileCache: vi.fn(), invalidateAllFileCaches: vi.fn(), markFileDirty: vi.fn() },
    clearDirtyBuffer: vi.fn(), loadDirtyBuffer: vi.fn(), info: vi.fn(), error: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ commands: state.commands, useProjectState: () => ({ project_path: "/repo" }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (name: string, cb: (event: { payload: unknown }) => void) => {
    state.events.set(name, cb); return () => state.events.delete(name);
} }));
vi.mock("@/lib/workspace/dirty-buffers", () => ({ clearDirtyBuffer: state.clearDirtyBuffer, loadDirtyBuffer: state.loadDirtyBuffer }));
vi.mock("@/features/notifications", () => ({ notify: { info: state.info, error: state.error } }));
import { useFileContent } from "@/features/editor/ui/main/hooks/use-file-content";
function Editor({ path }: { path: string }) {
    const saved = useRef(""); const version = useRef(0);
    const file = useFileContent(path, false, path.startsWith("diff:"), saved, version);
    return <div>{file.originalContent}|{file.content}|{file.error}</div>;
}
let host: HTMLDivElement;
let root: Root | undefined;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
    vi.resetAllMocks(); state.events.clear();
    state.commands.readFile.mockResolvedValue("new disk");
    state.commands.markFileDirty.mockResolvedValue(undefined);
    state.commands.gitGetItemContent.mockResolvedValue("new git");
    state.commands.gitGetCommitFileContent.mockResolvedValue(["new original", "new modified"]);
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root?.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render(path: string) { await act(async () => root?.render(<Editor path={path} />)); }
it.each(["commit:abc", "staged", "unstaged"])("ignores a late %s diff after switching files", async (kind) => {
    const old = deferred<unknown>();
    if (kind.startsWith("commit")) state.commands.gitGetCommitFileContent.mockReturnValueOnce(old.promise);
    else state.commands.gitGetItemContent.mockReturnValueOnce(old.promise);
    await render(`diff:${kind}:/repo/old.ts`);
    await render(`diff:${kind}:/repo/new.ts`);
    const current = host.textContent;
    await act(async () => old.resolve(kind.startsWith("commit") ? ["old original", "old modified"] : "old git"));
    expect(host.textContent).toBe(current); expect(current).toContain("new");
});
it("ignores a delayed fallback after switching files", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const old = deferred<string>();
    state.commands.gitGetCommitFileContent.mockRejectedValueOnce(new Error("temporary"));
    state.commands.readFile.mockReturnValueOnce(old.promise);
    await render("diff:commit:abc:/repo/old.ts");
    await render("diff:commit:abc:/repo/new.ts");
    await act(async () => old.resolve("old fallback"));
    expect(host.textContent).toBe("new original|new modified|");
});
it("does not let an older failed refresh overwrite a newer successful load", async () => {
    const old = deferred<[string,string]>();
    state.commands.gitGetCommitFileContent.mockReturnValueOnce(old.promise);
    await render("diff:commit:abc:/repo/file.ts");
    await act(async () => window.dispatchEvent(new Event("bettershape-git-refresh")));
    await act(async () => old.reject(new Error("temporary")));
    expect(host.textContent).toBe("new original|new modified|");
    expect(state.commands.readFile).not.toHaveBeenCalled();
});
it("does not discard a dirty buffer when an agent callback outlives the editor", async () => {
    await render("/repo/file.ts"); state.loadDirtyBuffer.mockReturnValue({ content: "unsaved" });
    act(() => { state.events.get("bettershape-file-edited")?.({ payload: "/repo/file.ts" }); root?.unmount(); root = undefined; });
    await act(async () => {});
    expect(state.clearDirtyBuffer).not.toHaveBeenCalled();
    expect(state.commands.markFileDirty).not.toHaveBeenCalled();
    expect(state.info).not.toHaveBeenCalled();
});
it("does not restart a file read from an expired file-change callback", async () => {
    await render("/repo/file.ts");
    act(() => { state.events.get("bettershape-files-changed")?.({ payload: ["/repo/file.ts"] }); root?.unmount(); root = undefined; });
    await act(async () => {});
    expect(state.commands.readFile).toHaveBeenCalledTimes(1);
});

it.each(["bettershape-file-edited", "bettershape-files-changed"])("reports a rejected %s reload without leaking backend details", async (event) => {
    await render("/repo/file.ts");
    state.loadDirtyBuffer.mockImplementationOnce(() => { throw new Error("private detail"); });
    await act(async () => state.events.get(event)?.({ payload: event === "bettershape-file-edited" ? "/repo/file.ts" : ["/repo/file.ts"] }));
    expect(state.error).toHaveBeenCalledWith("File Error", "Could not refresh the editor. Save your changes before reopening the file.");
    expect(state.clearDirtyBuffer).not.toHaveBeenCalled();
});
