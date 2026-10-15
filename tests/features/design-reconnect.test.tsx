import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const SOURCE = 'export default function App() { return <main><div className="card">Hello</div><div>Other</div></main>; }';
type PanelProps = ComponentProps<typeof import("@/features/preview/design/panel").DesignStylePanel>;
const backend = vi.hoisted(() => ({
    service: { projectPath: "/project", url: "http://localhost:5173", ptyId: 7 },
    ready: new Set<(url: string) => void>(), register: vi.fn(), probe: vi.fn(),
    exportSelection: null as null | ((scale: number, format: string) => Promise<void>),
    undo: vi.fn(), redo: vi.fn(),
    panel: null as PanelProps | null, read: vi.fn(), patch: vi.fn(), save: vi.fn(), css: vi.fn(), cssRead: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ commands: {
    inspectDesignProject: async (projectRoot: string) => ({ projectRoot, framework: "vite", supported: true }),
    listDesignAssets: async () => [], rememberPreviewUrl: async () => {},
    registerDesignBridge: backend.register, probePreviewUrl: backend.probe,
    readFile: backend.cssRead, readFileFromDisk: backend.read, applyDesignSourcePatch: backend.patch, saveFile: backend.save,
    primeFileCache: vi.fn(), invalidateFileCache: vi.fn(), undoDesignSourcePatch: backend.undo, redoDesignSourcePatch: backend.redo,
} }));
vi.mock("@/lib/ui/css-variables-loader", async original => ({ ...await original<typeof import("@/lib/ui/css-variables-loader")>(), resolveGlobalsCss: backend.css }));
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
    ...await original<typeof import("@/features/preview/design/toolbar")>(), DesignToolbar: ({ onModeChange }: { onModeChange: (mode: "select") => void }) => <button onClick={() => onModeChange("select")}>Inspect</button>,
}));
vi.mock("@/features/preview/design/panel", () => ({ DesignStylePanel: (props: PanelProps & { onExport: (scale: number, format: string) => Promise<void> }) => { backend.panel = props; backend.exportSelection = props.onExport; return null; } }));
import { invalidateGlobalsCssCache } from "@/lib/ui/css-variables-loader";
import { DesignStudio } from "@/features/preview/design/shell";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
    backend.service = { projectPath: "/project", url: "http://localhost:5173", ptyId: 7 };
    backend.undo.mockReset().mockResolvedValue({ changed: false });
    backend.redo.mockReset().mockResolvedValue({ changed: false });
    invalidateGlobalsCssCache();
    backend.cssRead.mockReset().mockResolvedValue(":root { --seed: red; }");
    backend.panel = null;
    backend.read.mockReset().mockResolvedValue(SOURCE);
    backend.patch.mockReset().mockResolvedValue({}); backend.save.mockReset().mockResolvedValue(undefined);
    backend.css.mockReset().mockResolvedValue({ path: "/project/src/globals.css", content: ":root {}" });
    backend.exportSelection = null; backend.ready.clear(); backend.register.mockReset().mockResolvedValue(undefined); backend.probe.mockReset().mockResolvedValue(true);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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

it.each(["origin", "frame", "service", "project"])("rejects an export response from a different %s", async (mismatch) => {
    await render();
    await act(async () => host.querySelector("button")?.click());
    const frame = host.querySelector("iframe")!;
    const post = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    let finished = false;
    const request = backend.exportSelection!(1, "png").then(() => { finished = true; });
    const sent = post.mock.calls.find(([data]) => data.type === "bettershape-design-export")![0];
    const service = backend.service;
    if (mismatch === "service") backend.service = { ...service, ptyId: 8 };
    if (mismatch === "project") backend.service = { ...service, projectPath: "/other" };
    const respond = (origin: string, source: MessageEventSource | null) => window.dispatchEvent(new MessageEvent("message", {
        origin, source, data: { type: "bettershape-design-export-result", requestId: sent.requestId },
    }));
    await act(async () => { respond(mismatch === "origin" ? "http://localhost:4000" : service.url, mismatch === "frame" ? window : frame.contentWindow); });
    expect(finished).toBe(false);
    backend.service = service;
    await act(async () => { respond(service.url, frame.contentWindow); await request; });
    expect(finished).toBe(true);
});

