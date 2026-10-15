import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), remote: vi.fn(), project: "/first", selectedId: "1" as string | null, refresh: () => {} }));
vi.mock("@/lib/backend", () => ({
    commands: { githubApiGet: mocks.get, gitRemoteUrl: mocks.remote },
    useProjectState: () => ({ project_path: mocks.project }),
}));
vi.mock("@/lib/github/store", () => ({ loginGitHub: vi.fn(), useGitHubAuth: () => ({ loggedIn: true }) }));
vi.mock("@/features/chat/ui/prs/store", () => ({ selectPr: vi.fn(), updateSelectedPr: vi.fn(), usePrUi: () => ({ selectedId: mocks.selectedId }) }));
vi.mock("@/features/chat/ui/prs/list", () => ({
    PullRequestsList: ({ items, loading, hasMore, onLoadMore, onRefresh }: { items: { title: string }[]; loading: boolean; hasMore: boolean; onLoadMore: () => void; onRefresh: () => void }) => {
        mocks.refresh = onRefresh;
        return <div data-loading={loading} data-has-more={hasMore} onClick={onLoadMore}>{items.map((item) => item.title).join(", ")}</div>;
    },
}));
import { PullRequestsPanel } from "@/features/chat/ui/prs/view";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockReset();
    mocks.remote.mockReset();
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    mocks.project = "/first";
    mocks.selectedId = "1";
    mocks.remote.mockImplementation(async (path: string) => `https://github.com/owner${path}.git`);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

describe("PR panel request lifecycle", () => {
    it("does not refetch details when its own enrichment updates the selected row", async () => {
        mocks.get.mockImplementation(async (path: string) => {
            if (path.includes("/pulls?")) return [{ id: 1, number: 7, title: "A PR", state: "open" }];
            if (path.endsWith("/pulls/7")) return { additions: 12, deletions: 2, comments: 3 };
            return [];
        });
        await act(async () => { root.render(<PullRequestsPanel />); });
        await act(async () => { await Promise.resolve(); });
        expect(mocks.get.mock.calls.filter(([path]) => path.endsWith("/pulls/7"))).toHaveLength(1);
        expect(mocks.get).toHaveBeenCalledTimes(3);
        expect(host.textContent).toContain("A PR");
    });

    it("ignores a previous project's late response", async () => {
        const old = deferred<unknown>();
        mocks.get.mockImplementation(async (path: string) => path.includes("/first/") ? old.promise : [{ id: 2, number: 8, title: "Current project" }]);
        await act(async () => { root.render(<PullRequestsPanel pane="list" />); });
        mocks.project = "/second";
        await act(async () => { root.render(<PullRequestsPanel pane="list" />); });
        expect(host.textContent).toBe("Current project");
        await act(async () => { old.resolve([{ id: 1, number: 7, title: "Stale project" }]); });
        expect(host.textContent).toBe("Current project");
        expect(host.querySelector("[data-loading]")?.getAttribute("data-loading")).toBe("false");
    });

    it("does not start an API request after an obsolete remote lookup completes", async () => {
        const oldRemote = deferred<string>();
        mocks.remote.mockImplementation(async (path: string) => path === "/first" ? oldRemote.promise : "https://github.com/owner/second.git");
        mocks.get.mockResolvedValue([]);
        await act(async () => { root.render(<PullRequestsPanel pane="list" />); });
        mocks.project = "/second";
        await act(async () => { root.render(<PullRequestsPanel pane="list" />); });
        await act(async () => { oldRemote.resolve("https://github.com/owner/first.git"); });
        expect(mocks.get).toHaveBeenCalledTimes(1);
        expect(mocks.get.mock.calls[0][0]).toContain("/owner/second/");
    });
});


