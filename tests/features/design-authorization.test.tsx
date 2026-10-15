import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptsDesignMessage, authorizeDesignPreview, designMessageOrigin, OFF_DESIGN_ORIGIN, scopeDesignBridge } from "@/features/preview/design/authorization";

const backend = vi.hoisted(() => ({ project: "/project-a", register: vi.fn(), read: vi.fn(), save: vi.fn(), error: vi.fn(), service: null as { projectPath: string; url: string; ptyId: number } | null }));
vi.mock("@/lib/backend", () => ({
    useProjectState: () => ({ project_path: backend.project }),
    commands: { registerDesignBridge: backend.register, readFileFromDisk: backend.read, saveFile: backend.save, primeFileCache: vi.fn() },
}));
vi.mock("@/features/terminal/background-run", () => ({
    getBackgroundPreviewService: () => backend.service,
    sameProjectPath: (a: string, b: string) => a === b,
}));
vi.mock("@/features/notifications", () => ({ notify: { error: backend.error } }));
import { DesignInspectOverlay } from "@/features/preview/design/inspect-bar";
vi.mock("@/features/preview/store", () => ({
    usePreviewStore: () => ({ history: ["http://localhost:3000"], index: 0, urlBar: "http://localhost:3000", iframeSrc: "http://localhost:3000", reloadKey: 0, loading: false }),
    getPreviewCurrentUrl: () => "http://localhost:3000", getLastDevUrl: () => "http://localhost:3000",
    isLocalPreviewUrl: () => true, seedPreviewFromDevUrl: vi.fn(), ensurePreviewLoaded: vi.fn(),
    watchPreviewFrame: () => () => {}, recordPreviewLocation: vi.fn(), endPreviewStackNav: vi.fn(), inferPreviewUrlFromPerformance: () => null,
}));
vi.mock("@/lib/runtime/store", () => ({ useRuntimeFlag: () => true }));
vi.mock("@/features/detection/lib/lib", () => ({ isWebProject: async () => true }));
import PreviewPanel from "@/features/preview/ui/preview-panel";


let host: HTMLDivElement;
let frame: HTMLIFrameElement;
let root: Root;
let ref: { current: HTMLIFrameElement };
beforeEach(() => {
    backend.project = "/project-a";
    backend.service = { projectPath: "/project-a", url: "http://localhost:3000", ptyId: 7 };
    backend.register.mockReset().mockResolvedValue(undefined);
    backend.read.mockReset().mockResolvedValue('export function Card(){ return <div className="card">Hello</div>; }');
    backend.save.mockReset().mockResolvedValue(undefined); backend.error.mockReset();
    host = document.createElement("div"); frame = document.createElement("iframe");
    frame.src = "http://localhost:3000";
    document.body.append(host, frame); root = createRoot(host); ref = { current: frame };
});
afterEach(() => { act(() => root.unmount()); host.remove(); frame.remove(); vi.useRealTimers(); });

it.each(["https://example.com", "http://localhost:48921", "http://localhost:1420", "file:///tmp/a", "http://user:secret@localhost:3000", "null"])("does not authorize %s as a project preview", (url) => {
    expect(authorizeDesignPreview("/project-a", url)).toBeNull();
});

it("binds message authority to the exact frame, origin and project", () => {
    const authorization = authorizeDesignPreview("/project-a", "http://localhost:3000/page")!;
    const message = { source: frame.contentWindow, origin: "http://localhost:3000" };
    expect(acceptsDesignMessage(message, frame, authorization, "/project-a")).toBe(true);
    expect(acceptsDesignMessage({ ...message, origin: "http://localhost:4000" }, frame, authorization, "/project-a")).toBe(false);
    expect(acceptsDesignMessage({ ...message, source: window }, frame, authorization, "/project-a")).toBe(false);
    expect(acceptsDesignMessage(message, frame, authorization, "/project-b")).toBe(false);
    expect(acceptsDesignMessage(message, null, authorization, "/project-a")).toBe(false);
    expect(designMessageOrigin(authorization, "/project-b")).toBe(OFF_DESIGN_ORIGIN);
    expect(designMessageOrigin(authorization, "/project-a")).toBe("http://localhost:3000");
});

