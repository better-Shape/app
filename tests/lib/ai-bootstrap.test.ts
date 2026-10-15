import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ settings: vi.fn(), sync: vi.fn(), ready: vi.fn(), stop: vi.fn() }));
vi.mock("@/lib/settings", () => ({ initSettings: mocks.settings }));
vi.mock("@/lib/ai/sync", () => ({ initAiConfigSync: mocks.sync, aiConfigReady: mocks.ready }));
beforeEach(() => {
    vi.resetModules();
    mocks.settings.mockReset().mockResolvedValue(undefined);
    mocks.sync.mockReset().mockReturnValue(mocks.stop);
    mocks.ready.mockReset().mockResolvedValue(undefined);
    mocks.stop.mockReset();
});
it("an early send waits for actual keychain hydration and shares the layout owner", async () => {
    let finish!: () => void;
    mocks.ready.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const boot = await import("@/lib/ai/bootstrap");
    const layout = boot.acquireAiConfiguration();
    let sent = false;
    const send = boot.waitForAiConfiguration(new AbortController().signal).then(() => { sent = true; });
    await vi.waitFor(() => expect(mocks.ready).toHaveBeenCalled());
    expect(sent).toBe(false);
    mocks.ready.mockResolvedValue(undefined); finish(); await send;
    expect(sent).toBe(true);
    expect(mocks.settings).toHaveBeenCalledTimes(1);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.stop).not.toHaveBeenCalled();
    layout.release(); expect(mocks.stop).toHaveBeenCalledTimes(1);
});
it("surfaces initialization failure and permits a fresh attempt", async () => {
    mocks.settings.mockRejectedValueOnce(new Error("unavailable"));
    const boot = await import("@/lib/ai/bootstrap");
    await expect(boot.waitForAiConfiguration(new AbortController().signal)).rejects.toThrow("unavailable");
    await boot.waitForAiConfiguration(new AbortController().signal);
    expect(mocks.settings).toHaveBeenCalledTimes(2);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
});
it("cancels a waiting send without stopping a layout's hydration owner", async () => {
    let finish!: () => void;
    mocks.ready.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const boot = await import("@/lib/ai/bootstrap");
    const layout = boot.acquireAiConfiguration(); const abort = new AbortController();
    const send = boot.waitForAiConfiguration(abort.signal);
    await vi.waitFor(() => expect(mocks.ready).toHaveBeenCalled());
    abort.abort(); await expect(send).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.stop).not.toHaveBeenCalled();
    finish(); await layout.ready; layout.release();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
});
it("keeps edit tracking until an orphaned hydration settles", async () => {
    let finish!: () => void;
    mocks.ready.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const boot = await import("@/lib/ai/bootstrap"); const owner = boot.acquireAiConfiguration();
    await vi.waitFor(() => expect(mocks.ready).toHaveBeenCalled());
    owner.release(); owner.release(); expect(mocks.stop).not.toHaveBeenCalled();
    finish(); await owner.ready; expect(mocks.stop).toHaveBeenCalledTimes(1);
});
