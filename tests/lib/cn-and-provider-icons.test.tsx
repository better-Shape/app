// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { cn } from "@/core/utils";
import { measureAndSyncComposerTextarea } from "@/features/chat/ui/composer/input-helpers";
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

describe("measureAndSyncComposerTextarea dynamic inline action probe", () => {
    it("subtracts live inline action widths including an expanded dictation control", () => {
        const row = document.createElement("div");
        row.setAttribute("data-composer-row", "");
        row.style.paddingLeft = "2px";
        row.style.paddingRight = "2px";
        row.style.columnGap = "4px";
        Object.defineProperty(row, "clientWidth", { configurable: true, value: 400 });

        const leftAction = document.createElement("div");
        leftAction.setAttribute("data-composer-left-action", "");
        leftAction.getBoundingClientRect = () => ({ width: 32 } as DOMRect);

        let rightWidth = 140;
        const rightActions = document.createElement("div");
        rightActions.setAttribute("data-composer-right-actions", "");
        rightActions.getBoundingClientRect = () => ({ width: rightWidth } as DOMRect);

        const textarea = document.createElement("textarea");
        Object.defineProperty(textarea, "clientWidth", { configurable: true, value: 380 });
        Object.defineProperty(textarea, "scrollHeight", {
            configurable: true,
            get() {
                const probed = Number.parseFloat(textarea.style.width);
                if (Number.isFinite(probed) && probed < 250) return 44;
                return 22;
            },
        });

        row.append(leftAction, textarea, rightActions);
        document.body.appendChild(row);
        mountedContainer = row;

        const composerTallRef = { current: true };
        const lastAppliedHeightRef = { current: 44 };
        const textareaClientWidthRef = { current: 380 };
        const stageHeightRef = { current: 760 };

        // While dictation is listening (rightWidth = 140 -> probeWidth = 216 < 250), keep stacked.
        const whileListening = measureAndSyncComposerTextarea({
            textarea,
            overlay: null,
            inputValue: "Draft text that wraps only while dictation timer is expanded",
            isExpanded: false,
            revealCaretEnd: false,
            composerTallRef,
            lastAppliedHeightRef,
            textareaClientWidthRef,
            stageHeightRef,
        });
        expect(whileListening.tall).toBe(true);

        // Once dictation ends (rightWidth = 68 -> probeWidth = 288 >= 250), collapse cleanly.
        rightWidth = 68;
        const afterListening = measureAndSyncComposerTextarea({
            textarea,
            overlay: null,
            inputValue: "Draft text that wraps only while dictation timer is expanded",
            isExpanded: false,
            revealCaretEnd: false,
            composerTallRef,
            lastAppliedHeightRef,
            textareaClientWidthRef,
            stageHeightRef,
        });
        expect(afterListening.tall).toBe(false);
    });
});

