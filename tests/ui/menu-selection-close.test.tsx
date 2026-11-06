import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
    Menubar,
    MenubarContent,
    MenubarMenu,
    MenubarRadioGroup,
    MenubarRadioItem,
    MenubarTrigger,
} from "@/components/ui/dropdown";

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

const openWith = (trigger: Element | null, key = "Enter") =>
    act(() => {
        trigger?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });

const menuItem = (role: string, label: string): HTMLElement | undefined =>
    Array.from(document.body.querySelectorAll<HTMLElement>(`[role="${role}"]`)).find(
        (node) => node.textContent?.trim() === label,
    );

describe("menu selection", () => {
    it("closes a dropdown after a radio pick, the single choice of its group", () => {
        const onValueChange = vi.fn();
        act(() =>
            root.render(
                <DropdownMenu>
                    <DropdownMenuTrigger>Sort</DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuRadioGroup value="name" onValueChange={onValueChange}>
                            <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="date">Date</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                </DropdownMenu>,
            ),
        );
        openWith(host.querySelector("button"));
        expect(menuItem("menuitemradio", "Name")?.getAttribute("aria-checked")).toBe("true");

        act(() => menuItem("menuitemradio", "Date")?.click());

        expect(onValueChange).toHaveBeenCalledExactlyOnceWith("date");
        expect(document.body.querySelector('[role="menu"]')).toBeNull();
    });

    it("keeps a dropdown open after a checkbox toggle, for the next toggle", () => {
        const onCheckedChange = vi.fn();
        act(() =>
            root.render(
                <DropdownMenu>
                    <DropdownMenuTrigger>Filters</DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuCheckboxItem checked={false} onCheckedChange={onCheckedChange}>
                            Staged
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem checked>Unstaged</DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                </DropdownMenu>,
            ),
        );
        openWith(host.querySelector("button"));

        act(() => menuItem("menuitemcheckbox", "Staged")?.click());

        expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(true);
        expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
    });

    it("closes a menubar menu after a radio pick", () => {
        const onValueChange = vi.fn();
        act(() =>
            root.render(
                <Menubar>
                    <MenubarMenu>
                        <MenubarTrigger>View</MenubarTrigger>
                        <MenubarContent>
                            <MenubarRadioGroup value="tree" onValueChange={onValueChange}>
                                <MenubarRadioItem value="tree">Tree</MenubarRadioItem>
                                <MenubarRadioItem value="list">List</MenubarRadioItem>
                            </MenubarRadioGroup>
                        </MenubarContent>
                    </MenubarMenu>
                </Menubar>,
            ),
        );
        openWith(host.querySelector('[role="menuitem"]'), "ArrowDown");

        act(() => menuItem("menuitemradio", "List")?.click());

        expect(onValueChange).toHaveBeenCalledExactlyOnceWith("list");
        expect(document.body.querySelector('[role="menu"]')).toBeNull();
    });
});
