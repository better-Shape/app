import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalStripTab } from "@/features/terminal/ui/terminal-tab";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

type Handlers = { onActivate: (id: string) => void; onClose: (id: string) => void };

/** The strip as `features/terminal/ui/terminal.tsx` renders it: a tablist of terminal tabs. */
const renderStrip = (titles: string[], active: string, { onActivate, onClose }: Handlers) =>
    act(() =>
        root.render(
            <div role="tablist">
                {titles.map((title) => (
                    <TerminalStripTab
                        key={title}
                        title={title}
                        active={title === active}
                        unread={false}
                        onActivate={() => onActivate(title)}
                        onClose={() => onClose(title)}
                    />
                ))}
            </div>,
        ),
    );

/** The two panes of a split terminal, each a tablist inside the terminal root. */
const renderSplit = (panes: { titles: string[]; active: string }[], { onActivate, onClose }: Handlers) =>
    act(() =>
        root.render(
            <div data-terminal-root="true">
                {panes
                    .filter((pane) => pane.titles.length > 0)
                    .map((pane) => (
                        <div key={pane.titles[0]} role="tablist">
                            {pane.titles.map((title) => (
                                <TerminalStripTab
                                    key={title}
                                    title={title}
                                    active={title === pane.active}
                                    unread={false}
                                    onActivate={() => onActivate(title)}
                                    onClose={() => onClose(title)}
                                />
                            ))}
                        </div>
                    ))}
            </div>,
        ),
    );

const tabs = () => [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}) =>
    act(() => {
        el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    });
const click = (el: Element) =>
    act(() => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

describe("terminal strip tab semantics", () => {
    it("nests no focusable control and announces Delete as its close key", () => {
        renderStrip(["PowerShell 1", "PowerShell 2"], "PowerShell 1", { onActivate: vi.fn(), onClose: vi.fn() });
        expect(
            tabs().map((tab) => tab.querySelectorAll("button, a[href], input, select, textarea, [tabindex]").length),
        ).toEqual([0, 0]);
        expect(tabs().map((tab) => tab.getAttribute("aria-keyshortcuts"))).toEqual(["Delete", "Delete"]);
        expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
        expect(tabs()[0].querySelector("[data-tab-close]")?.getAttribute("aria-hidden")).toBe("true");
    });

    it("opens on Enter or Space, since the strip has no drag-and-drop", () => {
        const onActivate = vi.fn();
        renderStrip(["PowerShell 1", "PowerShell 2"], "PowerShell 1", { onActivate, onClose: vi.fn() });
        press(tabs()[1], "Enter");
        press(tabs()[1], " ");
        press(tabs()[1], "a");
        expect(onActivate.mock.calls).toEqual([["PowerShell 2"], ["PowerShell 2"]]);
    });

    it("closes on a glyph click without opening, and opens on a click elsewhere", () => {
        const onActivate = vi.fn();
        const onClose = vi.fn();
        renderStrip(["PowerShell 1", "PowerShell 2"], "PowerShell 1", { onActivate, onClose });
        click(tabs()[1].querySelector("[data-tab-close]")!);
        expect(onClose).toHaveBeenLastCalledWith("PowerShell 2");
        expect(onActivate).not.toHaveBeenCalled();
        click(tabs()[1]);
        expect(onActivate).toHaveBeenLastCalledWith("PowerShell 2");
    });

    it("moves focus to the next tab, or the previous one for the last tab, when Delete closes it", () => {
        let open = ["bash 1", "bash 2", "bash 3"];
        const handlers: Handlers = {
            onActivate: () => {},
            onClose: (title) => {
                open = open.filter((entry) => entry !== title);
                renderStrip(open, "bash 1", handlers);
            },
        };
        renderStrip(open, "bash 1", handlers);

        tabs()[1].focus();
        press(tabs()[1], "Delete");
        expect(tabs().map((tab) => tab.textContent)).toEqual(["bash 1", "bash 3"]);
        expect(document.activeElement?.textContent).toBe("bash 3");

        press(tabs()[1], "Delete");
        expect(document.activeElement?.textContent).toBe("bash 1");
    });

    it("moves focus along the strip with the arrows, Home and End, without opening a tab", () => {
        const onActivate = vi.fn();
        renderStrip(["bash 1", "bash 2", "bash 3"], "bash 1", { onActivate, onClose: vi.fn() });
        const focused = () => document.activeElement?.textContent;

        tabs()[0].focus();
        press(tabs()[0], "ArrowRight");
        expect(focused()).toBe("bash 2");
        press(tabs()[1], "End");
        expect(focused()).toBe("bash 3");
        press(tabs()[2], "ArrowRight");
        expect(focused()).toBe("bash 1");
        press(tabs()[0], "ArrowLeft");
        expect(focused()).toBe("bash 3");
        press(tabs()[2], "Home");
        expect(focused()).toBe("bash 1");
        expect(onActivate).not.toHaveBeenCalled();
    });

    it("leaves a modified arrow, Home or End to shortcuts", () => {
        renderStrip(["bash 1", "bash 2", "bash 3"], "bash 1", { onActivate: vi.fn(), onClose: vi.fn() });
        tabs()[0].focus();
        const chords: [string, KeyboardEventInit][] = [
            ["ArrowRight", { ctrlKey: true }],
            ["ArrowRight", { altKey: true }],
            ["ArrowLeft", { metaKey: true }],
            ["End", { shiftKey: true }],
        ];
        for (const [key, modifier] of chords) {
            const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifier });
            act(() => {
                tabs()[0].dispatchEvent(event);
            });
            expect(event.defaultPrevented, key).toBe(false);
            expect(document.activeElement?.textContent, key).toBe("bash 1");
        }
    });

    it("closes one tab per Delete press, ignoring the repeats of a held key", () => {
        const onClose = vi.fn();
        renderStrip(["bash 1", "bash 2"], "bash 1", { onActivate: vi.fn(), onClose });
        tabs()[0].focus();
        press(tabs()[0], "Delete", { repeat: true });
        expect(onClose).not.toHaveBeenCalled();
        press(tabs()[0], "Delete");
        expect(onClose).toHaveBeenCalledExactlyOnceWith("bash 1");
    });

    it("hands focus to the other pane's selected tab when the last tab of a split pane closes", () => {
        let right = ["bash 3"];
        const handlers: Handlers = {
            onActivate: () => {},
            onClose: (title) => {
                right = right.filter((entry) => entry !== title);
                renderSplit([{ titles: ["bash 1", "bash 2"], active: "bash 2" }, { titles: right, active: "bash 3" }], handlers);
            },
        };
        renderSplit([{ titles: ["bash 1", "bash 2"], active: "bash 2" }, { titles: right, active: "bash 3" }], handlers);

        const last = tabs()[2];
        expect(last.textContent).toBe("bash 3");
        last.focus();
        press(last, "Delete");
        expect(tabs().map((tab) => tab.textContent)).toEqual(["bash 1", "bash 2"]);
        expect(document.activeElement?.textContent).toBe("bash 2");
    });
});
