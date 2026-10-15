"use client";

import { useScopedState } from "@/lib/ui/use-scoped-state";

import React, { useEffect } from "react";

export function ChatMermaid({ source }: { source: string }) {
    const [svg, setSvg] = useScopedState<string | null>([source], () => null);
    const [failed, setFailed] = useScopedState([source], () => false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const mermaid = (await import("mermaid")).default;
                mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: "strict",
                    theme: "neutral",
                });
                const id = `mmd-${Math.random().toString(36).slice(2, 10)}`;
                const { svg: rendered } = await mermaid.render(id, source);
                if (!cancelled) setSvg(rendered);
            } catch {
                if (!cancelled) setFailed(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [source, setSvg, setFailed]);

    if (failed) {
        return (
            <pre className="my-1 overflow-x-auto squircle-2xl border border-border-subtle bg-surface-3 p-3 chat-text font-mono text-text-secondary">
                {source}
            </pre>
        );
    }
    if (!svg) {
        return <div className="my-1 h-16 squircle-2xl bg-surface-3" aria-hidden />;
    }
    return (
        <div
            className="my-1 overflow-x-auto squircle-2xl bg-surface-3 p-3 text-text-primary [&_svg]:mx-auto [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
}
