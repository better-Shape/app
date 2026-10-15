import { act, StrictMode, useLayoutEffect, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScopedState } from "@/lib/ui/use-scoped-state";
import { useElementById } from "@/lib/ui/use-element-by-id";
import { useObjectUrl } from "@/lib/ui/use-object-url";
import { useClock } from "@/lib/ui/use-clock";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("input-owned state", () => {
    let update: Dispatch<SetStateAction<number>>;
    const commits: number[] = [];
    function Owner({ owner, initial = 0 }: { owner: string; initial?: number }) {
        const [value, setValue] = useScopedState([owner], () => initial);
        useLayoutEffect(() => { update = setValue; commits.push(value); });
        return <span>{value}</span>;
    }
    it("keeps same-owner updates and setter identity, then resets before children commit", async () => {
        commits.length = 0;
        await act(async () => root.render(<Owner owner="a" initial={1} />));
        const first = update;
        await act(async () => update(value => value + 2));
        await act(async () => root.render(<Owner owner="a" initial={8} />));
        expect(container.textContent).toBe("3");
        expect(update).toBe(first);
        commits.length = 0;
        await act(async () => root.render(<Owner owner="b" initial={8} />));
        expect(commits).toEqual([8]);
        expect(update).not.toBe(first);
    });
    it("rejects obsolete callbacks even after A → B → A under StrictMode", async () => {
        await act(async () => root.render(<StrictMode><Owner owner="a" /></StrictMode>));
        const obsoleteA = update;
        await act(async () => root.render(<StrictMode><Owner owner="b" /></StrictMode>));
        const obsoleteB = update;
        await act(async () => root.render(<StrictMode><Owner owner="a" initial={4} /></StrictMode>));
        const staleUpdater = vi.fn(() => 99);
        await act(async () => { obsoleteA(staleUpdater); obsoleteB(99); });
        expect(staleUpdater).not.toHaveBeenCalled();
        expect(container.textContent).toBe("4");
        await act(async () => update(value => value + 1));
        expect(container.textContent).toBe("5");
    });
    it("can render on the server without committing a resource", () => {
        expect(renderToString(<Owner owner="server" initial={7} />)).toContain("7");
    });
});

describe("portal target ownership", () => {
    function PortalTarget({ id = "slot", enabled = true }: { id?: string; enabled?: boolean }) {
        const element = useElementById(id, enabled);
        return <span>{element?.id ?? "absent"}</span>;
    }
    it("discovers late slots, id changes, removals and replacements", async () => {
        await act(async () => root.render(<PortalTarget />));
        expect(container.textContent).toBe("absent");
        const slot = document.createElement("div");
        slot.id = "slot";
        await act(async () => document.body.append(slot));
        expect(container.textContent).toBe("slot");
        await act(async () => { slot.id = "renamed"; });
        expect(container.textContent).toBe("absent");
        await act(async () => root.render(<PortalTarget id="renamed" />));
        expect(container.textContent).toBe("renamed");
        await act(async () => slot.remove());
        expect(container.textContent).toBe("absent");
        await act(async () => document.body.append(slot));
        expect(container.textContent).toBe("renamed");
        await act(async () => root.render(<PortalTarget id="renamed" enabled={false} />));
        expect(container.textContent).toBe("absent");
    });
    it("shares one observer and disconnects only after the last consumer", async () => {
        const observe = vi.spyOn(MutationObserver.prototype, "observe");
        const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
        await act(async () => root.render(<><PortalTarget key="one" /><PortalTarget key="two" /></>));
        expect(observe).toHaveBeenCalledTimes(1);
        await act(async () => root.render(<><PortalTarget key="one" /></>));
        expect(disconnect).not.toHaveBeenCalled();
        await act(async () => root.render(null));
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(renderToString(<PortalTarget />)).toContain("absent");
    });
});

describe("shared minute clock", () => {
    function Clock() { return <span>{useClock()}</span>; }
    it("shares its timer, refreshes on resubscribe and releases the final subscription", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        await act(async () => root.render(<><Clock key="one" /><Clock key="two" /></>));
        expect(vi.getTimerCount()).toBe(1);
        expect(container.textContent).toBe("100000100000");
        await act(async () => vi.advanceTimersByTime(60_000));
        expect(container.textContent).toBe("160000160000");
        await act(async () => root.render(<><Clock key="one" /></>));
        expect(vi.getTimerCount()).toBe(1);
        await act(async () => root.render(null));
        expect(vi.getTimerCount()).toBe(0);
        vi.setSystemTime(900_000);
        await act(async () => root.render(<StrictMode><Clock /></StrictMode>));
        expect(container.textContent).toBe("900000");
        expect(vi.getTimerCount()).toBe(1);
        expect(renderToString(<Clock />)).toContain("0");
    });
});

describe("blob URL lifetime", () => {
    function Preview({ file, dataUrl }: { file: File | null; dataUrl?: string }) {
        return <span>{useObjectUrl(file, dataUrl) ?? "absent"}</span>;
    }
    it("allocates only after commit, revokes on replacement and balances StrictMode replay", async () => {
        const create = vi.fn().mockImplementation(() => `blob:${create.mock.calls.length}`);
        const revoke = vi.fn();
        vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
        const first = new File(["a"], "a.png");
        expect(renderToString(<Preview file={first} />)).toContain("absent");
        expect(create).not.toHaveBeenCalled();
        await act(async () => root.render(<StrictMode><Preview file={first} /></StrictMode>));
        expect(container.textContent).toBe(`blob:${create.mock.calls.length}`);
        expect(create.mock.calls.length - revoke.mock.calls.length).toBe(1);
        const old = container.textContent;
        await act(async () => root.render(<StrictMode><Preview file={new File(["b"], "b.png")} /></StrictMode>));
        expect(revoke).toHaveBeenCalledWith(old);
        expect(create.mock.calls.length - revoke.mock.calls.length).toBe(1);
        await act(async () => root.render(null));
        expect(revoke).toHaveBeenCalledTimes(create.mock.calls.length);
    });
    it("prefers supplied data URLs and releases a blob when a data URL becomes available", async () => {
        const create = vi.fn().mockReturnValue("blob:first");
        const revoke = vi.fn();
        vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
        const file = new File(["a"], "a.png");
        await act(async () => root.render(<Preview file={file} dataUrl="data:image/png;base64,AA" />));
        expect(create).not.toHaveBeenCalled();
        expect(container.textContent).toBe("data:image/png;base64,AA");
        await act(async () => root.render(<Preview file={file} />));
        expect(container.textContent).toBe("blob:first");
        await act(async () => root.render(<Preview file={file} dataUrl="data:image/png;base64,BB" />));
        expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:first");
        expect(container.textContent).toBe("data:image/png;base64,BB");
    });
});
