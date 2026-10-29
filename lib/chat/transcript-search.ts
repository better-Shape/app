/**
 * Searchable text extraction and match indexing for in-conversation find.
 */

import { type AngleMatchReplacement, scanMarkdownOutsideCode } from "./export-markdown";

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

type PairedTagFormatter = (openTag: string, inner: string) => string;

const HIDDEN_PAIRED_TAG_NAMES = [
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
    "thinking",
    "thought",
    "think",
    "analysis",
    "rename_chat",
    "todos",
] as const;

const SELF_CLOSING_MARKER_TAGS = new Set(["chat_renamed", "forked_from"]);
const TAG_BOUNDARY_CHARS = new Set([">", " ", "\t", "\n", "\r", "/"]);
const ATTR_QUOTES = new Set(['"', "'"]);
const UNQUOTED_TAG_OUTCOMES: Partial<Record<string, 1 | -1>> = {
    ">": 1,
    "<": -1,
};

const LOWER_TAG_NAME_CHARS = new Set(
    "abcdefghijklmnopqrstuvwxyz0123456789_:-",
);
const SENT_FILE_TITLE_ATTR_RE = /\btitle=(["'])([^"']*)\1/i;
const SENT_FILE_NAME_ATTR_RE = /\bname=(["'])([^"']*)\1/i;
const ATTACHMENT_TYPE_ATTR_RE = /\btype=(["'])([^"']*)\1/i;
const ATTACHMENT_XML_ENC_RE = /\bname_encoding=(["'])xml\1/i;
const EDIT_FILE_ATTR_RE = /\bfile=(["'])([^"']*)\1/i;
const CAT_PATH_ATTR_RE = /\bpath=(["'])([^"']*)\1/i;

/** Decodes basic XML entities inside an extracted tag attribute value. */
export const decodeBasicXmlEntities = (raw: string): string =>
    raw
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");

/** Reads the raw attribute value matched by `attrRe` from `openTag`, or `""`. */
const readRawTagAttr = (openTag: string, attrRe: RegExp): string =>
    openTag.match(attrRe)?.[2] ?? "";

/** Reads and XML-decodes an attribute matched by `attrRe` from `openTag`. */
const readDecodedTagAttr = (openTag: string, attrRe: RegExp): string => {
    const raw = readRawTagAttr(openTag, attrRe);
    return raw ? decodeBasicXmlEntities(raw).trim() : "";
};

/** Checks whether an attachment payload contains an inline `data:` URL thumbnail. */
const hasInlineAttachmentDataUrl = (
    isAssetTag: boolean,
    inner: string,
): boolean => {
    const trimmed = inner.trim();
    if (trimmed.startsWith("data:")) return true;
    if (!isAssetTag) return false;
    return trimmed
        .slice(trimmed.lastIndexOf("\n") + 1)
        .trim()
        .startsWith("data:");
};

/** Checks whether a user attachment renders as an `<img>` thumbnail rather than a text pill. */
const rendersAsImageThumb = (
    tagKind: "image" | "file" | "asset",
    openTag: string,
    inner: string,
): boolean => {
    const mime = readRawTagAttr(openTag, ATTACHMENT_TYPE_ATTR_RE).toLowerCase();
    const isImage = tagKind === "image" || mime.startsWith("image/");
    return isImage && hasInlineAttachmentDataUrl(tagKind === "asset", inner);
};

/** Formats the visible pill filename rendered by `<SentAttachment>` for search indexing. */
const formatUserAttachmentSearchLabel = (
    tagKind: "image" | "file" | "asset",
    openTag: string,
    inner: string,
): string => {
    if (rendersAsImageThumb(tagKind, openTag, inner)) return " ";
    const rawName =
        readRawTagAttr(openTag, SENT_FILE_NAME_ATTR_RE) || "attachment";
    const name = ATTACHMENT_XML_ENC_RE.test(openTag)
        ? decodeBasicXmlEntities(rawName)
        : rawName;
    return ` ${name} `;
};

/** Joins `a` and `b` with a space, deduplicating empty or identical values. */
const joinDistinctLabels = (a: string, b: string): string => {
    if (!a) return b;
    return !b || a === b ? a : `${a} ${b}`;
};

/** Formats the visible heading and filename rendered by `<SentFileCard>` for search indexing. */
const formatSentFileSearchLabel = (openTag: string): string => {
    const label = joinDistinctLabels(
        readDecodedTagAttr(openTag, SENT_FILE_TITLE_ATTR_RE),
        readDecodedTagAttr(openTag, SENT_FILE_NAME_ATTR_RE),
    );
    return label ? ` ${label} ` : " ";
};

/** Formats the edited file path rendered by `<edit file="...">` for search indexing. */
const formatEditSearchLabel = (openTag: string): string => {
    const filePath = readDecodedTagAttr(openTag, EDIT_FILE_ATTR_RE);
    return filePath ? ` ${filePath} ` : " ";
};

/** Formats the file path rendered by `<cat path="...">` for search indexing. */
const formatCatSearchLabel = (openTag: string, inner: string): string => {
    const label = readDecodedTagAttr(openTag, CAT_PATH_ATTR_RE) || inner.trim();
    return label ? ` ${label} ` : " ";
};

const PAIRED_TAG_FORMATTERS: ReadonlyMap<string, PairedTagFormatter> = new Map<
    string,
    PairedTagFormatter
>([
    ...HIDDEN_PAIRED_TAG_NAMES.map((tag): [string, PairedTagFormatter] => [
        tag,
        () => " ",
    ]),
    [
        "attached_image",
        (openTag, inner) =>
            formatUserAttachmentSearchLabel("image", openTag, inner),
    ],
    [
        "attached_file",
        (openTag, inner) =>
            formatUserAttachmentSearchLabel("file", openTag, inner),
    ],
    [
        "attached_asset",
        (openTag, inner) =>
            formatUserAttachmentSearchLabel("asset", openTag, inner),
    ],
    ["sent_file", (openTag) => formatSentFileSearchLabel(openTag)],
    ["edit", (openTag) => formatEditSearchLabel(openTag)],
    ["cat", formatCatSearchLabel],
]);

/** Reads a lowercase XML tag name immediately after `<` at `offset`, or `""` if invalid. */
const readLowerTagNameAt = (lower: string, offset: number): string => {
    let end = offset + 1;
    while (LOWER_TAG_NAME_CHARS.has(lower.charAt(end))) {
        end += 1;
    }
    if (end === offset + 1) return "";
    return TAG_BOUNDARY_CHARS.has(lower.charAt(end))
        ? lower.slice(offset + 1, end)
        : "";
};

/** Advances attribute quote state (`""`, `'"'`, or `"'"`) for one tag-header character. */
const nextAttrQuoteState = (quote: string, ch: string): string => {
    if (quote) return ch === quote ? "" : quote;
    return ATTR_QUOTES.has(ch) ? ch : "";
};

/** Classifies one tag-header character (`1` hit `>`, `-1` abort, `0` continue). */
const classifyOpenTagChar = (quote: string, ch: string): 1 | -1 | 0 => {
    if (quote) return ch === "\n" ? -1 : 0;
    return UNQUOTED_TAG_OUTCOMES[ch] ?? 0;
};

/** Finds the closing `>` of an opening XML tag starting at `from`, or `-1` if malformed. */
const findOpenTagCloseGt = (source: string, from: number): number => {
    let quote = "";
    for (let idx = from; idx < source.length; idx += 1) {
        const ch = source.charAt(idx);
        const status = classifyOpenTagChar(quote, ch);
        if (status !== 0) return status === 1 ? idx : -1;
        quote = nextAttrQuoteState(quote, ch);
    }
    return -1;
};

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

/** Finds the next valid `</tag>` closer at or after `from`, returning `[closeStart, closeEnd]`. */
const findNextCloseTagBounds = (
    lower: string,
    closePrefix: string,
    from: number,
): readonly [number, number] | null => {
    let idx = lower.indexOf(closePrefix, from);
    while (idx !== -1) {
        const afterName = idx + closePrefix.length;
        const gt = lower.indexOf(">", afterName);
        if (gt === -1) return null;
        if (/^[ \t\r\n]*$/u.test(lower.slice(afterName, gt))) {
            return [idx, gt + 1];
        }
        idx = lower.indexOf(closePrefix, afterName);
    }
    return null;
};

/** Counts non-self-closing nested `<tag ...>` openers inside `lower[from..limit)`. */
const countNestedOpenersBefore = (
    source: string,
    lower: string,
    openPrefix: string,
    from: number,
    limit: number,
): number => {
    let added = 0;
    let openIdx = findNextOpenTagAt(lower, openPrefix, from);
    while (openIdx !== -1 && openIdx < limit) {
        const gt = findOpenTagCloseGt(source, openIdx + openPrefix.length);
        if (gt === -1) break;
        added += Number(source.charAt(gt - 1) !== "/");
        openIdx = findNextOpenTagAt(lower, openPrefix, gt + 1);
    }
    return added;
};

/** Finds balanced `[closeStart, closeEnd]` for `<tag>` opened at `afterOpenGt`, or `null`. */
const findBalancedPairedClose = (
    source: string,
    lower: string,
    afterOpenGt: number,
    tag: string,
): readonly [number, number] | null => {
    const openPrefix = `<${tag}`;
    const closePrefix = `</${tag}`;
    let depth = 1;
    let cursor = afterOpenGt;
    while (depth > 0) {
        const close = findNextCloseTagBounds(lower, closePrefix, cursor);
        if (!close) return null;
        depth +=
            countNestedOpenersBefore(source, lower, openPrefix, cursor, close[0]) - 1;
        cursor = close[1];
        if (depth === 0) return close;
    }
    return null;
};

/** Matches `<chat_renamed .../>`, `<forked_from .../>`, or `<bettershape_action ...>` at `openGt`. */
const matchInlineActionTag = (
    source: string,
    tagName: string,
    openGt: number,
): AngleMatchReplacement | null => {
    if (tagName === "bettershape_action") {
        return { replacement: " ", end: openGt + 1 };
    }
    if (!SELF_CLOSING_MARKER_TAGS.has(tagName)) return null;
    return source.charAt(openGt - 1) === "/"
        ? { replacement: " ", end: openGt + 1 }
        : null;
};

/** Matches a paired control/tool tag opened at `[offset, openGt]` across any inner fences. */
const matchPairedControlTag = (
    source: string,
    lower: string,
    tagName: string,
    offset: number,
    openGt: number,
    formatter: PairedTagFormatter,
): AngleMatchReplacement | null => {
    const openTag = source.slice(offset, openGt + 1);
    if (source.charAt(openGt - 1) === "/") {
        return { replacement: formatter(openTag, ""), end: openGt + 1 };
    }
    const close = findBalancedPairedClose(source, lower, openGt + 1, tagName);
    if (!close) return null;
    return {
        replacement: formatter(openTag, source.slice(openGt + 1, close[0])),
        end: close[1],
    };
};

/** Matches any hidden or summarized control/tool XML block starting at top-level `<` `offset`. */
const matchTranscriptControlTagAt = (
    source: string,
    lower: string,
    offset: number,
): AngleMatchReplacement | null => {
    const tagName = readLowerTagNameAt(lower, offset);
    if (!tagName) return null;
    const openGt = findOpenTagCloseGt(source, offset + 1 + tagName.length);
    if (openGt === -1) return null;
    const pairedFormatter = PAIRED_TAG_FORMATTERS.get(tagName);
    return pairedFormatter
        ? matchPairedControlTag(source, lower, tagName, offset, openGt, pairedFormatter)
        : matchInlineActionTag(source, tagName, openGt);
};

/**
 * Strips hidden agent control tags while keeping prose, fenced code, tool output,
 * and edited file paths searchable.
 */
export const extractSearchableMessageText = (raw: string): string => {
    if (!raw) return "";
    const normalized = raw.replace(/\r\n?/g, "\n");
    const lower = normalized.replace(/[A-Z]/gu, (ch) => ch.toLowerCase());
    return scanMarkdownOutsideCode(normalized, (src, offset) =>
        matchTranscriptControlTagAt(src, lower, offset),
    ).trim();
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

export type WebSearchResultItem = {
    title: string;
    url: string;
    snippet: string;
};

/** Extracts the trimmed remainder of the first line containing `prefix`, or `null`. */
const extractFirstPrefixedLine = (
    block: string,
    prefix: string,
): string | null => {
    const idx = block.indexOf(prefix);
    if (idx === -1) return null;
    const start = idx + prefix.length;
    const lineEnd = block.indexOf("\n", start);
    const raw =
        lineEnd === -1 ? block.slice(start) : block.slice(start, lineEnd);
    return raw.trim();
};

/** Removes the first `prefix...` single-line entry (excluding its trailing `\r\n`/`\n`) from `block`. */
const stripFirstPrefixedLine = (block: string, prefix: string): string => {
    const idx = block.indexOf(prefix);
    if (idx === -1) return block;
    const lineEnd = block.indexOf("\n", idx + prefix.length);
    if (lineEnd === -1) return block.slice(0, idx);
    const end = block.charAt(lineEnd - 1) === "\r" ? lineEnd - 1 : lineEnd;
    return `${block.slice(0, idx)}${block.slice(end)}`;
};

/** Parses a single `---`-delimited web search result section when a title or URL is present. */
const parseSingleWebResultSection = (
    block: string,
): WebSearchResultItem | null => {
    const title = extractFirstPrefixedLine(block, "### ");
    const url = extractFirstPrefixedLine(block, "URL:");
    if (title === null && url === null) return null;
    const withoutTitle = stripFirstPrefixedLine(block, "### ");
    const snippet = stripFirstPrefixedLine(withoutTitle, "URL:").trim();
    return {
        title: title !== null ? title : "Result",
        url: url !== null ? url : "",
        snippet,
    };
};

/** Parses `<web_result>` markdown sections into structured citation items. */
export const parseWebResults = (
    blockContent: string,
): WebSearchResultItem[] => {
    const results: WebSearchResultItem[] = [];
    for (const block of blockContent.split("---")) {
        if (!block) continue;
        const parsed = parseSingleWebResultSection(block);
        if (parsed) results.push(parsed);
    }
    return results;
};

