"use client";

import { useEffect, useRef } from "react";
import { commands } from "@/lib/backend";
import { loadDirtyBuffer } from "@/lib/workspace/dirty-buffers";

/** Read save content from a synchronous editor flush, recovered draft, latest broadcast, or disk in that order. */
export function useEditorBuffer() {
    // Mounted editors answer a synchronous flush; earlier dirty documents live in recovery.
    // Retain just the latest broadcast for legacy publishers, not every visited file.
    const activeBufferRef = useRef<{ path: string; content: string } | null>(null);

    useEffect(() => {
        /** Retain the latest published document as a bounded fallback for legacy buffer publishers. */
        const handleBuffer = (event: Event) => {
            const detail = (event as CustomEvent<{ path: string; content: string }>).detail;
            if (!detail?.path || typeof detail.content !== "string") return;
            activeBufferRef.current = { path: detail.path, content: detail.content };
        };
        window.addEventListener("bettershape-editor-buffer", handleBuffer as EventListener);
        return () => window.removeEventListener("bettershape-editor-buffer", handleBuffer as EventListener);
    }, []);

    /** Capture the live buffer synchronously before falling back to recovery, cached content, or an asynchronous disk read. */
    const readLatestContent = async (path: string) => {
        let live: string | undefined;
        /** Accept a flush response only for the requested path and only when its content is a string. */
        const capture = (event: Event) => {
            const detail = (event as CustomEvent<{ path: string; content: string }>).detail;
            if (detail?.path === path && typeof detail.content === "string") live = detail.content;
        };
        window.addEventListener("bettershape-editor-buffer", capture);
        try { window.dispatchEvent(new CustomEvent("bettershape-editor-flush-buffer", { detail: { path } })); }
        finally { window.removeEventListener("bettershape-editor-buffer", capture); }
        if (typeof live === "string") return live;
        const restored = loadDirtyBuffer(path);
        if (restored) return restored.content;
        const buffer = activeBufferRef.current;
        if (buffer?.path === path) return buffer.content;
        return await commands.readFile(path);
    };

    return { readLatestContent };
}
