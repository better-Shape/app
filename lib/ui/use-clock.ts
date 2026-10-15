"use client";

import { useSyncExternalStore } from "react";

let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const snapshot = () => now;
const serverSnapshot = () => 0;

/** One minute clock for all relative labels; no timers survive the last subscriber. */
function subscribe(notify: () => void): () => void {
    listeners.add(notify);
    if (!timer) {
        now = Date.now();
        timer = setInterval(() => { now = Date.now(); for (const listener of listeners) listener(); }, 60_000);
    }
    return () => {
        listeners.delete(notify);
        if (listeners.size === 0) { clearInterval(timer); timer = undefined; }
    };
}

export function useClock(): number {
    return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