it("does not revive an export grant after replacement even if the old service reappears", async () => {
    await render();
    await act(async () => host.querySelector("button")?.click());
    const frame = host.querySelector("iframe")!;
    const post = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
        let finished = false;
        const request = backend.exportSelection!(1, "png").then(() => { finished = true; });
        const sent = post.mock.calls.find(([data]) => data.type === "bettershape-design-export")![0];
        const service = backend.service;
        let finishRegistration!: () => void;
        backend.register.mockImplementationOnce(() => new Promise<void>(resolve => { finishRegistration = resolve; }));
        await act(async () => {
            backend.service = { ...service, ptyId: 8 };
            backend.ready.forEach(callback => callback(service.url));
        });
        backend.service = service;
        expect(host.querySelector("iframe")).toBe(frame);
        await act(async () => {
            window.dispatchEvent(new MessageEvent("message", {
                source: frame.contentWindow, origin: service.url,
                data: { type: "bettershape-design-export-result", requestId: sent.requestId },
            }));
        });
        expect(finished).toBe(false);
        await act(async () => { finishRegistration(); await vi.advanceTimersByTimeAsync(12_000); await request; });
        expect(finished).toBe(true);
    } finally { vi.useRealTimers(); }
});

it("abandons export decoding when the service grant is revoked", async () => {
    await render();
    await act(async () => host.querySelector("button")?.click());
    const frame = host.querySelector("iframe")!;
    const post = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    let loaded!: () => void;
    vi.stubGlobal("Image", class {
        onload: (() => void) | null = null;
        set src(_value: string) { loaded = () => this.onload?.(); }
    });
    const create = vi.spyOn(document, "createElement");
    const request = backend.exportSelection!(1, "png");
    const sent = post.mock.calls.find(([data]) => data.type === "bettershape-design-export")![0];
    await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
            source: frame.contentWindow, origin: backend.service.url,
            data: { type: "bettershape-design-export-result", requestId: sent.requestId, dataUrl: "data:image/png;base64,AA==" },
        }));
    });
    expect(loaded).toBeTypeOf("function");
    backend.service = { ...backend.service, ptyId: 8 };
    await act(async () => { loaded(); await request; });
    expect(create.mock.calls.some(([tag]) => tag === "canvas")).toBe(false);
});

const mutationActions: Array<[string, (panel: PanelProps) => void | Promise<void>]> = [
    ["styles", panel => panel.onCommit({ color: "red" })],
    ["text", panel => panel.onCommitText?.("Changed")],
    ["attribute", panel => panel.onCommitAttr?.("title", "Changed")],
    ["delete", panel => panel.onDelete?.()],
    ["duplicate", panel => panel.onDuplicate?.()],
    ["component", panel => panel.onComponentPatch?.({ key: "selected", field: "text", value: "Changed" })],
    ["token", panel => panel.onCreateToken?.("--brand", "red")],
];

async function selectForMutation() {
    await render();
    await act(async () => host.querySelector("button")?.click());
    const frame = host.querySelector("iframe")!;
    await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
            source: frame.contentWindow, origin: backend.service.url,
            data: { type: "bettershape-design-selection", element: {
                rect: { x: 0, y: 0, width: 100, height: 30 }, key: "selected", tag: "div", text: "Hello", classes: ["card"], styles: {}, attributes: {},
                source: { fileName: "src/App.tsx", lineNumber: 1, columnNumber: 1 },
                component: { tag: "Card", properties: [] },
            } },
        }));
    });
    return backend.panel!;
}

it.each(mutationActions)("allows an authorized %s mutation", async (_name, apply) => {
    const panel = await selectForMutation();
    await act(async () => apply(panel));
    expect(backend.patch.mock.calls.length + backend.save.mock.calls.length).toBe(1);
});

it.each(mutationActions)("rejects a %s mutation after the selected service is replaced", async (_name, apply) => {
    const panel = await selectForMutation();
    backend.service = { ...backend.service, ptyId: 8 };
    await act(async () => apply(panel));
    expect(backend.patch).not.toHaveBeenCalled();
    expect(backend.save).not.toHaveBeenCalled();
});

it("rejects a retained selection callback after a replacement receives a new grant", async () => {
    const panel = await selectForMutation();
    await replaceService(8);
    await act(async () => panel.onCommit({ color: "red" }));
    expect(backend.patch).not.toHaveBeenCalled();
    const fresh = await selectForMutation();
    await act(async () => fresh.onCommit({ color: "blue" }));
    expect(backend.patch).toHaveBeenCalledTimes(1);
});


it.each(mutationActions.filter(([name]) => name !== "token"))("revalidates %s after its final disk read completes", async (name, apply) => {
    const panel = await selectForMutation();
    let finish!: (value: string) => void;
    backend.read.mockClear();
    if (name !== "delete" && name !== "duplicate") backend.read.mockResolvedValueOnce(SOURCE);
    backend.read.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    await act(async () => { apply(panel); });
    expect(backend.read).toHaveBeenCalledTimes(name === "delete" || name === "duplicate" ? 1 : 2);
    backend.service = { ...backend.service, ptyId: 8 };
    await act(async () => finish(SOURCE));
    expect(backend.patch).not.toHaveBeenCalled();
});

