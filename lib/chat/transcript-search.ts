/**
 * Searchable text extraction and match indexing for in-conversation find.
 */

export interface TranscriptMatch {
    messageIndex: number;
    role: string;
    occurrenceInMessage: number;
    start: number;
    end: number;
    snippet: string;
}

export interface TranscriptSearchOptions {
    caseSensitive?: boolean;
    maxMatches?: number;
}

const HIDDEN_AGENT_TAG_NAMES = [
    "tool_result",
    "terminal_read",
    "terminal_input",
    "list_terminals",
    "tool_code",
    "tool_calls",
    "tool_call",
    "tool_response",
    "function_calls",
    "function_call",
    "function_response",
    "minimax:tool_call",
    "invoke",
    "parameter",
    "arg_key",
    "arg_value",
    "pre_dispatch_explanation",
    "tools",
    "new_path",
    "file_content",
    "sent_file",
] as const;

const INLINE_SYSTEM_MARKER_RE = /<(?:chat_renamed|forked_from)(?:[ \t][^<>]*)?\/>/giu;

const TAG_BOUNDARY_CHARS = new Set([">", " ", "\t", "\n", "\r", "/"]);

/** Finds the next valid `<tag` opener with a tag-boundary delimiter at or after `from`. */
const findNextOpenTagAt = (
    lower: string,
    openPrefix: string,
    from: number,
): number => {
    let idx = lower.indexOf(openPrefix, from);
    while (idx !== -1) {
        const delim = lower.charAt(idx + openPrefix.length);
        if (TAG_BOUNDARY_CHARS.has(delim)) return idx;
        idx = lower.indexOf(openPrefix, idx + openPrefix.length);
    }
    return -1;
};

/** Finds the matching `</tag>` start index after `<tag ...>`, or `-1` when unclosed. */
const findPairedTagCloseAt = (
    lower: string,
    afterPrefix: number,
    closeToken: string,
): number => {
    const gtIdx = lower.indexOf(">", afterPrefix);
    return gtIdx === -1 ? -1 : lower.indexOf(closeToken, gtIdx + 1);
};

/** Strips paired `<tag ...>...</tag>` blocks for a single lowercase `tag` in linear time. */
const stripSinglePairedTag = (text: string, tag: string): string => {
    const lower = text.toLowerCase();
    const openPrefix = `<${tag}`;
    let openIdx = findNextOpenTagAt(lower, openPrefix, 0);
    if (openIdx === -1) return text;
    const closeToken = `</${tag}>`;
    const parts: string[] = [];
    let cursor = 0;
    while (openIdx !== -1) {
        const closeIdx = findPairedTagCloseAt(
            lower,
            openIdx + openPrefix.length,
            closeToken,
        );
        if (closeIdx === -1) break;
        parts.push(text.slice(cursor, openIdx), " ");
        cursor = closeIdx + closeToken.length;
        openIdx = findNextOpenTagAt(lower, openPrefix, cursor);
    }
    parts.push(text.slice(cursor));
    return parts.join("");
};

/** Strips all hidden backend tool/payload XML blocks from `segment` without regex backtracking. */
const stripHiddenPayloadTags = (segment: string): string => {
    if (!segment.includes("<")) return segment;
    let out = segment;
    for (const tag of HIDDEN_AGENT_TAG_NAMES) {
        out = stripSinglePairedTag(out, tag);
    }
    return out;
};

/** Strips hidden agent control tags on a non-fenced text slice. */
const stripControlTagsSlice = (segment: string): string =>
    stripHiddenPayloadTags(segment)
        .replace(/<attached_(image|file|asset)\b[^>]*>[\s\S]*?<\/attached_\1>/gi, " ")
        .replace(/<(thinking|thought|think|analysis)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<rename_chat\b[^>]*>[\s\S]*?<\/rename_chat>/gi, " ")
        .replace(/<todos\b[^>]*>[\s\S]*?<\/todos>/gi, " ")
        .replace(INLINE_SYSTEM_MARKER_RE, " ")
        .replace(/<bettershape_action\b[^>]*\/?>/gi, " ")
        .replace(
            /<edit\b([^>]*)>[\s\S]*?<\/edit>/gi,
            (_match, attrs: string) => {
                const fileMatch = attrs.match(/\bfile=["']([^"']+)["']/i);
                return fileMatch?.[1] ? ` ${fileMatch[1]} ` : " ";
            },
        )
        .replace(
            /<cat\b([^>]*)>([\s\S]*?)<\/cat>/gi,
            (_match, attrs: string, inner: string) => {
                const pathMatch = attrs.match(/\bpath=["']([^"']+)["']/i);
                if (pathMatch?.[1]) return ` ${pathMatch[1]} `;
                const trimmedInner = inner.trim();
                return trimmedInner ? ` ${trimmedInner} ` : " ";
            },
        );

