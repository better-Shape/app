// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { cn } from "@/core/utils";
import { hasProviderBrandIcon, providerIcon } from "@/lib/ui/provider-icon";

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

afterEach(() => {
    if (mountedRoot) {
        act(() => {
            mountedRoot?.unmount();
        });
        mountedRoot = null;
    }
    mountedContainer?.remove();
    mountedContainer = null;
});

describe("cn directional padding & custom token merge", () => {
    it("preserves orthogonal padding utilities when overriding one axis", () => {
        expect(cn("p-2", "px-3")).toBe("p-2 px-3");
        expect(cn("px-2.5 py-1.5", "px-3")).toBe("py-1.5 px-3");
        expect(cn("py-sm px-md", "px-3")).toBe("py-sm px-3");
        expect(cn("pl-sm pr-sm", "px-3")).toBe("px-3");
    });

    it("resolves custom BetterShape size tokens cleanly against standard Tailwind utilities", () => {
        expect(cn("h-chrome", "h-8")).toBe("h-8");
        expect(cn("size-7", "h-8")).toBe("h-8");
        expect(cn("px-sm", "px-2.5")).toBe("px-2.5");
    });
});

describe("providerIcon SVG isolation & vendor brand detection", () => {
    it("distinguishes mapped vendor brand icons from generic fallback IDs", () => {
        expect(hasProviderBrandIcon("openai")).toBe(true);
        expect(hasProviderBrandIcon("azure")).toBe(true);
        expect(hasProviderBrandIcon("zenmux")).toBe(true);
        expect(hasProviderBrandIcon("moonshot")).toBe(true);
        expect(hasProviderBrandIcon("llmgateway")).toBe(false);
        expect(hasProviderBrandIcon("venice")).toBe(false);
        expect(hasProviderBrandIcon("custom")).toBe(false);
        expect(hasProviderBrandIcon("auto")).toBe(false);
    });

    it("scopes internal SVG defs across co-mounted icons and normalizes upstream artboards", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        mountedContainer = container;
        mountedRoot = root;

        act(() => {
            root.render(
                <div>
                    <div data-testid="google">{providerIcon("google", 16)}</div>
                    <div data-testid="azure">{providerIcon("azure", 16)}</div>
                    <div data-testid="zenmux">{providerIcon("zenmux", 16)}</div>
                    <div data-testid="moonshot">{providerIcon("moonshot", 16)}</div>
                </div>,
            );
        });

        const allIds = Array.from(container.querySelectorAll<HTMLElement>("[id]")).map((el) => el.id);
        expect(allIds.length).toBeGreaterThan(2);
        expect(new Set(allIds).size).toBe(allIds.length);
        expect(container.querySelectorAll("svg title")).toHaveLength(0);

        const zenmuxSvg = container.querySelector('[data-testid="zenmux"] svg');
        expect(zenmuxSvg?.getAttribute("viewBox")).toBe("16 8 128 148");

        const moonshotSvg = container.querySelector('[data-testid="moonshot"] svg');
        expect(moonshotSvg?.getAttribute("fill")).toBe("currentColor");
    });
});
