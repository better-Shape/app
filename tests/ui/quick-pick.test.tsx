import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuickPick, type QuickPickItem } from "@/components/ui/quick-pick";

let host: HTMLDivElement;
let root: Root;
const select = vi.fn();
const submit = vi.fn();
const items: QuickPickItem[] = [{ id: "one", label: "One" }, { id: "two", label: "Two" }];
function press(key: string, options: KeyboardEventInit = {}) {
    const input = document.querySelector("[role=dialog] input");
    if (!input) throw new Error("Quick-pick input is missing");
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
    input.dispatchEvent(event);
    return event;
}
function Probe({ confirm }: { confirm: boolean }) {
    useLayoutEffect(() => { if (confirm) press("Enter"); }, [confirm]);
    return null;
}
function Harness({ query = "", rows = items, open = true, confirm = false, allowSubmit = false }: {
    query?: string; rows?: QuickPickItem[]; open?: boolean; confirm?: boolean; allowSubmit?: boolean;
}) {
    return <><QuickPick open={open} onOpenChange={() => {}} query={query} onQueryChange={() => {}}
        items={rows} onSelect={select} onSubmitQuery={allowSubmit ? submit : undefined} />
        <Probe confirm={confirm} /></>;
}
beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("resets the selected row before committing a new query's keyboard handler", async () => {
    await act(async () => root.render(<Harness />));
    act(() => { press("ArrowDown"); });
    await act(async () => root.render(<Harness query="new" confirm />));
    expect(select).toHaveBeenCalledExactlyOnceWith(items[0]);
});

it("resets selection before committing a changed result count", async () => {
    await act(async () => root.render(<Harness />));
    act(() => { press("ArrowDown"); });
    await act(async () => root.render(<Harness rows={[...items, { id: "three", label: "Three" }]} confirm />));
    expect(select).toHaveBeenCalledExactlyOnceWith(items[0]);
});

it.each(["Enter", "ArrowDown", "ArrowUp"])("leaves composing %s to the input method", async key => {
    await act(async () => root.render(<Harness query="draft" allowSubmit />));
    let event: KeyboardEvent | undefined;
    act(() => { event = press(key, { isComposing: true }); });
    expect(event?.defaultPrevented).toBe(false);
    expect(select).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness query="draft" />));
    act(() => { press("Enter"); });
    expect(select).toHaveBeenCalledExactlyOnceWith(items[0]);
});

it("ignores composition boundary key codes before submitting the completed query", async () => {
    await act(async () => root.render(<Harness query="new branch" allowSubmit />));
    act(() => { press("Enter", { keyCode: 229 }); });
    expect(submit).not.toHaveBeenCalled();
    act(() => { press("Enter"); });
    expect(submit).toHaveBeenCalledExactlyOnceWith("new branch");
});

it("cancels pending focus work when the dialog closes", async () => {
    let id = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
    vi.stubGlobal("cancelAnimationFrame", (key: number) => { frames.delete(key); });
    await act(async () => root.render(<Harness />));
    expect(frames.size).toBeGreaterThan(0);
    await act(async () => root.render(<Harness open={false} />));
    expect(frames.size).toBe(0);
});

it("keeps explicit query submission separate from item clicks", async () => {
    await act(async () => root.render(<Harness query="  custom  " allowSubmit />));
    act(() => { press("ArrowUp"); press("Enter"); });
    expect(submit).toHaveBeenCalledExactlyOnceWith("custom");
    const second = Array.from(document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")).find(button => button.textContent === "Two");
    if (!second) throw new Error("Second result is missing");
    act(() => second.click());
    expect(select).toHaveBeenCalledExactlyOnceWith(items[1]);
});

it("wraps keyboard selection and starts at the first result on reopen", async () => {
    const rows = [...items, { id: "three", label: "Three" }];
    await act(async () => root.render(<Harness rows={rows} />));
    act(() => { press("ArrowDown"); });
    act(() => { press("Enter"); });
    expect(select).toHaveBeenLastCalledWith(rows[1]);
    act(() => { press("ArrowUp"); });
    act(() => { press("ArrowUp"); });
    act(() => { press("Enter"); });
    expect(select).toHaveBeenLastCalledWith(rows[2]);
    await act(async () => root.render(<Harness rows={rows} open={false} />));
    await act(async () => root.render(<Harness rows={rows} />));
    act(() => { press("Enter"); });
    expect(select).toHaveBeenLastCalledWith(rows[0]);
    expect(select).toHaveBeenCalledTimes(3);
});

it.each(["  repository  ", "   "])("handles an empty result list with query %j", async query => {
    await act(async () => root.render(<Harness rows={[]} query={query} allowSubmit />));
    act(() => { press("ArrowUp"); press("ArrowDown"); press("Enter"); });
    expect(select).not.toHaveBeenCalled();
    if (query.trim()) expect(submit).toHaveBeenCalledExactlyOnceWith("repository");
    else expect(submit).not.toHaveBeenCalled();
});

it.each([{ isComposing: true }, { keyCode: 229 }])("does not dismiss the dialog for composition Escape %j", async options => {
    const changeOpen = vi.fn();
    await act(async () => root.render(<QuickPick open onOpenChange={changeOpen} query="draft"
        onQueryChange={() => {}} items={items} onSelect={select} />));
    act(() => { press("Escape", options); });
    expect(changeOpen).not.toHaveBeenCalled();
    act(() => { press("Escape"); });
    expect(changeOpen).toHaveBeenCalledExactlyOnceWith(false);
});

it("schedules nothing while closed and cancels a valid zero-valued frame ID", async () => {
    const schedule = vi.fn().mockReturnValue(0);
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", schedule);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    await act(async () => root.render(<Harness open={false} />));
    expect(schedule).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness />));
    expect(cancel).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Harness open={false} />));
    expect(cancel).toHaveBeenCalledExactlyOnceWith(0);
});

it("does not steal result focus when an asynchronous result count changes", async () => {
    let id = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
    vi.stubGlobal("cancelAnimationFrame", (key: number) => { frames.delete(key); });
    const flushFrames = () => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach(callback => callback(0));
    };
    await act(async () => root.render(<Harness />));
    act(flushFrames);
    const result = document.querySelector<HTMLButtonElement>("[role=dialog] button");
    expect(result).not.toBeNull();
    act(() => result?.focus());
    expect(document.activeElement).toBe(result);
    await act(async () => root.render(<Harness rows={[...items, { id: "three", label: "Three" }]} />));
    act(flushFrames);
    expect(document.activeElement).toBe(result);
});
