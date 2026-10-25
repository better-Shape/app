import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { GeneratingIndicator } from "@/features/chat/ui/blocks/generating";
import { CodebaseAnalysis } from "@/features/chat/ui/blocks/analysis";
import { StyleAnalysis } from "@/features/chat/ui/blocks/style";
import { ThinkingBlock } from "@/features/chat/ui/blocks/thinking";
import {
    isChatGenerating,
    useGeneratingChatIds,
    resetGeneratingChatsForTests,
    setChatGenerating,
} from "@/features/chat/lib/generating-chats";

describe("generating chats", () => {
    afterEach(() => {
        resetGeneratingChatsForTests();
    });

    it("keeps chat A generating after switching focus to chat B", () => {
        setChatGenerating("A", true);
        setChatGenerating("B", false);
        expect(isChatGenerating("A")).toBe(true);
    });

    it("announces the active work status without keeping its live region busy", () => {
        const markup = renderToStaticMarkup(
            createElement(GeneratingIndicator, { label: "Searching files" }),
        );
        expect(markup).toContain('role="status"');
        expect(markup).toContain("Searching files");
        expect(markup).not.toContain("aria-busy");
    });

    it("publishes immutable snapshots so mounted subscribers react to start and completion", () => {
        const host = document.createElement("div");
        const root = createRoot(host);
        const snapshots: ReadonlySet<string>[] = [];
        function Consumer() {
            const ids = useGeneratingChatIds();
            snapshots.push(ids);
            return createElement("span", null, [...ids].join(","));
        }
        try {
            act(() => root.render(createElement(Consumer)));
            const empty = snapshots[0];
            act(() => setChatGenerating("A", true));
            expect(host.textContent).toBe("A");
            expect(empty.size).toBe(0);
            const active = snapshots.at(-1)!;
            act(() => setChatGenerating("A", true));
            expect(snapshots.at(-1)).toBe(active);
            act(() => setChatGenerating("A", false));
            expect(host.textContent).toBe("");
            expect(active.has("A")).toBe(true);
        } finally {
            act(() => root.unmount());
            resetGeneratingChatsForTests();
        }
    });

    it("keeps status live regions outside busy content containers", () => {
        const activeBlocks = [
            createElement(ThinkingBlock, { content: "Current thought", isActive: true }),
            createElement(CodebaseAnalysis, { items: [], isActive: true }),
            createElement(StyleAnalysis, { label: "Styles", isActive: true }),
        ];

        for (const block of activeBlocks) {
            const container = document.createElement("div");
            container.innerHTML = renderToStaticMarkup(block);
            const status = container.querySelector('[role="status"]');
            expect(status).not.toBeNull();
            expect(status?.closest("[aria-busy]")).toBeNull();
        }

        const thoughtContainer = document.createElement("div");
        thoughtContainer.innerHTML = renderToStaticMarkup(
            createElement(ThinkingBlock, { content: "Current thought", isActive: true }),
        );
        expect(thoughtContainer.querySelector('[aria-busy="true"]')).not.toBeNull();
    });
});
