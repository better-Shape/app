import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { GeneratingIndicator } from "@/features/chat/ui/blocks/generating";
import { CodebaseAnalysis } from "@/features/chat/ui/blocks/analysis";
import { StyleAnalysis } from "@/features/chat/ui/blocks/style";
import { ThinkingBlock } from "@/features/chat/ui/blocks/thinking";
import {
    isChatGenerating,
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