it("polls visible panels without overlapping requests, and pauses while hidden", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const next = deferred<unknown>();
    mocks.get.mockResolvedValueOnce([{ id: 1, number: 7, title: "First" }]).mockReturnValueOnce(next.promise);
    await act(async () => { root.render(<PullRequestsPanel pane="list" />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(host.textContent).toBe("First");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.get).toHaveBeenCalledTimes(2);
    await act(async () => { next.resolve([{ id: 1, number: 7, title: "Updated" }]); });
    expect(host.textContent).toBe("Updated");
    visibility.mockReturnValue(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.get).toHaveBeenCalledTimes(2);
});

it("keeps the last loaded rows on a failed background refresh", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    mocks.get.mockResolvedValueOnce([{ id: 1, number: 7, title: "Last known" }]).mockRejectedValueOnce(new Error("Offline"));
    await act(async () => { root.render(<PullRequestsPanel pane="list" />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(host.textContent).toBe("Last known");
    expect(host.querySelector("[data-loading]")?.getAttribute("data-loading")).toBe("false");
});


it("loads and refreshes later list pages instead of silently truncating at 50 PRs", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const first = Array.from({ length: 100 }, (_, id) => ({ id: id + 1, number: id + 1, title: `PR ${id + 1}` }));
    mocks.get.mockResolvedValueOnce(first).mockResolvedValueOnce([{ id: 101, number: 101, title: "Older PR" }]);
    await act(async () => root.render(<PullRequestsPanel pane="list" />));
    expect(host.querySelector("[data-has-more]")?.getAttribute("data-has-more")).toBe("true");
    await act(async () => { host.firstElementChild!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(host.textContent).toContain("Older PR");
    expect(mocks.get.mock.calls[1][0]).toContain("page=2");
    mocks.get.mockResolvedValueOnce(first).mockResolvedValueOnce([{ id: 101, number: 101, title: "Updated older PR" }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.get).toHaveBeenCalledTimes(4);
    expect(host.textContent).toContain("Updated older PR");
});

it("stops obsolete pagination when switching projects", async () => {
    const late = deferred<unknown>();
    const first = Array.from({ length: 100 }, (_, id) => ({ id, number: id + 1, title: `Old ${id}` }));
    mocks.get.mockResolvedValueOnce(first).mockReturnValueOnce(late.promise).mockResolvedValueOnce([{ id: 300, number: 3, title: "Current repo" }]);
    await act(async () => root.render(<PullRequestsPanel pane="list" />));
    act(() => { host.firstElementChild!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    mocks.project = "/second";
    await act(async () => root.render(<PullRequestsPanel pane="list" />));
    await act(async () => late.resolve([{ id: 200, number: 200, title: "Stale next page" }]));
    expect(host.textContent).toBe("Current repo");
});

it("retains loaded rows through a transient remote lookup failure and recovers next poll", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    mocks.get.mockResolvedValueOnce([{ id: 1, number: 7, title: "Last known remote" }]);
    await act(async () => root.render(<PullRequestsPanel pane="list" />));
    mocks.remote.mockRejectedValueOnce(new Error("Git process unavailable"));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(host.textContent).toBe("Last known remote");
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[data-loading]")?.getAttribute("data-loading")).toBe("false");
    mocks.get.mockResolvedValueOnce([{ id: 1, number: 7, title: "Recovered" }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(host.textContent).toBe("Recovered");
});

it("clears rows when the remote is confirmed absent, rather than temporarily unavailable", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    mocks.get.mockResolvedValueOnce([{ id: 1, number: 7, title: "Previous remote" }]);
    await act(async () => root.render(<PullRequestsPanel pane="list" />));
    mocks.remote.mockResolvedValueOnce("");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(host.textContent).toBe("");
    expect(mocks.get).toHaveBeenCalledTimes(1);
});

it("polls lightweight metadata without refetching unchanged review pages", async () => {
    vi.useFakeTimers(); vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    let updated = "2026-10-14T00:00:00Z";
    mocks.get.mockImplementation(async (path: string) => {
        const row = { id: 1, number: 7, title: "A PR", state: "open", updated_at: updated, head: { sha: "same-head" } };
        if (path.includes("/pulls?")) return [row];
        if (path.endsWith("/pulls/7")) return row;
        return [];
    });
    await act(async () => root.render(<PullRequestsPanel />));
    expect(mocks.get.mock.calls.filter(([path]) => path.includes("/reviews?"))).toHaveLength(1);
    for (let tick = 0; tick < 3; tick += 1) await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.get.mock.calls.filter(([path]) => path.endsWith("/pulls/7"))).toHaveLength(4);
    expect(mocks.get.mock.calls.filter(([path]) => path.includes("/reviews?"))).toHaveLength(1);
    updated = "2026-10-14T00:01:00Z";
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.get.mock.calls.filter(([path]) => path.includes("/reviews?"))).toHaveLength(2);
    await act(async () => mocks.refresh());
    expect(mocks.get.mock.calls.filter(([path]) => path.includes("/reviews?"))).toHaveLength(3);
});

it("never queries old PR details against a changed remote when the new list fails", async () => {
    vi.useFakeTimers(); vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    mocks.get.mockImplementation(async (path: string) => {
        if (path.includes("/second/")) throw new Error("Offline");
        if (path.includes("/pulls?")) return [{ id: 1, number: 7, title: "Previous remote PR", state: "open" }];
        return [];
    });
    await act(async () => root.render(<PullRequestsPanel />));
    expect(host.textContent).toContain("Previous remote PR");
    mocks.get.mockClear();
    mocks.remote.mockResolvedValue("https://github.com/owner/second.git");
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(host.textContent).not.toContain("Previous remote PR");
    expect(mocks.get.mock.calls.some(([path]) => path.includes("/second/pulls/7"))).toBe(false);
    expect(host.querySelector("[data-has-more]")?.getAttribute("data-has-more")).toBe("false");
});

it("bounds automatic list polling to the first page and one rotating older page", async () => {
    vi.useFakeTimers(); vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    let revision = "initial";
    mocks.get.mockImplementation(async (path: string) => {
        const page = Number(new URL(path, "https://api.github.com").searchParams.get("page"));
        return Array.from({ length: page === 4 ? 1 : 100 }, (_, offset) => ({ id: (page - 1) * 100 + offset + 1, number: (page - 1) * 100 + offset + 1, title: `${revision} page ${page} row ${offset}` }));
    });
    await act(async () => root.render(<PullRequestsPanel pane="list" />));
    for (let page = 2; page <= 4; page++) await act(async () => host.firstElementChild!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.textContent).toContain("initial page 4 row 0");
    mocks.get.mockClear(); revision = "polled";
    for (const olderPage of [2, 3, 4, 2]) {
        await act(async () => vi.advanceTimersByTimeAsync(30_000));
        expect(mocks.get.mock.calls.map(([path]) => Number(new URL(path, "https://api.github.com").searchParams.get("page")))).toEqual([1, olderPage]);
        expect(host.textContent).toContain(`polled page ${olderPage} row 0`);
        expect(host.textContent).toContain("page 4 row 0");
        mocks.get.mockClear();
    }
    revision = "manual";
    await act(async () => mocks.refresh());
    expect(mocks.get.mock.calls.map(([path]) => Number(new URL(path, "https://api.github.com").searchParams.get("page")))).toEqual([1, 2, 3, 4]);
    expect(host.textContent).toContain("manual page 4 row 0");
});

it("drops obsolete later pages when a bounded poll reaches the end of the collection", async () => {
    vi.useFakeTimers(); vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const full = Array.from({ length: 100 }, (_, id) => ({ id, number: id + 1, title: `Old ${id}` }));
    mocks.get.mockResolvedValueOnce(full).mockResolvedValueOnce([{ id: 200, number: 200, title: "Older page" }]);
    await act(async () => root.render(<PullRequestsPanel pane="list" />));
    await act(async () => host.firstElementChild!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    mocks.get.mockClear().mockResolvedValue([{ id: 300, number: 300, title: "Only row" }]);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe("Only row");
    expect(host.querySelector("[data-has-more]")?.getAttribute("data-has-more")).toBe("false");
    mocks.get.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.get).toHaveBeenCalledTimes(1);
});

it("retries the same older page after a failed bounded poll without committing partial data", async () => {
    vi.useFakeTimers(); vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    let revision = "initial";
    let fail = false;
    mocks.get.mockImplementation(async (path: string) => {
        const page = Number(new URL(path, "https://api.github.com").searchParams.get("page"));
        if (fail && page === 2) throw new Error("Rate limited");
        return Array.from({ length: page === 3 ? 1 : 100 }, (_, index) => ({ id: page * 100 + index, number: page * 100 + index, title: `${revision} page ${page} row ${index}` }));
    });
    await act(async () => root.render(<PullRequestsPanel pane="list" />));
    for (let page = 2; page <= 3; page++) await act(async () => host.firstElementChild!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    mocks.get.mockClear(); fail = true; revision = "refreshed";
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(host.textContent).toContain("initial page 1 row 0");
    expect(host.textContent).not.toContain("refreshed");
    mocks.get.mockClear(); fail = false;
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.get.mock.calls.map(([path]) => Number(new URL(path, "https://api.github.com").searchParams.get("page")))).toEqual([1, 2]);
    expect(host.textContent).toContain("refreshed page 2 row 0");
    expect(host.textContent).toContain("initial page 3 row 0");
    mocks.get.mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.get.mock.calls.map(([path]) => Number(new URL(path, "https://api.github.com").searchParams.get("page")))).toEqual([1, 3]);
    expect(host.textContent).toContain("refreshed page 3 row 0");
});

it("coalesces explicit Refresh clicks behind pagination and reconciles every newly loaded page", async () => {
    const pending = deferred<unknown>();
    const pageOne = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, number: index + 1, title: `Original ${index}` }));
    mocks.get.mockResolvedValueOnce(pageOne).mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce(pageOne.map(row => ({ ...row, title: `Fresh ${row.number}` })))
        .mockResolvedValueOnce([{ id: 101, number: 101, title: "Fresh older page" }]);
    await act(async () => root.render(<PullRequestsPanel pane="list" />));
    await act(async () => host.firstElementChild!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => { mocks.refresh(); mocks.refresh(); mocks.refresh(); });
    expect(mocks.get).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve([{ id: 101, number: 101, title: "Stale older page" }]));
    expect(mocks.get).toHaveBeenCalledTimes(4);
    expect(mocks.get.mock.calls.slice(2).map(([path]) => new URL(path, "https://api.github.com").searchParams.get("page"))).toEqual(["1", "2"]);
    expect(host.textContent).toContain("Fresh older page");
    expect(host.textContent).not.toContain("Stale older page");
});
it("retains explicit Refresh while an automatic poll is pending", async () => {
    vi.useFakeTimers(); vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const pending = deferred<unknown>();
    mocks.get.mockResolvedValueOnce([{ id: 1, number: 1, title: "Initial" }]).mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce([{ id: 1, number: 1, title: "Explicit refresh" }]);
    await act(async () => root.render(<PullRequestsPanel pane="list" />));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    await act(async () => mocks.refresh());
    expect(mocks.get).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve([{ id: 1, number: 1, title: "Old poll" }]));
    expect(host.textContent).toBe("Explicit refresh");
    expect(mocks.get).toHaveBeenCalledTimes(3);
});

