"use client";

import { useEffect, useRef } from "react";
import { commands } from "@/lib/backend";
import { loadDirtyBuffer } from "@/lib/workspace/dirty-buffers";

export function useEditorBuffer() {
    const activeBufferRef = useRef(new Map<string, string>());

    useEffect(() => {
        const handleBuffer = (event: Event) => {
            const detail = (event as CustomEvent<{ path: string; content: string }>).detail;
            if (!detail?.path) return;
            activeBufferRef.current.set(detail.path, detail.content);
        };
        window.addEventListener("bettershape-editor-buffer", handleBuffer as EventListener);
        return () => window.removeEventListener("bettershape-editor-buffer", handleBuffer as EventListener);
    }, []);

    const readLatestContent = async (path: string) => {
        let live: string | undefined;
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
        const buffer = activeBufferRef.current.get(path);
        if (typeof buffer === "string") return buffer;
        return commands.readFile(path);
    };

    return { readLatestContent };
}
