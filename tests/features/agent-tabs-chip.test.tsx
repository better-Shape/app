import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { cards } = vi.hoisted(() => ({
    cards: [{ id: "child-1", parentId: "parent-1", title: "Research agent" }],
}));

vi.mock("@/features/agent/subagents/store", () => ({
    getSubagents: () => cards,
    openSubagent: vi.fn(),
    subscribeSubagents: () => () => {},
}));
vi.mock("@/features/chat/ui/shell/tabs", () => ({ NEW_CHAT_TAB_ID: "__new_chat__" }));

import { AgentTabsChip } from "@/features/agent/sidebar/agent-tabs-chip";

describe("AgentTabsChip disclosure semantics", () => {
    it("keeps the aria-controls target mounted and hidden while collapsed", () => {
        const host = document.createElement("div");
        host.innerHTML = renderToStaticMarkup(<AgentTabsChip />);
        const control = host.querySelector<HTMLButtonElement>("button[aria-controls]");
        const panelId = control?.getAttribute("aria-controls");
        const controlledPanel = panelId ? host.querySelector<HTMLElement>(`#${panelId}`) : null;

        expect(control?.getAttribute("aria-expanded")).toBe("false");
        expect(controlledPanel).not.toBeNull();
        expect(controlledPanel?.hidden).toBe(true);
        expect(controlledPanel?.textContent).toContain("Research agent");
    });
});
