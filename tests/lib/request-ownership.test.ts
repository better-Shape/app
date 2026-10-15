import { expect, it } from "vitest";
import { createChatRequestId, isLocalChatRequest } from "@/lib/chat/request-ownership";
it("namespaces draft and named conversation requests without retaining their history", () => {
    const draft = createChatRequestId(null);
    const named = createChatRequestId("null");
    const next = createChatRequestId(null);
    expect(isLocalChatRequest(draft)).toBe(true);
    expect(isLocalChatRequest("another-window:lane:1")).toBe(false);
    expect(draft.slice(0, draft.lastIndexOf(":"))).not.toBe(named.slice(0, named.lastIndexOf(":")));
    expect(BigInt(next.split(":").at(-1)!)).toBeGreaterThan(BigInt(draft.split(":").at(-1)!));
});
