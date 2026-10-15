import { beforeEach, describe, expect, it, vi } from "vitest";
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/backend", () => ({ commands: { githubApiGet: get } }));
import { appendUnique, getGitHubPage, reconcilePageRows } from "@/features/chat/ui/prs/pagination";

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


it("reconciles refreshed page membership without dropping enrichment on untouched pages", () => {
    const previous = [{ id: "1", title: "stale" }, { id: "2", title: "removed" }, { id: "3", title: "detail enriched", ci: "success" }];
    expect(reconcilePageRows(previous, [{ id: "1", title: "fresh" }, { id: "4", title: "new" }], [["4", "1"], ["3"]], row => row.id)).toEqual([
        { id: "4", title: "new" }, { id: "1", title: "fresh" }, { id: "3", title: "detail enriched", ci: "success" },
    ]);
});
it("deduplicates moving boundaries and removes truncated pages", () => {
    const previous = [{ id: "1" }, { id: "2" }, { id: "3" }];
    expect(reconcilePageRows(previous, [{ id: "2" }], [["2"], ["2", "1"]], row => row.id)).toEqual([{ id: "2" }, { id: "1" }]);
    expect(reconcilePageRows(previous, [], [[]], row => row.id)).toEqual([]);
});