/** Parse markdown fence line. */
const parseMarkdownFenceLine = (
    line: string,
): { char: string; length: number; rest: string } | null => {
    let idx = 0;
    while (idx < 4 && idx < line.length && line.charCodeAt(idx) === 32) idx += 1;
    if (idx > 3 || idx >= line.length) return null;
    const ch = line.charAt(idx);
    if (ch !== "`" && ch !== "~") return null;
    let fenceEnd = idx;
    while (fenceEnd < line.length && line.charAt(fenceEnd) === ch) fenceEnd += 1;
    const runLen = fenceEnd - idx;
    if (runLen < 3) return null;
    return { char: ch, length: runLen, rest: line.slice(fenceEnd) };
};

/**
 * Strips hidden agent control tags while keeping prose, fenced code, tool output,
 * and edited file paths searchable.
 */
export const extractSearchableMessageText = (raw: string): string => {
    if (!raw) return "";
    const normalized = raw.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    const out: string[] = [];
    const proseBuf: string[] = [];
    let fenceChar = "";
    let fenceLen = 0;

    for (const line of lines) {
        const fence = parseMarkdownFenceLine(line);
        if (!fenceChar && fence) {
            if (proseBuf.length > 0) {
                out.push(stripControlTagsSlice(proseBuf.join("\n")));
                proseBuf.length = 0;
            }
            fenceChar = fence.char;
            fenceLen = fence.length;
            out.push(line);
        } else if (
            fenceChar &&
            fence &&
            fence.char === fenceChar &&
            fence.length >= fenceLen &&
            fence.rest.trim().length === 0
        ) {
            fenceChar = "";
            fenceLen = 0;
            out.push(line);
        } else if (fenceChar) {
            out.push(line);
        } else {
            proseBuf.push(line);
        }
    }
    if (proseBuf.length > 0) {
        out.push(stripControlTagsSlice(proseBuf.join("\n")));
    }
    return out.join("\n").trim();
};

/** Build match snippet. */
const buildMatchSnippet = (text: string, start: number, end: number, radius = 36): string => {
    const left = Math.max(0, start - radius);
    const right = Math.min(text.length, end + radius);
    const prefix = left > 0 ? "…" : "";
    const suffix = right < text.length ? "…" : "";
    return `${prefix}${text.slice(left, right).replace(/\s+/g, " ").trim()}${suffix}`;
};

/** Escape reg exp. */
const escapeRegExp = (literal: string): string => {
    return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/** Finds literal matches across user and assistant messages with snippet previews. */
export const findTranscriptMatches = (
    messages: ReadonlyArray<{ role?: string; content?: string }>,
    query: string,
    optionsOrMax: number | TranscriptSearchOptions = 500,
): TranscriptMatch[] => {
    const opts: TranscriptSearchOptions =
        typeof optionsOrMax === "number" ? { maxMatches: optionsOrMax } : optionsOrMax;
    const caseSensitive = Boolean(opts.caseSensitive);
    const maxMatches = opts.maxMatches ?? 500;
    const trimmedQuery = query.trim();
    if (!trimmedQuery || maxMatches <= 0 || messages.length === 0) return [];

    const results: TranscriptMatch[] = [];
    const matcher = new RegExp(escapeRegExp(trimmedQuery), caseSensitive ? "g" : "gi");

    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
        const msg = messages[messageIndex];
        const role = msg?.role ?? "assistant";
        if (role !== "user" && role !== "assistant") continue;
        const clean = extractSearchableMessageText(msg?.content ?? "");
        if (!clean) continue;

        matcher.lastIndex = 0;
        let occurrence = 0;
        let match = matcher.exec(clean);
        while (match !== null) {
            const found = match.index;
            const matchedLen = match[0].length;
            if (matchedLen === 0) {
                matcher.lastIndex += 1;
                match = matcher.exec(clean);
                continue;
            }
            results.push({
                messageIndex,
                role,
                occurrenceInMessage: occurrence,
                start: found,
                end: found + matchedLen,
                snippet: buildMatchSnippet(clean, found, found + matchedLen),
            });
            occurrence += 1;
            if (results.length >= maxMatches) return results;
            match = matcher.exec(clean);
        }
    }

    return results;
};
