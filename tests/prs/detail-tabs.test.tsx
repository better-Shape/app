import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/backend", () => ({ commands: { githubApiGet: get } }));
import { PrFilesTab } from "@/features/chat/ui/prs/detail-tabs";
import { mapPullRow } from "@/features/chat/ui/prs/mapping";

it("keeps loaded file pages on review-only changes and revalidates them on commits or explicit refresh", async () => {
    get.mockImplementation(async (path: string) => Array.from({ length: path.endsWith("page=1") ? 100 : 1 }, (_, i) => ({ filename: `${path.endsWith("page=1") ? "first" : "last"}-${i}.ts`, status: "modified", additions: 1, deletions: 0 })));
    const host = document.createElement("div"); document.body.appendChild(host);
    const root = createRoot(host);
    let item = mapPullRow({ id: 1, number: 7, title: "PR", state: "open", updated_at: "first", head: { sha: "sha-a" } }, "owner/repo");
    try {
        await act(async () => root.render(<PrFilesTab item={item} revision={0} />));
        const more = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Load more"));
        expect(more).toBeDefined();
        await act(async () => more!.click());
        expect(get).toHaveBeenCalledTimes(2);
        item = { ...item, updatedAt: "review changed" };
        await act(async () => root.render(<PrFilesTab item={item} revision={0} />));
        expect(get).toHaveBeenCalledTimes(2);
        item = { ...item, headSha: "sha-b" };
        await act(async () => root.render(<PrFilesTab item={item} revision={0} />));
        expect(get).toHaveBeenCalledTimes(4);
        await act(async () => root.render(<PrFilesTab item={item} revision={1} />));
        expect(get).toHaveBeenCalledTimes(6);
        expect(host.textContent).toContain("last-0.ts");
    } finally { act(() => root.unmount()); host.remove(); }
});
