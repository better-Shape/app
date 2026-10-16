"use client";

import { useEffect, useRef } from "react";
import { commands } from "@/lib/backend";

/**
 * The newest content of each open editor buffer, keyed by path.
 *
 * The editor publishes every keystroke here, so a menu command that reads a file gets what
 * the user has typed rather than what the last write left on disk.
 */
export const useEditorBuffer = () => {
    const activeBufferRef = useRef<Record<string, string>>({});

    useEffect(() => {
        /**
         * Kept in a ref that is never reset, because a buffer outlives every path switch:
         * closing a file does not discard what was typed in it.
         */
        const handleBuffer = (event: Event) => {
            /** Ignored when malformed: a throw here would escape into the event listener. */
            const detail = (event as CustomEvent<{ path: string; content: string }>).detail;
            if (!detail?.path) return;
            activeBufferRef.current[detail.path] = detail.content;
        };
        window.addEventListener("bettershape-editor-buffer", handleBuffer as EventListener);
        return () => {
            window.removeEventListener("bettershape-editor-buffer", handleBuffer as EventListener);
        };
    }, []);

    /**
     * The content to act on: the typed buffer when there is one, the file otherwise.
     *
     * An empty string is a real buffer, so the presence of the key decides and not the value.
     */
    const readLatestContent = async (path: string) => {
        const buffer = activeBufferRef.current[path];
        if (typeof buffer === "string") return buffer;
        return commands.readFile(path);
    };

    return { readLatestContent };
};
