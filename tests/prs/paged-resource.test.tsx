import { useLayoutEffect, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/backend", () => ({ commands: { githubApiGet: get } }));
import { usePagedPrResource } from "@/features/chat/ui/prs/use-paged-resource";

let host: HTMLDivElement;
let root: Root;
let current: ReturnType<typeof usePagedPrResource>;
function Harness({ path = "/first", revision = 0, limit = Infinity }) {
    const result = usePagedPrResource(path, revision, limit);
    useLayoutEffect(() => { current = result; });
    return <div>{result.rows.map((row) => row.title).join(",")}</div>;
}
const page = (start = 0) => Array.from({ length: 100 }, (_, id) => ({ id: start + id, title: `Row ${start + id}` }));
function deferred() {
    let resolve!: (value: unknown) => void;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}
beforeEach(() => {
    get.mockReset();
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("appends later pages exactly once and revalidates all loaded pages", async () => {
    const second = deferred();
    get.mockResolvedValueOnce(page()).mockReturnValueOnce(second.promise);
    await act(async () => root.render(<Harness />));
    expect(current.hasMore).toBe(true);
    act(() => { current.loadMore(); current.loadMore(); });
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve([{ id: 99, title: "Updated row" }, { id: 100, title: "Last row" }]));
    expect(current.rows).toHaveLength(101);
    expect(current.rows[99].title).toBe("Updated row");
    expect(current.hasMore).toBe(false);
    get.mockResolvedValueOnce(page()).mockResolvedValueOnce([{ id: 101, title: "Changed last page" }]);
    await act(async () => root.render(<Harness revision={1} />));
    expect(current.rows.at(-1)?.title).toBe("Changed last page");
    expect(get.mock.calls.at(-1)?.[0]).toBe("/first?per_page=100&page=2");
});

it("preserves data and pagination on failure so the failed next page is retryable", async () => {
    get.mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error("Offline"));
    await act(async () => root.render(<Harness />));
    await act(async () => current.loadMore());
    expect(current.rows).toHaveLength(100);
    expect(current.error).toBe("Offline");
    expect(current.hasMore).toBe(true);
    get.mockResolvedValueOnce([{ id: 100, title: "Recovered" }]);
    await act(async () => current.loadMore());
    expect(get.mock.calls.at(-1)?.[0]).toBe("/first?per_page=100&page=2");
    expect(current.error).toBe(null);
    expect(current.rows).toHaveLength(101);
});

it("does not install stale responses after a repository change", async () => {
    const old = deferred();
    get.mockReturnValueOnce(old.promise).mockResolvedValueOnce([{ id: 2, title: "Current repo" }]);
    await act(async () => root.render(<Harness />));
    await act(async () => root.render(<Harness path="/second" />));
    await act(async () => old.resolve(page()));
    expect(host.textContent).toBe("Current repo");
    expect(current.hasMore).toBe(false);
    expect(current.loading).toBe(false);
});

it("retains the entire previous snapshot if a later page fails during refresh", async () => {
    get.mockResolvedValueOnce(page()).mockResolvedValueOnce([{ id: 100, title: "Original" }]);
    await act(async () => root.render(<Harness />));
    await act(async () => current.loadMore());
    get.mockResolvedValueOnce(page(50)).mockRejectedValueOnce(new Error("Rate limited"));
    await act(async () => root.render(<Harness revision={1} />));
    expect(current.rows[0].id).toBe(0);
    expect(current.rows.at(-1)?.title).toBe("Original");
    expect(current.error).toBe("Rate limited");
});

it("discloses endpoint caps rather than requesting pages the API cannot return", async () => {
    get.mockResolvedValue(page());
    await act(async () => root.render(<Harness limit={100} />));
    expect(current.atLimit).toBe(true);
    expect(current.hasMore).toBe(false);
    await act(async () => current.loadMore());
    expect(get).toHaveBeenCalledTimes(1);
});

it("invalidates pending pagination on unmount", async () => {
    const next = deferred();
    get.mockResolvedValueOnce(page()).mockReturnValueOnce(next.promise);
    await act(async () => root.render(<Harness />));
    act(() => current.loadMore());
    act(() => root.render(null));
    await act(async () => next.resolve(page(100)));
    expect(get).toHaveBeenCalledTimes(2);
});


it("keeps timeline records from different event tables even when their numeric IDs collide", async () => {
    get.mockResolvedValueOnce([
        { id: 5, event: "commented", title: "Comment" },
        { id: 5, event: "reviewed", title: "Review" },
    ]);
    await act(async () => root.render(<Harness />));
    expect(current.rows).toHaveLength(2);
});
