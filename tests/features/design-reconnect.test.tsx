import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({
    service: { projectPath: "/project", url: "http://localhost:5173", ptyId: 7 },
    ready: new Set<(url: string) => void>(), register: vi.fn(), probe: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ commands: {
    inspectDesignProject: async (projectRoot: string) => ({ projectRoot, framework: "vite", supported: true }),
    listDesignAssets: async () => [], rememberPreviewUrl: async () => {},
    registerDesignBridge: backend.register, probePreviewUrl: backend.probe,
} }));
vi.mock("@/features/detection/lib/lib", () => ({ detectDevCommand: async () => ({ command: "npm run dev", urlHint: "http://localhost:5173" }) }));
vi.mock("@/features/preview/lib/discover-routes", () => ({ discoverDesignPages: async () => [] }));
vi.mock("@/features/terminal/background-run", () => ({
    getBackgroundPreviewService: () => backend.service,
    getBackgroundRunCwd: () => backend.service.projectPath,
    getLastPreviewReadyUrl: () => backend.service.url,
    sameProjectPath: (a: string, b: string) => a === b,
    ensureBackgroundRun: async () => backend.service.ptyId,
    subscribePreviewReady: (cb: (url: string) => void) => { backend.ready.add(cb); return () => backend.ready.delete(cb); },
}));
vi.mock("@/features/preview/design/toolbar", async (original) => ({
    ...await original<typeof import("@/features/preview/design/toolbar")>(), DesignToolbar: () => null,
}));
vi.mock("@/features/preview/design/panel", () => ({ DesignStylePanel: () => null }));
import { DesignStudio } from "@/features/preview/design/shell";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
    backend.service = { projectPath: "/project", url: "http://localhost:5173", ptyId: 7 };
    backend.ready.clear(); backend.register.mockReset().mockResolvedValue(undefined); backend.probe.mockReset().mockResolvedValue(true);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render() { await act(async () => root.render(<DesignStudio projectPath="/project" onClose={() => {}} />)); }
async function replaceService(id: number) {
    await act(async () => {
        backend.service = { ...backend.service, ptyId: id };
        for (const cb of backend.ready) cb(backend.service.url);
    });
}
it("reauthorizes and replaces the actual frame when a new PTY uses the same origin", async () => {
    await render();
    const oldFrame = host.querySelector("iframe");
    expect(oldFrame).not.toBeNull();
    expect(backend.register).toHaveBeenCalledTimes(1);
    await replaceService(8);
    expect(backend.register).toHaveBeenCalledTimes(2);
    expect(host.querySelector("iframe")).not.toBe(oldFrame);
});
it("retries the newest service when replacement happens during bridge registration", async () => {
    await render();
    let finish!: () => void;
    backend.register.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await replaceService(8);
    expect(backend.register).toHaveBeenCalledTimes(2);
    await replaceService(9);
    await act(async () => finish());
    expect(backend.register).toHaveBeenCalledTimes(3);
    expect(host.querySelector("iframe")).not.toBeNull();
});
it("does not reconnect to a replacement belonging to a different project", async () => {
    await render();
    backend.service = { ...backend.service, projectPath: "/other-project" };
    await replaceService(8);
    expect(backend.register).toHaveBeenCalledTimes(1);
});

it("shows a failed reconnect instead of leaving the canvas loading, and recovers on the next readiness event", async () => {
    await render();
    backend.probe.mockResolvedValueOnce(false);
    await replaceService(8);
    expect(host.textContent).toContain("Could not connect to the project preview.");
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    await replaceService(9);
    expect(host.textContent).not.toContain("Could not connect to the project preview.");
    expect(host.querySelector("iframe")).not.toBeNull();
});
