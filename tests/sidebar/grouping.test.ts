import { describe, expect, it } from "vitest";
import type { Conversation } from "@/lib/backend/types";
import type { ChatCollection } from "@/lib/sidebar/chat-list-meta";
import { groupChats, matchesChatSearch } from "@/features/agent/sidebar/grouping";
import { buildShelves, buildShelfChildren } from "@/features/agent/sidebar/sections";
const chats: Conversation[] = [
    { id: "a", title: "Fix auth", project_path: "C:\\repo\\one", timestamp: 30, history: [] },
    { id: "b", title: "Review UI", project_path: "/repo/two", timestamp: 20, history: [] },
    { id: "c", title: "Untitled", project_path: "C:/repo/one/", timestamp: 10, history: [] },
];
const collections: ChatCollection[] = [
    { id: "z", name: "Zebra", chatIds: ["a"], icon: "star", color: "blue" },
    { id: "b", name: "Build", chatIds: ["b"], icon: "flag", color: "teal" },
];
describe("session grouping", () => {
    it("orders collection groups by name with ungrouped sessions last", () => {
        expect(groupChats(chats, "collection", collections).map((group) => [group.label, group.chats.map((chat) => chat.id)]))
            .toEqual([["Build", ["b"]], ["Zebra", ["a"]], ["No collection", ["c"]]]);
    });
    it("normalizes project separators without mixing distinct projects with the same basename", () => {
        const grouped = groupChats([...chats, { ...chats[0], id: "d", project_path: "/other/one" }], "project");
        expect(grouped).toHaveLength(3);
        expect(grouped.find((group) => group.id === "C:/repo/one")?.chats.map((chat) => chat.id)).toEqual(["a", "c"]);
    });
    it("shares row order between shelf data, grouped rendering and keyboard jumps", () => {
        const sections = buildShelves({ chats, sort: "recent", activeId: null, pinned: new Set(), generating: new Set(), grouping: "collection", collections });
        const children = buildShelfChildren(sections, new Set(), "collection", collections);
        expect(sections.flatMap((section) => section.chats.map((chat) => chat.id))).toEqual(["b", "a", "c"]);
        expect(children.filter((child) => child.kind === "row").map((child) => child.chat.id)).toEqual(["b", "a", "c"]);
        expect(children.filter((child) => child.kind === "group").map((child) => child.label)).toEqual(["Build", "Zebra", "No collection"]);
        expect(buildShelfChildren(sections, new Set(["settled"]), "collection", collections)).toEqual([]);
    });
    it("matches all query terms across title, collection and Windows paths", () => {
        expect(matchesChatSearch(chats[0], "AUTH zebra", "Zebra")).toBe(true);
        expect(matchesChatSearch(chats[0], "repo auth")).toBe(true);
        expect(matchesChatSearch(chats[0], "auth missing")).toBe(false);
        expect(matchesChatSearch(chats[0], "  ")).toBe(true);
    });
});

it("retains filesystem roots and trims long separator suffixes without backtracking", () => {
    const paths = ["/", "C:/", "", "/repo" + "/".repeat(20_000)];
    const grouped = groupChats(paths.map((project_path, id) => ({ ...chats[0], id: String(id), project_path })), "project");
    expect(grouped.map((group) => group.id).sort()).toEqual(["", "/", "/repo", "C:/"]);
    expect(grouped.find((group) => group.id === "/")?.label).toBe("/");
});
