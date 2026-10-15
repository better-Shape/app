import { act, useLayoutEffect, useRef } from "react";
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
const commits: Array<{ path: string; content: string; loading: boolean }> = [];
function Editor({ path }: { path: string }) {
    const saved = useRef(""); const version = useRef(0);
    const file = useFileContent(path, false, path.startsWith("diff:"), saved, version);
    useLayoutEffect(() => { commits.push({ path, content: file.content, loading: file.loading }); }, [path, file.content, file.loading]);
    return <div>{file.originalContent}|{file.content}|{file.error}</div>;
}
let host: HTMLDivElement;
let root: Root | undefined;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
    vi.resetAllMocks(); state.events.clear(); commits.length = 0;
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

it.each(["bettershape-file-edited", "bettershape-files-changed"])("reports a rejected %s recovery lookup without leaking backend details", async (event) => {
    await render("/repo/file.ts");
    state.loadDirtyBuffer.mockImplementationOnce(() => { throw new Error("private detail"); });
    await act(async () => state.events.get(event)?.({ payload: event === "bettershape-file-edited" ? "/repo/file.ts" : ["/repo/file.ts"] }));
    expect(state.error).toHaveBeenCalledWith("File Error", "Could not refresh the editor. Save your changes before reopening the file.");
    expect(state.clearDirtyBuffer).not.toHaveBeenCalled();
});

it("never exposes the previous file's text under a newly selected path", async () => {
    await render("/repo/first.txt");
    const next = deferred<string>();
    state.commands.readFile.mockReturnValueOnce(next.promise);
    await render("/repo/second.txt");
    const second = commits.filter((commit) => commit.path === "/repo/second.txt");
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((commit) => commit.content === "" && commit.loading)).toBe(true);
    await act(async () => next.resolve("second disk"));
    expect(host.textContent).toBe("|second disk|");
});

it("preserves unsaved editor text when an agent updates its disk file", async () => {
    await render("/repo/file.txt");
    state.loadDirtyBuffer.mockReturnValue({ content: "user draft" });
    state.clearDirtyBuffer.mockImplementation(() => state.loadDirtyBuffer.mockReturnValue(null));
    state.commands.readFile.mockResolvedValueOnce("agent's disk version");
    await act(async () => state.events.get("bettershape-file-edited")?.({ payload: "/repo/file.txt" }));
    expect(host.textContent).toBe("|user draft|");
    expect(state.clearDirtyBuffer).not.toHaveBeenCalled();
    expect(state.info).toHaveBeenCalledWith("File updated by agent", "Your unsaved edits remain open. Review the disk changes before saving.");
});

it.each(["bettershape-file-edited", "bettershape-files-changed"])("handles an actual backend read failure during %s without exposing details", async (event) => {
    await render("/repo/file.ts");
    state.commands.readFile.mockRejectedValueOnce(new Error("private backend detail"));
    await act(async () => state.events.get(event)?.({ payload: event === "bettershape-file-edited" ? "/repo/file.ts" : ["/repo/file.ts"] }));
    expect(state.commands.readFile).toHaveBeenCalledTimes(2);
    expect(state.error).toHaveBeenCalledWith("File Error", "Could not refresh the editor. Save your changes before reopening the file.");
    expect(host.textContent).not.toContain("private backend detail");
    expect(state.clearDirtyBuffer).not.toHaveBeenCalled();
});

it.each([
    ["Permission denied (os error 13): private detail", "Check its permissions."],
    ["Access is denied (os error 5): private detail", "Check its permissions."],
    ["No such file or directory (os error 2): private detail", "It may have been moved or deleted."],
    ["stream did not contain valid UTF-8: private detail", "cannot be displayed as UTF-8 text."],
])("keeps common read errors actionable without displaying raw backend text: %s", async (message, expected) => {
    state.commands.readFile.mockRejectedValueOnce(new Error(message));
    await render("/repo/file.ts");
    expect(host.textContent).toContain(expected);
    expect(host.textContent).not.toContain("private detail");
    expect(state.error).not.toHaveBeenCalled();
});
