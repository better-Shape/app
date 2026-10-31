import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sidebar can be open in two windows. A pin, unread mark or collection made
 * in one used to stay invisible in the other until a reload, because the caches
 * are per window and nothing listened for the change.
 */
describe("chat list cross-window sync", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    it("re-reads pins written by another window", async () => {
        const meta = await import("@/lib/sidebar/chat-list-meta");
        const seen = vi.fn();
        meta.subscribePinnedChats(seen);
        expect(meta.getPinnedChatIds().has("chat-1")).toBe(false);

        // Another window's write, delivered as a storage event.
        localStorage.setItem("bettershape-sidebar-pinned-chats", JSON.stringify(["chat-1"]));
        window.dispatchEvent(new StorageEvent("storage", { key: "bettershape-sidebar-pinned-chats" }));

        expect(meta.getPinnedChatIds().has("chat-1")).toBe(true);
        expect(seen).toHaveBeenCalled();
    });

    it("re-reads unread marks and collections from a broadcast", async () => {
        const meta = await import("@/lib/sidebar/chat-list-meta");
        localStorage.setItem("bettershape-sidebar-unread-chats", JSON.stringify(["chat-2"]));
        localStorage.setItem(
            "bettershape-sidebar-collections",
            JSON.stringify([{ id: "col-1", name: "Later", icon: "star", color: "blue", chatIds: ["chat-2"] }]),
        );
        window.dispatchEvent(new CustomEvent("bettershape-chat-unread-changed"));

        expect(meta.getUnreadChatIds().has("chat-2")).toBe(true);
        expect(meta.getCollections()).toHaveLength(1);
    });

    it("does not re-read, or notify twice, for its own write", async () => {
        const meta = await import("@/lib/sidebar/chat-list-meta");
        const seen = vi.fn();
        meta.subscribePinnedChats(seen);
        meta.setChatPinned("chat-3", true);
        // One notification for the local subscribers, none from the echo.
        expect(seen).toHaveBeenCalledTimes(1);
        expect(meta.getPinnedChatIds().has("chat-3")).toBe(true);
    });

    it("re-reads colours written by another window and wakes their subscribers", async () => {
        const meta = await import("@/lib/sidebar/chat-list-meta");
        const seen = vi.fn();
        meta.subscribeChatColors(seen);
        expect(meta.getChatColors()["chat-1"]).toBeUndefined();

        localStorage.setItem("bettershape-sidebar-chat-colors", JSON.stringify({ "chat-1": "blue" }));
        window.dispatchEvent(new StorageEvent("storage", { key: "bettershape-sidebar-chat-colors" }));

        expect(meta.getChatColors()["chat-1"]).toBe("blue");
        expect(seen).toHaveBeenCalled();
    });

    it("installs the cross-window sync for a window that only reads colours", async () => {
        const meta = await import("@/lib/sidebar/chat-list-meta");
        // A read, with no subscription: the popout that only paints colours.
        meta.getChatColors();
        localStorage.setItem("bettershape-sidebar-chat-colors", JSON.stringify({ "chat-2": "green" }));
        window.dispatchEvent(new CustomEvent("bettershape-chat-colors-changed"));

        expect(meta.getChatColors()["chat-2"]).toBe("green");
    });

    it("announces a colour write as a colour change, not a pin change", async () => {
        const meta = await import("@/lib/sidebar/chat-list-meta");
        const pins = vi.fn();
        window.addEventListener("bettershape-chat-pins-changed", pins);
        meta.setChatColor("chat-4", "rose");
        window.removeEventListener("bettershape-chat-pins-changed", pins);

        expect(pins).not.toHaveBeenCalled();
        expect(meta.getChatColors()["chat-4"]).toBe("rose");
    });

    it("ignores storage keys that are not sidebar state", async () => {
        const meta = await import("@/lib/sidebar/chat-list-meta");
        const seen = vi.fn();
        meta.subscribePinnedChats(seen);
        meta.getPinnedChatIds();
        window.dispatchEvent(new StorageEvent("storage", { key: "unrelated-key" }));
        expect(seen).not.toHaveBeenCalled();
    });
});
