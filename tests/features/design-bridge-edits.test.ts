/**
 * The preview bridge owns canvas hit-testing and reports edits back to the host.
 * Host-initiated edits (inspector text/attribute fields, component property panel)
 * are persisted by the host under the scope it chose, so the bridge must not echo a
 * generic commit for them: that second, unscoped write could widen an instance edit
 * into the shared component source. A canvas-side edit still reports its commit.
 *
 * The bridge is a plain script string, so it is executed here against jsdom exactly
 * as the preview frame runs it. One instance serves the whole file: the script
 * installs window listeners and returns early if it is run twice.
 */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { DESIGN_BRIDGE_SCRIPT } from "@/features/preview/design/bridge";

type BridgeMessage = { type?: string; layers?: Array<{ key: string; tag: string; classes: string[] }> };

let posted: BridgeMessage[];
let post: ReturnType<typeof vi.spyOn>;

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** Replace the preview document and ask the bridge for the tree of that document. */
async function renderPreview(markup: string) {
    posted.length = 0;
    document.body.innerHTML = markup;
    sendToBridge({ type: "bettershape-design-refresh" });
    for (let attempt = 0; attempt < 20; attempt++) {
        await wait(10);
        if (posted.some((message) => message.type === "bettershape-design-tree")) return;
    }
    throw new Error("bridge never reported a tree");
}

/** Send a host → bridge message with the guard the bridge checks (`event.source === parent`). */
function sendToBridge(data: unknown) {
    window.dispatchEvent(new MessageEvent("message", { data, source: window, origin: location.origin }));
}

function keyFor(selector: string): string {
    const [tag, cssClass] = selector.split(".");
    const tree = posted.filter((message) => message.type === "bettershape-design-tree").at(-1);
    const layer = tree?.layers?.find((candidate) => candidate.tag === tag && (!cssClass || candidate.classes.includes(cssClass)));
    if (!layer) throw new Error(`no bridge layer for ${selector}`);
    return layer.key;
}

const commitTypes = () => posted.filter((message) => message.type?.startsWith("bettershape-design-commit-")).map((message) => message.type);

beforeAll(() => {
    posted = [];
    post = vi.spyOn(window, "postMessage").mockImplementation(((message: BridgeMessage) => {
        posted.push(message);
    }) as typeof window.postMessage);
    new Function("window", "document", "location", "setTimeout", "MutationObserver", DESIGN_BRIDGE_SCRIPT)(
        window, document, window.location, setTimeout, MutationObserver,
    );
});

afterAll(() => {
    post.mockRestore();
    document.body.innerHTML = "";
});

beforeEach(() => {
    posted.length = 0;
});

it("does not echo a commit for a host-initiated text edit it was told is already persisted", async () => {
    await renderPreview(`<div class="card">Hello</div>`);
    const key = keyFor("div.card");
    posted.length = 0;
    sendToBridge({ type: "bettershape-design-set-text", key, text: "Changed", silent: true });
    await wait();
    expect(document.querySelector("div.card")!.textContent).toBe("Changed");
    expect(commitTypes()).toEqual([]);
});

it("still reports a canvas-side text edit so the host can persist it", async () => {
    await renderPreview(`<div class="card">Hello</div>`);
    const key = keyFor("div.card");
    posted.length = 0;
    sendToBridge({ type: "bettershape-design-set-text", key, text: "Typed in canvas" });
    await wait();
    expect(commitTypes()).toContain("bettershape-design-commit-text");
});

it("does not echo a commit for a host-initiated attribute edit either", async () => {
    await renderPreview(`<div class="panel">Panel</div>`);
    const key = keyFor("div.panel");
    posted.length = 0;
    sendToBridge({ type: "bettershape-design-set-attr", key, name: "title", value: "Changed", silent: true });
    await wait();
    expect(document.querySelector("div.panel")!.getAttribute("title")).toBe("Changed");
    expect(commitTypes()).toEqual([]);
});

it("still reports a canvas-side attribute edit", async () => {
    await renderPreview(`<div class="panel">Panel</div>`);
    const key = keyFor("div.panel");
    posted.length = 0;
    sendToBridge({ type: "bettershape-design-set-attr", key, name: "title", value: "Typed" });
    await wait();
    expect(commitTypes()).toContain("bettershape-design-commit-attr");
});
