import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { GeneratingIndicator } from "@/features/chat/ui/blocks/generating";
import { ActionLine } from "@/features/chat/ui/blocks/action-line";
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

    // Every active step in the transcript - reasoning, tool calls, analysis,
    // edits - is one ActionLine, so this is the surface the invariant has to
    // hold on. It used to be asserted against standalone chat blocks that no
    // longer render, which meant the rule was pinned to dead code.
    it("announces an active step without burying its status in busy content", () => {
        const host = document.createElement("div");
        host.innerHTML = renderToStaticMarkup(
            createElement(
                ActionLine,
                { action: "Thinking", busy: true, defaultOpen: true },
                createElement("div", { "aria-busy": "true" }, "Reading the composer"),
            ),
        );
        const status = host.querySelector('[role="status"]');
        expect(status).not.toBeNull();
        expect(status?.textContent).toContain("Thinking");
        // The busy content container is a sibling region, never an ancestor.
        expect(status?.closest('[aria-busy="true"]')).toBeNull();
        expect(host.querySelector('[aria-busy="true"]')?.textContent).toContain("Reading the composer");

        // A finished step is not a live region at all, so nothing re-announces.
        host.innerHTML = renderToStaticMarkup(
            createElement(ActionLine, { action: "Thought", detail: "briefly" }),
        );
        expect(host.querySelector('[role="status"]')).toBeNull();
    });
});
