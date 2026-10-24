/**
 * Incremental top-level Markdown block splitter for streaming chat replies.
 *
 * Turning a growing N-character reply into `[...settled, tail]` lets completed
 * top-level blocks freeze behind `React.memo` while only `tail` re-parses as
 * tokens arrive - reducing streaming render work from O(N^2) to O(tail).
 *
 * Correctness invariants:
 *  1. Reference link / footnote definitions (`[id]: url`, `[^1]: note`) resolve
 *     document-wide in CommonMark/GFM, so any message containing one falls back
 *     to `{ settled: [], tail: markdown }`.
 *  2. Fenced code blocks (```` ``` ```` or `~~~` with 0-3 leading spaces) never
 *     split internally, even across blank lines or shorter nested fences.
 *  3. Contiguous or loose lists (`-`, `*`, `+`, `1.`, `1)`) stay in a single
 *     block across blank lines when the next non-blank line is another list
 *     marker or an indented continuation, preserving `<ol>` numbering and
 *     nested list structure.
 *  4. A block only enters `settled` once a subsequent top-level block has
 *     already started after at least one blank line outside any fence.
 */

const REFERENCE_DEF_RE = /^ {0,3}\[\^?(?:\\.|[^\]\\])+\]:[ \t]*\S/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+\S/;
const INDENTED_CONTINUATION_RE = /^(?: {2,}|\t)\S/;
const INDENTED_CODE_LINE_RE = /^(?: {4}|\t)/;

export interface StreamingMarkdownSplit {
    settled: string[];
    tail: string;
}

interface IncrementalSplitCache {
    /** Exact prefix `markdown.slice(0, tailStartOffset)` covering all settled blocks + separator. */
    settledPrefix: string;
    settled: string[];
    tailStartOffset: number;
    /** Previous full input when a reference definition forced full-document fallback. */
    refFallbackPrefix: string | null;
}

let incrementalCache: IncrementalSplitCache | null = null;

function isClosingFence(line: string, fenceChar: string, fenceLen: number): boolean {
    let spaces = 0;
    while (spaces < line.length && spaces < 4 && line.charCodeAt(spaces) === 32) {
        spaces++;
    }
    if (spaces >= 4) return false;
    const targetCode = fenceChar.charCodeAt(0);
    let count = 0;
    let i = spaces;
    while (i < line.length && line.charCodeAt(i) === targetCode) {
        count++;
        i++;
    }
    if (count < fenceLen) return false;
    while (i < line.length) {
        const ch = line.charCodeAt(i);
        if (ch !== 32 && ch !== 9 && ch !== 13) return false;
        i++;
    }
    return true;
}

/** Strips leading CommonMark blockquote markers (`>`) without regex backtracking. */
const stripBlockquoteMarkers = (line: string): string => {
    let pos = 0;
    while (pos < line.length) {
        let spaces = 0;
        while (spaces < 3 && pos + spaces < line.length && line.charCodeAt(pos + spaces) === 32) {
            spaces += 1;
        }
        if (pos + spaces >= line.length || line.charCodeAt(pos + spaces) !== 62) {
            break;
        }
        pos += spaces + 1;
        if (pos < line.length && (line.charCodeAt(pos) === 32 || line.charCodeAt(pos) === 9)) {
            pos += 1;
        }
    }
    return pos === 0 ? line : line.slice(pos);
};

function isBlankLine(line: string): boolean {
    for (let i = 0; i < line.length; i++) {
        const ch = line.charCodeAt(i);
        if (ch !== 32 && ch !== 9 && ch !== 13) return false;
    }
    return true;
}

/** Returns true when `markdown` ends inside an unclosed fenced code block. */
export function hasUnclosedMarkdownFence(markdown: string): boolean {
    if (!markdown || (!markdown.includes("```") && !markdown.includes("~~~"))) {
        return false;
    }
    const lines = markdown.split("\n");
    let activeFence: { char: string; len: number } | null = null;
    for (const line of lines) {
        if (activeFence === null) {
            const open = FENCE_OPEN_RE.exec(line);
            if (open) {
                const run = open[1];
                if (run) {
                    const rest = line.slice(open[0].length);
                    const firstChar = run[0];
                    if (!firstChar || (firstChar === "`" && rest.includes("`"))) continue;
                    activeFence = { char: firstChar, len: run.length };
                }
            }
        } else if (isClosingFence(line, activeFence.char, activeFence.len)) {
            activeFence = null;
        }
    }
    return activeFence !== null;
}

