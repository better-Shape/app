import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DropdownMenuShortcut, MenubarShortcut } from "@/components/ui/dropdown";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

/** A `#rrggbb` token from the `:root` block of app/globals.css. */
const token = (name: string): string => {
    const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
    if (!match) throw new Error(`${name} is not a #rrggbb token`);
    return match[1];
};

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
const luminance = (hex: string): number => {
    const channel = (offset: number) => {
        const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};

const contrast = (a: string, b: string): number => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
};

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
        for (const hint of host.querySelectorAll("span")) {
            expect(hint.className).toMatch(/\btext-text-secondary\b/);
            expect(hint.className).not.toMatch(/\btext-text-muted\b/);
        }
        // Dropdown and menubar panels are `bg-sidebar`; 13px text needs 4.5:1 (WCAG 1.4.3).
        expect(contrast(token("--text-secondary"), token("--sidebar"))).toBeGreaterThanOrEqual(4.5);
    });
});
