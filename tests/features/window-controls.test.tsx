import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
    close: vi.fn(), minimize: vi.fn(), maximize: vi.fn(), unmaximize: vi.fn(),
    isMaximized: vi.fn(), isFullscreen: vi.fn(), listen: vi.fn(), error: vi.fn(), runtime: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("@/features/notifications", () => ({ notify: { error: native.error } }));
vi.mock("@/lib/window/tauri-window", () => ({ isTauriRuntime: native.runtime }));
import { useWindowControls } from "@/features/agent/workbench/titlebar/hooks/use-window-controls";
let host: HTMLDivElement; let root: Root;
let controls: ReturnType<typeof useWindowControls>;
function Harness() {
    const value = useWindowControls();
    useLayoutEffect(() => { controls = value; }, [value]);
    return null;
}
async function mount() { await act(async () => root.render(<Harness />)); }
beforeEach(() => {
    for (const mock of Object.values(native)) mock.mockReset();
    native.runtime.mockReturnValue(true);
    native.isMaximized.mockResolvedValue(false); native.isFullscreen.mockResolvedValue(false);
    native.listen.mockResolvedValue(vi.fn());
    for (const command of [native.close, native.minimize, native.maximize, native.unmaximize]) command.mockResolvedValue(undefined);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.documentElement.removeAttribute("data-window-maximized"); });

it("unsubscribes a resize listener that registers after unmount", async () => {
    let finish!: (unlisten: () => void) => void;
    native.listen.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount();
    const unlisten = vi.fn();
    await act(async () => root.unmount());
    await act(async () => finish(unlisten));
    expect(unlisten).toHaveBeenCalledTimes(1);
});
it("does not register a resize listener after initial chrome synchronization outlives the hook", async () => {
    let finish!: (maximized: boolean) => void;
    native.isMaximized.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(); await act(async () => root.unmount());
    await act(async () => finish(true));
    expect(native.listen).not.toHaveBeenCalled();
    expect(document.documentElement.hasAttribute("data-window-maximized")).toBe(false);
});
it("both close aliases request the current window once per click", async () => {
    await mount();
    await act(async () => { controls.close(); controls.closeWindow(); });
    expect(native.close).toHaveBeenCalledTimes(2);
});
it("does not initialize native window controls in a browser preview", async () => {
    native.runtime.mockReturnValue(false);
    await mount();
    expect(native.listen).not.toHaveBeenCalled();
});

it.each(["close", "minimize", "toggleMaximize"] as const)("reports a failed %s action without an unhandled rejection", async action => {
    await mount();
    (action === "toggleMaximize" ? native.maximize : native[action]).mockRejectedValueOnce(new Error("native failure"));
    await act(async () => { await controls[action](); });
    expect(native.error).toHaveBeenCalledTimes(1);
});
it("reports an initial read failure but still subscribes for future resize updates", async () => {
    native.isMaximized.mockRejectedValueOnce(new Error("initial failure"));
    await mount();
    expect(native.error).toHaveBeenCalledTimes(1);
    expect(native.listen).toHaveBeenCalledTimes(1);
    native.isMaximized.mockResolvedValueOnce(true);
    await act(async () => native.listen.mock.calls[0][1]());
    expect(controls.isMaximized).toBe(true);
});
it("reports a resize callback failure", async () => {
    await mount();
    native.isMaximized.mockRejectedValueOnce(new Error("resize failure"));
    await act(async () => native.listen.mock.calls[0][1]());
    expect(native.error).toHaveBeenCalledTimes(1);
});
it("keeps the newest resize synchronization when older native reads finish late", async () => {
    await mount();
    let finish!: (value: boolean) => void;
    native.isMaximized.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const resized = native.listen.mock.calls[0][1];
    await act(async () => resized());
    native.isMaximized.mockResolvedValueOnce(false);
    await act(async () => resized());
    await act(async () => finish(true));
    expect(controls.isMaximized).toBe(false);
    expect(document.documentElement.hasAttribute("data-window-maximized")).toBe(false);
});
it("resynchronizes actual native state instead of guessing after a maximize command", async () => {
    await mount();
    // The OS can change the window again while the command response is in flight.
    await act(async () => controls.toggleMaximize());
    expect(native.maximize).toHaveBeenCalledTimes(1);
    expect(controls.isMaximized).toBe(false);
});

it("reports a rejected listener registration", async () => {
    native.listen.mockRejectedValueOnce(new Error("registration failed"));
    await mount();
    expect(native.error).toHaveBeenCalledTimes(1);
});
it("disposes an established listener once and fences its pending callback", async () => {
    const unlisten = vi.fn();
    native.listen.mockResolvedValueOnce(unlisten);
    await mount();
    let finish!: (value: boolean) => void;
    native.isMaximized.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => native.listen.mock.calls[0][1]());
    await act(async () => root.unmount());
    await act(async () => finish(true));
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(document.documentElement.hasAttribute("data-window-maximized")).toBe(false);
});
it("uses fullscreen state for chrome without treating it as maximized", async () => {
    native.isFullscreen.mockResolvedValue(true);
    await mount();
    expect(controls.isMaximized).toBe(false);
    expect(document.documentElement.hasAttribute("data-window-maximized")).toBe(true);
});
