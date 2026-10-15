import { afterEach, expect, it, vi } from "vitest";
import { requestSaveAll, type SaveAllRequestDetail } from "@/lib/workspace/save-all";

let listener: ((event: Event) => void) | undefined;
afterEach(() => {
    if (listener) window.removeEventListener("save-all-request", listener);
    listener = undefined;
    vi.useRealTimers();
});
function handle(save: () => Promise<void>) {
    listener = (event) => (event as CustomEvent<SaveAllRequestDetail>).detail.waitUntil(save());
    window.addEventListener("save-all-request", listener);
}

it("does not claim success when no save handler is mounted", async () => {
    expect(await requestSaveAll()).toBe(false);
});

it("waits for the save acknowledgement rather than an elapsed delay", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    handle(() => new Promise((resolve) => { finish = resolve; }));
    let completed = false;
    const result = requestSaveAll().then((saved) => { completed = true; return saved; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(completed).toBe(false);
    finish();
    expect(await result).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
});

it("reports a failed save without an unhandled rejection", async () => {
    handle(async () => { throw new Error("Disk full"); });
    expect(await requestSaveAll()).toBe(false);
});

it("fails closed if a save never acknowledges", async () => {
    vi.useFakeTimers();
    handle(() => new Promise(() => undefined));
    const result = requestSaveAll();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
});
