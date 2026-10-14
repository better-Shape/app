import { useLayoutEffect, act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/features/chat/ui/prs/actions", () => ({ runPrAction: run }));
import { usePrCloseSweep } from "@/features/chat/ui/prs/close-sweep";
import type { PrItem } from "@/features/chat/ui/prs/mapping";
const rows: PrItem[] = [1, 2, 3].map((number) => ({ id: String(number), number, title: `PR ${number}`, repo: "owner/repo", status: number === 3 ? "closed" : "open", labels: [], updated: "" }));
let sweep: ReturnType<typeof usePrCloseSweep>;
let root: Root;
let host: HTMLDivElement;
let hit: Element | null;
function Harness({ repo = "owner/repo" }) {
    const ref = useRef<HTMLDivElement>(null);
    const result = usePrCloseSweep(ref, repo);
    useLayoutEffect(() => { sweep = result; });
    return <div ref={ref}>{rows.map((row) => <div key={row.id} data-pr-id={row.id}>{row.title}</div>)}</div>;
}
function pointer(type: string, props = {}): PointerEvent {
    return Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: 0, clientY: 0, ...props }) as PointerEvent;
}
function start(props = {}) { act(() => sweep.start(rows[0], rows, pointer("pointerdown", props))); }
function move(id: string, props = {}) {
    hit = host.querySelector(`[data-pr-id="${id}"]`);
    act(() => { window.dispatchEvent(pointer("pointermove", { clientY: 30, ...props })); });
}
beforeEach(async () => {
    run.mockReset().mockResolvedValue(true);
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => hit) });
    await act(async () => root.render(<Harness />));
    hit = host.querySelector('[data-pr-id="1"]');
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("stages unique open rows and only closes on release, suppressing the synthetic click", async () => {
    start(); move("2"); move("1"); move("2");
    expect([...sweep.selected]).toEqual(["1", "2"]);
    expect(run).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(pointer("pointerup", { clientY: 30 })); });
    expect(run.mock.calls.map(([item]) => item.id)).toEqual(["1", "2"]);
    expect(run).toHaveBeenCalledWith(rows[1], "close", "owner/repo");
    expect(sweep.suppressClick()).toBe(true);
    expect(sweep.selected.size).toBe(0);
    expect(sweep.closing).toBe(false);
});

it("leaves ordinary clicks to the accessible button action", async () => {
    start();
    await act(async () => { window.dispatchEvent(pointer("pointerup")); });
    expect(run).not.toHaveBeenCalled();
    expect(sweep.suppressClick()).toBe(false);
});

it.each(["escape", "blur", "cancel", "outside", "hidden"])("cancels a %s gesture without mutating GitHub", async (kind) => {
    start(); move("2");
    await act(async () => {
        if (kind === "escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        if (kind === "blur") window.dispatchEvent(new Event("blur"));
        if (kind === "cancel") window.dispatchEvent(pointer("pointercancel"));
        if (kind === "hidden") document.dispatchEvent(new Event("visibilitychange"));
        if (kind === "outside") hit = document.body;
        window.dispatchEvent(pointer("pointerup"));
    });
    expect(run).not.toHaveBeenCalled();
    expect(sweep.selected.size).toBe(0);
});

it("ignores closed rows, touch scrolling, secondary pointers, and non-primary buttons", async () => {
    for (const props of [{ pointerType: "touch" }, { isPrimary: false }, { button: 2 }]) {
        start(props); move("2");
        await act(async () => { window.dispatchEvent(pointer("pointerup")); });
    }
    expect(run).not.toHaveBeenCalled();
    start(); move("3");
    expect([...sweep.selected]).toEqual(["1"]);
    await act(async () => { window.dispatchEvent(pointer("pointerup")); });
    expect(run).not.toHaveBeenCalled();
});

it("bounds close mutations to one in flight, and stops remaining work on repo changes", async () => {
    let resolve!: (result: boolean) => void;
    run.mockImplementationOnce(() => new Promise<boolean>((r) => { resolve = r; }));
    start(); move("2");
    await act(async () => { window.dispatchEvent(pointer("pointerup")); });
    expect(run).toHaveBeenCalledTimes(1);
    expect(sweep.closing).toBe(true);
    await act(async () => root.render(<Harness repo="owner/other" />));
    await act(async () => resolve(true));
    expect(run).toHaveBeenCalledTimes(1);
    expect(sweep.closing).toBe(false);
});

it("does not close anything after unmount during a drag", async () => {
    start(); move("2");
    act(() => root.render(null));
    await act(async () => { window.dispatchEvent(pointer("pointerup")); });
    expect(run).not.toHaveBeenCalled();
});
