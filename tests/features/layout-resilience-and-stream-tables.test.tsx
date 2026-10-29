// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Breadcrumb, BreadcrumbItem } from "@/components/ui/breadcrumb";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApprovalCard } from "@/features/chat/ui/blocks/approval";
import Status from "@/features/agent/workbench/status/ui/status";
import { ChatDataTable, MarkdownTableShell } from "@/features/chat/ui/md/data-table";
import { preprocessChatMarkdown, repairStreamGlitches } from "@/features/chat/ui/md/stream";
import { ChatMarkdown } from "@/features/chat/ui/md/view";
import { OpenInMenu } from "@/features/chat/ui/shell/open-in";
import {
    clearProposedEdit,
    getProposedEdit,
    isFileResolved,
    markFileResolved,
    setCurrentConversationId,
    setProposedEdit,
} from "@/features/chat/lib/proposed-edits";
import {
    chatModelIdsFor,
    defaultProvidersSettings,
    toRustAiConfig,
    withFeatureModel,
} from "@/lib/ai/providers";
import { unifiedDiffRows } from "@/lib/ui/diff-count";

const mountedRoots: Array<{ root: Root; host: HTMLDivElement }> = [];

/** Mounts `element` inside `TooltipProvider` and tracks cleanup for `afterEach`. */
const mountInTooltipProvider = (element: React.ReactElement): HTMLDivElement => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
        root.render(<TooltipProvider>{element}</TooltipProvider>);
    });
    mountedRoots.push({ root, host });
    return host;
};

afterEach(() => {
    while (mountedRoots.length > 0) {
        const entry = mountedRoots.pop();
        if (!entry) continue;
        act(() => {
            entry.root.unmount();
        });
        entry.host.remove();
    }
});

describe("stream glitch sanitizer structured table and code-fence preservation", () => {
    it("preserves wide 10-column and 16-column GFM table delimiter rows", () => {
        const headers = Array.from({ length: 16 }, (_, idx) => `Col_${idx + 1}`).join(" | ");
        const delimiter = Array.from({ length: 16 }, () => "---").join(" | ");
        const centeredDelimiter = Array.from({ length: 10 }, () => ":---:").join(" | ");
        const values = Array.from({ length: 16 }, (_, idx) => `v_${idx + 1}`).join(" | ");
        const wideTable = `| ${headers} |\n| ${delimiter} |\n| ${values} |`;
        const alignedTable = `| ${Array.from({ length: 10 }, (_, idx) => `H_${idx}`).join(" | ")} |\n| ${centeredDelimiter} |\n| ${Array.from({ length: 10 }, () => "ok").join(" | ")} |`;

        expect(repairStreamGlitches(wideTable)).toBe(wideTable);
        expect(preprocessChatMarkdown(wideTable, { streaming: false })).toContain(`| ${delimiter} |`);
        expect(repairStreamGlitches(alignedTable)).toBe(alignedTable);
    });

    it("preserves sparse empty-cell GFM rows and Unicode box-drawing diagrams", () => {
        const sparseTable = [
            "| Time | Mon | Tue | Wed | Thu | Fri | Sat | Sun | Notes |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
            "| 09:00 |  |  |  |  |  |  |  | standup |",
        ].join("\n");
        const boxDiagram = "┌──────────┬──────────┬──────────┬──────────┐\n│ Service  │ Region A │ Region B │ Region C │\n└──────────┴──────────┴──────────┴──────────┘";

        expect(repairStreamGlitches(sparseTable)).toBe(sparseTable);
        expect(repairStreamGlitches(boxDiagram)).toBe(boxDiagram);
    });

    it("leaves repeated hex dumps and ASCII grids untouched inside backtick and tilde fences", () => {
        const hexFence = [
            "Packet capture:",
            "```hex",
            "0000: 0000 0000 0000 0000 0000 0000 0000 0000",
            "0010: dead beef dead beef dead beef dead beef",
            "```",
        ].join("\n");
        const tildeFence = [
            "~~~text",
            "+----------+----------+----------+----------+",
            "| worker_1 | worker_1 | worker_1 | worker_1 |",
            "+----------+----------+----------+----------+",
            "~~~",
        ].join("\n");

        expect(repairStreamGlitches(hexFence)).toBe(hexFence);
        expect(repairStreamGlitches(tildeFence)).toBe(tildeFence);
    });

    it("still collapses genuine adjacent prose replays outside code fences", () => {
        const repeatedSentence = "The deployment succeeded cleanly. ";
        const glitched = `${repeatedSentence}${repeatedSentence}\n\`\`\`hex\n0000 0000 0000 0000 0000 0000\n\`\`\``;
        const repaired = repairStreamGlitches(glitched);

        expect(repaired).toContain(repeatedSentence);
        expect(repaired.indexOf(repeatedSentence)).toBe(repaired.lastIndexOf(repeatedSentence));
        expect(repaired).toContain("0000 0000 0000 0000 0000 0000");
    });
});

