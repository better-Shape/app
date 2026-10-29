/**
 * Clean Markdown serializer for copying or exporting a chat transcript.
 */

import { formatMessageModelLabel, isAutoModelId } from "./usage-display";

const ATTACHED_BLOCK_AT_RE = /<attached_(image|file|asset)\b([^>]*)>[\s\S]*?<\/attached_\1>/yi;
const ASSISTANT_HIDDEN_BLOCK_AT_RE =
    /<(thinking|thought|think|analysis|rename_chat|todos)\b[^>]*>[\s\S]*?<\/\1>/yi;
const ASSISTANT_EDIT_BLOCK_AT_RE = /<edit\b([^>]*)>[\s\S]*?<\/edit>/yi;
const ASSISTANT_ACTION_TAG_AT_RE = /<bettershape_action\b[^>]*\/?>/yi;

type AngleMatchReplacement = {
    replacement: string;
    end: number;
};

/** Counts consecutive backtick characters starting at `start`. */
const countBacktickRun = (source: string, start: number): number => {
    let end = start;
    while (end < source.length && source.charCodeAt(end) === 96) {
        end += 1;
    }
    return end - start;
};

/** Finds the closing backtick run of exact length `runLen` within the same paragraph. */
const findClosingInlineTicks = (source: string, from: number, runLen: number): number => {
    let cursor = from;
    while (cursor < source.length) {
        const nextTick = source.indexOf("`", cursor);
        if (nextTick === -1) return -1;
        const count = countBacktickRun(source, nextTick);
        if (count === runLen) {
            return source.slice(from, nextTick).includes("\n\n") ? -1 : nextTick + count;
        }
        cursor = nextTick + count;
    }
    return -1;
};

/** Parses a CommonMark fence marker (` ``` ` or `~~~`) on `line` when present. */
const readLineFenceMarker = (
    line: string,
): { char: string; len: number; suffix: string } | null => {
    let spaces = 0;
    while (spaces < 3 && line.charCodeAt(spaces) === 32) {
        spaces += 1;
    }
    const markerChar = line.charAt(spaces);
    if (markerChar !== "`" && markerChar !== "~") return null;
    let markerEnd = spaces;
    while (markerEnd < line.length && line.charAt(markerEnd) === markerChar) {
        markerEnd += 1;
    }
    const len = markerEnd - spaces;
    if (len < 3) return null;
    return { char: markerChar, len, suffix: line.slice(markerEnd) };
};

/** Checks whether the line starting at `lineStart` opens a fenced code block. */
const readOpeningFenceAt = (
    source: string,
    lineStart: number,
): { char: string; len: number; afterLine: number } | null => {
    const lineEnd = source.indexOf("\n", lineStart);
    const afterLine = lineEnd === -1 ? source.length : lineEnd + 1;
    const rawLine = lineEnd === -1 ? source.slice(lineStart) : source.slice(lineStart, lineEnd);
    const parsed = readLineFenceMarker(rawLine);
    if (!parsed) return null;
    if (parsed.char === "`" && parsed.suffix.includes("`")) return null;
    return { char: parsed.char, len: parsed.len, afterLine };
};

/** Finds the offset immediately past the closing fence line, or `source.length` if unclosed. */
const findClosingFenceEnd = (
    source: string,
    from: number,
    fenceChar: string,
    fenceLen: number,
): number => {
    let cursor = from;
    while (cursor < source.length) {
        const lineEnd = source.indexOf("\n", cursor);
        const afterLine = lineEnd === -1 ? source.length : lineEnd + 1;
        const rawLine = lineEnd === -1 ? source.slice(cursor) : source.slice(cursor, lineEnd);
        const parsed = readLineFenceMarker(rawLine);
        if (
            parsed
            && parsed.char === fenceChar
            && parsed.len >= fenceLen
            && /^[ \t]*$/.test(parsed.suffix)
        ) {
            return afterLine;
        }
        cursor = afterLine;
    }
    return source.length;
};

/** Computes the next scanner stop at a newline boundary, inline backtick, or `<` character. */
const findNextInterestingOffset = (source: string, from: number): number => {
    let best = source.length;
    const nextNewline = source.indexOf("\n", from);
    if (nextNewline !== -1 && nextNewline + 1 < best) best = nextNewline + 1;
    const nextTick = source.indexOf("`", from);
    if (nextTick !== -1 && nextTick < best) best = nextTick;
    const nextAngle = source.indexOf("<", from);
    if (nextAngle !== -1 && nextAngle < best) best = nextAngle;
    return best;
};

