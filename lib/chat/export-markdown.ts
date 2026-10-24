/**
 * Clean Markdown serializer for copying or exporting a chat transcript.
 */

import { formatMessageModelLabel, isAutoModelId } from "./usage-display";

function cleanMessageBodyForMarkdown(raw: string, role: "user" | "assistant"): string {
    if (!raw) return "";
    const attachmentNotes: string[] = [];
    const withoutAttachments = raw.replace(
        /<attached_(image|file|asset)\b([^>]*)>[\s\S]*?<\/attached_\1>/gi,
        (_m, kind: string, attrs: string) => {
            const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i);
            const label = nameMatch?.[1]?.trim() || kind;
            attachmentNotes.push(`_Attached: \`${label}\`_`);
            return "";
        },
    );

    const stripped =
        role === "assistant"
            ? withoutAttachments
                  .replace(
                      /<(?:think|thought|thinking|analysis)\b[^>]*>[\s\S]*?<\/(?:think|thought|thinking|analysis)>/gi,
                      "",
                  )
                  .replace(/<rename_chat\b[^>]*>[\s\S]*?<\/rename_chat>/gi, "")
                  .replace(/<todos\b[^>]*>[\s\S]*?<\/todos>/gi, "")
                  .replace(/<bettershape_action\b[^>]*\/?>/gi, "")
                  .replace(/<edit\b([^>]*)>[\s\S]*?<\/edit>/gi, (_m, attrs: string) => {
                      const fileMatch = attrs.match(/\bfile=["']([^"']+)["']/i);
                      const path = fileMatch && fileMatch[1] ? fileMatch[1].trim() : "";
                      return path ? `\n> Edited \`${path}\`\n` : "";
                  })
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
