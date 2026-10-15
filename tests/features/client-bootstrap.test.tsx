import { mockWindows } from "@tauri-apps/api/mocks";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const nativeWindow = vi.hoisted(() => ({ label: "settings", onCloseRequested: vi.fn(), destroy: vi.fn(), show: vi.fn(), hide: vi.fn(), message: vi.fn(), confirm: vi.fn(), unlisten: vi.fn() }));
const mocks = vi.hoisted(() => ({ settings: vi.fn(), sync: vi.fn(), stop: vi.fn(), error: vi.fn(), others: vi.fn(), generating: false, saveAll: vi.fn(), getProjectState: vi.fn(), markFileDirty: vi.fn(), files: [] as Array<{ path: string; name: string; is_dirty: boolean }> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/settings" }));
vi.mock("@/lib/settings", () => ({ initSettings: mocks.settings }));
vi.mock("@/lib/github/store", () => ({ initGitHubAuth: vi.fn() }));
vi.mock("@/lib/ai/sync", () => ({ initAiConfigSync: mocks.sync, aiConfigReady: async () => undefined }));
vi.mock("@/lib/mcp/registry", () => ({ syncActiveMcpServers: vi.fn() }));
vi.mock("@/features/notifications", () => ({ notify: { error: mocks.error } }));
vi.mock("@/lib/window/tauri-window", () => ({ isTauriRuntime: () => true, isMainTauriWindow: async () => false }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => nativeWindow }));
vi.mock("@/lib/window/close-others", () => ({ closeOtherWindows: mocks.others, reportCancelledClose: async () => undefined }));
vi.mock("@/features/chat/lib/generating-chats", () => ({ hasGeneratingChats: () => mocks.generating }));
vi.mock("@/lib/workspace/save-all", () => ({ requestSaveAll: mocks.saveAll }));
vi.mock("@/lib/backend", () => ({ getProjectSnapshot: () => ({ open_files: mocks.files }), commands: { getProjectState: mocks.getProjectState, markFileDirty: mocks.markFileDirty } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: nativeWindow.confirm, message: nativeWindow.message }));
vi.mock("@/lib/editor/benign-errors", () => ({ installBenignErrorFilters: vi.fn() }));
vi.mock("@/components/layout/main", () => ({ default: () => null }));
vi.mock("@/features/agent/workbench", () => ({ Titlebar: () => null }));
vi.mock("@/features/loading/context", () => ({ LoadingProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/ui/notification", () => ({ NotificationProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/core/providers/menu", () => ({ GlobalContextMenu: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/features/chat/lib/chat-stream-store", () => ({ ChatStreamProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/features/git/ui/manager/filter-context", () => ({ FilterProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/features/chat/ui/shell/checkpoint-restore-dialog", () => ({ CheckpointRestoreDialog: () => null }));
vi.mock("@/components/ui/suppress-native-tooltips", () => ({ SuppressNativeTooltips: () => null }));
vi.mock("@/features/agent/palette", () => ({ CommandPaletteBridge: () => null }));
vi.mock("@/features/chat/ui/design-capture", () => ({ DesignPreviewCaptureHost: () => null }));
vi.mock("@/components/layout/webview-reconnect", () => ({ WebviewReconnect: () => null }));
import { acknowledgeCredentialDraft, credentialDraftVersion, stageCredentialDrafts } from "@/lib/ai/credential-drafts";
import { stageDirtyBuffer, saveDirtyBuffer, loadDirtyBuffer } from "@/lib/workspace/dirty-buffers";
import ClientLayout from "@/app/client-layout";
let host: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => {
    mockWindows("settings"); nativeWindow.label = "settings";
    localStorage.clear();
    mocks.generating = false; mocks.files = [];
    mocks.markFileDirty.mockReset().mockResolvedValue(undefined);
    nativeWindow.destroy.mockReset().mockResolvedValue(undefined);
    nativeWindow.message.mockReset().mockResolvedValue("Save");
    mocks.others.mockReset().mockResolvedValue(true);
    mocks.saveAll.mockReset().mockResolvedValue(true);
    mocks.getProjectState.mockReset().mockResolvedValue({ open_files: [] });
    vi.clearAllMocks(); nativeWindow.onCloseRequested.mockResolvedValue(nativeWindow.unlisten); nativeWindow.confirm.mockResolvedValue(false); mocks.settings.mockResolvedValue(undefined); mocks.sync.mockReturnValue(mocks.stop);
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => {
    act(() => root?.unmount()); host.remove(); localStorage.clear();
    acknowledgeCredentialDraft("openai", credentialDraftVersion("openai", "example-key"));
});
async function render() { await act(async () => root?.render(<ClientLayout><div>Settings</div></ClientLayout>)); }
it("reports hydration failure without leaking rejection details or starting sync", async () => {
    mocks.settings.mockRejectedValue(new Error("private backend detail"));
    await render();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith("Could not initialize app settings", "Reload the app to try again.");
});
it("ignores a late failure after the owning layout unmounts", async () => {
    let reject!: (reason: Error) => void;
    mocks.settings.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    await render(); act(() => root?.unmount()); root = undefined;
    await act(async () => reject(new Error("late")));
    expect(mocks.error).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
});
it("unsubscribes successful synchronization when its layout unmounts", async () => {
    await render(); expect(mocks.sync).toHaveBeenCalledTimes(1);
    act(() => root?.unmount()); root = undefined;
    expect(mocks.stop).toHaveBeenCalledTimes(1);
});

it("guards the settings window close and destroys it only after explicit approval", async () => {
    await render();
    await vi.waitFor(() => expect(nativeWindow.onCloseRequested).toHaveBeenCalled());
    const close = nativeWindow.onCloseRequested.mock.calls[0][0];
    stageCredentialDrafts({ openai: "example-key" });
    const preventDefault = vi.fn();
    await close({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(nativeWindow.confirm).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cancelLabel: "Keep open" }));
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
    nativeWindow.confirm.mockResolvedValue(true);
    await close({ preventDefault });
    expect(nativeWindow.destroy).toHaveBeenCalledTimes(1);
});

it("hides an active main window without closing secondary windows or discarding drafts", async () => {
    nativeWindow.label = "main"; mocks.generating = true;
    stageCredentialDrafts({ openai: "example-key" });
    await render();
    await vi.waitFor(() => expect(nativeWindow.onCloseRequested).toHaveBeenCalled());
    await nativeWindow.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() });
    expect(nativeWindow.hide).toHaveBeenCalledOnce();
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
    expect(nativeWindow.confirm).not.toHaveBeenCalled();
    expect(mocks.others).not.toHaveBeenCalled();
});

it("waits for file saves and keeps the window if credentials change meanwhile", async () => {
    nativeWindow.label = "main";
    mocks.files = [{ path: "/example.txt", name: "example.txt", is_dirty: true }];
    nativeWindow.confirm.mockResolvedValue(true);
    let finish!: (saved: boolean) => void;
    mocks.saveAll.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await render();
    await vi.waitFor(() => expect(nativeWindow.onCloseRequested).toHaveBeenCalled());
    const closing = nativeWindow.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(mocks.saveAll).toHaveBeenCalled());
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
    stageCredentialDrafts({ openai: "example-key" });
    finish(true); await closing;
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
});

it.each([false, true])("keeps the window after save failure or a remaining dirty file: %s", async (saved) => {
    nativeWindow.label = "main";
    mocks.files = [{ path: "/example.txt", name: "example.txt", is_dirty: true }];
    nativeWindow.confirm.mockResolvedValue(true);
    mocks.saveAll.mockResolvedValue(saved);
    mocks.getProjectState.mockResolvedValue({ open_files: mocks.files });
    await render();
    await vi.waitFor(() => expect(nativeWindow.onCloseRequested).toHaveBeenCalled());
    await nativeWindow.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() });
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith("Could not save all files", expect.any(String));
});

it("keeps the window when the editor changes during file-save confirmation", async () => {
    nativeWindow.label = "main";
    mocks.files = [{ path: "/example.txt", name: "example.txt", is_dirty: true }];
    nativeWindow.message.mockImplementationOnce(async () => {
        window.dispatchEvent(new Event("bettershape-editor-changed"));
        return "Save";
    });
    await render();
    await vi.waitFor(() => expect(nativeWindow.onCloseRequested).toHaveBeenCalled());
    await nativeWindow.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() });
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
});

async function closeDirtyMain(paths = ["/example.txt"]) {
    nativeWindow.label = "main";
    mocks.files = paths.map((path) => ({ path, name: path, is_dirty: true }));
    for (const path of paths) saveDirtyBuffer(path, "draft", "disk");
    await render();
    await vi.waitFor(() => expect(nativeWindow.onCloseRequested).toHaveBeenCalled());
    return nativeWindow.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() });
}

