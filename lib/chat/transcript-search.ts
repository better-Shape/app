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

/**
 * Strips hidden agent control tags while keeping prose, fenced code, tool output,
 * and edited file paths searchable.
 */
export function extractSearchableMessageText(raw: string): string {
    if (!raw) return "";
    return raw
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
            /<cat\b([^>]*)>[\s\S]*?<\/cat>/gi,
            (_match, attrs: string) => {
                const pathMatch = attrs.match(/\bpath=["']([^"']+)["']/i);
                return pathMatch?.[1] ? ` ${pathMatch[1]} ` : " ";
            },
        )
        .replace(/\r\n/g, "\n")
        .trim();
}

function buildMatchSnippet(text: string, start: number, end: number, radius = 36): string {
    const left = Math.max(0, start - radius);
    const right = Math.min(text.length, end + radius);
    const prefix = left > 0 ? "…" : "";
    const suffix = right < text.length ? "…" : "";
    return `${prefix}${text.slice(left, right).replace(/\s+/g, " ").trim()}${suffix}`;
}

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
    const needle = caseSensitive ? trimmedQuery : trimmedQuery.toLowerCase();
    if (!needle || messages.length === 0) return [];

    const results: TranscriptMatch[] = [];
    const step = Math.max(1, needle.length);

    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
        const msg = messages[messageIndex];
        const role = msg?.role ?? "assistant";
        if (role !== "user" && role !== "assistant") continue;
        const clean = extractSearchableMessageText(msg?.content ?? "");
        if (!clean) continue;

        const hay = caseSensitive ? clean : clean.toLowerCase();
        let cursor = 0;
        let occurrence = 0;
        while (cursor <= hay.length - needle.length) {
            const found = hay.indexOf(needle, cursor);
            if (found === -1) break;
            results.push({
                messageIndex,
                role,
                occurrenceInMessage: occurrence,
                start: found,
                end: found + needle.length,
                snippet: buildMatchSnippet(clean, found, found + needle.length),
            });
            occurrence += 1;
            if (results.length >= maxMatches) return results;
            cursor = found + step;
        }
    }

    return results;
}
