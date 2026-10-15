import { expect, it, vi } from "vitest";
import { createBrowserTab } from "@/features/preview/design/toolbar";

it("uses unique cryptographic IDs for new tabs while preserving explicit restored identity", () => {
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValueOnce("11111111-1111-4111-8111-111111111111").mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    try {
        const first = createBrowserTab("http://localhost:3000/one");
        const next = createBrowserTab("http://localhost:3000/two");
        expect(first.id).toBe("tab-11111111-1111-4111-8111-111111111111");
        expect(next.id).not.toBe(first.id);
        expect(first.history).toEqual([first.url]);
        expect(createBrowserTab("", "restored").id).toBe("restored");
        expect(uuid).toHaveBeenCalledTimes(2);
    } finally { uuid.mockRestore(); }
});