describe("unifiedDiffRows hunk grouping and real line counts", () => {
    it("omits redundant @@ header when a single hunk begins at line 1", () => {
        const original = "const timeout = 1000;\nexport default timeout;\n";
        const replacement = "const timeout = 5000;\nexport default timeout;\n";
        const rows = unifiedDiffRows(original, replacement, 2);

        expect(rows.some((row) => row.type === "hunk")).toBe(false);
        expect(rows.find((row) => row.type === "remove")).toMatchObject({
            line: "const timeout = 1000;",
            oldNum: 1,
        });
        expect(rows.find((row) => row.type === "add")).toMatchObject({
            line: "const timeout = 5000;",
            newNum: 1,
        });
    });

    it("emits real unified hunk headers without ellipsis for discontiguous multi-hunk edits", () => {
        const baseLines = Array.from({ length: 20 }, (_, idx) => `const line_${idx + 1} = ${idx + 1};`);
        const nextLines = [...baseLines];
        nextLines[1] = "const line_2 = 200;";
        nextLines[17] = "const line_18 = 1800;\nconst line_18b = 1801;";

        const rows = unifiedDiffRows(baseLines.join("\n"), nextLines.join("\n"), 1);
        const hunks = rows.filter((row) => row.type === "hunk").map((row) => row.line);

        expect(hunks).toHaveLength(2);
        expect(hunks[0]).toBe("@@ -1,3 +1,3 @@");
        expect(hunks[1]).toBe("@@ -17,3 +17,4 @@");
        expect(hunks.join("\n")).not.toContain("…");
    });
});

