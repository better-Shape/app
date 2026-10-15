import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
    listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
    spawn: vi.fn(), kill: vi.fn(), read: vi.fn(), registration: vi.fn(), release: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (name: string, fn: (event: { payload: unknown }) => void) => {
    await mocks.registration(name);
    const listeners = mocks.listeners.get(name) ?? new Set();
    mocks.listeners.set(name, listeners); listeners.add(fn);
    return () => { listeners.delete(fn); return mocks.release(name); };
} }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, args: unknown) => command === "pty_spawn_run" ? mocks.spawn() : command === "pty_read_output" ? mocks.read(args) : mocks.kill() }));
vi.mock("@/lib/backend", () => ({ getProjectPath: () => "/project" }));
vi.mock("@/lib/settings", () => ({ resolveDefaultTerminalShell: () => "default" }));
vi.mock("@/features/terminal/session", () => ({ registerBoundTerminalTab: vi.fn(), terminalSessionStore: { appendPtyOutput: vi.fn(), clearPtyScrollback: vi.fn() } }));
let background: typeof import("@/features/terminal/background-run");
function emit(name: string, payload: unknown) { for (const listener of mocks.listeners.get(name) ?? []) listener({ payload }); }
beforeEach(async () => {
    vi.resetModules(); mocks.listeners.clear(); mocks.spawn.mockReset().mockResolvedValue(7);
    mocks.read.mockReset().mockImplementation(async ({ id }: { id: number }) => ({ sessionId: id, running: true, exitCode: null, previewUrl: null }));
    mocks.release.mockReset().mockResolvedValue(undefined); mocks.kill.mockReset().mockResolvedValue(undefined); mocks.registration.mockReset().mockResolvedValue(undefined);
    background = await import("@/features/terminal/background-run");
});
afterEach(async () => { await background.stopBackgroundRun(); vi.unstubAllGlobals(); });
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

