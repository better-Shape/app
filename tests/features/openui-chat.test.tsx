import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { OpenUIBlock } from "@/features/chat/ui/blocks/openui";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
});

describe("OpenUIBlock", () => {
    it("disables OpenUI runtime telemetry and the remote development inspector", () => {
        expect(process.env.OPENUI_TELEMETRY_DISABLED).toBe("1");
        expect(Reflect.get(globalThis, Symbol.for("openui.devtools.autoMount"))).toBe(true);
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
        expect(host.querySelector("figure table.sr-only tbody")?.textContent).toContain("-5");
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

    it("caps pathological nested layouts with a readable fallback", async () => {
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

        expect(host.textContent).toContain("nested too deeply to display");
        expect(host.textContent).not.toContain("Deep content");
    });

    it("shows a safe fallback when a generated program references an unknown component", async () => {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);

        await act(async () => {
            root?.render(<OpenUIBlock response={'root = Surface([missing])\nmissing = NotRegistered("ignored")'} />);
        });

        expect(host.textContent).toContain("This visual response could not be rendered.");
        expect(host.querySelector("script, iframe, img")).toBeNull();
    });
});
