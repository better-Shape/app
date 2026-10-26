/**
 * Boundary-aware composer prompt history recall, undo-safe textarea insertion,
 * and smart URL paste helpers.
 */

export interface PromptHistoryCursor {
    /** Index into `prompts` (0 = most recent sent prompt). */
    index: number;
    /** Unsent composer draft preserved before entering history recall. */
    stashedDraft: string;
    /** Exact recalled string placed into the composer at `index`. */
    recalledValue: string;
}

const HTTP_URL_RE = /^https?:\/\/[^\s<>()]+$/i;

/**
 * Extracts deduplicated user prompts in newest-first order, stripping inline
 * attachment XML payloads so recalled prompts stay clean in the textarea.
 */
export const extractCleanUserPrompts = (
    messages: ReadonlyArray<{ role?: string; content?: string }>,
    extraRecent: ReadonlyArray<string> = [],
    maxCount = 50,
): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();

    const pushClean = (raw: string | undefined) => {
        if (!raw) return;
        const cleaned = raw
            .replace(/<attached_(?:image|file|asset)\b[^>]*>[\s\S]*?<\/attached_(?:image|file|asset)>\n*/gi, "")
            .trim();
        if (!cleaned || seen.has(cleaned)) return;
        seen.add(cleaned);
        out.push(cleaned);
    };

    for (let i = extraRecent.length - 1; i >= 0 && out.length < maxCount; i--) {
        pushClean(extraRecent[i]);
    }

    for (let i = messages.length - 1; i >= 0 && out.length < maxCount; i--) {
        const msg = messages[i];
        if (msg?.role !== "user") continue;
        pushClean(msg.content);
    }

    return out;
};

/**
 * Merges already newest-first prompt history with chronological in-session
 * sent prompts (where `extraChronological[last]` is most recent), deduplicating
 * while preserving newest-first recall order.
 */
export const mergeNewestFirstPrompts = (
    newestFirstPrompts: ReadonlyArray<string>,
    extraChronological: ReadonlyArray<string> = [],
    maxCount = 50,
): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();

    const pushClean = (raw: string | undefined) => {
        if (!raw) return;
        const cleaned = raw
            .replace(/<attached_(?:image|file|asset)\b[^>]*>[\s\S]*?<\/attached_(?:image|file|asset)>\n*/gi, "")
            .trim();
        if (!cleaned || seen.has(cleaned)) return;
        seen.add(cleaned);
        out.push(cleaned);
    };

    for (let i = extraChronological.length - 1; i >= 0 && out.length < maxCount; i--) {
        pushClean(extraChronological[i]);
    }

    for (let i = 0; i < newestFirstPrompts.length && out.length < maxCount; i++) {
        pushClean(newestFirstPrompts[i]);
    }

    return out;
};

/** Returns true when a collapsed caret sits on the first logical line of `value`. */
export const isCaretOnFirstLogicalLine = (
    value: string,
    selectionStart: number | null | undefined,
    selectionEnd: number | null | undefined,
): boolean => {
    const start = selectionStart ?? 0;
    const end = selectionEnd ?? start;
    if (start !== end) return false;
    return value.lastIndexOf("\n", Math.max(0, start - 1)) === -1 || start === 0;
};

/** Returns true when a collapsed caret sits on the last logical line of `value`. */
export const isCaretOnLastLogicalLine = (
    value: string,
    selectionStart: number | null | undefined,
    selectionEnd: number | null | undefined,
): boolean => {
    const start = selectionStart ?? value.length;
    const end = selectionEnd ?? start;
    if (start !== end) return false;
    return value.indexOf("\n", start) === -1;
};

/**
 * True when pressing `ArrowUp` should enter or continue prompt-history browsing:
 * - Empty composer recalls immediately.
 * - Non-empty draft enters history recall when caret is already at index 0 (`0..0`),
 *   so pressing `ArrowUp` once moves to start-of-draft and pressing again stashes
 *   the unsent draft and recalls the previous sent prompt.
 * - Once browsing an unedited recalled prompt, anywhere on the first logical line steps older.
 */
export const canStepPromptHistoryUp = (
    cursor: PromptHistoryCursor | null,
    currentValue: string,
    selectionStart: number | null | undefined,
    selectionEnd: number | null | undefined,
): boolean => {
    const start = selectionStart ?? 0;
    const end = selectionEnd ?? start;
    if (start !== end) return false;
    if (currentValue.length === 0) return true;
    if (cursor && currentValue === cursor.recalledValue) {
        return isCaretOnFirstLogicalLine(currentValue, start, end);
    }
    return start === 0;
};

/**
 * True when the user has not typed custom edits on top of the recalled prompt,
 * making it safe for `ArrowDown` or `Escape` to restore newer prompts / `stashedDraft`.
 */
export const isUnmodifiedHistoryRecall = (
    cursor: PromptHistoryCursor | null,
    currentValue: string,
): cursor is PromptHistoryCursor => {
    return cursor !== null && currentValue === cursor.recalledValue;
};

/** Steps one entry older in `prompts`, stashing `currentValue` on initial entry. */
export const stepPromptHistoryUp = (
    cursor: PromptHistoryCursor | null,
    currentValue: string,
    prompts: ReadonlyArray<string>,
): { cursor: PromptHistoryCursor; value: string } | null => {
    if (prompts.length === 0) return null;
    if (!cursor) {
        const value = prompts.at(0);
        if (value === undefined) return null;
        return {
            cursor: { index: 0, stashedDraft: currentValue, recalledValue: value },
            value,
        };
    }
    const nextIndex = Math.min(cursor.index + 1, prompts.length - 1);
    if (nextIndex === cursor.index) return null;
    const value = prompts.at(nextIndex);
    if (value === undefined) return null;
    return {
        cursor: { index: nextIndex, stashedDraft: cursor.stashedDraft, recalledValue: value },
        value,
    };
};

