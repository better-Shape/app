/**
 * Clean Markdown serializer for copying or exporting a chat transcript.
 */

import { formatMessageModelLabel, isAutoModelId } from "./usage-display";

const stripAssistantProseSlice = (segment: string): string =>
    segment
        .replace(
            /<(thinking|thought|think|analysis)\b[^>]*>[\s\S]*?<\/\1>/gi,
            "",
        )
        .replace(/<rename_chat\b[^>]*>[\s\S]*?<\/rename_chat>/gi, "")
        .replace(/<todos\b[^>]*>[\s\S]*?<\/todos>/gi, "")
        .replace(/<bettershape_action\b[^>]*\/?>/gi, "")
        .replace(/<edit\b([^>]*)>[\s\S]*?<\/edit>/gi, (_m, attrs: string) => {
            const fileMatch = attrs.match(/\bfile=["']([^"']+)["']/i);
            const path = fileMatch ? fileMatch[1].trim() : "";
            return path ? `\n> Edited \`${path}\`\n` : "";
        });

/** Transforms non-code prose while preserving inline backtick spans verbatim. */
const transformOutsideInlineCode = (
    prose: string,
    transform: (segment: string) => string,
): string => {
    const out: string[] = [];
    let cursor = 0;
    const inlineCodeRe = /(`+)([^`]*?)\1/g;
    let match: RegExpExecArray | null = inlineCodeRe.exec(prose);
    while (match !== null) {
        if (match.index > cursor) {
            out.push(transform(prose.slice(cursor, match.index)));
        }
        out.push(match[0]);
        cursor = match.index + match[0].length;
        match = inlineCodeRe.exec(prose);
    }
    if (cursor < prose.length) {
        out.push(transform(prose.slice(cursor)));
    }
    return out.join("");
};

/** Parses a Markdown code-fence delimiter line when present. */
const parseFenceLine = (line: string): { char: string; len: number; hasRest: boolean } | null => {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fenceMatch) return null;
    const marker = fenceMatch[1];
    return {
        char: marker[0],
        len: marker.length,
        hasRest: fenceMatch[2].trim().length > 0,
    };
};

/** True when `parsed` closes an open code fence matching `fenceChar` and `fenceLen`. */
const isClosingFence = (
    parsed: { char: string; len: number; hasRest: boolean } | null,
    fenceChar: string,
    fenceLen: number,
): boolean => Boolean(parsed && parsed.char === fenceChar && parsed.len >= fenceLen && !parsed.hasRest);

/** Transforms non-code prose while preserving fenced code blocks and inline code spans. */
const transformOutsideCodeBlocks = (
    source: string,
    transform: (segment: string) => string,
): string => {
    const lines = source.replace(/\r\n/g, "\n").split("\n");
    const out: string[] = [];
    const proseBuf: string[] = [];
    let fenceChar = "";
    let fenceLen = 0;

    const flushProse = () => {
        if (proseBuf.length === 0) return;
        out.push(transformOutsideInlineCode(proseBuf.join("\n"), transform));
        proseBuf.length = 0;
    };

    for (const line of lines) {
        const parsed = parseFenceLine(line);
        if (!fenceChar && parsed) {
            flushProse();
            fenceChar = parsed.char;
            fenceLen = parsed.len;
            out.push(line);
        } else if (fenceChar && isClosingFence(parsed, fenceChar, fenceLen)) {
            fenceChar = "";
            fenceLen = 0;
            out.push(line);
        } else if (fenceChar) {
            out.push(line);
        } else {
            proseBuf.push(line);
        }
    }
    flushProse();
    return out.join("\n");
};

function cleanMessageBodyForMarkdown(raw: string, role: "user" | "assistant"): string {
    if (!raw) return "";
    const attachmentNotes: string[] = [];
    const withoutAttachments = transformOutsideCodeBlocks(raw, (segment) =>
        segment.replace(
            /<attached_(image|file|asset)\b([^>]*)>[\s\S]*?<\/attached_\1>/gi,
            (_m, kind: string, attrs: string) => {
                const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i);
                const label = nameMatch?.[1]?.trim() || kind;
                attachmentNotes.push(`_Attached: \`${label}\`_`);
                return "";
            },
        ),
    );

    const stripped =
        role === "assistant"
            ? transformOutsideCodeBlocks(withoutAttachments, stripAssistantProseSlice)
            : withoutAttachments;

    const cleaned = stripped
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (attachmentNotes.length === 0) return cleaned;
    return [attachmentNotes.join(" · "), cleaned].filter(Boolean).join("\n\n");
}

/** Formats a conversation title and message array into a clean Markdown document. */
export function formatTranscriptAsMarkdown(
    title: string,
    messages: ReadonlyArray<{ role?: string; content?: string; model?: string }>,
): string {
    const heading = (title || "").trim() || "Chat transcript";
    const sections: string[] = [`# ${heading}`];

    for (const msg of messages) {
        if (msg.role !== "user" && msg.role !== "assistant") continue;
        const body = cleanMessageBodyForMarkdown(msg.content ?? "", msg.role);
        if (!body) continue;

        if (msg.role === "user") {
            sections.push(`## You\n\n${body}`);
        } else {
            const modelTag =
                msg.model && !isAutoModelId(msg.model)
                    ? ` (${formatMessageModelLabel(msg.model)})`
                    : "";
            sections.push(`## Assistant${modelTag}\n\n${body}`);
        }
    }

    return `${sections.join("\n\n---\n\n")}\n`;
}

/** Produces a filesystem-safe `.md` filename from a conversation title. */
export function slugifyTranscriptFilename(title: string): string {
    const slug = (title || "chat")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    return `${slug || "chat"}-transcript.md`;
}