describe("chat tables, display math, breadcrumbs, approval footer, and scoped brand SVGs", () => {
    it("renders wide GFM tables inside a dedicated horizontal scroller and formats $$ display math", () => {
        const md = [
            "| C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 | C10 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
            "| `a` | `b` | `c` | `d` | `e` | `f` | `g` | `h` | `i` | `j` |",
            "",
            "$$E = mc^2 + \\sum_{i=1}^{n} x_i$$",
        ].join("\n");

        const container = mountInTooltipProvider(<ChatMarkdown content={md} />);
        const table = container.querySelector("table");
        const scroller = table?.parentElement;
        const mathBlock = container.querySelector("[data-math-display='true']");

        expect(table).not.toBeNull();
        expect(table?.className).toContain("w-max");
        expect(table?.className).toContain("min-w-full");
        expect(scroller?.className).toContain("overflow-x-auto");
        expect(mathBlock?.textContent).toBe("E = mc^2 + \\sum_{i=1}^{n} x_i");
    });

    it("keeps CopyButton outside the scrolling track in ChatDataTable and MarkdownTableShell", () => {
        const container = mountInTooltipProvider(
            <div>
                <ChatDataTable headers={["Key", "Value"]} rows={[["mode", "strict"]]} />
                <MarkdownTableShell>
                    <table>
                        <thead>
                            <tr>
                                <th>Col</th>
                            </tr>
                        </thead>
                    </table>
                </MarkdownTableShell>
            </div>,
        );
        const scrollers = container.querySelectorAll(".overflow-x-auto.overflow-y-hidden");
        expect(scrollers.length).toBe(2);
    });

    it("propagates collapseClassName from ancestor BreadcrumbItem onto its trailing separator", () => {
        const container = mountInTooltipProvider(
            <Breadcrumb>
                <BreadcrumbItem onClick={() => undefined} collapseClassName="hidden @[310px]/titlebar:flex">
                    bettershape-demo
                </BreadcrumbItem>
                <BreadcrumbItem current>Preview fixture chat</BreadcrumbItem>
            </Breadcrumb>,
        );
        const listItems = container.querySelectorAll("li");
        const separatorWrap = container.querySelector("ol > span");

        expect(listItems[0]?.className).toContain("@[310px]/titlebar:flex");
        expect(separatorWrap?.className).toContain("@[310px]/titlebar:flex");
    });

    it("renders ApprovalCard action buttons inside a flex-wrap footer without empty left sibling", () => {
        const onSkip = vi.fn();
        const onAccept = vi.fn();
        const container = mountInTooltipProvider(
            <ApprovalCard
                title="Edit handler.ts"
                skipLabel="Skip"
                acceptLabel="Accept"
                onSkip={onSkip}
                onAccept={onAccept}
            />,
        );
        const buttons = Array.from(container.querySelectorAll("button"));
        const acceptBtn = buttons.find((btn) => btn.textContent?.includes("Accept")) ?? null;
        const actionGroup = acceptBtn?.closest("[data-find-skip]");
        const footer = actionGroup?.parentElement;

        expect(actionGroup?.className).toContain("ml-auto");
        expect(footer?.className).toContain("flex-wrap");
        expect(footer?.children.length).toBe(1);
    });

    it("scopes embedded <style> selectors inside OpenInMenu brand icons", () => {
        const container = mountInTooltipProvider(<OpenInMenu path="/preview/bettershape-demo" />);
        const styleBlocks = Array.from(container.querySelectorAll("style")).map(
            (styleEl: HTMLStyleElement) => styleEl.textContent ?? "",
        );
        for (const cssText of styleBlocks) {
            expect(cssText).not.toMatch(/(?:^|[^-\w])\.st0\b/);
        }
    });

    it("falls back to catalog nonChat metadata and forwards agent/commits feature models", () => {
        const settings = defaultProvidersSettings();
        settings.connections.openai = {
            ...settings.connections.openai,
            apiKey: ["sk", "test", "placeholder0000"].join("-"),
            enabled: true,
            models: ["text-embedding-3-small", "openai/gpt-5", "openai/gpt-5-mini"],
            discoveredModels: [
                { id: "text-embedding-3-small" },
                { id: "openai/gpt-5" },
                { id: "openai/gpt-5-mini" },
            ],
        };

        const chatIds = chatModelIdsFor("openai", settings.connections);
        expect(chatIds).toContain("openai/gpt-5");
        expect(chatIds).not.toContain("text-embedding-3-small");

        const withSlots = withFeatureModel(
            withFeatureModel(settings, "agent", "openai/gpt-5"),
            "commits",
            "openai/gpt-5-mini",
        );
        const wire = toRustAiConfig(withSlots);
        expect(wire.agentModel).toBe("openai/gpt-5");
        expect(wire.commitModel).toBe("openai/gpt-5-mini");
    });

    it("stores and resolves proposed edits safely on __proto__ and constructor paths", () => {
        setCurrentConversationId("conv-proto-check");
        setProposedEdit("__proto__", {
            id: "edit-proto",
            original: "a",
            replacement: "b",
            baseline: "a",
        });
        expect(getProposedEdit("__proto__")?.id).toBe("edit-proto");
        expect(({} as Record<string, unknown>).id).toBeUndefined();

        markFileResolved("constructor", "__proto__", "applied", "b");
        expect(isFileResolved("constructor", "__proto__", "b")).toBe(true);
        clearProposedEdit("__proto__");
        setCurrentConversationId(null);
    });

    it("declares @container/status on an ancestor wrapper around the @[760px]/status:grid row", () => {
        const container = mountInTooltipProvider(<Status />);
        const outer = container.querySelector(".status-bar");
        const inner = outer?.firstElementChild;

        expect(outer?.className).toContain("@container/status");
        expect(outer?.className).not.toContain("@[760px]/status:grid");
        expect(inner?.className).toContain("@[760px]/status:grid");
    });
});
