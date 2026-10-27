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

/** Move through matches, wrapping at both ends. Nothing selected → first match. */
export function nextMatchIndex(current: number, delta: number, count: number): number {
    if (count <= 0) return -1;
    if (current < 0) return 0;
    return (((current + delta) % count) + count) % count;
}
