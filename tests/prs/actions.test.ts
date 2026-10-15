import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrItem } from "@/features/chat/ui/prs/mapping";
const { request, success, error } = vi.hoisted(() => ({ request: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/backend", () => ({ commands: { githubApiRequest: request } }));
vi.mock("@/features/notifications", () => ({ notify: { success, error } }));
import { runPrAction } from "@/features/chat/ui/prs/actions";
import { applyPrOverride, clearPrOverride, readPrOverride } from "@/features/chat/ui/prs/overrides";
const item: PrItem = { id: "1", nodeId: "PR_node", number: 7, repo: "owner/repo", title: "Change", status: "open", headSha: "abc", updated: "", labels: [] };
beforeEach(() => vi.clearAllMocks());
afterEach(() => clearPrOverride(item.id));

describe("PR actions", () => {
    it("marks drafts ready using the GraphQL node ID", async () => {
        request.mockResolvedValue(JSON.stringify({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } }));
        expect(await runPrAction({ ...item, draft: true }, "ready", item.repo)).toBe(true);
        const [method, path, body] = request.mock.calls[0];
        expect([method, path]).toEqual(["POST", "/graphql"]);
        expect(JSON.parse(body)).toMatchObject({ variables: { id: "PR_node" } });
        expect(readPrOverride(item.id)?.draft).toBe(false);
    });

    it("rolls back GraphQL errors even with a successful transport", async () => {
        request.mockResolvedValue({ errors: [{ message: "Insufficient permission" }] });
        expect(await runPrAction({ ...item, draft: true }, "ready", item.repo)).toBe(false);
        expect(readPrOverride(item.id)).toBeNull();
        expect(error).toHaveBeenCalledWith("Insufficient permission");
        expect(success).not.toHaveBeenCalled();
    });

    it("guards merges against a changed head and checks merged:false", async () => {
        request.mockResolvedValue({ merged: false, message: "Head changed" });
        expect(await runPrAction(item, "merge", item.repo)).toBe(false);
        expect(JSON.parse(request.mock.calls[0][2])).toEqual({ merge_method: "merge", sha: "abc" });
        expect(readPrOverride(item.id)).toBeNull();
        expect(success).not.toHaveBeenCalled();
    });

    it("accepts a confirmed merge", async () => {
        request.mockResolvedValue({ merged: true });
        expect(await runPrAction(item, "merge", item.repo)).toBe(true);
        expect(readPrOverride(item.id)?.status).toBe("merged");
    });

    it("does not send requests against the wrong repo or without required IDs", async () => {
        expect(await runPrAction(item, "close", "other/repo")).toBe(false);
        expect(await runPrAction({ ...item, headSha: undefined }, "merge", item.repo)).toBe(false);
        expect(await runPrAction({ ...item, nodeId: undefined, draft: true }, "ready", item.repo)).toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it("locks a PR across separate action surfaces until completion", async () => {
        let resolve!: (value: unknown) => void;
        request.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
        const first = runPrAction(item, "close", item.repo);
        expect(await runPrAction(item, "merge", item.repo)).toBe(false);
        expect(request).toHaveBeenCalledTimes(1);
        resolve({ state: "closed" });
        expect(await first).toBe(true);
    });
});


it("preserves a confirmed earlier patch when a later action fails", async () => {
    applyPrOverride(item.id, { draft: false });
    request.mockRejectedValue(new Error("Offline"));
    expect(await runPrAction(item, "close", item.repo)).toBe(false);
    expect(readPrOverride(item.id)?.draft).toBe(false);
    expect(readPrOverride(item.id)?.status).toBeUndefined();
});

it("does not report an unconfirmed REST state change as a success", async () => {
    request.mockResolvedValue({ state: "open" });
    expect(await runPrAction(item, "close", item.repo)).toBe(false);
    expect(success).not.toHaveBeenCalled();
    expect(readPrOverride(item.id)).toBeNull();
});

it("rejects a stale drag snapshot after another surface confirms a merge", async () => {
    applyPrOverride(item.id, { status: "merged" });
    expect(await runPrAction(item, "close", item.repo)).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(readPrOverride(item.id)?.status).toBe("merged");
});

it("starts a fresh trust window at confirmation, not only when the request begins", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    let confirm!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
    try {
        const pending = runPrAction(item, "close", item.repo);
        now.mockReturnValue(20_000);
        confirm({ state: "closed" });
        await expect(pending).resolves.toBe(true);
        expect(readPrOverride(item.id, 70_000)?.status).toBe("closed");
        expect(readPrOverride(item.id, 80_001)).toBeNull();
    } finally { now.mockRestore(); }
});

it("does not renew an earlier override's trust window when a later request fails", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    let reject!: (reason: Error) => void;
    request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    try {
        applyPrOverride(item.id, { draft: false });
        now.mockReturnValue(50_000);
        const pending = runPrAction(item, "close", item.repo);
        now.mockReturnValue(70_000);
        reject(new Error("Offline"));
        await expect(pending).resolves.toBe(false);
        expect(readPrOverride(item.id)).toBeNull();
    } finally { now.mockRestore(); }
});

it("restores a fresh prior patch only until its original expiry", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    let reject!: (reason: Error) => void;
    request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    try {
        applyPrOverride(item.id, { draft: false });
        now.mockReturnValue(10_000);
        const pending = runPrAction(item, "close", item.repo);
        now.mockReturnValue(20_000);
        reject(new Error("Offline"));
        await expect(pending).resolves.toBe(false);
        expect(readPrOverride(item.id, 59_999)?.draft).toBe(false);
        expect(readPrOverride(item.id, 60_000)).toBeNull();
    } finally { now.mockRestore(); }
});

it("does not roll back over a newer override owner", async () => {
    let reject!: (reason: Error) => void;
    request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    applyPrOverride(item.id, { draft: false });
    const pending = runPrAction(item, "close", item.repo);
    applyPrOverride(item.id, { status: "merged" });
    reject(new Error("Offline"));
    await expect(pending).resolves.toBe(false);
    expect(readPrOverride(item.id)?.status).toBe("merged");
});

it("does not carry expired fields into a new optimistic patch", async () => {
    applyPrOverride(item.id, { draft: false }, 0);
    request.mockResolvedValue({ state: "closed" });
    await expect(runPrAction(item, "close", item.repo)).resolves.toBe(true);
    expect(readPrOverride(item.id)?.draft).toBeUndefined();
});

it("does not resurrect a patch after a canonical refresh settled the request owner", async () => {
    const { settlePrOverrides } = await import("@/features/chat/ui/prs/overrides");
    let reject!: (reason: Error) => void;
    request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    applyPrOverride(item.id, { draft: false });
    const pending = runPrAction(item, "close", item.repo);
    settlePrOverrides([{ ...item, status: "closed", draft: false }]);
    reject(new Error("Lost response"));
    await expect(pending).resolves.toBe(false);
    expect(readPrOverride(item.id)).toBeNull();
});
