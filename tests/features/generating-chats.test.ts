import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
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
    } finally { act(() => root.unmount()); resetGeneratingChatsForTests(); }
});
