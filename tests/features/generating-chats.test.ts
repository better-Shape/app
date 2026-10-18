import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { GeneratingIndicator } from "@/features/chat/ui/blocks/generating";
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
});
