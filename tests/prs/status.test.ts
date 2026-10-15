import { beforeEach, describe, expect, it, vi } from "vitest";
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/backend", () => ({ commands: { githubApiGet: get } }));
import { combinedCi, requestCiStatus } from "@/features/chat/ui/prs/status";
const noLegacy = { state: "pending", total_count: 0 };
const green = { status: "completed", conclusion: "success" };
beforeEach(() => vi.clearAllMocks());

describe("CI aggregation", () => {
    it("uses Actions checks when there are no legacy status contexts", () => {
        expect(combinedCi(noLegacy, [green])).toBe("success");
        expect(combinedCi(noLegacy, [])).toBe("unknown");
    });
    it.each(["failure", "cancelled", "timed_out", "action_required", "stale", "startup_failure"])("does not show %s as green", (conclusion) => {
        expect(combinedCi({ state: "success", total_count: 1 }, [{ status: "completed", conclusion }])).toBe("failure");
    });
    it("requires complete evidence for success, and lets failures dominate", () => {
        expect(combinedCi(null, [green])).toBe("unknown");
        expect(combinedCi({ state: "success", total_count: 1 }, null)).toBe("unknown");
        expect(combinedCi({ state: "failure", total_count: 1 }, null)).toBe("failure");
        expect(combinedCi(noLegacy, [green, { status: "queued" }])).toBe("pending");
    });
    it("paginates check runs before reporting success and deduplicates requests", async () => {
        get.mockResolvedValueOnce(noLegacy)
            .mockResolvedValueOnce({ total_count: 101, check_runs: Array.from({ length: 100 }, () => green) })
            .mockResolvedValueOnce({ total_count: 101, check_runs: [{ status: "completed", conclusion: "failure" }] });
        const first = requestCiStatus("owner", "repo", "sha");
        expect(requestCiStatus("owner", "repo", "sha")).toBe(first);
        expect(await first).toBe("failure");
        expect(get.mock.calls.map(([path]) => path)).toEqual([
            "/repos/owner/repo/commits/sha/status",
            "/repos/owner/repo/commits/sha/check-runs?filter=latest&per_page=100&page=1",
            "/repos/owner/repo/commits/sha/check-runs?filter=latest&per_page=100&page=2",
        ]);
    });
    it("bounds actual network concurrency and releases capacity after errors", async () => {
        let active = 0;
        let peak = 0;
        get.mockImplementation(async (path: string) => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active -= 1;
            if (path.endsWith("/status")) throw new Error("Unavailable");
            return { total_count: 1, check_runs: [green] };
        });
        const results = await Promise.all(Array.from({ length: 12 }, (_, i) => requestCiStatus("owner", "repo", `sha-${i}`)));
        expect(peak).toBe(4);
        expect(active).toBe(0);
        expect(results.every((result) => result === "unknown")).toBe(true);
    });
});
