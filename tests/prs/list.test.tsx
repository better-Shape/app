import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ renderActions: vi.fn(), close: vi.fn() }));
vi.mock("@/features/chat/ui/prs/actions", () => ({ runPrAction: mocks.close }));
vi.mock("@/features/chat/ui/prs/speed-actions", () => ({
    useShiftHeld: () => false,
    PrRowActions: (props: { item: { id: string }; onCloseSweepStart: (item: unknown, event: PointerEvent) => void }) => {
        mocks.renderActions(props);
        return null;
    },
}));
import { PullRequestsList } from "@/features/chat/ui/prs/list";
import { getPrUi, selectPr } from "@/features/chat/ui/prs/store";
import type { PrItem } from "@/features/chat/ui/prs/mapping";
let host: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof PullRequestsList>;
const items: PrItem[] = [1, 2, 3].map((number) => ({
    id: String(number), number, title: `PR ${number}`, repo: "owner/repo", status: "open", labels: [], updated: "", ci: "success",
}));
const renderCount = (id: string) => mocks.renderActions.mock.calls.filter(([value]) => value.item.id === id).length;
const render = async (patch: Partial<typeof props> = {}) => {
    props = { ...props, ...patch };
    await act(async () => root.render(<PullRequestsList {...props} />));
};
beforeEach(async () => {
    vi.clearAllMocks(); mocks.close.mockResolvedValue(true); selectPr(null);
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    props = {
        items, loading: false, hasMore: false, onLoadMore: vi.fn(), error: null, signedIn: true,
        repo: { owner: "owner", repo: "repo" }, query: "", onQueryChange: vi.fn(), sort: "updated",
        onSortChange: vi.fn(), state: "open", onStateChange: vi.fn(), onRefresh: vi.fn(), onSignIn: vi.fn(), onCiResolved: vi.fn(),
    };
    await render();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); selectPr(null); });

it("does not render memoized rows for unrelated list state or another row's selection", async () => {
    expect(items.map(({ id }) => renderCount(id))).toEqual([1, 1, 1]);
    await render({ loading: true });
    expect(items.map(({ id }) => renderCount(id))).toEqual([1, 1, 1]);
    act(() => host.querySelector<HTMLButtonElement>('[data-pr-id="1"] > button')?.click());
    expect(getPrUi().selectedItem).toBe(items[0]);
    expect(items.map(({ id }) => renderCount(id))).toEqual([2, 1, 1]);
});

it("updates only the changed row, and selection uses its current item", async () => {
    const changed = { ...items[0], title: "Updated title" };
    await render({ items: [changed, items[1], items[2]] });
    expect(items.map(({ id }) => renderCount(id))).toEqual([2, 1, 1]);
    act(() => host.querySelector<HTMLButtonElement>('[data-pr-id="1"] > button')?.click());
    expect(getPrUi().selectedItem).toBe(changed);
});

it("a stable sweep callback uses current row eligibility after polling", async () => {
    const first = mocks.renderActions.mock.calls.find(([value]) => value.item.id === "1")?.[0];
    expect(first).toBeDefined();
    await render({ items: [items[0], { ...items[1], status: "closed" }, items[2]], state: "all" });
    expect(renderCount("1")).toBe(1);
    const hit = vi.fn(() => host.querySelector('[data-pr-id="2"]'));
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hit });
    const pointer = (type: string, clientY: number) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
        pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: 0, clientY,
    }) as PointerEvent;
    act(() => first.onCloseSweepStart(items[0], pointer("pointerdown", 0)));
    act(() => window.dispatchEvent(pointer("pointermove", 30)));
    await act(async () => { window.dispatchEvent(pointer("pointerup", 30)); });
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledWith(items[0], "close", "owner/repo");
});
