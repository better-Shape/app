import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTabs } from "@/features/agent/workspace/tabs";
import { ChatTabBar } from "@/features/chat/ui/shell/tabs";

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

const tabs = () => [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
/** A focusable control inside `role="tab"` is a nested interactive control (axe nested-interactive). */
const focusableInside = (tab: HTMLElement) =>
    tab.querySelectorAll("button, a[href], input, select, textarea, [tabindex]").length;
/** `code` as a browser sends it: dnd-kit's keyboard sensor starts a drag on the Space and Enter codes. */
const KEY_CODES: Record<string, string> = { Enter: "Enter", " ": "Space", Delete: "Delete" };
const press = (el: HTMLElement, key: string) =>
    act(() => {
        el.dispatchEvent(
            new KeyboardEvent("keydown", { key, code: KEY_CODES[key] ?? key, bubbles: true, cancelable: true }),
        );
    });
const click = (el: Element) =>
    act(() => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

describe("workbench tab close semantics", () => {
    it("workspace tabs close on Delete or a glyph click and nest no focusable control", () => {
        const onClose = vi.fn();
        const onSelect = vi.fn();
        act(() =>
            root.render(
                <WorkspaceTabs
                    tabs={[
                        { id: "readme", kind: "file", title: "README.md", path: "/p/README.md" },
                        { id: "app", kind: "file", title: "App.tsx", path: "/p/src/App.tsx" },
                    ]}
                    activeId="readme"
                    onSelect={onSelect}
                    onClose={onClose}
                    onNew={() => {}}
                    onReorder={() => {}}
                />,
            ),
        );
        const [readme, app] = tabs();
        expect(tabs().map(focusableInside)).toEqual([0, 0]);
        expect(readme.getAttribute("aria-keyshortcuts")).toBe("Delete");

        press(readme, "Delete");
        expect(onClose).toHaveBeenLastCalledWith("readme");

        click(app.querySelector("[data-tab-close]")!);
        expect(onClose).toHaveBeenLastCalledWith("app");
        expect(onSelect).not.toHaveBeenCalled();

        click(app);
        expect(onSelect).toHaveBeenLastCalledWith("app");
    });

    it("moves focus to the next tab, or the previous one for the last tab, when Delete closes it", () => {
        const tabsFixture = [
            { id: "readme", kind: "file" as const, title: "README.md", path: "/p/README.md" },
            { id: "app", kind: "file" as const, title: "App.tsx", path: "/p/src/App.tsx" },
            { id: "lib", kind: "file" as const, title: "lib.ts", path: "/p/src/lib.ts" },
        ];
        const renderStrip = (list: typeof tabsFixture, onClose: (id: string) => void) =>
            act(() =>
                root.render(
                    <WorkspaceTabs
                        tabs={list}
                        activeId="readme"
                        onSelect={() => {}}
                        onClose={onClose}
                        onNew={() => {}}
                        onReorder={() => {}}
                    />,
                ),
            );
        let open = tabsFixture;
        const close = (id: string) => {
            open = open.filter((tab) => tab.id !== id);
            renderStrip(open, close);
        };
        renderStrip(open, close);

        tabs()[1].focus();
        press(tabs()[1], "Delete");
        expect(tabs().map((tab) => tab.getAttribute("aria-label"))).toEqual(["README.md", "lib.ts"]);
        expect(document.activeElement?.getAttribute("aria-label")).toBe("lib.ts");

        press(tabs()[1], "Delete");
        expect(document.activeElement?.getAttribute("aria-label")).toBe("README.md");
    });

    it("leaves Space to drag-and-drop reordering in the workspace strip", () => {
        const onSelect = vi.fn();
        act(() =>
            root.render(
                <WorkspaceTabs
                    tabs={[
                        { id: "readme", kind: "file", title: "README.md", path: "/p/README.md" },
                        { id: "app", kind: "file", title: "App.tsx", path: "/p/src/App.tsx" },
                    ]}
                    activeId="readme"
                    onSelect={onSelect}
                    onClose={() => {}}
                    onNew={() => {}}
                    onReorder={() => {}}
                />,
            ),
        );
        const [, app] = tabs();
        app.focus();
        press(app, " ");
        expect(onSelect).not.toHaveBeenCalled();
        press(app, "Escape");
    });

    it("a lone workspace tab offers no close path", () => {
        const onClose = vi.fn();
        act(() =>
            root.render(
                <WorkspaceTabs
                    tabs={[{ id: "files", kind: "files", title: "Files" }]}
                    activeId="files"
                    onSelect={() => {}}
                    onClose={onClose}
                    onNew={() => {}}
                    onReorder={() => {}}
                />,
            ),
        );
        const [only] = tabs();
        expect(only.getAttribute("aria-keyshortcuts")).toBeNull();
        expect(only.querySelector("[data-tab-close]")).toBeNull();
        press(only, "Delete");
        expect(onClose).not.toHaveBeenCalled();
    });

    it("chat tabs close on Delete or a glyph click and nest no focusable control", () => {
        const onCloseTab = vi.fn();
        const onSelectTab = vi.fn();
        act(() =>
            root.render(
                <ChatTabBar
                    title="Chats"
                    onNewChat={() => {}}
                    tabs={[
                        { id: "first", title: "First chat" },
                        { id: "second", title: "Second chat" },
                    ]}
                    activeTabId="first"
                    onSelectTab={onSelectTab}
                    onCloseTab={onCloseTab}
                />,
            ),
        );
        const [first, second] = tabs();
        expect(tabs().map(focusableInside)).toEqual([0, 0]);

        press(first, "Delete");
        expect(onCloseTab).toHaveBeenLastCalledWith("first");

        click(second.querySelector("[data-tab-close]")!);
        expect(onCloseTab).toHaveBeenLastCalledWith("second");
        expect(onSelectTab).not.toHaveBeenCalled();

        // Enter opens the tab before drag-and-drop sees it; its keyboard sensor would otherwise
        // take the Enter code as "pick up".
        press(second, "Enter");
        expect(onSelectTab).toHaveBeenLastCalledWith("second");
    });
});
