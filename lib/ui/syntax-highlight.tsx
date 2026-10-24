"use client";

import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

type HighlighterComponent = ComponentType<Record<string, unknown>>;

let resolvedPrism: HighlighterComponent | null = null;
let inflightLoad: Promise<{ default: HighlighterComponent }> | null = null;

function loadPrismModule(): Promise<{ default: HighlighterComponent }> {
    if (!inflightLoad) {
        inflightLoad = import("react-syntax-highlighter").then((m) => {
            const PrismComp = m.Prism as unknown as HighlighterComponent;
            resolvedPrism = PrismComp;
            return { default: PrismComp };
        });
    }
    return inflightLoad;
}

const LazyPrism = lazy(loadPrismModule);

/** Warm the syntax highlighter chunk during idle time so first code block renders synchronously. */
export function preloadSyntaxHighlighter(): void {
    if (resolvedPrism || typeof window === "undefined") return;
    void loadPrismModule().catch(() => {
        inflightLoad = null;
    });
}

export function SyntaxHighlighter({
    children,
    fallback,
    ...props
}: {
    children?: ReactNode;
    fallback?: ReactNode;
    [key: string]: unknown;
}) {
    if (resolvedPrism) {
        const Resolved = resolvedPrism;
        return <Resolved {...props}>{children}</Resolved>;
    }
    return (
        <Suspense fallback={fallback ?? <pre className="m-0 overflow-x-auto font-mono text-sm">{children}</pre>}>
            <LazyPrism {...props}>{children}</LazyPrism>
        </Suspense>
    );
}