/** Steps one entry newer in `prompts`, restoring `stashedDraft` past index `0`. */
export const stepPromptHistoryDown = (
    cursor: PromptHistoryCursor | null,
    prompts: ReadonlyArray<string>,
): { cursor: PromptHistoryCursor | null; value: string } | null => {
    if (!cursor) return null;
    if (cursor.index <= 0 || prompts.length === 0) {
        return {
            cursor: null,
            value: cursor.stashedDraft,
        };
    }
    const nextIndex = Math.min(cursor.index - 1, prompts.length - 1);
    const value = prompts[nextIndex] ?? cursor.stashedDraft;
    return {
        cursor: { index: nextIndex, stashedDraft: cursor.stashedDraft, recalledValue: value },
        value,
    };
};

/**
 * Wraps a non-empty single-line text selection into `[selection](url)` when
 * pasting a standalone HTTP(S) URL. Returns `null` when normal paste applies.
 */
export const tryWrapMarkdownLinkOnPaste = (
    value: string,
    selectionStart: number | null | undefined,
    selectionEnd: number | null | undefined,
    pastedText: string,
): {
    start: number;
    end: number;
    replacement: string;
    nextValue: string;
    nextCaret: number;
} | null => {
    const start = selectionStart ?? 0;
    const end = selectionEnd ?? start;
    if (start >= end) return null;

    const url = pastedText.trim();
    if (!HTTP_URL_RE.test(url)) return null;

    const selected = value.slice(start, end);
    if (!selected.trim() || selected.includes("\n") || selected.includes("\r")) return null;
    if (HTTP_URL_RE.test(selected.trim())) return null;
    if (selected.includes("[") || selected.includes("]")) return null;

    // Skip if selection overlaps any existing `[label](...)` Markdown link on the same line.
    const charBefore = start > 0 ? value[start - 1] : "";
    const afterSlice = value.slice(end, end + 2);
    if (charBefore === "[" && afterSlice.startsWith("](")) return null;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const nextNewline = value.indexOf("\n", end);
    const lineEnd = nextNewline === -1 ? value.length : nextNewline;
    const lineSlice = value.slice(lineStart, lineEnd);
    let scanPos = 0;
    while (scanPos < lineSlice.length) {
        const closeAndParen = lineSlice.indexOf("](", scanPos);
        if (closeAndParen === -1) break;
        const openBracket = lineSlice.lastIndexOf("[", closeAndParen - 1);
        const closeParen = lineSlice.indexOf(")", closeAndParen + 2);
        if (
            openBracket >= scanPos &&
            closeParen !== -1 &&
            !lineSlice.slice(openBracket + 1, closeAndParen).includes("]")
        ) {
            const spanStart = lineStart + openBracket;
            const spanEnd = lineStart + closeParen + 1;
            if (start < spanEnd && end > spanStart) return null;
            scanPos = closeParen + 1;
        } else {
            scanPos = closeAndParen + 2;
        }
    }

    const replacement = `[${selected}](${url})`;
    const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
    return {
        start,
        end,
        replacement,
        nextValue,
        nextCaret: start + replacement.length,
    };
};

/**
 * Replaces `[start, end]` inside a `<textarea>` using native `execCommand("insertText")`
 * when supported so the browser records a real `Cmd/Ctrl+Z` undo entry and dispatches
 * a native `input` event for React's controlled `onChange`. Falls back cleanly to
 * `onFallbackValue` in test environments (e.g. jsdom) where `execCommand` is stubbed.
 */
export const insertTextareaRangeWithUndo = (
    textarea: HTMLTextAreaElement,
    start: number,
    end: number,
    replacement: string,
    fallbackNextValue: string,
    onFallbackValue: (nextValue: string, nextCaret: number) => void,
): void => {
    const nextCaret = start + replacement.length;
    textarea.focus();
    textarea.setSelectionRange(start, end);

    const doc = textarea.ownerDocument as Document | null;
    if (doc && typeof doc.execCommand === "function") {
        try {
            if (
                doc.execCommand("insertText", false, replacement) &&
                textarea.value === fallbackNextValue
            ) {
                textarea.setSelectionRange(nextCaret, nextCaret);
                return;
            }
        } catch {
            // Fall through to controlled value callback when execCommand throws.
        }
    }

    onFallbackValue(fallbackNextValue, nextCaret);
};

/**
 * Strips leading `$ ` shell prompt markers from single- or multi-line shell snippets
 * while preserving environment variables like `$PATH` or `${HOME}`.
 */
export const stripShellPromptPrefix = (rawCode: string): string => {
    const trimmed = rawCode.replace(/\r\n/g, "\n").trim();
    if (!trimmed) return "";
    const lines = trimmed.split("\n");
    const nonEmpty = lines.filter((line) => line.trim().length > 0);
    if (nonEmpty.length === 0) return "";
    const hasDollarPrompt = nonEmpty.some((line) => /^\s*\$\s+\S/.test(line));
    if (!hasDollarPrompt) return trimmed;
    return lines
        .map((line) => (/^\s*\$\s+\S/.test(line) ? line.replace(/^\s*\$\s+/, "") : line))
        .join("\n")
        .trim();
};
