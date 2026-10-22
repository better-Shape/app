import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const eventSubscriptions = vi.hoisted(() => ({
    pending: [] as Array<{
        event: string;
        resolve: (unlisten: () => void) => void;
        reject: (error: Error) => void;
    }>,
}));

vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn((event: string) => new Promise<() => void>((resolve, reject) => {
        eventSubscriptions.pending.push({ event, resolve, reject });
    })),
}));

import { OpenUIBlock } from "@/features/chat/ui/blocks/openui";
import { TurnWorkflowSummary } from "@/features/chat/ui/blocks/turn";
import { ChatMessageItem } from "@/features/chat/ui/message/item";
import type { Chunk } from "@/features/chat/ui/md/renderer";

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let clipboardDescriptor: PropertyDescriptor | undefined;

afterEach(() => {
    eventSubscriptions.pending = [];
    if (root) act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
    clipboardDescriptor = undefined;
});

/** Mount an assistant message and expose its public copy action and clipboard spy. */
const renderAssistantMessageForCopy = async (content: string) => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
    });
    await act(async () => {
        root?.render(<ChatMessageItem role="assistant" content={content} timestamp={0} />);
    });
    const copyButton = host.querySelector<HTMLButtonElement>('button[aria-label="Copy message"]');
    if (!copyButton) throw new Error("Assistant copy action was not rendered");
    return {
        writeText,
        copyMessage: () => act(async () => copyButton.click()),
    };
};

