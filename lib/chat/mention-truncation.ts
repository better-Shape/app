/**
 * How much of a referenced file reaches the model.
 *
 * Settings -> AI -> Max context lines is the user's answer to "how much of each
 * file is sent with a turn". The character ceiling stays as a backstop: a
 * minified bundle has 200 "lines" that are still megabytes.
 */
export const MENTION_CHAR_LIMIT = 4000;

export const DEFAULT_MAX_CONTEXT_LINES = 200;

export function maxContextLineLimit(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : DEFAULT_MAX_CONTEXT_LINES;
}

/** Cuts `content` to `maxLines` lines and returns null when nothing was dropped. */
export function truncateMentionContent(content: string, maxLines: unknown): string | null {
    const limit = maxContextLineLimit(maxLines);
    const lines = content.split("\n");
    let body = lines.length > limit ? lines.slice(0, limit).join("\n") : content;
    let cut = body !== content;
    if (body.length > MENTION_CHAR_LIMIT) {
        body = body.slice(0, MENTION_CHAR_LIMIT);
        cut = true;
    }
    return cut ? `${body}\n…(truncated)` : null;
}
