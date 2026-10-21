/**
 * In-buffer terminal search.
 *
 * xterm exposes each buffer line only as text, so matching is a straight
 * case-insensitive scan. The result is a plain list so it can be unit tested
 * without a DOM or a terminal.
 */

export type TerminalMatch = {
    /** Absolute buffer row (scrollback included), 0-based. */
    row: number;
    /** Column of the first character of the match. */
    col: number;
    /** Length of the match in characters. */
    length: number;
};

/** A one-character query on a huge buffer must not freeze the panel. */
export const TERMINAL_MATCH_LIMIT = 1000;

export function findTerminalMatches(
    lines: readonly string[],
    query: string,
    limit: number = TERMINAL_MATCH_LIMIT,
): TerminalMatch[] {
    const raw = query.trim();
    if (!raw) return [];
    const needle = raw.toLowerCase();
    const matches: TerminalMatch[] = [];

    for (let row = 0; row < lines.length && matches.length < limit; row++) {
        const line = lines[row] ?? "";
        const haystack = line.toLowerCase();
        // Lowercasing can change length for a few characters; fall back to a
        // case-sensitive scan in that (very rare) case so columns stay correct.
        const comparable = haystack.length === line.length;
        const source = comparable ? haystack : line;
        const target = comparable ? needle : raw;
        let from = 0;
        while (matches.length < limit) {
            const at = source.indexOf(target, from);
            if (at === -1) break;
            matches.push({ row, col: at, length: target.length });
            from = at + Math.max(1, target.length);
        }
    }

    return matches;
}

/**
 * Code points drawn in two cells: East Asian Wide/Fullwidth plus the emoji
 * blocks. xterm positions cells, not JavaScript chars, so selecting a match that
 * contains any of these needs the cell width, not `String.length`.
 */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
    [0x1100, 0x115f],
    [0x2e80, 0x303e],
    [0x3041, 0x33ff],
    [0x3400, 0x4dbf],
    [0x4e00, 0x9fff],
    [0xa000, 0xa4cf],
    [0xa960, 0xa97f],
    [0xac00, 0xd7a3],
    [0xf900, 0xfaff],
    [0xfe10, 0xfe19],
    [0xfe30, 0xfe6f],
    [0xff00, 0xff60],
    [0xffe0, 0xffe6],
    [0x1f004, 0x1f004],
    [0x1f0cf, 0x1f0cf],
    [0x1f18e, 0x1f18e],
    [0x1f191, 0x1f19a],
    [0x1f1e6, 0x1f1ff],
    [0x1f300, 0x1faff],
    [0x20000, 0x2fffd],
    [0x30000, 0x3fffd],
];

const COMBINING = /\p{M}/u;

function isWide(codePoint: number): boolean {
    for (const [start, end] of WIDE_RANGES) {
        if (codePoint < start) return false;
        if (codePoint <= end) return true;
    }
    return false;
}

/**
 * Cells occupied by `text` once the terminal has drawn it. Zero-width joiners,
 * variation selectors, combining marks and control characters occupy none, and a
 * code point that follows a joiner belongs to the same cluster.
 */
export function cellWidth(text: string): number {
    let width = 0;
    let joined = false;
    for (const char of text) {
        const codePoint = char.codePointAt(0) ?? 0;
        if (codePoint === 0x200d) {
            joined = true;
            continue;
        }
        if (codePoint === 0xfe0e || codePoint === 0xfe0f) continue;
        if (codePoint < 0x20 || codePoint === 0x7f) continue;
        if (codePoint === 0x200b || codePoint === 0x2060) continue;
        if (COMBINING.test(char)) continue;
        if (joined) {
            joined = false;
            continue;
        }
        width += isWide(codePoint) ? 2 : 1;
    }
    return width;
}

/**
 * Translate a match's string offsets into the cell column and cell length that
 * `Terminal.select(column, row, length)` expects.
 */
export function toCellSelection(line: string, match: TerminalMatch): { column: number; length: number } {
    return {
        column: cellWidth(line.slice(0, match.col)),
        length: Math.max(1, cellWidth(line.slice(match.col, match.col + match.length))),
    };
}

/** Move through matches, wrapping at both ends. Nothing selected → first match. */
export function nextMatchIndex(current: number, delta: number, count: number): number {
    if (count <= 0) return -1;
    if (current < 0) return 0;
    return (((current + delta) % count) + count) % count;
}
