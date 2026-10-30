"use client";

import { commands, getProjectPath } from "@/lib/backend";
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
        return typeof formatted === "string" && formatted.length > 0 ? formatted : text;
    } catch {
        return text;
    }
}

/** Runs the save pipeline and returns the LF text that was written. */
export async function saveContents(path: string, doc: string, eol: "LF" | "CRLF" = "LF"): Promise<string> {
    const prepared = await formatForSave(path, prepareDocForSave(doc));
    await commands.saveFile(path, toDiskText(prepared, eol));
    return prepared;
}
