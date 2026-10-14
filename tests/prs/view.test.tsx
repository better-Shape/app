import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), remote: vi.fn(), project: "/first", selectedId: "1" as string | null }));
vi.mock("@/lib/backend", () => ({
    commands: { githubApiGet: mocks.get, gitRemoteUrl: mocks.remote },
    useProjectState: () => ({ project_path: mocks.project }),
}));
vi.mock("@/lib/github/store", () => ({ loginGitHub: vi.fn(), useGitHubAuth: () => ({ loggedIn: true }) }));
vi.mock("@/features/chat/ui/prs/store", () => ({ selectPr: vi.fn(), usePrUi: () => ({ selectedId: mocks.selectedId }) }));
vi.mock("@/features/chat/ui/prs/list", () => ({
    PullRequestsList: ({ items, loading }: { items: { title: string }[]; loading: boolean }) => (
        <div data-loading={loading}>{items.map((item) => item.title).join(", ")}</div>
    ),
}));
import { PullRequestsPanel } from "@/features/chat/ui/prs/view";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.clearAllMocks();
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
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
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
        expect(mocks.get).toHaveBeenCalledTimes(4);
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
