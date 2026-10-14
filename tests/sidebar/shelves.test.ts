import { describe, expect, it } from "vitest";
import type { Conversation } from "@/lib/backend/types";
import {
    CHAT_SHELVES,
    buildShelfChildren,
    buildShelves,
    cardMeta,
    chatRelativeTime,
    folderName,
    shelfOf,
    sortShelf,
    type ChatShelfChild,
    type ChatShelfHeader,
    type ChatShelfId,
    type ChatShelfRow,
    type ChatShelfSection,
} from "@/features/agent/sidebar/sections";

function chat(id: string, title: string, timestamp: number): Conversation {
    return { id, title, history: [], project_path: "/repo/app", timestamp };
}

const A = chat("a", "Alpha", 300);
const B = chat("b", "bravo", 100);
const C = chat("c", "Charlie", 200);
const D = chat("d", "delta", 400);

function ids(section: ChatShelfSection): string[] {
    return section.chats.map((entry) => entry.id);
}

function shelves(overrides: {
    chats?: readonly Conversation[];
    pinned?: string[];
    generating?: string[];
    activeId?: string | null;
    hidden?: string[];
} = {}): ChatShelfSection[] {
    return buildShelves({
        chats: overrides.chats ?? [A, B, C, D],
        sort: "recent",
        pinned: new Set(overrides.pinned ?? []),
        generating: new Set(overrides.generating ?? []),
        activeId: overrides.activeId ?? null,
        ...(overrides.hidden ? { hidden: new Set(overrides.hidden) } : {}),
    });
}

function headersOf(children: readonly ChatShelfChild[]): ChatShelfHeader[] {
    return children.filter((child): child is ChatShelfHeader => child.kind === "header");
}

function rowsOf(children: readonly ChatShelfChild[]): ChatShelfRow[] {
    return children.filter((child): child is ChatShelfRow => child.kind === "row");
}

function rowIds(children: readonly ChatShelfChild[]): string[] {
    return rowsOf(children).map((row) => row.chat.id);
}

describe("shelf precedence", () => {
    it("puts pinned above everything, then working, then active, then settled", () => {
        expect(shelfOf({ pinned: true, generating: true, active: true })).toBe("pinned");
        expect(shelfOf({ pinned: false, generating: true, active: true })).toBe("working");
        expect(shelfOf({ pinned: false, generating: false, active: true })).toBe("active");
        expect(shelfOf({ pinned: false, generating: false, active: false })).toBe("settled");
    });

    it("walks the sections in that same order", () => {
        expect(CHAT_SHELVES.map((spec) => spec.id)).toEqual([
            "pinned",
            "working",
            "active",
            "snoozed",
            "settled",
        ]);
    });

    it("honours snooze/settle intent without hiding a running session", () => {
        expect(shelfOf({ pinned: true, generating: false, active: true, disposition: "snoozed" })).toBe("snoozed");
        expect(shelfOf({ pinned: false, generating: true, active: false, disposition: "snoozed" })).toBe("working");
        expect(shelfOf({ pinned: true, generating: false, active: true, disposition: "settled" })).toBe("settled");
        expect(shelfOf({ pinned: false, generating: false, active: false, disposition: "active" })).toBe("active");
    });
});

describe("buildShelves", () => {
    it("omits sections with nothing in them", () => {
        const sections = shelves();
        expect(sections).toHaveLength(1);
        expect(sections[0].id).toBe("settled");
        expect(sections[0].label).toBe("Settled");
        expect(ids(sections[0])).toEqual(["d", "a", "c", "b"]);
    });

    it("splits the chats across every shelf that applies, in precedence order", () => {
        const sections = shelves({ pinned: ["b"], generating: ["c"], activeId: "d" });
        expect(sections.map((section) => section.id)).toEqual(["pinned", "working", "active", "settled"]);
        expect(sections.map(ids)).toEqual([["b"], ["c"], ["d"], ["a"]]);
    });

    it("gives a pinned chat the card variant and the rest the slim one", () => {
        const sections = shelves({ pinned: ["a"] });
        expect(sections.map((section) => section.variant)).toEqual(["card", "slim"]);
    });

    it("hides a chat inside an open undo window without touching the others", () => {
        expect(ids(shelves({ hidden: ["c"] })[0])).toEqual(["d", "a", "b"]);
    });

    it("drops a section entirely once its last chat is hidden", () => {
        expect(shelves({ chats: [A, B], pinned: ["b"], hidden: ["b"] }).map((s) => s.id)).toEqual([
            "settled",
        ]);
    });
});

