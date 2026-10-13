import { describe, expect, it } from "vitest";
import {
    adoptDraftQueuedMessages,
    canDrainQueue,
    needsBackendPin,
    queueForConversation,
    takeNextQueuedMessage,
    type QueuedChatMessage,
} from "@/features/chat/lib/message-queue";

const q = (id: string, content: string, conversationId: string | null): QueuedChatMessage => ({
    id,
    content,
    conversationId,
});

describe("queued follow-ups stay bound to their conversation", () => {
    it("only shows the queue of the chat on screen", () => {
        const queue = [q("1", "a", "X"), q("2", "b", "Y"), q("3", "c", "X")];
        expect(queueForConversation(queue, "X").map((m) => m.id)).toEqual(["1", "3"]);
        expect(queueForConversation(queue, "Y").map((m) => m.id)).toEqual(["2"]);
        expect(queueForConversation(queue, "Z")).toEqual([]);
    });

    it("drains only messages owned by the viewed conversation, preserving order", () => {
        const queue = [q("1", "for Y", "Y"), q("2", "first for X", "X"), q("3", "second for X", "X")];
        const first = takeNextQueuedMessage(queue, "X");
        expect(first?.item.id).toBe("2");
        expect(first?.rest.map((m) => m.id)).toEqual(["1", "3"]);

        const second = takeNextQueuedMessage(first!.rest, "X");
        expect(second?.item.id).toBe("3");
        expect(second?.rest.map((m) => m.id)).toEqual(["1"]);
    });

    it("never takes a message for another chat, even when it is the only one queued", () => {
        const queue = [q("1", "for Y", "Y")];
        expect(takeNextQueuedMessage(queue, "X")).toBeNull();
        expect(takeNextQueuedMessage(queue, null)).toBeNull();
    });

    it("a draft queue is drained in the draft, and adopts the new id when the draft becomes a chat", () => {
        const queue = [q("1", "queued during first turn", null)];
        expect(takeNextQueuedMessage(queue, null)?.item.id).toBe("1");

        const adopted = adoptDraftQueuedMessages(queue, "123");
        expect(adopted).toEqual([q("1", "queued during first turn", "123")]);
        expect(takeNextQueuedMessage(adopted, null)).toBeNull();
        expect(takeNextQueuedMessage(adopted, "123")?.item.id).toBe("1");
    });

    it("adoption leaves already-bound messages alone and returns the same array when idle", () => {
        const queue = [q("1", "x", "X")];
        expect(adoptDraftQueuedMessages(queue, "123")).toBe(queue);
        const mixed = [q("1", "x", "X"), q("2", "y", null)];
        expect(adoptDraftQueuedMessages(mixed, "123")).toEqual([q("1", "x", "X"), q("2", "y", "123")]);
    });
});

describe("drain gating", () => {
    it("does not drain while the viewed chat is generating", () => {
        expect(canDrainQueue({ isLoading: true, sendsInFlight: 0, skipDrain: false })).toBe(false);
    });

    it("does not drain while a send is still pending, even if the turn already reported complete", () => {
        // chat_complete arrives before the send's invoke resolves; draining here dropped messages.
        expect(canDrainQueue({ isLoading: false, sendsInFlight: 1, skipDrain: false })).toBe(false);
    });

    it("does not drain during a send-now handoff", () => {
        expect(canDrainQueue({ isLoading: false, sendsInFlight: 0, skipDrain: true })).toBe(false);
    });

    it("drains when idle and nothing is pending", () => {
        expect(canDrainQueue({ isLoading: false, sendsInFlight: 0, skipDrain: false })).toBe(true);
    });
});

describe("backend pin", () => {
    it("re-points the backend when it is unset or on another conversation", () => {
        expect(needsBackendPin(null, "X")).toBe(true);
        expect(needsBackendPin("Z", "X")).toBe(true);
    });

    it("leaves the backend alone when it already matches the viewed chat", () => {
        expect(needsBackendPin("X", "X")).toBe(false);
    });

    it("never pins a draft (no viewed conversation): sends then start a fresh chat as intended", () => {
        expect(needsBackendPin(null, null)).toBe(false);
        expect(needsBackendPin("Z", null)).toBe(false);
    });
});
