"use client";

import { initSettings } from "@/lib/settings";
import { aiConfigReady, initAiConfigSync } from "@/lib/ai/sync";

type Owner = { users: number; ready: Promise<void>; stop?: () => void; settled: boolean };
let current: Owner | undefined;

/** Layouts and early sends share one settings/keychain initialization owner. */
export function acquireAiConfiguration(): { ready: Promise<void>; release: () => void } {
    if (!current) {
        const owner: Owner = { users: 0, ready: Promise.resolve(), settled: false };
        current = owner;
        owner.ready = Promise.resolve().then(async () => {
            await initSettings();
            if (owner.users === 0) throw new Error("Provider initialization cancelled");
            owner.stop = initAiConfigSync();
            await aiConfigReady();
        }).finally(() => {
            owner.settled = true;
            if (owner.users === 0) owner.stop?.();
        });
        // An owner may unmount without awaiting readiness. Consumers still
        // receive the original rejection; this only prevents an orphan rejection.
        void owner.ready.catch(() => undefined);
    }
    const owner = current;
    owner.users += 1;
    let released = false;
    return { ready: owner.ready, release: () => {
        if (released) return;
        released = true;
        owner.users -= 1;
        if (owner.users === 0) {
            if (current === owner) current = undefined;
            if (owner.settled) owner.stop?.();
        }
    } };
}

export async function waitForAiConfiguration(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new DOMException("Send cancelled", "AbortError");
    const owner = acquireAiConfiguration();
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
        abort = () => reject(new DOMException("Send cancelled", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
    });
    try {
        await Promise.race([owner.ready.then(() => aiConfigReady()), cancelled]);
    } finally {
        signal.removeEventListener("abort", abort);
        owner.release();
    }
}
