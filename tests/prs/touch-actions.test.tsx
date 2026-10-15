import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePrCloseSweep } from "@/features/chat/ui/prs/close-sweep";
import type { PrItem } from "@/features/chat/ui/prs/mapping";
const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/features/chat/ui/prs/actions", () => ({ runPrAction: mocks.run, prActionsFor: () => ["close"], PR_ACTION_LABEL: { close: "Close" } }));
import { PrRowActions } from "@/features/chat/ui/prs/speed-actions";
const item: PrItem = { id: "1", number: 1, repo: "owner/repo", title: "Change", status: "open", updated: "", labels: [] };
function Harness() {
    const list = useRef<HTMLDivElement>(null);
    const sweep = usePrCloseSweep(list, item.repo);
    return <div ref={list} data-pr-id={item.id}><PrRowActions item={item} repo={{ owner: "owner", repo: "repo" }} speedMode={false}
        sweepBusy={sweep.closing} onCloseSweepStart={(row, event) => sweep.start(row, [item], event)} /></div>;
}
let host: HTMLDivElement;
let root: Root;
function button() {
    const found = host.querySelector<HTMLButtonElement>('[aria-label="Close #1"]');
    if (!found) throw new Error("Close button missing");
    return found;
}
function touch(type: string) {
    return Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
        pointerType: "touch", isPrimary: true, pointerId: 1, button: 0, buttons: 1, clientX: 0, clientY: 40,
    });
}
beforeEach(async () => {
    mocks.run.mockReset().mockResolvedValue(true);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
it("makes tap actions available to coarse pointers without hover or Shift", () => {
    expect(button().parentElement?.classList.contains("any-pointer-coarse:opacity-100")).toBe(true);
    expect(button().parentElement?.classList.contains("any-pointer-coarse:pointer-events-auto")).toBe(true);
});
it("closes exactly one PR on an ordinary touch tap", async () => {
    act(() => button().dispatchEvent(touch("pointerdown")));
    await act(async () => {
        button().dispatchEvent(touch("pointerup"));
        button().click();
    });
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(item, "close", item.repo);
});
it("does not convert touch scrolling into a destructive close sweep", async () => {
    act(() => button().dispatchEvent(touch("pointerdown")));
    await act(async () => {
        window.dispatchEvent(touch("pointermove"));
        window.dispatchEvent(touch("pointercancel"));
        window.dispatchEvent(touch("pointerup"));
    });
    expect(mocks.run).not.toHaveBeenCalled();
});
it("retains the same action for keyboard-generated clicks", async () => {
    await act(async () => button().click());
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(item, "close", item.repo);
});
