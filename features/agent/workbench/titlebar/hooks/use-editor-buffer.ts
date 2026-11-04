"use client";

import { readLatestContent } from "@/lib/editor/buffer-read";

/**
 * Reads the live buffer for a save that a menu or shortcut starts.
 *
 * The hook wraps the shared reader so a component renders with the same
 * behaviour a plain command has.
 */
export function useEditorBuffer() {
    return { readLatestContent };
}