it("rejects a PTY that exits before the spawn reply, even after announcing readiness", async () => {
    mocks.spawn.mockImplementationOnce(async () => {
        emit("preview-ready", { id: 7, url: "http://localhost:5173", source: "output" });
        emit("pty-exit", { id: 7, exit_code: 0 });
        return 7;
    });
    await expect(background.ensureBackgroundRun("npm run dev")).rejects.toThrow();
    expect(background.getBackgroundPreviewService()).toBeNull();
    expect(background.getLastPreviewReadyUrl()).toBeNull();
    expect([...mocks.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
    expect(await background.ensureBackgroundRun("npm run dev")).toBe(7);
});

it("does not mistake another PTY's early exit for this run's exit", async () => {
    mocks.spawn.mockImplementationOnce(async () => {
        emit("pty-exit", { id: 8 });
        emit("preview-ready", { id: 7, url: "http://localhost:5173", source: "output" });
        return 7;
    });
    await background.ensureBackgroundRun("npm run dev");
    expect(background.getBackgroundPreviewService()?.ptyId).toBe(7);
});

it("revokes a start stopped while the spawn reply is still pending", async () => {
    let resolve!: (id: number) => void;
    mocks.spawn.mockImplementationOnce(() => new Promise<number>(done => { resolve = done; }));
    const start = background.ensureBackgroundRun("npm run dev");
    const rejected = expect(start).rejects.toThrow();
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
    await background.stopBackgroundRun();
    emit("preview-ready", { id: 7, url: "http://localhost:5173", source: "output" });
    resolve(7);
    await rejected;
    expect(background.getBackgroundPreviewService()).toBeNull();
    expect(mocks.kill).toHaveBeenCalled();
});

it("removes all provisional listeners when registration fails before spawn", async () => {
    mocks.registration.mockImplementation(async (name: string) => { if (name === "pty-exit") throw new Error("cannot register"); });
    await expect(background.ensureBackgroundRun("npm run dev")).rejects.toThrow("cannot register");
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect([...mocks.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
});

it("handles asynchronous native unlisten failures during shutdown", async () => {
    await background.ensureBackgroundRun("npm run dev");
    mocks.release.mockRejectedValue(new Error("webview gone"));
    await background.stopBackgroundRun();
    expect(background.getBackgroundPreviewService()).toBeNull();
    expect([...mocks.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
});

it.each([
    [{ id: 7 }, "error"],
    [{ id: 7, exit_code: 0 }, "idle"],
    [{ id: 7, exit_code: 2 }, "error"],
])("does not invent a successful exit code for %o", async (payload, expected) => {
    await background.ensureBackgroundRun("npm run dev", "/project");
    emit("pty-exit", payload);
    const { getDevRunSnapshot } = await import("@/features/preview/run-status");
    expect(getDevRunSnapshot().status).toBe(expected);
    expect(background.getBackgroundPreviewService()).toBeNull();
});

it("clears startup status when loading the native bridge module fails", async () => {
    vi.doMock("@tauri-apps/api/core", () => { throw new Error("Bridge import failed"); });
    try {
        await expect(background.ensureBackgroundRun("npm run dev", "/project")).rejects.toThrow();
        const { getDevRunSnapshot } = await import("@/features/preview/run-status");
        expect(getDevRunSnapshot().status).toBe("idle");
        expect(mocks.spawn).not.toHaveBeenCalled();
        expect([...mocks.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
    } finally {
        vi.doMock("@tauri-apps/api/core", () => ({ invoke: (command: string, args: unknown) => command === "pty_spawn_run" ? mocks.spawn() : command === "pty_read_output" ? mocks.read(args) : mocks.kill() }));
    }
});

it("continues releasing remaining listeners when one unlisten throws synchronously", async () => {
    await background.ensureBackgroundRun("npm run dev");
    mocks.release.mockImplementationOnce(() => { throw new Error("webview gone"); });
    await background.stopBackgroundRun();
    expect(background.getBackgroundPreviewService()).toBeNull();
    expect([...mocks.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
});

it("waits for cancelled spawn cleanup before retrying the same command", async () => {
    let finish!: (id: number) => void;
    mocks.spawn.mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve; })).mockResolvedValueOnce(8);
    const first = background.ensureBackgroundRun("npm run dev");
    const cancelled = expect(first).rejects.toThrow("Preview start cancelled");
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    await background.stopBackgroundRun();
    const retry = background.ensureBackgroundRun("npm run dev");
    const restarted = expect(retry).resolves.toBe(8);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    finish(7);
    await cancelled; await restarted;
    expect(mocks.kill).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
});

it("replays only the selected PTY's output received before the spawn response", async () => {
    mocks.spawn.mockImplementationOnce(async () => {
        emit("pty-output", { id: 8, data: "unrelated ready" });
        emit("pty-output", { id: 7, data: "starting compiler\n" });
        emit("pty-output", { id: 7, data: "fatal: failed to compile\n" });
        return 7;
    });
    await background.ensureBackgroundRun("npm run dev");
    const { terminalSessionStore } = await import("@/features/terminal/session");
    const { getDevRunSnapshot } = await import("@/features/preview/run-status");
    expect(terminalSessionStore.appendPtyOutput).toHaveBeenCalledWith(7, "starting compiler\n");
    expect(terminalSessionStore.appendPtyOutput).toHaveBeenCalledWith(7, "fatal: failed to compile\n");
    expect(terminalSessionStore.appendPtyOutput).not.toHaveBeenCalledWith(8, expect.anything());
    expect(getDevRunSnapshot().status).toBe("error");
});
it("preserves an early failed exit as an error instead of clearing it to idle", async () => {
    mocks.spawn.mockImplementationOnce(async () => {
        emit("pty-output", { id: 7, data: "fatal startup error\n" });
        emit("pty-exit", { id: 7, exit_code: 1 });
        return 7;
    });
    await expect(background.ensureBackgroundRun("npm run dev")).rejects.toThrow("exited during startup");
    const { getDevRunSnapshot } = await import("@/features/preview/run-status");
    expect(getDevRunSnapshot().status).toBe("error");
    expect(background.getBackgroundPreviewService()).toBeNull();
});


it.each(["Linux", "Darwin", "unknown"])("preserves POSIX double-slash case on %s", userAgent => {
    vi.stubGlobal("navigator", { userAgent });
    expect(background.sameProjectPath("//Work/App", "//work/app")).toBe(false);
    expect(background.sameProjectPath("//Work/App/", "//Work/App")).toBe(true);
    expect(background.sameProjectPath("//", "/")).toBe(false);
    expect(background.sameProjectPath("///", "/")).toBe(true);
});
it("recognizes slash-form UNC paths on Windows", () => {
    vi.stubGlobal("navigator", { userAgent: "Windows" });
    expect(background.sameProjectPath("//Server/Share/App", "//server/share/app/")).toBe(true);
    expect(background.sameProjectPath(String.raw`\\Server\Share\App`, "//server/share/app")).toBe(true);
    expect(background.sameProjectPath(String.raw`\\?\C:\App`, "c:/app/")).toBe(true);
});
it("keeps literal POSIX backslashes and whitespace in project identity", () => {
    vi.stubGlobal("navigator", { userAgent: "Linux" });
    expect(background.sameProjectPath(String.raw`/project/a\b`, "/project/a/b")).toBe(false);
    expect(background.sameProjectPath("/project/app ", "/project/app")).toBe(false);
    expect(background.spawnCwd("/project/app ")).toBe("/project/app ");
    expect(background.sameProjectPath(String.raw`C:\Users\App`, "/mnt/c/Users/App")).toBe(false);
    expect(background.sameProjectPath(String.raw`\Project`, String.raw`\project`)).toBe(false);
});
it("starts a different PTY for distinct double-slash POSIX projects", async () => {
    vi.stubGlobal("navigator", { userAgent: "Linux" });
    mocks.spawn.mockResolvedValueOnce(7).mockResolvedValueOnce(8);
    await background.ensureBackgroundRun("npm run dev", "//Work/App");
    emit("preview-ready", { id: 7, url: "http://localhost:5173", source: "output" });
    expect(await background.ensureBackgroundRun("npm run dev", "//work/app")).toBe(8);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.kill).toHaveBeenCalled();
    expect(background.getBackgroundPreviewService()).toBeNull();
    emit("preview-ready", { id: 8, url: "http://localhost:5174", source: "output" });
    expect(background.getBackgroundPreviewService()).toEqual({ ptyId: 8, projectPath: "//work/app", url: "http://localhost:5174" });
});

function floodEarlyExits() {
    for (let id = 100; id < 240; id++) emit("pty-exit", { id, exit_code: 0 });
}

it("reconciles an overflowing early-exit buffer against the selected live native session", async () => {
    mocks.spawn.mockImplementationOnce(async () => {
        floodEarlyExits();
        emit("preview-ready", { id: 7, url: "http://localhost:5173", source: "output" });
        return 7;
    });
    expect(await background.ensureBackgroundRun("npm run dev")).toBe(7);
    expect(mocks.read).toHaveBeenCalledWith({ id: 7, tailChars: 500 });
    expect(mocks.kill).not.toHaveBeenCalled();
    expect(background.getBackgroundPreviewService()?.ptyId).toBe(7);
});

it("adopts a dev URL the run printed when native kept no readiness record", async () => {
    mocks.read.mockImplementation(async ({ id, tailChars }: { id: number; tailChars: number }) => tailChars === 500
        ? { sessionId: id, running: true, exitCode: null, previewUrl: null }
        : { sessionId: id, running: true, exitCode: null, previewUrl: null, output: "  ➜  Local:   http://localhost:4321/\n" });
    expect(await background.ensureBackgroundRun("npm run dev", "/project")).toBe(7);
    expect(mocks.read).toHaveBeenCalledWith({ id: 7, tailChars: 500 });
    expect(background.getBackgroundPreviewService()).toEqual({ ptyId: 7, projectPath: "/project", url: "http://localhost:4321" });
});

it("does not adopt a URL from a session that is no longer running", async () => {
    mocks.read.mockImplementation(async ({ id, tailChars }: { id: number; tailChars: number }) => tailChars === 500
        ? { sessionId: id, running: true, exitCode: null, previewUrl: null }
        : { sessionId: id, running: false, exitCode: 0, previewUrl: null, output: "Local: http://localhost:4321/\n" });
    await background.ensureBackgroundRun("npm run dev", "/project");
    expect(background.getBackgroundPreviewService()).toBeNull();
});

it("refuses to replace a live run whose process cannot be killed", async () => {
    await background.ensureBackgroundRun("npm run dev", "/project");
    emit("preview-ready", { id: 7, url: "http://localhost:5173", source: "output" });
    expect(background.getBackgroundPreviewService()).toEqual({ ptyId: 7, projectPath: "/project", url: "http://localhost:5173" });
    // A replacement start has to stop the old server first; if that kill fails, spawning a
    // second PTY would leave the first running unowned and still holding its port.
    mocks.kill.mockRejectedValueOnce(new Error("kill failed"));
    await expect(background.ensureBackgroundRun("npm run preview", "/project")).rejects.toThrow("Could not stop the running preview process");
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(background.getBackgroundPreviewService()).toEqual({ ptyId: 7, projectPath: "/project", url: "http://localhost:5173" });
    // The run stays owned, so a later Stop can still reach it and the exit event is still observed.
    await background.stopBackgroundRun();
    expect(mocks.kill).toHaveBeenCalledTimes(2);
    expect(background.getBackgroundPreviewService()).toBeNull();
});

it("keeps the run observable when a Stop cannot kill its process, and retries", async () => {
    await background.ensureBackgroundRun("npm run dev", "/project");
    emit("preview-ready", { id: 7, url: "http://localhost:5173", source: "output" });
    mocks.kill.mockRejectedValueOnce(new Error("kill failed"));
    await expect(background.stopBackgroundRun()).rejects.toThrow("Could not stop the running preview process");
    expect(background.getBackgroundPreviewService()).toEqual({ ptyId: 7, projectPath: "/project", url: "http://localhost:5173" });
    await background.stopBackgroundRun();
    expect(background.getBackgroundPreviewService()).toBeNull();
});

it("does not revive an exited selected PTY when its early exit was dropped", async () => {
    mocks.spawn.mockImplementationOnce(async () => { floodEarlyExits(); emit("pty-exit", { id: 7, exit_code: 7 }); return 7; });
    mocks.read.mockResolvedValue({ sessionId: 7, running: false, exitCode: 7 });
    await expect(background.ensureBackgroundRun("npm run dev")).rejects.toThrow("exited during startup");
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(background.getBackgroundPreviewService()).toBeNull();
    const { getDevRunSnapshot } = await import("@/features/preview/run-status");
    expect(getDevRunSnapshot().status).toBe("error");
});

it("keeps selected exit events received during reconciliation despite a stale running snapshot", async () => {
    mocks.spawn.mockImplementationOnce(async () => { floodEarlyExits(); return 7; });
    mocks.read.mockImplementationOnce(async () => {
        floodEarlyExits();
        emit("pty-exit", { id: 7, exit_code: 7 });
        return { sessionId: 7, running: true, exitCode: null };
    });
    await expect(background.ensureBackgroundRun("npm run dev")).rejects.toThrow("exited during startup");
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(background.getBackgroundPreviewService()).toBeNull();
    expect([...mocks.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
});

it.each(["unavailable", "wrong session", "malformed"])("rejects %s status evidence after overflow", async state => {
    mocks.spawn.mockImplementationOnce(async () => { floodEarlyExits(); return 7; });
    if (state === "unavailable") mocks.read.mockRejectedValue(new Error("Native status unavailable"));
    else mocks.read.mockResolvedValue(state === "wrong session" ? { sessionId: 8, running: true } : { sessionId: 7 });
    await expect(background.ensureBackgroundRun("npm run dev")).rejects.toThrow();
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.kill).toHaveBeenCalledOnce();
    expect(background.getBackgroundPreviewService()).toBeNull();
    expect([...mocks.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
});

it("keeps the selected output readiness received during native reconciliation", async () => {
    mocks.spawn.mockImplementationOnce(async () => {
        floodEarlyExits();
        emit("preview-ready", { id: 7, url: "http://localhost:5173", source: "output" });
        return 7;
    });
    mocks.read.mockImplementationOnce(async () => {
        floodEarlyExits();
        emit("preview-ready", { id: 8, url: "http://localhost:4444", source: "output" });
        emit("preview-ready", { id: 7, url: "http://localhost:5174", source: "output" });
        emit("preview-ready", { id: 7, url: "http://localhost:3000", source: "probe" });
        expect(background.getBackgroundPreviewService()).toBeNull();
        expect(background.getLastPreviewReadyUrl()).toBeNull();
        return { sessionId: 7, running: true };
    });
    await background.ensureBackgroundRun("npm run dev");
    expect(background.getBackgroundPreviewService()?.url).toBe("http://localhost:5174");
});

it("cannot publish a run stopped while overflow reconciliation was pending", async () => {
    mocks.spawn.mockImplementationOnce(async () => { floodEarlyExits(); return 7; });
    let finish!: () => void;
    mocks.read.mockImplementationOnce(() => new Promise(resolve => {
        finish = () => resolve({ sessionId: 7, running: true });
    }));
    const starting = background.ensureBackgroundRun("npm run dev");
    const rejected = expect(starting).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await background.stopBackgroundRun();
    emit("preview-ready", { id: 7, url: "http://localhost:5173", source: "output" });
    finish(); await rejected;
    expect(background.getBackgroundPreviewService()).toBeNull();
    expect(background.getLastPreviewReadyUrl()).toBeNull();
    expect([...mocks.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
    expect(mocks.kill).toHaveBeenCalledOnce();
    expect(await background.ensureBackgroundRun("npm run dev")).toBe(7);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
});


it("recovers the selected PTY's readiness after more than 32 early announcements", async () => {
    mocks.spawn.mockImplementationOnce(async () => {
        for (let id = 100; id < 164; id += 1) emit("preview-ready", { id, url: `http://localhost:${3000 + id}`, source: "output" });
        emit("preview-ready", { id: 7, url: "http://localhost:5173", source: "output" });
        return 7;
    });
    mocks.read.mockResolvedValueOnce({ sessionId: 7, running: true, previewUrl: "http://localhost:5173" });
    await background.ensureBackgroundRun("npm run dev", "/project");
    expect(background.getBackgroundPreviewService()).toEqual({ ptyId: 7, projectPath: "/project", url: "http://localhost:5173" });
});

it("reattaches an existing native PTY using retained output readiness without an event replay", async () => {
    mocks.read.mockResolvedValueOnce({ sessionId: 7, running: true, previewUrl: "http://localhost:5173" });
    await background.ensureBackgroundRun("npm run dev", "/project");
    expect(background.getBackgroundPreviewService()?.url).toBe("http://localhost:5173");
});

it("prefers a newer output event received while a readiness snapshot is pending", async () => {
    mocks.read.mockImplementationOnce(async () => {
        emit("preview-ready", { id: 7, url: "http://localhost:5174", source: "output" });
        return { sessionId: 7, running: true, previewUrl: "http://localhost:5173" };
    });
    await background.ensureBackgroundRun("npm run dev", "/project");
    expect(background.getBackgroundPreviewService()?.url).toBe("http://localhost:5174");
});

it("does not authorize retained readiness from an exited reattached process", async () => {
    mocks.read.mockResolvedValueOnce({ sessionId: 7, running: false, exitCode: 2, previewUrl: "http://localhost:5173" });
    await expect(background.ensureBackgroundRun("npm run dev", "/project")).rejects.toThrow("exited during startup");
    expect(background.getBackgroundPreviewService()).toBeNull();
});


it("does not let a later probe hide the native output-owned readiness snapshot", async () => {
    mocks.read.mockImplementationOnce(async () => {
        emit("preview-ready", { id: 7, url: "http://localhost:3000", source: "probe" });
        return { sessionId: 7, running: true, previewUrl: "http://localhost:5173", previewRevision: 2 };
    });
    await background.ensureBackgroundRun("npm run dev", "/project");
    expect(background.getBackgroundPreviewService()?.url).toBe("http://localhost:5173");
});

it.each([1, 3])("orders output events and native snapshots by revision, not delivery order (%i)", async revision => {
    mocks.read.mockImplementationOnce(async () => {
        emit("preview-ready", { id: 7, url: "http://localhost:5174", source: "output", revision });
        return { sessionId: 7, running: true, previewUrl: "http://localhost:5173", previewRevision: 2 };
    });
    await background.ensureBackgroundRun("npm run dev", "/project");
    const expected = revision > 2 ? "http://localhost:5174" : "http://localhost:5173";
    expect(background.getBackgroundPreviewService()?.url).toBe(expected);
    emit("preview-ready", { id: 7, url: "http://localhost:3000", source: "output", revision: 1 });
    expect(background.getBackgroundPreviewService()?.url).toBe(expected);
});
