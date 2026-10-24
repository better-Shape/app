/**
 * Incremental top-level Markdown block splitter for streaming chat replies.
 *
 * Turning a growing N-character reply into `[...settled, tail]` lets completed
 * top-level blocks freeze behind `React.memo` while only `tail` re-parses as
 * tokens arrive — reducing streaming render work from O(N^2) to O(tail).
 *
 * Correctness invariants:
 *  1. Reference link / footnote definitions (`[id]: url`, `[^1]: note`) resolve
 *     document-wide in CommonMark/GFM, so any message containing one falls back
 *     to `{ settled: [], tail: markdown }`.
 *  2. Fenced code blocks (```` ``` ```` or `~~~` with 0–3 leading spaces) never
 *     split internally, even across blank lines or shorter nested fences.
 *  3. Contiguous or loose lists (`-`, `*`, `+`, `1.`, `1)`) stay in a single
 *     block across blank lines when the next non-blank line is another list
 *     marker or an indented continuation, preserving `<ol>` numbering and
 *     nested list structure.
 *  4. A block only enters `settled` once a subsequent top-level block has
 *     already started after at least one blank line outside any fence.
 */

const REFERENCE_DEF_RE = /^ {0,3}\[\^?[^\]]+\]:[ \t]*\S/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+\S/;
const INDENTED_CONTINUATION_RE = /^(?: {2,}|\t)\S/;
const INDENTED_CODE_LINE_RE = /^(?: {4}|\t)/;

export interface StreamingMarkdownSplit {
    settled: string[];
    tail: string;
}

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
    let fenceChar: string | null = null;
    let fenceLen = 0;
    for (const line of lines) {
        if (fenceChar === null) {
            const open = FENCE_OPEN_RE.exec(line);
            const run = open?.[1];
            if (open && run) {
                // Backtick info strings cannot contain backticks in CommonMark (inline code instead).
                const rest = line.slice(open[0].length);
                const firstChar = run[0];
                if (!firstChar || (firstChar === "`" && rest.includes("`"))) continue;
                fenceChar = firstChar;
                fenceLen = run.length;
            }
        } else if (isClosingFence(line, fenceChar, fenceLen)) {
            fenceChar = null;
            fenceLen = 0;
        }
    }
    return fenceChar !== null;
}

/** Splits streaming Markdown into settled top-level blocks and a mutable tail block. */
export function splitStreamingMarkdownBlocks(markdown: string): StreamingMarkdownSplit {
    if (!markdown) {
        return { settled: [], tail: "" };
    }
    if (!markdown.includes("\n\n")) {
        return { settled: [], tail: markdown };
    }

    const lines = markdown.split("\n");
    const blocks: string[] = [];

    let currentLines: string[] = [];
    let pendingBlankLines: string[] = [];
    let currentIsList = false;
    let currentIsIndentedCode = false;
    let fenceChar: string | null = null;
    let fenceLen = 0;

    for (const line of lines) {
        if (fenceChar !== null) {
            currentLines.push(line);
            if (isClosingFence(line, fenceChar, fenceLen)) {
                fenceChar = null;
                fenceLen = 0;
            }
            continue;
        }

        if (REFERENCE_DEF_RE.test(line)) {
            return { settled: [], tail: markdown };
        }

        if (isBlankLine(line)) {
            if (currentLines.length > 0) {
                pendingBlankLines.push(line);
            }
            continue;
        }

        // Non-blank line outside any fence: decide whether pending blank lines split a block.
        if (pendingBlankLines.length > 0 && currentLines.length > 0) {
            const continuesList =
                currentIsList && (LIST_ITEM_RE.test(line) || INDENTED_CONTINUATION_RE.test(line));
            const continuesIndentedCode =
                currentIsIndentedCode && INDENTED_CODE_LINE_RE.test(line);
            if (continuesList || continuesIndentedCode) {
                currentLines.push(...pendingBlankLines);
                pendingBlankLines = [];
            } else {
                blocks.push(currentLines.join("\n"));
                currentLines = [];
                pendingBlankLines = [];
                currentIsList = false;
                currentIsIndentedCode = false;
            }
        }

        if (currentLines.length === 0) {
            currentIsList = LIST_ITEM_RE.test(line);
            currentIsIndentedCode = !currentIsList && INDENTED_CODE_LINE_RE.test(line);
        }

        const open = FENCE_OPEN_RE.exec(line);
        const run = open?.[1];
        if (open && run) {
            const rest = line.slice(open[0].length);
            const firstChar = run[0];
            if (firstChar && !(firstChar === "`" && rest.includes("`"))) {
                fenceChar = firstChar;
                fenceLen = run.length;
            }
        }

        currentLines.push(line);
    }

    if (currentLines.length > 0) {
        if (pendingBlankLines.length > 0) {
            currentLines.push(...pendingBlankLines);
        }
        blocks.push(currentLines.join("\n"));
    }

    if (blocks.length <= 1) {
        return { settled: [], tail: markdown };
    }

    // Keep the last 1 block (or 2 if the penultimate block was a list that could still
    // receive another loose list item after trailing blank lines) in `tail` when trailing blanks exist.
    const settled = blocks.slice(0, -1);
    const tail = blocks[blocks.length - 1] ?? "";
    return { settled, tail };
}
