"use client";

import { useEffect, useSyncExternalStore, type ComponentType, type ReactNode } from "react";

type HighlighterComponent = ComponentType<Record<string, unknown>>;

let resolvedPrism: HighlighterComponent | null = null;
let inflightLoad: Promise<HighlighterComponent> | null = null;
const prismListeners = new Set<() => void>();

function subscribePrism(listener: () => void): () => void {
    prismListeners.add(listener);
    return () => {
        prismListeners.delete(listener);
    };
}

function getPrismReadySnapshot(): boolean {
    return resolvedPrism !== null;
}

function loadPrismModule(): Promise<HighlighterComponent> {
    if (resolvedPrism) return Promise.resolve(resolvedPrism);
    if (!inflightLoad) {
        inflightLoad = import("react-syntax-highlighter")
            .then((m) => {
                const PrismComp = m.Prism as unknown as HighlighterComponent;
                resolvedPrism = PrismComp;
                inflightLoad = null;
                for (const listener of prismListeners) {
                    listener();
                }
                return PrismComp;
            })
            .catch((err) => {
                inflightLoad = null;
                throw err;
            });
    }
    return inflightLoad;
}

/** Warm the syntax highlighter chunk during idle time so first code block renders synchronously. */
export function preloadSyntaxHighlighter(): void {
    if (resolvedPrism || typeof window === "undefined") return;
    void loadPrismModule().catch(() => {
        /* retryable on next preload or mount */
    });
}

/** Lazy-loaded Prism syntax highlighter with retryable chunk loading and `<pre>` fallback. */
export function SyntaxHighlighter({
    children,
    fallback,
    ...props
}: {
    children?: ReactNode;
    fallback?: ReactNode;
    [key: string]: unknown;
}) {
    const isReady = useSyncExternalStore(
        subscribePrism,
        getPrismReadySnapshot,
        getPrismReadySnapshot,
    );

    useEffect(() => {
        if (isReady) return;
        void loadPrismModule().catch(() => {
            /* graceful fallback to <pre>; later mounts can retry */
        });
    }, [isReady]);

    if (isReady && resolvedPrism) {
        const Resolved = resolvedPrism;
        return <Resolved {...props}>{children}</Resolved>;
    }
    if (fallback !== undefined) {
        return fallback;
    }
    return <pre className="m-0 overflow-x-auto font-mono text-sm">{children}</pre>;
}