it("guards the injected script itself against unrelated local origins", () => {
    const authorization = authorizeDesignPreview("/project-a", "http://localhost:3000")!;
    const run = new Function("location", "record", scopeDesignBridge("record();", authorization));
    const record = vi.fn();
    run({ origin: "http://localhost:4000" }, record);
    expect(record).not.toHaveBeenCalled();
    run({ origin: "http://localhost:3000" }, record);
    expect(record).toHaveBeenCalledTimes(1);
});

function selection(origin: string, key = "element") {
    act(() => window.dispatchEvent(new MessageEvent("message", {
        source: frame.contentWindow, origin,
        data: { type: "bettershape-design-selection", element: { key, tag: "div", classes: ["card"], text: "Hello", source: { fileName: "src/Card.tsx", lineNumber: 1, columnNumber: 1 }, rect: { x: 0, y: 0, width: 100, height: 30 }, styles: {} } },
    })));
}
async function render(enabled = true) {
    await act(async () => root.render(<DesignInspectOverlay iframeRef={ref} enabled={enabled} onToggle={() => {}} />));
}
it("the actual inspector rejects cross-port messages and revokes access on a project switch", async () => {
    await render();
    expect(backend.register.mock.calls[0][0]).toContain('location.origin !== "http://localhost:3000"');
    selection("http://localhost:4000");
    expect(host.querySelector('[aria-label="Exit design mode"]')).toBeNull();
    selection("http://localhost:3000");
    expect(host.querySelector('[aria-label="Exit design mode"]')).not.toBeNull();
    backend.project = "/project-b";
    await render();
    selection("http://localhost:3000");
    expect(host.querySelector('[aria-label="Exit design mode"]')).toBeNull();
    // A subsequent project change is not an implicit grant either.
    backend.project = "/project-c";
    await render();
    selection("http://localhost:3000");
    expect(host.querySelector('[aria-label="Exit design mode"]')).toBeNull();
    backend.service = { projectPath: "/project-c", url: "http://localhost:3000", ptyId: 8 };
    await render(false); await render(true);
    selection("http://localhost:3000");
    expect(host.querySelector('[aria-label="Exit design mode"]')).not.toBeNull();
});

it.each(['http://localhost:3000"; record("escape"); //', '</script><script>record("escape")</script>', "line\nseparator\u2028"])("keeps an unusual origin as data in native JavaScript source: %s", (origin) => {
    const execute = new Function("location", "record", scopeDesignBridge('record("bridge");', { projectPath: "/project-a", origin, serviceId: 7 }));
    const record = vi.fn();
    execute({ origin: "http://localhost:3000" }, record);
    expect(record).not.toHaveBeenCalled();
    execute({ origin }, record);
    expect(record.mock.calls).toEqual([["bridge"]]);
});

it("never grants a manually entered service from another project or port", async () => {
    backend.service = { projectPath: "/other", url: "http://localhost:3000", ptyId: 9 };
    await render();
    expect(backend.register).not.toHaveBeenCalled();
    expect(authorizeDesignPreview("/project-a", "http://localhost:3000")).toBeNull();
    backend.service = { projectPath: "/project-a", url: "http://localhost:4000", ptyId: 9 };
    expect(authorizeDesignPreview("/project-a", "http://localhost:3000")).toBeNull();
    backend.service = null;
    expect(authorizeDesignPreview("/project-a", "http://localhost:3000")).toBeNull();
});

it("revokes messages and outgoing metadata when the server exits or is replaced on the same port", async () => {
    await render();
    const grant = authorizeDesignPreview("/project-a", "http://localhost:3000");
    backend.service = null;
    selection("http://localhost:3000");
    expect(host.querySelector('[aria-label="Exit design mode"]')).toBeNull();
    expect(designMessageOrigin(grant, "/project-a")).toBe(OFF_DESIGN_ORIGIN);
    backend.service = { projectPath: "/project-a", url: "http://localhost:3000", ptyId: 8 };
    selection("http://localhost:3000");
    expect(host.querySelector('[aria-label="Exit design mode"]')).toBeNull();
    expect(designMessageOrigin(grant, "/project-a")).toBe(OFF_DESIGN_ORIGIN);
});