describe("OpenUIBlock", () => {
    it("keeps edit approval disabled until both outcome listeners are installed", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        const edit: Chunk = {
            type: "edit_pending",
            commandId: "edit-1",
            commandStatus: "pending",
            file: "src/app.ts",
            original: "before",
            replacement: "after",
        };

        await act(async () => {
            root?.render(<TurnWorkflowSummary blocks={[edit]} />);
        });

        const buttons = Array.from(host.querySelectorAll("button"));
        const skip = buttons.find((button) => button.textContent?.includes("Skip"));
        const accept = buttons.find((button) => button.textContent?.includes("Accept"));
        expect(eventSubscriptions.pending.map(({ event }) => event)).toEqual([
            "agent-edit-resolved",
            "agent-edit-application-failed",
        ]);
        expect(skip?.getAttribute("aria-disabled")).toBe("true");
        expect(accept?.getAttribute("aria-disabled")).toBe("true");

        await act(async () => {
            eventSubscriptions.pending.forEach(({ resolve }) => resolve(() => {}));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(skip?.getAttribute("aria-disabled")).toBeNull();
        expect(accept?.getAttribute("aria-disabled")).toBeNull();
    });

    it("keeps edit approval unavailable if an outcome listener cannot register", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        const edit: Chunk = {
            type: "edit_pending",
            commandId: "edit-2",
            commandStatus: "pending",
            file: "src/app.ts",
            original: "before",
            replacement: "after",
        };

        await act(async () => {
            root?.render(<TurnWorkflowSummary blocks={[edit]} />);
        });
        await act(async () => {
            eventSubscriptions.pending[0]?.reject(new Error("listener failed"));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(host.textContent).toContain("Approval unavailable");
        expect(host.textContent).toContain("Approval listeners could not be registered.");

        const retry = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Retry"));
        expect(retry).toBeDefined();
        await act(async () => {
            retry?.click();
        });
        const retryListeners = eventSubscriptions.pending.slice(-2);
        expect(retryListeners).toHaveLength(2);
        await act(async () => {
            retryListeners.forEach(({ resolve }) => resolve(() => {}));
            await Promise.resolve();
            await Promise.resolve();
        });
        const skip = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Skip"));
        expect(skip?.getAttribute("aria-disabled")).toBeNull();
    });

    it("copies rendered visual text through the assistant message action", async () => {
        const { writeText, copyMessage } = await renderAssistantMessageForCopy(
            '```openui-lang\nroot = Surface([label])\nlabel = Text("Visual summary")\n```',
        );
        expect(host?.querySelector("[data-openui-block]")?.textContent).toContain("Visual summary");
        await copyMessage();

        expect(writeText).toHaveBeenCalledWith("Visual summary");
    });

    it("copies rendered metadata labels instead of protocol prefixes", async () => {
        const { writeText, copyMessage } = await renderAssistantMessageForCopy(
            '<forked_from id="source" title="Earlier chat"/>Answer from the earlier conversation.',
        );
        expect(host?.textContent).toContain("Forked from");
        await copyMessage();

        const copied = writeText.mock.calls[0]?.[0] ?? "";
        expect(copied).toContain("Forked from");
        expect(copied).toContain("Answer from the earlier conversation.");
        expect(copied).not.toContain("<forked_from");
    });

    it("copies rendered chart text instead of dropping structured message blocks", async () => {
        const { writeText, copyMessage } = await renderAssistantMessageForCopy(
            'A chart:\n<chart>{"title":"Test results","points":[{"label":"Passed","value":42}]}</chart>',
        );
        expect(host?.textContent).toContain("Test results");
        expect(host?.textContent).toContain("Passed");
        await copyMessage();

        expect(writeText.mock.calls[0]?.[0]).toContain("A chart:");
        expect(writeText.mock.calls[0]?.[0]).toContain("Test results");
        expect(writeText.mock.calls[0]?.[0]).toContain("Passed");
    });

    it("copies rendered question content instead of omitting structured prompts", async () => {
        const payload = JSON.stringify({
            questions: [{ id: "goal", prompt: "What should the report emphasize?", options: [{ id: "risks", label: "Risks first" }] }],
        });
        const { writeText, copyMessage } = await renderAssistantMessageForCopy(
            `Question for you:\n<questions id="ask-1" status="pending">${payload}</questions>`,
        );

        expect(host?.textContent).toContain("What should the report emphasize?");
        await copyMessage();

        const copied = writeText.mock.calls[0]?.[0] ?? "";
        expect(copied).toContain("Question for you:");
        expect(copied).toContain("What should the report emphasize?");
        expect(copied).toContain("Risks first");
        expect(copied).not.toContain("<questions");
    });

    it("disables OpenUI runtime telemetry and the remote development inspector", async () => {
        delete process.env.OPENUI_TELEMETRY_DISABLED;
        const autoMountKey = Symbol.for("openui.devtools.autoMount");
        Reflect.set(globalThis, autoMountKey, false);
        vi.resetModules();

        await import("@/features/chat/ui/blocks/disable-openui-devtools");

        expect(process.env.OPENUI_TELEMETRY_DISABLED).toBe("1");
        expect(Reflect.get(globalThis, autoMountKey)).toBe(true);
    });

    it("renders registered components from a generated program", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);

        await act(async () => {
            root?.render(
                <OpenUIBlock
                    response={'root = Surface([stack], "Project summary")\nstack = Stack([heading, metric], "row")\nheading = Text("The project has 12 files.", "body")\nmetric = Metric("Files", "12")'}
                />,
            );
        });

        expect(host.textContent).toContain("Project summary");
        expect(host.textContent).toContain("The project has 12 files.");
        expect(host.textContent).toContain("12");
        expect(host.querySelector("section")).toBeTruthy();
    });

    it("renders extra static components with bounded and accessible values", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);

        await act(async () => {
            root?.render(
                <OpenUIBlock
                    response={'root = Surface([heading, callout, progress, chart, table], "Details")\nheading = Text("Accessible summary", "heading")\ncallout = Callout("Note", "Everything shown is read-only.", "positive")\nprogress = Progress("Completion", 125, "Clamped to the supported range")\nchart = BarChart([], [])\ntable = DataTable(["Name", "Count"], [["Tests", "42"]], "Summary table")'}
                />,
            );
        });

        expect(host.textContent).toContain("Everything shown is read-only.");
        expect(host.querySelector("h4")?.textContent).toBe("Accessible summary");
        expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("100");
        expect(host.textContent).toContain("No chart data was provided.");
        expect(host.querySelector("section")?.className).toContain("bg-surface-2");
        expect(host.querySelector("section")?.className).not.toContain("shadow-sm");
        expect(host.querySelector('aside[role="note"]')?.textContent).toContain("Note");
        expect(host.querySelector('aside[role="note"] p')?.className).toContain("text-success");
        expect(host.querySelector("table:not(.sr-only) caption")?.textContent).toBe("Summary table");
        expect(host.querySelector("table:not(.sr-only)")?.previousElementSibling?.textContent).toBe("Summary table");
    });

    it("keeps signed chart values legible and limits large tables accessibly", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        const columns = Array.from({ length: 9 }, (_, index) => `Column ${index + 1}`);
        const rows = Array.from({ length: 31 }, (_, index) => [`Row ${index + 1}`]);
        const response = [
            'root = Surface([chart, table], "Bounded data")',
            'chart = BarChart(["Gain", "Loss"], [5, -5], "Signed values")',
            `table = DataTable(${JSON.stringify(columns)}, ${JSON.stringify(rows)}, "Long table")`,
        ].join("\n");

        await act(async () => {
            root?.render(<OpenUIBlock response={response} />);
        });

        const bars = Array.from(host.querySelectorAll("figure span[style]"));
        expect(host.textContent).toContain("-5");
        expect(host.querySelector("figure > div[aria-hidden='true']")).toBeTruthy();
        const accessibleTable = host.querySelector("table.sr-only");
        expect(accessibleTable?.closest("figure")).toBeNull();
        expect(accessibleTable?.querySelector("tbody")?.textContent).toContain("-5");
        expect(bars[0]?.getAttribute("style")).toContain("left: 50%");
        expect(bars[1]?.getAttribute("style")).toContain("left: 0%");
        const table = host.querySelector("table:not(.sr-only)");
        expect(table?.querySelectorAll("tbody tr")).toHaveLength(30);
        expect(table?.querySelectorAll("thead th")).toHaveLength(8);
        expect(host.textContent).toContain("Showing the first 30 rows and 8 columns.");
    });

    it("uses the full chart width when comparing non-negative values", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);

        await act(async () => {
            root?.render(
                <OpenUIBlock response={'root = Surface([chart])\nchart = BarChart(["Small", "Large"], [2, 4])'} />,
            );
        });

        const bars = Array.from(host.querySelectorAll("figure span[style]"));
        expect(bars[0]?.getAttribute("style")).toContain("width: 50%");
        expect(bars[0]?.getAttribute("style")).toContain("left: 0%");
        expect(bars[1]?.getAttribute("style")).toContain("width: 100%");
    });

    it("rejects definitions deeper than the expansion boundary before rendering", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        const layers = Array.from({ length: 20 }, (_, index) =>
            `node${index} = Stack([${index === 19 ? "leaf" : `node${index + 1}`}])`,
        );
        const response = [
            "root = Surface([node0])",
            ...layers,
            'leaf = Text("Deep content")',
        ].join("\n");

        await act(async () => {
            root?.render(<OpenUIBlock response={response} />);
        });

        expect(host.textContent).toContain("too complex to display safely");
        expect(host.textContent).not.toContain("Deep content");
    });

    it("rejects cyclic references before the OpenUI runtime expands them", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        const response = ["root = Surface([loop])", "loop = Stack([loop])"].join("\n");

        await act(async () => {
            root?.render(<OpenUIBlock response={response} />);
        });

        expect(host.textContent).toContain("too complex to display safely");
        expect(host.querySelector("section")).toBeNull();
    });

    it("does not count definition-like text inside a string as expanded work", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        const response = 'root = Surface([label])\nlabel = Text("root = Surface([a, a, a, a, a])", "body")';

        await act(async () => {
            root?.render(<OpenUIBlock response={response} />);
        });

        expect(host.textContent).toContain("root = Surface([a, a, a, a, a])");
        expect(host.querySelector("section")).toBeTruthy();
    });

    it("rejects repeated references whose expanded component tree exceeds the total budget", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        const repeated = Array(8).fill("b").join(", ");
        const response = [
            `root = Surface([${Array(8).fill("a").join(", ")}])`,
            `a = Stack([${repeated}])`,
            `b = Stack([${Array(8).fill("leaf").join(", ")}])`,
            'leaf = Text("Safe leaf")',
        ].join("\n");

        await act(async () => {
            root?.render(<OpenUIBlock response={response} />);
        });

        expect(host.textContent).toContain("too complex to display safely");
        expect(host.textContent).not.toContain("Safe leaf");
        expect(host.querySelector("section")).toBeNull();
    });

    it("budgets inline component calls before the renderer expands them", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        const inlineTables = Array(14).fill('DataTable(["Name"], [["Row"]])').join(", ");
        const response = `root = Surface([${inlineTables}])`;

        await act(async () => {
            root?.render(<OpenUIBlock response={response} />);
        });

        expect(host.textContent).toContain("too complex to display safely");
        expect(host.querySelector("section")).toBeNull();
    });

    it("expands child-array aliases and charges their inline containers", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        const tables = Array(14).fill("table").join(", ");
        const response = [
            "root = Surface([Stack(kids)])",
            `kids = [${tables}]`,
            'table = DataTable(["Name"], [["Row"]])',
        ].join("\n");

        await act(async () => {
            root?.render(<OpenUIBlock response={response} />);
        });

        expect(host.textContent).toContain("too complex to display safely");
        expect(host.querySelector("section")).toBeNull();
    });

    it("budgets large component fan-out as well as the number of OpenUI definitions", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        const response = [
            `root = Surface([${Array(14).fill("table").join(", ")}])`,
            'table = DataTable(["Name"], [["Row"]])',
        ].join("\n");

        await act(async () => {
            root?.render(<OpenUIBlock response={response} />);
        });

        expect(host.textContent).toContain("too complex to display safely");
        expect(host.querySelector("section")).toBeNull();
    });

    it("fails closed on data-dependent child expansion and unsupported container expressions", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        const unsafeResponses = [
            'root = Surface(@Each([1, 2], "item", Text("Item")))',
            'kids = @Each([1, 2], "item", Text("Item"))\nroot = Surface(kids)',
            'root = Surface([Stack(@Each([1, 2], "item", Text("Item"))]))',
            'root = Surface(Stack("unsupported children expression"))',
        ];

        for (const response of unsafeResponses) {
            await act(async () => {
                root?.render(<OpenUIBlock response={response} />);
            });
            expect(host.textContent).toContain("too complex to display safely");
            expect(host.querySelector("section")).toBeNull();
        }
    });

    it("shows a safe fallback when a generated program references an unknown component", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);

        await act(async () => {
            root?.render(<OpenUIBlock response={'root = Surface([missing])\nmissing = NotRegistered("ignored")'} />);
        });

        expect(host.textContent).toContain("too complex to display safely");
        expect(host.querySelector("section, script, iframe, img")).toBeNull();
    });

    it("does not keep an earlier renderer error visible after valid content arrives", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        const invalidResponse = [
            "root = Surface([label])",
            "label = Text(123)",
        ].join("\n");
        const validResponse = ["root = Surface([label])", 'label = Text("Recovered")'].join("\n");

        await act(async () => {
            root?.render(<OpenUIBlock response={invalidResponse} />);
        });
        expect(host.textContent).toContain("This visual response could not be rendered.");

        await act(async () => {
            root?.render(<OpenUIBlock response={validResponse} />);
        });

        expect(host.textContent).toContain("Recovered");
        expect(host.textContent).not.toContain("This visual response could not be rendered.");
    });
});
