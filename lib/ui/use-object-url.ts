"use client";

import { useMemo, useSyncExternalStore } from "react";

function createObjectUrlSource(file: File | null, dataUrl?: string) {
    let url: string | null = null;
    let subscribers = 0;
    return {
        snapshot: () => dataUrl || url,
        serverSnapshot: () => dataUrl || null,
        subscribe: () => {
            if (++subscribers === 1 && file && !dataUrl) url = URL.createObjectURL(file);
            return () => {
                if (--subscribers === 0 && url) {
                    URL.revokeObjectURL(url);
                    url = null;
                }
            };
        },
    };
}

/** Blob URLs belong to committed subscriptions, never an abandoned render. */
export function useObjectUrl(file: File | null, dataUrl?: string): string | null {
    const source = useMemo(() => createObjectUrlSource(file, dataUrl), [file, dataUrl]);
    return useSyncExternalStore(source.subscribe, source.snapshot, source.serverSnapshot);
}
