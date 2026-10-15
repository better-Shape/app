import { act, startTransition, Suspense, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChatTurnActive } from "@/features/chat/ui/shell/history-stepper";

let host: HTMLDivElement;
let root: Root;
function Harness({ streaming }: { streaming: boolean }) {
    const scrollRoot = useRef<HTMLDivElement>(null);
    const [active] = useChatTurnActive(scrollRoot, 3, { streaming });
    return <div ref={scrollRoot} data-scroll><output>{active}</output></div>;
}
function Suspend({ pending }: { pending?: Promise<void> }) {
    if (pending) throw pending;
    return null;
}
const tree = (streaming: boolean, pending?: Promise<void>) => <Suspense fallback={null}>
    <Harness streaming={streaming} /><Suspend pending={pending} />
</Suspense>;
beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it("does not scroll-select the streaming tail for an uncommitted streaming render", async () => {
    await act(async () => root.render(tree(false)));
    const scroll = host.querySelector<HTMLDivElement>("[data-scroll]");
    if (!scroll) throw new Error("Scroll container did not mount");
    Object.defineProperties(scroll, { scrollHeight: { value: 200 }, clientHeight: { value: 300 } });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const scrollNow = () => { scroll.dispatchEvent(new Event("scroll")); vi.advanceTimersByTime(32); };
    try {
        await act(async () => startTransition(() => root.render(tree(true, pending))));
        await act(async () => scrollNow());
        expect(host.querySelector("output")?.textContent).toBe("0");
    } finally {
        await act(async () => { release(); root.render(tree(true)); });
    }
    await act(async () => scrollNow());
    expect(host.querySelector("output")?.textContent).toBe("2");
});
