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
export function extractCleanUserPrompts(
    messages: ReadonlyArray<{ role?: string; content?: string }>,
    extraRecent: ReadonlyArray<string> = [],
    maxCount = 50,
): string[] {
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
}

export function isCaretOnFirstLogicalLine(
    value: string,
    selectionStart: number | null | undefined,
    selectionEnd: number | null | undefined,
): boolean {
    const start = selectionStart ?? 0;
    const end = selectionEnd ?? start;
    if (start !== end) return false;
    return value.lastIndexOf("\n", Math.max(0, start - 1)) === -1 || start === 0;
}

export function isCaretOnLastLogicalLine(
    value: string,
    selectionStart: number | null | undefined,
    selectionEnd: number | null | undefined,
): boolean {
    const start = selectionStart ?? value.length;
    const end = selectionEnd ?? start;
    if (start !== end) return false;
    return value.indexOf("\n", start) === -1;
}

/**
 * True when pressing `ArrowUp` should enter or continue prompt-history browsing:
 * - Empty composer recalls immediately.
 * - Non-empty draft enters history recall when caret is already at index 0 (`0..0`),
 *   so pressing `ArrowUp` once moves to start-of-draft and pressing again stashes
 *   the unsent draft and recalls the previous sent prompt.
 * - Once browsing an unedited recalled prompt, anywhere on the first logical line steps older.
 */
export function canStepPromptHistoryUp(
    cursor: PromptHistoryCursor | null,
    currentValue: string,
    selectionStart: number | null | undefined,
    selectionEnd: number | null | undefined,
): boolean {
    const start = selectionStart ?? 0;
    const end = selectionEnd ?? start;
    if (start !== end) return false;
    if (currentValue.length === 0) return true;
    if (cursor && currentValue === cursor.recalledValue) {
        return isCaretOnFirstLogicalLine(currentValue, start, end);
    }
    return start === 0;
}

/**
 * True when the user has not typed custom edits on top of the recalled prompt,
 * making it safe for `ArrowDown` or `Escape` to restore newer prompts / `stashedDraft`.
 */
export function isUnmodifiedHistoryRecall(
    cursor: PromptHistoryCursor | null,
    currentValue: string,
): cursor is PromptHistoryCursor {
    return cursor !== null && currentValue === cursor.recalledValue;
}

export function stepPromptHistoryUp(
    cursor: PromptHistoryCursor | null,
    currentValue: string,
    prompts: ReadonlyArray<string>,
): { cursor: PromptHistoryCursor; value: string } | null {
    if (prompts.length === 0) return null;
    if (!cursor) {
        const value = prompts[0];
        if (value === undefined) return null;
        return {
            cursor: { index: 0, stashedDraft: currentValue, recalledValue: value },
            value,
        };
    }
    const nextIndex = Math.min(cursor.index + 1, prompts.length - 1);
    if (nextIndex === cursor.index) return null;
    const value = prompts[nextIndex];
    if (value === undefined) return null;
    return {
        cursor: { index: nextIndex, stashedDraft: cursor.stashedDraft, recalledValue: value },
        value,
    };
}

export function stepPromptHistoryDown(
    cursor: PromptHistoryCursor | null,
    prompts: ReadonlyArray<string>,
): { cursor: PromptHistoryCursor | null; value: string } | null {
    if (!cursor) return null;
    if (cursor.index <= 0) {
        return {
            cursor: null,
            value: cursor.stashedDraft,
        };
    }
    const nextIndex = cursor.index - 1;
    const value = prompts[nextIndex] ?? cursor.stashedDraft;
    return {
        cursor: { index: nextIndex, stashedDraft: cursor.stashedDraft, recalledValue: value },
        value,
    };
}

/**
 * Wraps a non-empty single-line text selection into `[selection](url)` when
 * pasting a standalone HTTP(S) URL. Returns `null` when normal paste applies.
 */
export function tryWrapMarkdownLinkOnPaste(
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
} | null {
    const start = selectionStart ?? 0;
    const end = selectionEnd ?? start;
    if (start >= end) return null;

    const url = pastedText.trim();
    if (!HTTP_URL_RE.test(url)) return null;

    const selected = value.slice(start, end);
    if (!selected.trim() || selected.includes("\n") || selected.includes("\r")) return null;
    if (HTTP_URL_RE.test(selected.trim())) return null;
    if (selected.includes("[") || selected.includes("]")) return null;

    // Skip if selection is already inside `[label](...)` syntax.
    const charBefore = start > 0 ? value[start - 1] : "";
    const afterSlice = value.slice(end, end + 2);
    if (charBefore === "[" && afterSlice.startsWith("](")) return null;

    const replacement = `[${selected}](${url})`;
    const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
    return {
        start,
        end,
        replacement,
        nextValue,
        nextCaret: start + replacement.length,
    };
}

/**
 * Replaces `[start, end]` inside a `<textarea>` using native `execCommand("insertText")`
 * when supported so the browser records a real `Cmd/Ctrl+Z` undo entry and dispatches
 * a native `input` event for React's controlled `onChange`. Falls back cleanly to
 * `onFallbackValue` in test environments (e.g. jsdom) where `execCommand` is stubbed.
 */
export function insertTextareaRangeWithUndo(
    textarea: HTMLTextAreaElement,
    start: number,
    end: number,
    replacement: string,
    fallbackNextValue: string,
    onFallbackValue: (nextValue: string, nextCaret: number) => void,
): void {
    const nextCaret = start + replacement.length;
    textarea.focus();
    textarea.setSelectionRange(start, end);

    let insertedViaNativeCommand = false;
    const doc = textarea.ownerDocument;
    if (doc && typeof doc.execCommand === "function") {
        try {
            const before = textarea.value;
            const ok = doc.execCommand("insertText", false, replacement);
            insertedViaNativeCommand = Boolean(ok && textarea.value !== before);
        } catch {
            insertedViaNativeCommand = false;
        }
    }

    if (insertedViaNativeCommand) {
        textarea.setSelectionRange(nextCaret, nextCaret);
        return;
    }

    onFallbackValue(fallbackNextValue, nextCaret);
}

/**
 * Strips leading `$ ` shell prompt markers from single- or multi-line shell snippets
 * while preserving environment variables like `$PATH` or `${HOME}`.
 */
export function stripShellPromptPrefix(rawCode: string): string {
    const trimmed = rawCode.replace(/\r\n/g, "\n").trim();
    if (!trimmed) return "";
    const lines = trimmed.split("\n");
    const nonEmpty = lines.filter((line) => line.trim().length > 0);
    if (nonEmpty.length === 0) return "";
    const allDollarPrefixed = nonEmpty.every((line) => /^\s*\$\s+\S/.test(line));
    if (!allDollarPrefixed) return trimmed;
    return lines
        .map((line) => line.replace(/^\s*\$\s+/, ""))
        .join("\n")
        .trim();
}