it("runs the queued manual refresh after the active request fails", async () => {
    vi.useFakeTimers(); vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const pending = deferred<unknown>();
    mocks.get.mockResolvedValueOnce([{ id: 1, number: 1, title: "Initial" }]).mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce([{ id: 1, number: 1, title: "Recovered by Refresh" }]);
    await act(async () => root.render(<PullRequestsPanel pane="list" />));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    await act(async () => mocks.refresh());
    await act(async () => pending.reject(new Error("transient failure")));
    expect(host.textContent).toBe("Recovered by Refresh");
    expect(mocks.get).toHaveBeenCalledTimes(3);
});
it.each(["project switch", "unmount"])("does not replay an obsolete queued Refresh after %s", async change => {
    const pending = deferred<unknown>();
    mocks.get.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([{ id: 2, number: 2, title: "New project" }]);
    await act(async () => root.render(<PullRequestsPanel pane="list" />));
    await act(async () => mocks.refresh());
    if (change === "project switch") {
        mocks.project = "/second";
        await act(async () => root.render(<PullRequestsPanel pane="list" />));
    } else await act(async () => root.unmount());
    const count = mocks.get.mock.calls.length;
    await act(async () => pending.resolve([{ id: 1, number: 1, title: "Obsolete" }]));
    expect(mocks.get).toHaveBeenCalledTimes(count);
    expect(host.textContent).not.toContain("Obsolete");
});