it("revalidates token creation after CSS discovery completes", async () => {
    const panel = await selectForMutation();
    let finish!: (value: { path: string; content: string }) => void;
    backend.css.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let pending: void | Promise<void>;
    await act(async () => { pending = panel.onCreateToken?.("--brand", "red"); });
    backend.service = { ...backend.service, ptyId: 8 };
    await act(async () => { finish({ path: "/project/src/globals.css", content: ":root {}" }); await pending; });
    expect(backend.save).not.toHaveBeenCalled();
});

it("does not upgrade a preview-cloned selection to a replacement grant", async () => {
    const panel = await selectForMutation();
    await act(async () => panel.onPreview({ color: "blue" }));
    const cloned = backend.panel!;
    expect(cloned.element?.styles.color).toBe("blue");
    await replaceService(8);
    await act(async () => cloned.onCommit({ color: "red" }));
    expect(backend.patch).not.toHaveBeenCalled();
});

it("rejects the old selection after a project change", async () => {
    const panel = await selectForMutation();
    backend.service = { ...backend.service, projectPath: "/other" };
    await act(async () => root.render(<DesignStudio projectPath="/other" onClose={() => {}} />));
    await act(async () => panel.onCommit({ color: "red" }));
    expect(backend.patch).not.toHaveBeenCalled();
});

it("invalidates a selection when the same iframe loads a new document", async () => {
    const panel = await selectForMutation();
    vi.useFakeTimers();
    try {
        await act(async () => host.querySelector("iframe")!.dispatchEvent(new Event("load")));
        await act(async () => panel.onCommit({ color: "red" }));
        expect(backend.patch).not.toHaveBeenCalled();
    } finally { vi.clearAllTimers(); vi.useRealTimers(); }
});

const frameMutations = [
    ["commit-styles", { styles: { color: "red" } }],
    ["commit-text", { text: "Changed" }],
    ["commit-attr", { attributes: { title: "Changed" } }],
    ["reorder", { before: null }],
    ["delete", {}], ["duplicate", {}],
] as const;

it.each(frameMutations)("revalidates incoming %s after source resolution", async (kind, payload) => {
    const panel = await selectForMutation();
    const frame = host.querySelector("iframe")!;
    let finish!: (source: string) => void;
    if (kind === "commit-styles") backend.read.mockResolvedValueOnce(SOURCE);
    backend.read.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
            source: frame.contentWindow, origin: backend.service.url,
            data: { type: `bettershape-design-${kind}`, element: panel.element, ...payload },
        }));
    });
    expect(finish).toBeTypeOf("function");
    backend.service = { ...backend.service, ptyId: 8 };
    await act(async () => finish(SOURCE));
    expect(backend.patch).not.toHaveBeenCalled();
});

it("rejects a queued edit even after the replacement grant becomes current", async () => {
    const panel = await selectForMutation();
    let finish!: (source: string) => void;
    backend.read.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    await act(async () => {
        panel.onCommit({ color: "red" });
        panel.onCommit({ color: "blue" });
    });
    await replaceService(8);
    await act(async () => finish(SOURCE));
    expect(backend.patch).not.toHaveBeenCalled();
});

it.each(["z", "y"])("allows authorized history shortcut %s", async key => {
    await selectForMutation();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true })));
    expect(key === "z" ? backend.undo : backend.redo).toHaveBeenCalledTimes(1);
});

it.each(["z", "y"])("revalidates queued history shortcut %s", async key => {
    const panel = await selectForMutation();
    let finish!: (source: string) => void;
    backend.read.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    await act(async () => {
        panel.onCommit({ color: "red" });
        window.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true }));
    });
    await replaceService(8);
    await act(async () => finish(SOURCE));
    expect(backend.undo).not.toHaveBeenCalled(); expect(backend.redo).not.toHaveBeenCalled();
});

it.each(frameMutations)("persists an authorized incoming %s mutation", async (kind, payload) => {
    const panel = await selectForMutation();
    const frame = host.querySelector("iframe")!;
    await act(async () => window.dispatchEvent(new MessageEvent("message", {
        source: frame.contentWindow, origin: backend.service.url,
        data: { type: `bettershape-design-${kind}`, element: panel.element, ...payload },
    })));
    expect(backend.patch).toHaveBeenCalledTimes(1);
});

