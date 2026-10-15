import { act, startTransition, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatMarkdown } from "@/features/chat/ui/md/view";

let host: HTMLDivElement;
let root: Root;
function Suspend({ pending }: { pending?: Promise<void> }) {
    if (pending) throw pending;
    return null;
}
const tree = (content: string, live: boolean, pending?: Promise<void>) => <Suspense fallback={null}>
    <ChatMarkdown content={content} isLast isGenerating={live} /><Suspend pending={pending} />
</Suspense>;
beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => window.setTimeout(() => callback(performance.now()), 16));
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(id => window.clearTimeout(id));
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("does not animate a finished message because an abandoned render looked live", async () => {
    await act(async () => root.render(tree("first", false)));
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    try {
        await act(async () => startTransition(() => root.render(tree("first", true, pending))));
        const finished = "A complete history message that should appear without streaming.";
        await act(async () => root.render(tree(finished, false)));
        expect(host.textContent).toBe(finished);
    } finally { await act(async () => release()); }
});

it("still reveals a committed stream and finishes its remaining text", async () => {
    const content = "Streaming begins with a short preview, then reveals the rest of this complete sentence. A finished response must not leave its final words hidden after generation ends.";
    await act(async () => root.render(tree(content, true)));
    expect(host.textContent?.length).toBeLessThan(content.length);
    await act(async () => root.render(tree(content, false)));
    for (let i = 0; i < 65; i++) await act(async () => { vi.advanceTimersByTime(32); });
    expect(host.textContent).toBe(content);
});