it.each(["empty", "failure", "requested"] as const)("does not claim no reviewers before requested-reviewer details settle (%s)", async outcome => {
    const detail = deferred<unknown>();
    mocks.get.mockImplementation(async (path: string) => {
        if (path.includes("/pulls?")) return [{ id: 1, number: 7, title: "Pending details", state: "open" }];
        if (path.endsWith("/pulls/7")) return detail.promise;
        return [];
    });
    await act(async () => root.render(<PullRequestsPanel />));
    const reviewerText = () => [...host.querySelectorAll("span")].find(node => node.textContent === "Reviewers")?.parentElement?.textContent;
    expect(reviewerText()).toBeDefined();
    expect(reviewerText()).not.toContain("None");
    await act(async () => {
        if (outcome === "failure") detail.reject(new Error("Reviewer details unavailable"));
        else detail.resolve({ requested_reviewers: outcome === "requested" ? [{ login: "alice" }] : [], requested_teams: [] });
    });
    if (outcome === "empty") expect(reviewerText()).toContain("None");
    else {
        expect(reviewerText()).not.toContain("None");
        if (outcome === "requested") expect(reviewerText()).toContain("Requested: alice");
        else expect(host.textContent).toContain("Details refresh failed: Reviewer details unavailable");
    }
});

it("does not infer empty requested-reviewer lists from incomplete detail data", async () => {
    mocks.get.mockImplementation(async (path: string) => {
        if (path.includes("/pulls?")) return [{ id: 1, number: 7, title: "Incomplete details", state: "open" }];
        if (path.endsWith("/pulls/7")) return { additions: 3 };
        return [];
    });
    await act(async () => root.render(<PullRequestsPanel />));
    const reviewers = [...host.querySelectorAll("span")].find(node => node.textContent === "Reviewers")?.parentElement;
    expect(reviewers?.textContent).toContain("Requested reviewers not loaded");
    expect(reviewers?.textContent).not.toContain("None");
});

it.each([
    { detail: { requested_reviewers: [{ login: "alice" }] }, known: "Requested: alice" },
    { detail: { requested_teams: [{ slug: "maintainers" }] }, known: "Requested: Team: maintainers" },
    { detail: { requested_reviewers: [] }, known: "" },
    { detail: { requested_teams: [] }, known: "" },
])("shows known requested reviewers without treating partial detail as complete: %j", async ({ detail, known }) => {
    mocks.get.mockImplementation(async (path: string) => {
        if (path.includes("/pulls?")) return [{ id: 1, number: 7, title: "Partial details", state: "open" }];
        if (path.endsWith("/pulls/7")) return detail;
        return [];
    });
    await act(async () => root.render(<PullRequestsPanel />));
    const reviewers = [...host.querySelectorAll("span")].find(node => node.textContent === "Reviewers")?.parentElement;
    if (known) expect(reviewers?.textContent).toContain(known);
    expect(reviewers?.textContent).toContain("Requested reviewer list incomplete");
    expect(reviewers?.textContent).not.toContain("None");
});
