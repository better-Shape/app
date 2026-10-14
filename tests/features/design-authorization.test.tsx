import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptsDesignMessage, authorizeDesignPreview, designMessageOrigin, OFF_DESIGN_ORIGIN, scopeDesignBridge } from "@/features/preview/design/authorization";

const backend = vi.hoisted(() => ({ project: "/project-a", register: vi.fn(), service: null as { projectPath: string; url: string; ptyId: number } | null }));
vi.mock("@/lib/backend", () => ({
    useProjectState: () => ({ project_path: backend.project }),
    commands: { registerDesignBridge: backend.register },
}));
vi.mock("@/features/terminal/background-run", () => ({
    getBackgroundPreviewService: () => backend.service,
    sameProjectPath: (a: string, b: string) => a === b,
}));
import { DesignInspectOverlay } from "@/features/preview/design/inspect-bar";

let host: HTMLDivElement;
let frame: HTMLIFrameElement;
let root: Root;
let ref: { current: HTMLIFrameElement };
beforeEach(() => {
    backend.project = "/project-a";
    backend.service = { projectPath: "/project-a", url: "http://localhost:3000", ptyId: 7 };
    backend.register.mockReset().mockResolvedValue(undefined);
    host = document.createElement("div"); frame = document.createElement("iframe");
    frame.src = "http://localhost:3000";
    document.body.append(host, frame); root = createRoot(host); ref = { current: frame };
});
afterEach(() => { act(() => root.unmount()); host.remove(); frame.remove(); });

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

function selection(origin: string) {
    act(() => window.dispatchEvent(new MessageEvent("message", {
        source: frame.contentWindow, origin,
        data: { type: "bettershape-design-selection", element: { key: "element", rect: { x: 0, y: 0, width: 100, height: 30 }, styles: {} } },
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
