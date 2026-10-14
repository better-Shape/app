import { beforeEach, describe, expect, it, vi } from "vitest";
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/backend", () => ({ commands: { githubApiGet: get } }));
import { appendUnique, getGitHubPage } from "@/features/chat/ui/prs/pagination";

beforeEach(() => get.mockReset());
describe("GitHub pagination", () => {
    it("preserves existing query parameters and detects full pages", async () => {
        get.mockResolvedValue(JSON.stringify(Array.from({ length: 100 }, (_, id) => ({ id }))));
        expect((await getGitHubPage("/pulls?state=closed", 2)).hasMore).toBe(true);
        expect(get).toHaveBeenCalledWith("/pulls?state=closed&per_page=100&page=2");
        get.mockResolvedValue([]);
        expect(await getGitHubPage("/reviews", 1)).toEqual({ rows: [], hasMore: false });
    });
    it.each([null, {}, { message: "Not Found" }, "broken JSON", [null], ["row"], [[]]])("rejects malformed responses instead of showing an empty list: %j", async (payload) => {
        get.mockResolvedValue(payload);
        await expect(getGitHubPage("/pulls", 1)).rejects.toThrow();
    });
    it("deduplicates moving page boundaries, preserving order and newest data", () => {
        expect(appendUnique([{ id: "1", title: "old" }, { id: "2", title: "second" }], [{ id: "1", title: "new" }, { id: "3", title: "third" }], (row) => row.id)).toEqual([
            { id: "1", title: "new" }, { id: "2", title: "second" }, { id: "3", title: "third" },
        ]);
    });
});
