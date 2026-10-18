import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { GeneratingIndicator } from "@/features/chat/ui/blocks/generating";
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
});
