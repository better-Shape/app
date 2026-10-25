import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMarkdown } from "@/features/chat/ui/md/view";

vi.mock("mermaid", () => ({
    default: {
        initialize: vi.fn(),
        render: vi.fn(async () => {
            throw new Error("invalid graph");
        }),
    },
}));

async function renderMarkdown(content: string): Promise<{ host: HTMLDivElement; root: Root }> {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
        root.render(<ChatMarkdown content={content} />);
    });
    await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
    });
    return { host, root };
}

describe("chat markdown tables and mermaid", () => {
    let root: Root | null = null;
    let host: HTMLDivElement | null = null;

    afterEach(() => {
        if (root && host) {
            act(() => root!.unmount());
            host.remove();
        }
        root = null;
        host = null;
    });

    it("renders a GFM table", async () => {
        const mounted = await renderMarkdown("| Name | Role |\n| --- | --- |\n| Ada | eng |\n");
        root = mounted.root;
        host = mounted.host;
        expect(host.querySelector("table")).toBeTruthy();
        expect(host.textContent).toContain("Ada");
    });

    it("renders filter-table JSON instead of dropping it", async () => {
        const mounted = await renderMarkdown("```filter-table\n[{\"name\":\"Ada\"}]\n```\n");
        root = mounted.root;
        host = mounted.host;
        expect(host.textContent).toContain("Ada");
        expect(host.querySelector("table")).toBeTruthy();
    });

    it("shows mermaid source when the graph is invalid", async () => {
        const source = "graph TD\nA-->";
        const mounted = await renderMarkdown("```mermaid\n" + source + "\n```\n");
        root = mounted.root;
        host = mounted.host;
        expect(host.textContent).toContain("graph TD");
        expect(() => host!.textContent).not.toThrow();
    });

    it("streams multi-block Markdown with plain open code fences and upgrades closed blocks cleanly", async () => {
        vi.stubGlobal(
            "matchMedia",
            (query: string) =>
                ({
                    matches: query.includes("prefers-reduced-motion"),
                    media: query,
                    onchange: null,
                    addListener: () => {},
                    removeListener: () => {},
                    addEventListener: () => {},
                    removeEventListener: () => {},
                    dispatchEvent: () => false,
                }) as MediaQueryList,
        );

        const streamHost = document.createElement("div");
        document.body.appendChild(streamHost);
        const streamRoot = createRoot(streamHost);
        host = streamHost;
        root = streamRoot;

        const openMd = [
            "## Step 1",
            "",
            "1. First ordered item using `React.memo` and `package.json`",
            "2. Second ordered item",
            "",
            "```tsx",
            "export const View = () => <div data-live={true}>42</div>;",
        ].join("\n");

        await act(async () => {
            streamRoot.render(<ChatMarkdown content={openMd} isGenerating isLast />);
        });

        expect(streamHost.querySelectorAll("ol")).toHaveLength(1);
        expect(streamHost.querySelectorAll("ol > li")).toHaveLength(2);
        // `React.memo` stays inline <code>, while `package.json` renders a file pill button:
        const buttons = [...streamHost.querySelectorAll("li button")].map((b) => b.textContent?.trim());
        expect(buttons).toContain("package.json");
        expect(buttons).not.toContain("React.memo");
        // Open JSX fence preserves `<div>` tags intact and uses plain zero-VDOM fast path:
        const openPre = streamHost.querySelector('pre[data-streaming-fence="true"]');
        expect(openPre).toBeTruthy();
        expect(openPre?.textContent).toContain("<div data-live={true}>42</div>");
        expect(openPre?.querySelectorAll("span").length ?? 0).toBe(0);

        const closedMd = `${openMd}\n\`\`\`\n\nTrailing summary paragraph.`;
        await act(async () => {
            streamRoot.render(<ChatMarkdown content={closedMd} isGenerating isLast />);
        });
        await act(async () => {
            await new Promise((r) => setTimeout(r, 40));
        });

        expect(streamHost.querySelector('pre[data-streaming-fence="true"]')).toBeNull();
        expect(streamHost.textContent).toContain("Trailing summary paragraph.");
        const allCodeText = [...streamHost.querySelectorAll("code")].map((c) => c.textContent).join("\n");
        expect(allCodeText).toContain("<div data-live={true}>42</div>");
        vi.unstubAllGlobals();
    });
});
