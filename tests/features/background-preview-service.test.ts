import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
    listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
    spawn: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (name: string, fn: (event: { payload: unknown }) => void) => {
    const listeners = mocks.listeners.get(name) ?? new Set();
    mocks.listeners.set(name, listeners); listeners.add(fn);
    return () => { listeners.delete(fn); };
} }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string) => command === "pty_spawn_run" ? mocks.spawn() : Promise.resolve() }));
vi.mock("@/lib/backend", () => ({ getProjectPath: () => "/project" }));
vi.mock("@/lib/settings", () => ({ resolveDefaultTerminalShell: () => "default" }));
vi.mock("@/features/terminal/session", () => ({ registerBoundTerminalTab: vi.fn(), terminalSessionStore: { appendPtyOutput: vi.fn(), clearPtyScrollback: vi.fn() } }));
let background: typeof import("@/features/terminal/background-run");
function emit(name: string, payload: unknown) { for (const listener of mocks.listeners.get(name) ?? []) listener({ payload }); }
beforeEach(async () => {
    vi.resetModules(); mocks.listeners.clear(); mocks.spawn.mockReset().mockResolvedValue(7);
    background = await import("@/features/terminal/background-run");
});
afterEach(async () => { await background.stopBackgroundRun(); });
it("requires the selected PTY's output, not a reachable port or another PTY", async () => {
    await background.ensureBackgroundRun("npm run dev", "/project");
    emit("preview-ready", { id: 7, url: "http://localhost:3000", source: "probe" });
    expect(background.getBackgroundPreviewService()).toBeNull();
    emit("preview-ready", { id: 8, url: "http://localhost:3000", source: "output" });
    expect(background.getBackgroundPreviewService()).toBeNull();
    emit("preview-ready", { id: 7, url: "http://localhost:5173", source: "output" });
    expect(background.getBackgroundPreviewService()).toEqual({ ptyId: 7, projectPath: "/project", url: "http://localhost:5173" });
    emit("preview-ready", { id: 7, url: "http://localhost:3000", source: "probe" });
    expect(background.getLastPreviewReadyUrl()).toBe("http://localhost:5173");
    emit("pty-exit", { id: 7 });
    expect(background.getBackgroundPreviewService()).toBeNull();
});
it("keeps a readiness event emitted before the spawn reply, without trusting unrelated early events", async () => {
    mocks.spawn.mockImplementation(async () => {
        emit("preview-ready", { id: 8, url: "http://localhost:4444", source: "output" });
        emit("preview-ready", { id: 7, url: "http://localhost:5173", source: "output" });
        emit("preview-ready", { id: 7, url: "http://localhost:3000", source: "probe" });
        return 7;
    });
    await background.ensureBackgroundRun("npm run dev", "/project");
    expect(background.getBackgroundPreviewService()?.url).toBe("http://localhost:5173");
    await background.stopBackgroundRun();
    expect(background.getBackgroundPreviewService()).toBeNull();
});
it("removes the provisional listener when spawn fails", async () => {
    mocks.spawn.mockRejectedValue(new Error("spawn failed"));
    await expect(background.ensureBackgroundRun("npm run dev", "/project")).rejects.toThrow("spawn failed");
    expect(mocks.listeners.get("preview-ready")?.size).toBe(0);
    expect(background.getBackgroundPreviewService()).toBeNull();
});
it("does not conflate case-sensitive projects or relative and absolute drive roots", () => {
    expect(background.sameProjectPath("/Project", "/project")).toBe(false);
    expect(background.sameProjectPath("C:\\Project", "c:/project/")).toBe(true);
    expect(background.sameProjectPath("C:/", "C:")).toBe(false);
    expect(background.sameProjectPath("/", "")).toBe(false);
});

it("shares one start across concurrent callers and permits retry after failure", async () => {
    let resolve!: (id: number) => void;
    mocks.spawn.mockImplementationOnce(() => new Promise<number>((done) => { resolve = done; }));
    const first = background.ensureBackgroundRun("npm run dev", "/project");
    const second = background.ensureBackgroundRun("npm run dev", "/project");
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    resolve(7);
    expect(await Promise.all([first, second])).toEqual([7, 7]);
    expect(await background.ensureBackgroundRun("npm run dev", "/project")).toBe(7);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    emit("pty-exit", { id: 7 });
    mocks.spawn.mockRejectedValueOnce(new Error("failed start"));
    await expect(background.ensureBackgroundRun("npm run dev", "/project")).rejects.toThrow("failed start");
    expect(await background.ensureBackgroundRun("npm run dev", "/project")).toBe(7);
});
