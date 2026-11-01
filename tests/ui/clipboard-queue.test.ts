import { describe, expect, it, vi } from "vitest";
import { createClipboardQueue } from "@/lib/ui/clipboard-queue";

const deferred = () => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("clipboard queue", () => {
    it("writes in the order the copies were asked for", async () => {
        const writes: string[] = [];
        const pendings: Array<ReturnType<typeof deferred>> = [];
        const queue = createClipboardQueue((text) => {
            writes.push(text);
            const pending = deferred();
            pendings.push(pending);
            return pending.promise;
        });
        void queue("first");
        void queue("second");
        await flush();
        // The second write waits for the first, so the older text cannot land last.
        expect(writes).toEqual(["first"]);
        pendings[0].resolve();
        await flush();
        expect(writes).toEqual(["first", "second"]);
        pendings[1].resolve();
        await flush();
    });

    it("falls back only for the newest copy when the write fails", async () => {
        const fallback = vi.fn();
        const queue = createClipboardQueue(() => Promise.reject(new Error("denied")));
        void queue("older", { onFailure: fallback });
        await queue("newer", { onFailure: fallback });
        await flush();
        expect(fallback).toHaveBeenCalledTimes(1);
        expect(fallback).toHaveBeenCalledWith("newer");
    });

    it("drops a write that a later copy already superseded", async () => {
        const writes: string[] = [];
        const queue = createClipboardQueue((text) => {
            writes.push(text);
            return Promise.resolve();
        });
        // A selection copied through the synchronous path bumps the caller's
        // counter, so the queued text is stale by the time it can run.
        let latest = 1;
        void queue("older", { shouldWrite: () => latest === 1 });
        latest = 2;
        await flush();
        expect(writes).toEqual([]);
    });

    it("keeps writing after a failure", async () => {
        const write = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce(undefined);
        const queue = createClipboardQueue(write);
        await queue("one");
        await queue("two");
        expect(write).toHaveBeenCalledTimes(2);
        expect(write).toHaveBeenLastCalledWith("two");
    });
});