describe("sortShelf", () => {
    const chats = [A, B, C, D];

    it("puts the newest first for Recent and the oldest first for Oldest", () => {
        expect(sortShelf(chats, "recent").map((entry) => entry.id)).toEqual(["d", "a", "c", "b"]);
        expect(sortShelf(chats, "oldest").map((entry) => entry.id)).toEqual(["b", "c", "a", "d"]);
    });

    it("compares names without case and in both directions", () => {
        expect(sortShelf(chats, "name-asc").map((entry) => entry.title)).toEqual([
            "Alpha",
            "bravo",
            "Charlie",
            "delta",
        ]);
        expect(sortShelf(chats, "name-desc").map((entry) => entry.title)).toEqual([
            "delta",
            "Charlie",
            "bravo",
            "Alpha",
        ]);
    });

    it("orders equal timestamps by id, so the input order cannot leak through", () => {
        const tied = [chat("z", "Same", 500), chat("a", "Same", 500), chat("m", "Same", 500)];
        const forward = sortShelf(tied, "recent").map((entry) => entry.id);
        expect(forward).toEqual(["a", "m", "z"]);
        expect(sortShelf([...tied].reverse(), "recent").map((entry) => entry.id)).toEqual(forward);
    });

    it("does not let the pin set leak into the order inside a shelf", () => {
        // The old comparator led with the pin check, which made "Recent" mean
        // "newest among the unpinned" for every row under the pinned block.
        expect(sortShelf([B, D, A, C], "recent").map((entry) => entry.id)).toEqual(["d", "a", "c", "b"]);
    });

    it("leaves the input alone", () => {
        const input = [A, B, C, D];
        sortShelf(input, "oldest");
        expect(input).toEqual([A, B, C, D]);
    });
});

describe("buildShelfChildren", () => {
    it("renders no headers at all when everything is in one shelf", () => {
        const children = buildShelfChildren(shelves(), new Set<ChatShelfId>());
        expect(headersOf(children)).toHaveLength(0);
        expect(children).toHaveLength(4);
    });

    it("interleaves a header with its rows once there is more than one shelf", () => {
        const children = buildShelfChildren(shelves({ pinned: ["d"] }), new Set<ChatShelfId>());
        expect(children.map((child) => child.kind)).toEqual([
            "header",
            "row",
            "header",
            "row",
            "row",
            "row",
        ]);
        expect(headersOf(children).map((header) => [header.label, header.count, header.open])).toEqual([
            ["Pinned", 1, true],
            ["Settled", 3, true],
        ]);
    });

    it("hides a collapsed shelf's rows but keeps its header", () => {
        const children = buildShelfChildren(shelves({ pinned: ["d"] }), new Set<ChatShelfId>(["pinned"]));
        expect(headersOf(children).map((header) => header.shelf)).toEqual(["pinned", "settled"]);
        expect(headersOf(children).find((header) => header.shelf === "pinned")?.open).toBe(false);
        expect(rowIds(children)).toEqual(["a", "c", "b"]);
    });

    it("keeps a row's key when the chat only changes shelf", () => {
        const before = rowsOf(buildShelfChildren(shelves({ chats: [A, B] }), new Set<ChatShelfId>()));
        const after = rowsOf(
            buildShelfChildren(shelves({ chats: [A, B], generating: ["b"] }), new Set<ChatShelfId>()),
        );
        const bBefore = before.find((row) => row.chat.id === "b");
        const bAfter = after.find((row) => row.chat.id === "b");

        expect(bBefore?.variant).toBe("slim");
        expect(bAfter?.variant).toBe("slim");
        // Same key, so React relocates the node instead of rebuilding it and the
        // motion layer can glide it.
        expect(bAfter?.key).toBe(bBefore?.key);
    });

    it("changes a row's key when the chat also changes variant", () => {
        const before = rowsOf(buildShelfChildren(shelves({ chats: [A, B] }), new Set<ChatShelfId>()));
        const after = rowsOf(
            buildShelfChildren(shelves({ chats: [A, B], pinned: ["b"] }), new Set<ChatShelfId>()),
        );
        const bBefore = before.find((row) => row.chat.id === "b");
        const bAfter = after.find((row) => row.chat.id === "b");

        expect(bBefore?.variant).toBe("slim");
        expect(bAfter?.variant).toBe("card");
        expect(bAfter?.key).not.toBe(bBefore?.key);
        // An untouched chat keeps its key either way.
        expect(after.find((row) => row.chat.id === "a")?.key).toBe(
            before.find((row) => row.chat.id === "a")?.key,
        );
    });

    it("gives headers and rows keys that cannot collide", () => {
        const children = buildShelfChildren(shelves({ pinned: ["d"] }), new Set<ChatShelfId>());
        const keys = children.map((child) => child.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.some((key) => key.startsWith("header:"))).toBe(true);
    });
});

describe("card text", () => {
    const now = 2_000_000_000_000;

    it("scales the relative time like the welcome screen does", () => {
        expect(chatRelativeTime(now, now)).toBe("now");
        expect(chatRelativeTime(now - 5 * 60_000, now)).toBe("5m");
        expect(chatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h");
        expect(chatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d");
        expect(chatRelativeTime(now + 60_000, now)).toBe("—");
    });

    it("takes the folder name out of a path on either separator", () => {
        expect(folderName("/home/dev/bettershape")).toBe("bettershape");
        expect(folderName("C:\\code\\bettershape")).toBe("bettershape");
        expect(folderName("")).toBe("");
    });

    it("shows the folder and the collection on the card", () => {
        expect(cardMeta("/home/dev/bettershape", null)).toBe("bettershape");
        expect(cardMeta("/home/dev/bettershape", "Refactors")).toBe("bettershape · Refactors");
        expect(cardMeta("", null)).toBe("");
    });
});