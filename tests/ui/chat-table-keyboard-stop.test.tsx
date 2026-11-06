import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MarkdownTableShell } from "@/features/chat/ui/md/data-table";

/** The width of the scroll box. */
const BOX_WIDTH = 400;
/** The width of the table inside it, which each test sets. */
let tableWidth = 0;
/** Callbacks of every ResizeObserver the component created. */
let resizeCallbacks: (() => void)[] = [];

/** Stands in for the browser's ResizeObserver, which jsdom lacks. */
class FakeResizeObserver {
    constructor(callback: () => void) {
        resizeCallbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    tableWidth = 0;
    resizeCallbacks = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(() => tableWidth);
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => BOX_WIDTH);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** Renders a markdown table and returns its scroll box, the table's parent. */
const renderTable = (): HTMLElement => {
    act(() =>
        root.render(
            <TooltipProvider>
                <MarkdownTableShell>
                    <table>
                        <tbody>
                            <tr>
                                <td>Composer</td>
                                <td>Ready</td>
                            </tr>
                        </tbody>
                    </table>
                </MarkdownTableShell>
            </TooltipProvider>,
        ),
    );
    const box = host.querySelector("table")?.parentElement;
    if (!box) throw new Error("the table has no scroll box");
    return box;
};

/** Changes the table's width and lets the resize observers report it. */
const resizeTable = (width: number) => {
    tableWidth = width;
    act(() => {
        for (const callback of resizeCallbacks) callback();
    });
};

/** The keyboard stop and name the box carries. */
const stopOf = (box: HTMLElement) => ({
    tabIndex: box.getAttribute("tabindex"),
    role: box.getAttribute("role"),
    name: box.getAttribute("aria-label"),
});

const NO_STOP = { tabIndex: null, role: null, name: null };
const STOP = { tabIndex: "0", role: "group", name: "Scrollable table" };

describe("chat table keyboard stop", () => {
    it("adds no stop and no name to a table that fits its box", () => {
        tableWidth = 300;
        expect(stopOf(renderTable())).toEqual(NO_STOP);
    });

    it("makes a table wider than its box a named stop, and drops it when the table fits again", () => {
        tableWidth = 900;
        const box = renderTable();
        expect(stopOf(box)).toEqual(STOP);
        resizeTable(300);
        expect(stopOf(box)).toEqual(NO_STOP);
        resizeTable(900);
        expect(stopOf(box)).toEqual(STOP);
    });

    it("keeps a focused table a stop when it comes to fit, so focus stays on it until it leaves", () => {
        tableWidth = 900;
        const box = renderTable();
        act(() => box.focus());
        expect(document.activeElement).toBe(box);

        resizeTable(300);
        expect(stopOf(box)).toEqual(STOP);
        expect(document.activeElement).toBe(box);

        act(() => box.blur());
        expect(stopOf(box)).toEqual(NO_STOP);
    });

    it("ignores focus on a control inside the table", () => {
        tableWidth = 300;
        const box = renderTable();
        const cell = box.querySelector("td");
        if (!cell) throw new Error("the table has no cell");
        const link = document.createElement("a");
        link.href = "#cell";
        link.textContent = "cell link";
        cell.append(link);
        act(() => link.focus());
        expect(document.activeElement).toBe(link);
        expect(stopOf(box)).toEqual(NO_STOP);
    });
});
