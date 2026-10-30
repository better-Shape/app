"use client";

import { commands, getProjectPath } from "@/lib/backend";
import { notify } from "@/features/notifications";
import { getSettings } from "@/lib/settings";

/**
 * Editor settings that change the bytes a save writes.
 *
 * Kept in one place because three save paths exist (the CodeMirror keybinding,
 * autosave, and the markdown preview's Save), and a setting that only one of
 * them honours is a setting that works intermittently.
 */

/** Converts the LF document back to the file's line ending on the way to disk. */
export function toDiskText(text: string, eol: "LF" | "CRLF"): string {
    const lf = text.replace(/\r\n/g, "\n");
    return eol === "CRLF" ? lf.replace(/\n/g, "\r\n") : lf;
}

/**
 * Strips trailing spaces and tabs one line at a time.
 *
 * A single multiline expression with `$` and a quantified class backtracks
 * super-linearly on long runs of whitespace; splitting first keeps each
 * replacement anchored to one line.
 */
const trimLineEnds = (doc: string): string =>
    doc
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/, ""))
        .join("\n");

/** Applies Trim trailing whitespace and Insert final newline to an LF document. */
export function prepareDocForSave(doc: string): string {
    const editor = getSettings().editor;
    let text = editor.trimTrailingWhitespace ? trimLineEnds(doc) : doc;
    if (editor.insertFinalNewline && text.length > 0 && !text.endsWith("\n")) text += "\n";
    return text;
}

/**
 * Formats with Prettier when Format on save is on.
 *
 * A file type Prettier cannot parse keeps the text it was given: refusing to
 * save a Markdown note because no parser matched would be a data loss bug, and
 * the explicit Format action still reports its own failure.
 */
export async function formatForSave(path: string, text: string): Promise<string> {
    if (!getSettings().editor.formatOnSave) return text;
    try {
        const formatted = await commands.prettierFormatFile(getProjectPath() ?? "", path, text);
        lastFormatFailure = null;
        return typeof formatted === "string" && formatted.length > 0 ? formatted : text;
    } catch (error) {
        // Saving the unformatted text is the right call — refusing to save would
        // lose the user's work — but a silent fallback makes Format on save look
        // like it worked. Report each distinct failure once: autosave repeats the
        // same broken file every few hundred milliseconds.
        const reason = error instanceof Error ? error.message : String(error);
        const signature = `${path}\u0000${reason}`;
        if (signature !== lastFormatFailure) {
            lastFormatFailure = signature;
            notify.warn("Format on save skipped", `${path}: ${reason}`);
        }
        return text;
    }
}

/**
 * Writes per path, in the order they were requested.
 *
 * Formatting is asynchronous, so two saves of the same file can finish out of
 * order and leave the older snapshot on disk. Chaining per path keeps the last
 * request as the last write.
 */
const writeChains = new Map<string, Promise<void>>();

/** Last reported formatting failure, so autosave does not repeat the toast. */
let lastFormatFailure: string | null = null;

/** Runs `run` after every earlier write for the same path, success or not. */
const serializeWrites = <T>(path: string, run: () => Promise<T>): Promise<T> => {
    const previous = writeChains.get(path) ?? Promise.resolve();
    const next = previous.then(run, run);
    // The tail resolves to nothing, so the map never holds saved file text, and
    // a settled path is dropped rather than kept for the life of the session.
    const tail = next.then(
        () => undefined,
        () => undefined,
    );
    writeChains.set(path, tail);
    void tail.then(() => {
        if (writeChains.get(path) === tail) writeChains.delete(path);
    });
    return next;
};

/** Runs the save pipeline and returns the LF text that was written. */
export function saveContents(path: string, doc: string, eol: "LF" | "CRLF" = "LF"): Promise<string> {
    const prepared = prepareDocForSave(doc);
    return serializeWrites(path, async () => {
        const formatted = await formatForSave(path, prepared);
        await commands.saveFile(path, toDiskText(formatted, eol));
        return formatted;
    });
}
