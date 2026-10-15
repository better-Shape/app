import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
    cancelled: undefined as undefined | ((event: { payload: { label: string } }) => void),
    destroyed: undefined as undefined | (() => void),
    stopCancel: vi.fn(), stopDestroyed: vi.fn(), close: vi.fn(), listen: vi.fn(), once: vi.fn(), enumerate: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
    TauriEvent: { WINDOW_DESTROYED: "tauri://destroyed" },
    listen: state.listen,
    emitTo: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/window", () => ({ getAllWindows: state.enumerate }));
import { closeOtherWindows } from "@/lib/window/close-others";
beforeEach(() => {
    vi.clearAllMocks(); state.cancelled = undefined; state.destroyed = undefined;
    state.close.mockReset().mockResolvedValue(undefined);
    state.stopCancel.mockReset(); state.stopDestroyed.mockReset();
    state.listen.mockReset().mockImplementation(async (_event: string, callback: typeof state.cancelled) => { state.cancelled = callback; return state.stopCancel; });
    state.once.mockReset().mockImplementation(async (_event: string, callback: () => void) => { state.destroyed = callback; return state.stopDestroyed; });
    state.enumerate.mockReset().mockResolvedValue([{ label: "main" }, { label: "settings", close: state.close, once: state.once }]);
});
afterEach(() => vi.useRealTimers());
it("does not equate a queued close with destruction", async () => {
    let finished = false;
    const result = closeOtherWindows("main").then((closed) => { finished = true; return closed; });
    await vi.waitFor(() => expect(state.close).toHaveBeenCalled());
    expect(finished).toBe(false);
    state.destroyed?.();
    expect(await result).toBe(true);
    expect(state.stopCancel).toHaveBeenCalledOnce();
    expect(state.stopDestroyed).toHaveBeenCalledOnce();
});
it("keeps the main window when a secondary window cancels", async () => {
    const result = closeOtherWindows("main");
    await vi.waitFor(() => expect(state.close).toHaveBeenCalled());
    state.cancelled?.({ payload: { label: "settings" } });
    expect(await result).toBe(false);
    expect(state.stopCancel).toHaveBeenCalledOnce();
    expect(state.stopDestroyed).toHaveBeenCalledOnce();
});
it("fails closed and cleans up when the native close request rejects", async () => {
    state.close.mockRejectedValue(new Error("Unavailable"));
    expect(await closeOtherWindows("main")).toBe(false);
    expect(state.stopCancel).toHaveBeenCalledOnce();
    expect(state.stopDestroyed).toHaveBeenCalledOnce();
});

it("times out a hanging close IPC and cleans listeners", async () => {
    vi.useFakeTimers();
    state.close.mockImplementation(() => new Promise(() => undefined));
    const result = closeOtherWindows("main");
    await vi.waitFor(() => expect(state.close).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toBe(false);
    expect(state.stopCancel).toHaveBeenCalledOnce();
    expect(state.stopDestroyed).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
});

it("times out enumeration without issuing a late close", async () => {
    vi.useFakeTimers();
    let resolve!: (windows: unknown[]) => void;
    state.enumerate.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const result = closeOtherWindows("main");
    await vi.waitFor(() => expect(state.enumerate).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toBe(false);
    resolve([{ label: "settings", close: state.close, once: state.once }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.close).not.toHaveBeenCalled();
});

it.each(["listen", "once"] as const)("cleans up a late %s registration after timeout", async (method) => {
    vi.useFakeTimers();
    let resolve!: (stop: () => void) => void;
    state[method].mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const result = closeOtherWindows("main");
    await vi.waitFor(() => expect(state[method]).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toBe(false);
    const stopLate = vi.fn(); resolve(stopLate);
    await vi.advanceTimersByTimeAsync(0);
    expect(stopLate).toHaveBeenCalledOnce();
    expect(state.close).not.toHaveBeenCalled();
});

it("accepts observed destruction even if the close IPC never returns", async () => {
    state.close.mockImplementation(() => new Promise(() => undefined));
    const result = closeOtherWindows("main");
    await vi.waitFor(() => expect(state.close).toHaveBeenCalled());
    state.destroyed?.();
    expect(await result).toBe(true);
});

it("continues cleanup if an unlisten function throws", async () => {
    state.stopCancel.mockImplementation(() => { throw new Error("Already gone"); });
    const result = closeOtherWindows("main");
    await vi.waitFor(() => expect(state.close).toHaveBeenCalled());
    state.destroyed?.();
    expect(await result).toBe(true);
    expect(state.stopDestroyed).toHaveBeenCalledOnce();
});