it("does not discard a newer recovery buffer after an old close approval", async () => {
    nativeWindow.message.mockImplementationOnce(async () => {
        saveDirtyBuffer("/example.txt", "newer draft", "disk");
        window.dispatchEvent(new CustomEvent("bettershape-editor-changed", { detail: { path: "/example.txt" } }));
        return "Don't save";
    });
    await closeDirtyMain();
    expect(loadDirtyBuffer("/example.txt")?.content).toBe("newer draft");
    expect(mocks.markFileDirty).not.toHaveBeenCalled();
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
});

it.each(["Cancel", "unexpected result"])("does not treat %s as a discard approval", async (result) => {
    nativeWindow.message.mockResolvedValue(result);
    await closeDirtyMain();
    expect(loadDirtyBuffer("/example.txt")?.content).toBe("draft");
    expect(mocks.saveAll).not.toHaveBeenCalled();
    expect(mocks.markFileDirty).not.toHaveBeenCalled();
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
});

it("restores dirty state if an edit arrives while a discard is being prepared", async () => {
    nativeWindow.message.mockResolvedValue("Don't save");
    mocks.markFileDirty.mockImplementationOnce(async () => {
        saveDirtyBuffer("/example.txt", "newer draft", "disk");
        window.dispatchEvent(new CustomEvent("bettershape-editor-changed", { detail: { path: "/example.txt" } }));
    });
    await closeDirtyMain();
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
    expect(loadDirtyBuffer("/example.txt")?.content).toBe("newer draft");
    expect(mocks.markFileDirty).toHaveBeenLastCalledWith("/example.txt", true);
});

