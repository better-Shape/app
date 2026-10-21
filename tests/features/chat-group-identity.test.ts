import { describe, expect, it } from "vitest";
import { groupChatMessages } from "@/features/chat/lib/chat-session-utils";
import type { ChatMessage } from "@/lib/backend";

function msg(role: "user" | "assistant", content: string, timestamp: number): ChatMessage {
    return { role, content, timestamp } as ChatMessage;
}

describe("groupChatMessages", () => {
    it("groups a user message with the assistant reply", () => {
        const messages = [msg("user", "hi", 1), msg("assistant", "hello", 2)];
        const groups = groupChatMessages(messages);
        expect(groups).toHaveLength(1);
        expect(groups[0]!.map((entry) => entry.msgIdx)).toEqual([0, 1]);
    });

    it("starts a new turn on each user message and skips hidden ones", () => {
        const hidden = { ...msg("assistant", "secret", 2), hidden: true } as ChatMessage;
        const messages = [msg("user", "a", 1), hidden, msg("user", "b", 3)];
        const groups = groupChatMessages(messages);
        expect(groups).toHaveLength(2);
        expect(groups[1]![0]!.msgIdx).toBe(2);
    });

    it("keeps earlier turns by identity when only the last message streams", () => {
        const first = [msg("user", "hi", 1), msg("assistant", "hello", 2)];
        expect(groupChatMessages(first)).toHaveLength(1);

        // Two turns, so a stream into the last one can prove that the earlier
        // turn keeps its identity rather than being rebuilt with it.
        const withSecond = [...first, msg("user", "again", 3), msg("assistant", "sure", 4)];
        const twoTurns = groupChatMessages(withSecond);
        expect(twoTurns).toHaveLength(2);

        // Streaming rewrites the last message object only.
        const streaming = [
            ...withSecond.slice(0, 3),
            { ...withSecond[3]!, content: "sure thing" } as ChatMessage,
        ];
        const after = groupChatMessages(streaming);
        expect(after).toHaveLength(2);
        expect(after[0]).toBe(twoTurns[0]);
        expect(after[1]).not.toBe(twoTurns[1]);

        // A new user turn invalidates only the new turn; the older ones are reused.
        const extended = [...streaming, msg("user", "third", 5)];
        const third = groupChatMessages(extended);
        expect(third).toHaveLength(3);
        expect(third[0]).toBe(twoTurns[0]);
        expect(third[1]).toBe(after[1]);
        expect(third[2]).not.toBe(third[1]);
    });

    it("reuses every turn when the same array is grouped twice", () => {
        const messages = [msg("user", "a", 1), msg("assistant", "b", 2), msg("user", "c", 3)];
        const first = groupChatMessages(messages);
        const second = groupChatMessages(messages);
        expect(second).toBe(first);
    });

    it("does not reuse a turn whose messages changed in place", () => {
        const messages = [msg("user", "a", 1), msg("assistant", "b", 2)];
        const first = groupChatMessages(messages);
        const replaced = [messages[0]!, { ...messages[1]!, content: "c" } as ChatMessage];
        const second = groupChatMessages(replaced);
        expect(second).not.toBe(first);
        expect(second[0]).not.toBe(first[0]);
    });
});