it("does not transplant an old preview update onto a newer selection owner", async () => {
    const old = await selectForMutation();
    const frame = host.querySelector("iframe")!;
    await act(async () => window.dispatchEvent(new MessageEvent("message", {
        source: frame.contentWindow, origin: backend.service.url,
        data: { type: "bettershape-design-selection", element: { ...old.element, key: "new-selection" } },
    })));
    await act(async () => old.onPreview({ color: "red" }));
    expect(backend.panel!.element?.key).toBe("new-selection");
    expect(backend.panel!.element?.styles.color).toBeUndefined();
});

async function selectSource(element: PanelProps["element"]) {
    const frame = host.querySelector("iframe")!;
    await act(async () => window.dispatchEvent(new MessageEvent("message", {
        source: frame.contentWindow, origin: backend.service.url,
        data: { type: "bettershape-design-selection", element },
    })));
}

it("keeps the newest source mapping when an older lookup finishes last", async () => {
    const original = (await selectForMutation()).element!;
    let finish!: (source: string) => void;
    backend.read.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    await selectSource({ ...original, key: "slow", source: { ...original.source!, fileName: "src/Slow.tsx" } });
    await selectSource({ ...original, key: "current", source: { ...original.source!, fileName: "src/Current.tsx" } });
    expect(backend.panel!.source?.file).toBe("src/Current.tsx");
    await act(async () => finish(SOURCE));
    expect(backend.panel!.source?.file).toBe("src/Current.tsx");
});

it("does not restore a source target after deselection", async () => {
    const original = (await selectForMutation()).element!;
    let finish!: (source: string) => void;
    backend.read.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    await selectSource({ ...original, key: "slow" });
    await selectSource(null);
    await act(async () => finish(SOURCE));
    expect(backend.panel!.source).toBeNull();
});

it("does not publish a queued mutation's lookup as the current selection target", async () => {
    const old = await selectForMutation();
    let finish!: (source: string) => void;
    backend.read.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    await act(async () => { old.onCommit({ color: "red" }); });
    await selectSource({ ...old.element!, key: "current", source: { ...old.element!.source!, fileName: "src/Current.tsx" } });
    await act(async () => finish(SOURCE));
    expect(backend.patch).toHaveBeenCalledTimes(1);
    expect(backend.panel!.source?.file).toBe("src/Current.tsx");
});

it("creates consecutive tokens through the real CSS loader without losing its path", async () => {
    const loader = await vi.importActual<typeof import("@/lib/ui/css-variables-loader")>("@/lib/ui/css-variables-loader");
    backend.css.mockImplementation(loader.resolveGlobalsCss);
    let disk = ":root { --seed: red; }";
    backend.cssRead.mockImplementation(async () => disk);
    backend.read.mockImplementation(async (path: string) => path.endsWith(".css") ? disk : SOURCE);
    backend.save.mockImplementation(async (_path: string, content: string) => { disk = content; });
    const panel = await selectForMutation();
    await act(async () => { await panel.onCreateToken!("--first", "blue"); });
    // A separate file edit between token operations must not be overwritten by cached content.
    disk = disk.replace("--seed: red", "--seed: green");
    await act(async () => { await panel.onCreateToken!("--second", "purple"); });
    expect(backend.save).toHaveBeenCalledTimes(2);
    expect(backend.save.mock.calls.map(([path]) => path)).toEqual(["/project/app/globals.css", "/project/app/globals.css"]);
    expect(disk).toContain("--first: blue"); expect(disk).toContain("--second: purple"); expect(disk).toContain("--seed: green");
});

it("serializes concurrent token writes through disk acknowledgement", async () => {
    const loader = await vi.importActual<typeof import("@/lib/ui/css-variables-loader")>("@/lib/ui/css-variables-loader");
    backend.css.mockImplementation(loader.resolveGlobalsCss);
    let disk = ":root {}";
    backend.cssRead.mockImplementation(async () => disk);
    backend.read.mockImplementation(async (path: string) => path.endsWith(".css") ? disk : SOURCE);
    let finish!: () => void;
    backend.save.mockImplementationOnce((_path: string, content: string) => new Promise<void>(resolve => {
        finish = () => { disk = content; resolve(); };
    })).mockImplementation(async (_path: string, content: string) => { disk = content; });
    const panel = await selectForMutation();
    let first: void | Promise<void>;
    let second: void | Promise<void>;
    await act(async () => {
        first = panel.onCreateToken!("--first", "blue");
        second = panel.onCreateToken!("--second", "green");
    });
    expect(backend.save).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await Promise.all([first, second]); });
    expect(backend.save).toHaveBeenCalledTimes(2);
    expect(disk).toContain("--first: blue"); expect(disk).toContain("--second: green");
});