it("restores the recovery copy and dirty flag if window destruction fails", async () => {
    nativeWindow.message.mockResolvedValue("Don't save");
    nativeWindow.destroy.mockRejectedValueOnce(new Error("destroy failed"));
    await closeDirtyMain();
    expect(loadDirtyBuffer("/example.txt")?.content).toBe("draft");
    expect(mocks.markFileDirty).toHaveBeenLastCalledWith("/example.txt", true);
});

it("discards only after approval and removes the recovery copy on successful close", async () => {
    nativeWindow.message.mockResolvedValue("Don't save");
    await closeDirtyMain();
    expect(nativeWindow.destroy).toHaveBeenCalledOnce();
    expect(loadDirtyBuffer("/example.txt")).toBeNull();
    expect(mocks.markFileDirty).toHaveBeenCalledExactlyOnceWith("/example.txt", false);
});

it("hides instead of discarding when generation starts during the close dialog", async () => {
    nativeWindow.message.mockImplementationOnce(async () => { mocks.generating = true; return "Don't save"; });
    await closeDirtyMain();
    expect(nativeWindow.hide).toHaveBeenCalledOnce();
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
    expect(loadDirtyBuffer("/example.txt")?.content).toBe("draft");
});

it("retains recovery after a native dirty-state update fails", async () => {
    nativeWindow.message.mockResolvedValue("Don't save");
    mocks.markFileDirty.mockRejectedValueOnce(new Error("state update failed"));
    await closeDirtyMain();
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
    expect(loadDirtyBuffer("/example.txt")?.content).toBe("draft");
    expect(mocks.markFileDirty).toHaveBeenLastCalledWith("/example.txt", true);
});

it("keeps a newer buffer while restoring other recovery copies after a failed destruction", async () => {
    nativeWindow.message.mockResolvedValue("Don't save");
    nativeWindow.destroy.mockImplementationOnce(async () => {
        saveDirtyBuffer("/example.txt", "newer draft", "disk");
        window.dispatchEvent(new CustomEvent("bettershape-editor-changed", { detail: { path: "/example.txt" } }));
        throw new Error("destroy failed");
    });
    await closeDirtyMain(["/example.txt", "/other.txt"]);
    expect(loadDirtyBuffer("/example.txt")?.content).toBe("newer draft");
    expect(loadDirtyBuffer("/other.txt")?.content).toBe("draft");
    expect(mocks.markFileDirty).toHaveBeenCalledWith("/example.txt", true);
    expect(mocks.markFileDirty).toHaveBeenCalledWith("/other.txt", true);
});