it("binds an alternate package to its actual editing root, independently of the outer workspace", () => {
    backend.service = { projectPath: "/project-a/packages/site", url: "http://localhost:3000", ptyId: 9 };
    const grant = authorizeDesignPreview("/project-a/packages/site", "http://localhost:3000");
    expect(designMessageOrigin(grant, "/project-a/packages/site")).toBe("http://localhost:3000");
    expect(designMessageOrigin(grant, "/project-a")).toBe(OFF_DESIGN_ORIGIN);
});

async function changeRange(value: string) {
    const input = host.querySelector("input")!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

it("persists an admitted edit when design mode is disabled before the debounce", async () => {
    vi.useFakeTimers(); await render(); selection("http://localhost:3000");
    await changeRange("20");
    expect(backend.save).not.toHaveBeenCalled();
    await render(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(backend.save.mock.calls[0][0]).toBe("/project-a/src/Card.tsx");
    expect(backend.save.mock.calls[0][1]).not.toContain('className="card"');
});

it("combines different slider properties during the debounce instead of losing the first", async () => {
    vi.useFakeTimers(); await render(); selection("http://localhost:3000");
    await changeRange("20");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Padding"))!.click());
    await changeRange("16");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(backend.save).toHaveBeenCalledTimes(1);
    const content = backend.save.mock.calls[0][1];
    expect(content).toMatch(/rounded/); expect(content).toMatch(/p-4|p-\[16px\]/);
});

it.each(["exit", "replace", "project", "navigate"])("revalidates a pending inspector read after %s", async kind => {
    vi.useFakeTimers(); await render(); selection("http://localhost:3000");
    let finish!: (value: string) => void;
    backend.read.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    await changeRange("20");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(backend.read).toHaveBeenCalledTimes(1);
    if (kind === "exit") backend.service = null;
    if (kind === "replace") backend.service = { ...backend.service!, ptyId: 8 };
    if (kind === "project") { backend.project = "/other"; await render(); }
    if (kind === "navigate") await act(async () => frame.dispatchEvent(new Event("load")));
    await act(async () => finish('export function Card(){ return <div className="card">Hello</div>; }'));
    expect(backend.save).not.toHaveBeenCalled();
});

it("reports an inspector write failure instead of silently treating live CSS as saved", async () => {
    vi.useFakeTimers(); await render(); selection("http://localhost:3000");
    backend.save.mockRejectedValueOnce(new Error("disk full"));
    await changeRange("20");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(backend.error).toHaveBeenCalled();
});

it("finishes an already reading edit after inspection is disabled", async () => {
    vi.useFakeTimers(); await render(); selection("http://localhost:3000");
    let finish!: (value: string) => void;
    backend.read.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    await changeRange("20");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await render(false);
    await act(async () => finish('export function Card(){ return <div className="card">Hello</div>; }'));
    expect(backend.save).toHaveBeenCalledTimes(1);
});

it("flushes distinct selection snapshots and serializes their file updates", async () => {
    vi.useFakeTimers(); await render(); selection("http://localhost:3000");
    let disk = 'export function Card(){ return <div className="card">Hello</div>; }';
    backend.read.mockImplementation(async () => disk);
    backend.save.mockImplementation(async (_path: string, content: string) => { disk = content; });
    await changeRange("20");
    selection("http://localhost:3000", "reselected");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Padding"))!.click());
    await changeRange("16");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(backend.save).toHaveBeenCalledTimes(2);
    expect(disk).toMatch(/rounded/); expect(disk).toMatch(/p-4|p-\[16px\]/);
});

function PreviewWithInspection() {
    const [design, setDesign] = useState(true);
    return <PreviewPanel hideToolbar design={design} onDesignChange={setDesign} />;
}

it("the real preview parent preserves an admitted slider edit when Exit design mode is clicked", async () => {
    vi.useFakeTimers();
    frame.remove();
    await act(async () => root.render(<PreviewWithInspection />));
    frame = host.querySelector("iframe")!;
    selection("http://localhost:3000");
    await changeRange("20");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Exit design mode"]')!.click());
    expect(host.querySelector("input[type=range]")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(backend.save).toHaveBeenCalledTimes(1);
});