function parseSliceBlocks(slice: string): {
    hasRefDef: boolean;
    blocks: Array<{ text: string; startOffset: number }>;
} {
    const lines = slice.split("\n");
    const blocks: Array<{ text: string; startOffset: number }> = [];

    let currentLines: string[] = [];
    let currentStartOffset = 0;
    let pendingBlankLines: string[] = [];
    let currentIsList = false;
    let currentIsIndentedCode = false;
    let activeFence: { char: string; len: number } | null = null;
    let lineOffset = 0;

    for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx] ?? "";
        const thisLineOffset = lineOffset;
        lineOffset += line.length + (idx < lines.length - 1 ? 1 : 0);

        if (activeFence !== null) {
            currentLines.push(line);
            if (isClosingFence(line, activeFence.char, activeFence.len)) {
                activeFence = null;
            }
            continue;
        }

        if (REFERENCE_DEF_RE.test(stripBlockquoteMarkers(line))) {
            return { hasRefDef: true, blocks: [] };
        }

        if (isBlankLine(line)) {
            if (currentLines.length > 0) {
                pendingBlankLines.push(line);
            }
            continue;
        }

        if (pendingBlankLines.length > 0 && currentLines.length > 0) {
            const continuesList =
                currentIsList && (LIST_ITEM_RE.test(line) || INDENTED_CONTINUATION_RE.test(line));
            const continuesIndentedCode =
                currentIsIndentedCode && INDENTED_CODE_LINE_RE.test(line);
            if (continuesList || continuesIndentedCode) {
                currentLines.push(...pendingBlankLines);
                pendingBlankLines = [];
            } else {
                blocks.push({ text: currentLines.join("\n"), startOffset: currentStartOffset });
                currentLines = [];
                pendingBlankLines = [];
            }
        }

        if (currentLines.length === 0) {
            currentStartOffset = thisLineOffset;
            currentIsList = LIST_ITEM_RE.test(line);
            currentIsIndentedCode = !currentIsList && INDENTED_CODE_LINE_RE.test(line);
        }

        const open = FENCE_OPEN_RE.exec(line);
        if (open) {
            const run = open[1];
            if (run) {
                const rest = line.slice(open[0].length);
                const firstChar = run[0];
                if (firstChar && !(firstChar === "`" && rest.includes("`"))) {
                    activeFence = { char: firstChar, len: run.length };
                }
            }
        }

        currentLines.push(line);
    }

    if (currentLines.length > 0) {
        if (pendingBlankLines.length > 0) {
            currentLines.push(...pendingBlankLines);
        }
        blocks.push({ text: currentLines.join("\n"), startOffset: currentStartOffset });
    }

    return { hasRefDef: false, blocks };
}

/** Splits streaming Markdown into settled top-level blocks and a mutable tail block in O(tail). */
export function splitStreamingMarkdownBlocks(markdown: string): StreamingMarkdownSplit {
    if (!markdown) {
        return { settled: [], tail: "" };
    }
    if (!markdown.includes("\n\n")) {
        return { settled: [], tail: markdown };
    }

    // Fast O(1) fallback continuation when an earlier line already introduced a reference def
    // outside a fence, provided the new tokens only appended to that same prefix.
    if (
        incrementalCache?.refFallbackPrefix &&
        markdown.startsWith(incrementalCache.refFallbackPrefix)
    ) {
        const appended = markdown.slice(incrementalCache.refFallbackPrefix.length);
        if (!appended.includes("```") && !appended.includes("~~~")) {
            incrementalCache = {
                ...incrementalCache,
                refFallbackPrefix: markdown,
            };
            return { settled: [], tail: markdown };
        }
    }

    // Fast O(tail) incremental continuation when `markdown` extends the settled prefix.
    let baseSettled: string[] = [];
    let sliceStart = 0;
    if (
        incrementalCache &&
        !incrementalCache.refFallbackPrefix &&
        incrementalCache.tailStartOffset > 0 &&
        markdown.length >= incrementalCache.tailStartOffset &&
        markdown.startsWith(incrementalCache.settledPrefix)
    ) {
        baseSettled = incrementalCache.settled;
        sliceStart = incrementalCache.tailStartOffset;
    }

    const tailInput = sliceStart > 0 ? markdown.slice(sliceStart) : markdown;
    const parsed = parseSliceBlocks(tailInput);

    if (parsed.hasRefDef) {
        incrementalCache = {
            settledPrefix: "",
            settled: [],
            tailStartOffset: 0,
            refFallbackPrefix: markdown,
        };
        return { settled: [], tail: markdown };
    }

    const totalBlocks = baseSettled.length + parsed.blocks.length;
    const lastBlock = parsed.blocks.at(-1);
    if (totalBlocks <= 1 || !lastBlock) {
        return { settled: [], tail: markdown };
    }

    const newlySettled = parsed.blocks.slice(0, -1).map((b) => b.text);
    const settled = baseSettled.length > 0 ? [...baseSettled, ...newlySettled] : newlySettled;
    const nextTailStart = sliceStart + lastBlock.startOffset;

    incrementalCache = {
        settledPrefix: markdown.slice(0, nextTailStart),
        settled,
        tailStartOffset: nextTailStart,
        refFallbackPrefix: null,
    };

    return { settled, tail: lastBlock.text };
}
