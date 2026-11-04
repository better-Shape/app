"use client";

import { commands } from "@/lib/backend";
import { loadDirtyBuffer } from "@/lib/workspace/dirty-buffers";

/**
 * Reads the text a save should write for `path`.
 *
 * A mounted editor answers the flush synchronously; a file whose editor is not
 * mounted falls back to its recovery draft, then to the last published buffer,
 * then to disk. Shared because the titlebar, the command palette and the menu
 * shortcuts all save files, and each one reading the buffer differently is how
 * a save loses the edits the user can see on screen.
 */

/** The latest buffer broadcast, kept only as a fallback for legacy publishers. */
let latestBroadcast: { path: string; content: string } | null = null;
let listening = false;

const ensureListener = () => {
    if (listening || typeof window === "undefined") return;
    listening = true;
    window.addEventListener("bettershape-editor-buffer", (event) => {
        const detail = (event as CustomEvent<{ path: string; content: string }>).detail;
        if (!detail?.path || typeof detail.content !== "string") return;
        latestBroadcast = { path: detail.path, content: detail.content };
    });
};

export async function readLatestContent(path: string): Promise<string> {
    ensureListener();
    let live: string | undefined;
    /** Accept a flush response only for the requested path and only when its content is a string. */
    const capture = (event: Event) => {
        const detail = (event as CustomEvent<{ path: string; content: string }>).detail;
        if (detail?.path === path && typeof detail.content === "string") live = detail.content;
    };
    window.addEventListener("bettershape-editor-buffer", capture);
    try {
        window.dispatchEvent(new CustomEvent("bettershape-editor-flush-buffer", { detail: { path } }));
    } finally {
        window.removeEventListener("bettershape-editor-buffer", capture);
    }
    if (typeof live === "string") return live;
    const restored = loadDirtyBuffer(path);
    if (restored) return restored.content;
    if (latestBroadcast?.path === path) return latestBroadcast.content;
    return await commands.readFile(path);
}
