"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let observer: MutationObserver | undefined;
const serverSnapshot = () => null;

/** Share DOM ownership observation across portal consumers, including late roots and removals. */
function subscribe(notify: () => void): () => void {
    listeners.add(notify);
    if (!observer) {
        observer = new MutationObserver(() => { for (const listener of listeners) listener(); });
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["id"] });
    }
    return () => {
        listeners.delete(notify);
        if (listeners.size === 0) { observer?.disconnect(); observer = undefined; }
    };
}

/** Resolve a portal slot without effect-driven state or bounded polling. */
export function useElementById(id: string, enabled = true): HTMLElement | null {
    const snapshot = useCallback(() => enabled ? document.getElementById(id) : null, [id, enabled]);
    return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