/** Scans `source` while skipping fenced/inline code and invoking `onAngleAt` at top-level `<`. */
const scanMarkdownOutsideCode = (
    source: string,
    onAngleAt: (input: string, offset: number) => AngleMatchReplacement | null,
): string => {
    const out: string[] = [];
    let cursor = 0;

    while (cursor < source.length) {
        if (cursor === 0 || source.charCodeAt(cursor - 1) === 10) {
            const fence = readOpeningFenceAt(source, cursor);
            if (fence) {
                const fenceEnd = findClosingFenceEnd(
                    source,
                    fence.afterLine,
                    fence.char,
                    fence.len,
                );
                out.push(source.slice(cursor, fenceEnd));
                cursor = fenceEnd;
                continue;
            }
        }

        const code = source.charCodeAt(cursor);
        if (code === 96) {
            const runLen = countBacktickRun(source, cursor);
            const closeEnd = findClosingInlineTicks(source, cursor + runLen, runLen);
            const spanEnd = closeEnd !== -1 ? closeEnd : cursor + runLen;
            out.push(source.slice(cursor, spanEnd));
            cursor = spanEnd;
            continue;
        }

        if (code === 60) {
            const matched = onAngleAt(source, cursor);
            if (matched) {
                out.push(matched.replacement);
                cursor = matched.end;
                continue;
            }
            out.push("<");
            cursor += 1;
            continue;
        }

        const nextStop = findNextInterestingOffset(source, cursor);
        out.push(source.slice(cursor, nextStop));
        cursor = nextStop;
    }

    return out.join("");
};

/** Tests a sticky regular expression at an exact `offset`. */
const execStickyAt = (pattern: RegExp, input: string, offset: number): RegExpExecArray | null => {
    pattern.lastIndex = offset;
    return pattern.exec(input);
};

/** Matches a top-level `<attached_*>` block at `offset` and appends its summary note. */
const matchAttachmentBlockAt = (
    input: string,
    offset: number,
    attachmentNotes: string[],
): AngleMatchReplacement | null => {
    const match = execStickyAt(ATTACHED_BLOCK_AT_RE, input, offset);
    if (!match) return null;
    const kind = match[1] ?? "file";
    const attrs = match[2] ?? "";
    const nameMatch = /\bname=["']([^"']+)["']/i.exec(attrs);
    const label = nameMatch?.[1]?.trim() || kind;
    attachmentNotes.push(`_Attached: \`${label}\`_`);
    return { replacement: "", end: offset + match[0].length };
};

/** Matches an assistant-only control tag (`<thinking>`, `<edit>`, `<todos>`, etc.) at `offset`. */
const matchAssistantControlAt = (
    input: string,
    offset: number,
): AngleMatchReplacement | null => {
    const hidden = execStickyAt(ASSISTANT_HIDDEN_BLOCK_AT_RE, input, offset);
    if (hidden) return { replacement: "", end: offset + hidden[0].length };

    const editMatch = execStickyAt(ASSISTANT_EDIT_BLOCK_AT_RE, input, offset);
    if (editMatch) {
        const attrs = editMatch[1] ?? "";
        const fileMatch = /\bfile=["']([^"']+)["']/i.exec(attrs);
        const filePath = fileMatch?.[1]?.trim() ?? "";
        return {
            replacement: filePath ? `\n> Edited \`${filePath}\`\n` : "",
            end: offset + editMatch[0].length,
        };
    }

    const actionMatch = execStickyAt(ASSISTANT_ACTION_TAG_AT_RE, input, offset);
    if (actionMatch) return { replacement: "", end: offset + actionMatch[0].length };
    return null;
};

/** Cleans a raw user or assistant message body into export-ready Markdown. */
const cleanMessageBodyForMarkdown = (raw: string, role: "user" | "assistant"): string => {
    if (!raw) return "";
    const normalized = raw.replace(/\r\n?/g, "\n");
    const attachmentNotes: string[] = [];

    const stripped = scanMarkdownOutsideCode(normalized, (input, offset) => {
        const attachment = matchAttachmentBlockAt(input, offset, attachmentNotes);
        if (attachment) return attachment;
        return role === "assistant" ? matchAssistantControlAt(input, offset) : null;
    });

    const cleaned = stripped.replace(/\n{3,}/g, "\n\n").trim();
    if (attachmentNotes.length === 0) return cleaned;
    return [attachmentNotes.join(" · "), cleaned].filter(Boolean).join("\n\n");
};

/** Formats a conversation title and message array into a clean Markdown document. */
export const formatTranscriptAsMarkdown = (
    title: string,
    messages: ReadonlyArray<{ role?: string; content?: string; model?: string }>,
): string => {
    const heading = (title || "").trim() || "Chat transcript";
    const sections: string[] = [`# ${heading}`];

    for (const msg of messages) {
        if (msg.role !== "user" && msg.role !== "assistant") continue;
        const body = cleanMessageBodyForMarkdown(msg.content ?? "", msg.role);
        if (!body) continue;

        if (msg.role === "user") {
            sections.push(`## You\n\n${body}`);
        } else {
            const modelHeader =
                msg.model && !isAutoModelId(msg.model)
                    ? `## Assistant (${formatMessageModelLabel(msg.model)})`
                    : "## Assistant";
            sections.push(`${modelHeader}\n\n${body}`);
        }
    }

    return `${sections.join("\n\n---\n\n")}\n`;
};

/** Produces a filesystem-safe `.md` filename from a conversation title. */
export const slugifyTranscriptFilename = (title: string): string => {
    const rawSlug = (title || "chat").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    let start = 0;
    while (start < rawSlug.length && rawSlug.charCodeAt(start) === 45) start += 1;
    let end = rawSlug.length;
    while (end > start && rawSlug.charCodeAt(end - 1) === 45) end -= 1;
    const slug = rawSlug.slice(start, end).slice(0, 48);
    return `${slug || "chat"}-transcript.md`;
};
