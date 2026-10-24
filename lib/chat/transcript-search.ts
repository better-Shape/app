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

/** Strips hidden agent control tags on a non-fenced text slice. */
const stripControlTagsSlice = (segment: string): string =>
    segment
        .replace(/<attached_(?:image|file|asset)\b[^>]*>[\s\S]*?<\/attached_(?:image|file|asset)>/gi, " ")
        .replace(/<(?:thinking|analysis)\b[^>]*>[\s\S]*?<\/(?:thinking|analysis)>/gi, " ")
        .replace(/<rename_chat\b[^>]*>[\s\S]*?<\/rename_chat>/gi, " ")
        .replace(/<todos\b[^>]*>[\s\S]*?<\/todos>/gi, " ")
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

/**
 * Strips hidden agent control tags while keeping prose, fenced code, tool output,
 * and edited file paths searchable.
 */
export function extractSearchableMessageText(raw: string): string {
    if (!raw) return "";
    const normalized = raw.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    const out: string[] = [];
    const proseBuf: string[] = [];
    let fenceChar = "";
    let fenceLen = 0;

    for (const line of lines) {
        const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        const marker = fenceMatch?.[1];
        const rest = fenceMatch?.[2] ?? "";
        if (!fenceChar && marker) {
            if (proseBuf.length > 0) {
                out.push(stripControlTagsSlice(proseBuf.join("\n")));
                proseBuf.length = 0;
            }
            fenceChar = marker.charAt(0);
            fenceLen = marker.length;
            out.push(line);
        } else if (
            fenceChar &&
            marker &&
            marker.charAt(0) === fenceChar &&
            marker.length >= fenceLen &&
            /^[ \t]*$/.test(rest)
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
}

function buildMatchSnippet(text: string, start: number, end: number, radius = 36): string {
    const left = Math.max(0, start - radius);
    const right = Math.min(text.length, end + radius);
    const prefix = left > 0 ? "…" : "";
    const suffix = right < text.length ? "…" : "";
    return `${prefix}${text.slice(left, right).replace(/\s+/g, " ").trim()}${suffix}`;
}

function escapeRegExp(literal: string): string {
    return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Finds literal matches across user and assistant messages with snippet previews. */
export function findTranscriptMatches(
    messages: ReadonlyArray<{ role?: string; content?: string }>,
    query: string,
    optionsOrMax: number | TranscriptSearchOptions = 500,
): TranscriptMatch[] {
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
        let match: RegExpExecArray | null;
        while ((match = matcher.exec(clean)) !== null) {
            const found = match.index;
            const matchedLen = match[0].length;
            if (matchedLen === 0) {
                matcher.lastIndex += 1;
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
        }
    }

    return results;
}