it("does not forget a dirty file when rollback fails and a later close sees stale native state", async () => {
    nativeWindow.message.mockResolvedValue("Don't save");
    mocks.markFileDirty.mockImplementationOnce(async () => {
        mocks.files[0].is_dirty = false;
        saveDirtyBuffer("/example.txt", "newer draft", "disk");
        window.dispatchEvent(new CustomEvent("bettershape-editor-changed", { detail: { path: "/example.txt" } }));
    }).mockRejectedValueOnce(new Error("rollback failed"));
    await closeDirtyMain();
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
    nativeWindow.message.mockResolvedValue("Cancel");
    await nativeWindow.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() });
    expect(nativeWindow.message).toHaveBeenCalledTimes(2);
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
    expect(loadDirtyBuffer("/example.txt")?.content).toBe("newer draft");
});

it("warns about restored recovery even before native dirty state catches up", async () => {
    nativeWindow.label = "main";
    nativeWindow.message.mockResolvedValue("Cancel");
    mocks.files = [{ path: "/restored.txt", name: "restored.txt", is_dirty: false }];
    saveDirtyBuffer("/restored.txt", "draft", "disk");
    await render();
    await vi.waitFor(() => expect(nativeWindow.onCloseRequested).toHaveBeenCalled());
    await nativeWindow.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() });
    expect(nativeWindow.message).toHaveBeenCalled();
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
    expect(loadDirtyBuffer("/restored.txt")?.content).toBe("draft");
});

it("flushes a popout's last staged edit before destroying its webview", async () => {
    nativeWindow.label = "popout-editor";
    await render();
    await vi.waitFor(() => expect(nativeWindow.onCloseRequested).toHaveBeenCalled());
    stageDirtyBuffer("/popout.txt", "last keystroke", "disk");
    expect(localStorage.getItem("bettershape-dirty-buffers-v1")).toBeNull();
    await nativeWindow.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() });
    expect(nativeWindow.destroy).toHaveBeenCalledOnce();
    expect(localStorage.getItem("bettershape-dirty-buffers-v1")).toContain("last keystroke");
});

it("keeps a popout open if its staged recovery cannot be persisted", async () => {
    nativeWindow.label = "popout-editor";
    await render();
    await vi.waitFor(() => expect(nativeWindow.onCloseRequested).toHaveBeenCalled());
    stageDirtyBuffer("/popout.txt", "last keystroke", "disk");
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    try {
        await nativeWindow.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() });
        expect(nativeWindow.destroy).not.toHaveBeenCalled();
        expect(loadDirtyBuffer("/popout.txt")?.content).toBe("last keystroke");
    } finally { write.mockRestore(); }
});

it("rolls back a discard if deleting its recovery copy fails", async () => {
    let write: ReturnType<typeof vi.spyOn> | undefined;
    nativeWindow.message.mockImplementationOnce(async () => {
        write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("storage unavailable"); });
        return "Don't save";
    });
    try {
        await closeDirtyMain();
        expect(nativeWindow.destroy).not.toHaveBeenCalled();
        expect(loadDirtyBuffer("/example.txt")?.content).toBe("draft");
        expect(mocks.markFileDirty).toHaveBeenLastCalledWith("/example.txt", true);
    } finally { write?.mockRestore(); }
});

it("does not close any secondary window when the main file prompt is cancelled", async () => {
    nativeWindow.message.mockResolvedValue("Cancel");
    await closeDirtyMain();
    expect(mocks.others).not.toHaveBeenCalled();
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
});

it("asks for main-window consent before beginning secondary closures", async () => {
    nativeWindow.message.mockImplementationOnce(async () => {
        expect(mocks.others).not.toHaveBeenCalled();
        return "Don't save";
    });
    await closeDirtyMain();
    expect(mocks.others).toHaveBeenCalledOnce();
    expect(nativeWindow.destroy).toHaveBeenCalledOnce();
});

it("restores the main draft if it changes while secondary windows are closing", async () => {
    nativeWindow.message.mockResolvedValue("Don't save");
    mocks.others.mockImplementationOnce(async () => {
        window.dispatchEvent(new CustomEvent("bettershape-editor-changed", { detail: { path: "/example.txt" } }));
        saveDirtyBuffer("/example.txt", "edit while closing peers", "saved");
        return true;
    });
    await closeDirtyMain();
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
    expect(loadDirtyBuffer("/example.txt")?.content).toBe("edit while closing peers");
    expect(mocks.markFileDirty).toHaveBeenLastCalledWith("/example.txt", true);
});

it("reports failed native close registration without exposing backend details", async () => {
    nativeWindow.onCloseRequested.mockRejectedValueOnce(new Error("private registration detail"));
    await render();
    expect(mocks.error).toHaveBeenCalledWith("Window close protection is unavailable", "Save your changes before restarting the app. Native close requests remain blocked.");
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
});
