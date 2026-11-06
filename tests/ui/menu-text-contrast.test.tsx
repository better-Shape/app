import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DropdownMenuShortcut, MenubarShortcut } from "@/components/ui/dropdown";
import { contrastRatio, cssToken } from "../helpers/contrast";

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

describe("menu text contrast", () => {
    it("draws shortcut hints in a colour that holds 4.5:1 on the menu panel", () => {
        act(() =>
            root.render(
                <>
                    <DropdownMenuShortcut>Ctrl+F</DropdownMenuShortcut>
                    <MenubarShortcut>Ctrl+S</MenubarShortcut>
                </>,
            ),
        );
        const hints = [...host.querySelectorAll("span")];
        expect(hints.map((hint) => hint.textContent)).toEqual(["Ctrl+F", "Ctrl+S"]);
        for (const hint of hints) {
            expect(hint.className).toMatch(/\btext-text-secondary\b/);
            expect(hint.className).not.toMatch(/\btext-text-muted\b/);
        }
        // Dropdown and menubar panels are `bg-sidebar`; 13px text needs 4.5:1 (WCAG 1.4.3).
        expect(contrastRatio(cssToken("--text-secondary"), cssToken("--sidebar"))).toBeGreaterThanOrEqual(4.5);
    });
});
