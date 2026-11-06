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
const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}) =>
    act(() => {
        el.dispatchEvent(
            new KeyboardEvent("keydown", { key, code: KEY_CODES[key] ?? key, bubbles: true, cancelable: true, ...init }),
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
        expect(readme.getAttribute("aria-keyshortcuts")).toBe("Delete Meta+Backspace");

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

    it("leaves Space to drag-and-drop reordering in the workspace strip", async () => {
        const onSelect = vi.fn();
        const onReorder = vi.fn();
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
                    onReorder={onReorder}
                />,
            ),
        );
        const [, app] = tabs();
        app.focus();
        // A picked-up tab is raised above its neighbours while it moves.
        expect(app.style.zIndex).toBe("1");
        press(app, " ");
        expect(app.style.zIndex).toBe("20");
        expect(onSelect).not.toHaveBeenCalled();

        // Mid-drag the arrows belong to the drag, not to focus movement.
        press(app, "ArrowRight");
        expect(document.activeElement).toBe(app);
        // The keyboard sensor starts listening for keys on the next task, then Escape drops the tab.
        await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
        press(app, "Escape");
        expect(app.style.zIndex).toBe("1");
        expect(onReorder).not.toHaveBeenCalled();
    });

    it("moves focus along the workspace strip with the arrows when no tab is picked up", () => {
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
        const [readme, app] = tabs();
        readme.focus();
        press(readme, "ArrowRight");
        expect(document.activeElement).toBe(app);
        press(app, "ArrowRight");
        expect(document.activeElement).toBe(readme);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("names each strip and takes one Tab stop in it, the selected tab", () => {
        const workspace = (activeId: string) =>
            act(() =>
                root.render(
                    <WorkspaceTabs
                        tabs={[
                            { id: "readme", kind: "file", title: "README.md", path: "/p/README.md" },
                            { id: "app", kind: "file", title: "App.tsx", path: "/p/src/App.tsx" },
                            { id: "lib", kind: "file", title: "lib.ts", path: "/p/src/lib.ts" },
                        ]}
                        activeId={activeId}
                        onSelect={() => {}}
                        onClose={() => {}}
                        onNew={() => {}}
                        onReorder={() => {}}
                    />,
                ),
            );
        workspace("app");
        expect(host.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Workspace");
        expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
        // A screen reader says "tab", not dnd-kit's "sortable".
        expect(tabs().map((tab) => tab.getAttribute("aria-roledescription"))).toEqual([null, null, null]);
        // With no tab selected, the first keeps the strip reachable.
        workspace("missing");
        expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);

        act(() =>
            root.render(
                <ChatTabBar
                    title="Chats"
                    onNewChat={() => {}}
                    tabs={[
                        { id: "first", title: "First chat" },
                        { id: "second", title: "Second chat" },
                    ]}
                    activeTabId="second"
                    onSelectTab={() => {}}
                    onCloseTab={() => {}}
                />,
            ),
        );
        const strip = host.querySelector('[role="tablist"]');
        expect(strip?.getAttribute("aria-label")).toBe("Chats");
        expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0]);
        expect(tabs().map((tab) => tab.getAttribute("aria-roledescription"))).toEqual([null, null]);
        // The strip holds only tabs; the New chat button sits after it.
        expect([...(strip?.children ?? [])].every((child) => child.getAttribute("role") === "tab")).toBe(true);
        expect(host.querySelector('button[aria-label="New chat"]')?.closest('[role="tablist"]')).toBeNull();
    });

    it("closes a workspace tab on Cmd+Backspace, for keyboards without a Delete key", () => {
        const onClose = vi.fn();
        act(() =>
            root.render(
                <WorkspaceTabs
                    tabs={[
                        { id: "readme", kind: "file", title: "README.md", path: "/p/README.md" },
                        { id: "app", kind: "file", title: "App.tsx", path: "/p/src/App.tsx" },
                    ]}
                    activeId="readme"
                    onSelect={() => {}}
                    onClose={onClose}
                    onNew={() => {}}
                    onReorder={() => {}}
                />,
            ),
        );
        const [, app] = tabs();
        press(app, "Backspace");
        expect(onClose).not.toHaveBeenCalled();
        press(app, "Backspace", { metaKey: true });
        expect(onClose).toHaveBeenCalledExactlyOnceWith("app");
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
