"use client";

/**
 * The line ending each open file was loaded with.
 *
 * The buffers hold LF, and the file's own ending is converted back on the way
 * to disk. Anything that saves a file without an editor in front of it (Save
 * All, Save As) has no view to ask, so the editor records what it loaded here.
 * Without it, saving a CRLF file from the menu would rewrite every line.
 */

export type LiveEol = "LF" | "CRLF";

const MAX_TRACKED = 512;
const endings = new Map<string, LiveEol>();

/** The ending a text on disk uses, read from its bytes. */
export const lineEndingOfText = (text: string): LiveEol => (text.includes("\r\n") ? "CRLF" : "LF");

/** Records the ending the editor loaded for `path`. */
export function rememberLiveEol(path: string, eol: LiveEol): void {
    if (!path) return;
    endings.delete(path);
    endings.set(path, eol);
    if (endings.size <= MAX_TRACKED) return;
    const oldest = endings.keys().next();
    if (!oldest.done) endings.delete(oldest.value);
}

/** The ending the editor loaded for `path`, or LF when no editor has seen it. */
export function liveEolFor(path: string): LiveEol {
    return endings.get(path) ?? "LF";
}

/** Drops the record, for a file that closed without being saved. */
export function forgetLiveEol(path: string): void {
    endings.delete(path);
}
