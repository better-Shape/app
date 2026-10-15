import { act, StrictMode, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useSendPreparations } from "@/features/chat/lib/use-send-preparations";

let root: Root | null;
let host: HTMLDivElement;
let preparation: ReturnType<typeof useSendPreparations>;
function Harness({ project, conversation, startOnce = false }: { project: string | null; conversation: string | null; startOnce?: boolean }) {
    const current = useSendPreparations(project, conversation);
    const started = useRef(false);
    useEffect(() => { preparation = current; });
    useEffect(() => {
        if (startOnce && !started.current) {
            started.current = true;
            current.begin(conversation);
        }
    }, [current, conversation, startOnce]);
    return null;
}
function render(project: string | null = "project-a", conversation: string | null = null) {
    act(() => root!.render(<Harness project={project} conversation={conversation} />));
}
function begin(owner: string | null) {
    let controller!: AbortController;
    act(() => { controller = preparation.begin(owner); });
    return controller;
}
beforeEach(() => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    render();
});
afterEach(() => { act(() => root?.unmount()); host.remove(); });

it("shows only the viewed conversation's preparation, including the unnamed draft", () => {
    const draft = begin(null);
    const other = begin("other");
    expect(preparation.isPreparing).toBe(true);
    render("project-a", "idle");
    expect(preparation.isPreparing).toBe(false);
    render("project-a", "other");
    expect(preparation.isPreparing).toBe(true);
    act(() => preparation.cancel("other"));
    expect(preparation.isPreparing).toBe(false);
    expect(other.signal.aborted).toBe(true);
    expect(draft.signal.aborted).toBe(false);
    render();
    expect(preparation.isPreparing).toBe(true);
});
it("clears cancellation immediately and ignores an old finally after a new preparation begins", () => {
    const old = begin(null);
    act(() => preparation.cancel(null));
    expect(old.signal.aborted).toBe(true);
    expect(preparation.isPreparing).toBe(false);
    const next = begin(null);
    act(() => preparation.finish(old));
    expect(preparation.isPreparing).toBe(true);
    expect(next.signal.aborted).toBe(false);
    act(() => preparation.finish(next));
    expect(preparation.isPreparing).toBe(false);
});
it("does not clear overlapping owners when one reaches native admission", () => {
    const first = begin(null);
    const second = begin(null);
    act(() => { preparation.finish(first); preparation.finish(first); });
    expect(preparation.isPreparing).toBe(true);
    expect(first.signal.aborted).toBe(false);
    act(() => preparation.finish(second));
    expect(preparation.isPreparing).toBe(false);
});
it("aborts preparation on project changes and fences callbacks even when returning to the same project", () => {
    const oldScope = preparation;
    const old = begin(null);
    render("project-b");
    expect(old.signal.aborted).toBe(true);
    expect(preparation.isPreparing).toBe(false);
    expect(oldScope.begin(null).signal.aborted).toBe(true);
    render("project-a");
    const next = begin(null);
    act(() => { oldScope.cancel(null); oldScope.finish(old); });
    expect(preparation.isPreparing).toBe(true);
    expect(next.signal.aborted).toBe(false);
    expect(oldScope.begin(null).signal.aborted).toBe(true);
});
it("aborts every conversation at unmount and rejects retained callbacks", () => {
    const retained = preparation;
    const draft = begin(null);
    const background = begin("other");
    act(() => root!.unmount()); root = null;
    expect(draft.signal.aborted).toBe(true);
    expect(background.signal.aborted).toBe(true);
    expect(retained.begin(null).signal.aborted).toBe(true);
    retained.finish(draft);
    retained.cancel(null);
});
it("does not retain preparation state across StrictMode effect cleanup", () => {
    act(() => root!.render(<StrictMode><Harness project="strict" conversation={null} startOnce /></StrictMode>));
    expect(preparation.isPreparing).toBe(false);
});
