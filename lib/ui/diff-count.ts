import { diffLines } from "diff";

export type DiffRow = { type: "add" | "remove"; line: string; num: number };

export type UnifiedDiffRow = {
    type: "add" | "remove" | "context" | "hunk";
    line: string;
    oldNum?: number;
    newNum?: number;
};

/** Changed lines only, counted the same way a diff preview renders them. */
export function changedDiffLines(original: string, replacement: string): DiffRow[] {
    const changes = diffLines(original || "", replacement || "");
    const out: DiffRow[] = [];
    let oldNum = 1;
    let newNum = 1;
    for (const part of changes) {
        const lines = part.value.split("\n");
        if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
        for (const line of lines) {
            if (part.added) {
                out.push({ type: "add", line, num: newNum });
                newNum += 1;
            } else if (part.removed) {
                out.push({ type: "remove", line, num: oldNum });
                oldNum += 1;
            } else {
                oldNum += 1;
                newNum += 1;
            }
        }
    }
    return out;
}

type RawDiffLine = {
    type: "add" | "remove" | "same";
    line: string;
    oldNum?: number;
    newNum?: number;
};

/** Collects raw line indices within `context` lines of any added or removed line. */
const collectKeptDiffIndices = (raw: readonly RawDiffLine[], context: number): Set<number> => {
    const keep = new Set<number>();
    for (const [idx, entry] of raw.entries()) {
        if (entry.type === "same") continue;
        const start = Math.max(0, idx - context);
        const end = Math.min(raw.length - 1, idx + context);
        for (let neighbor = start; neighbor <= end; neighbor += 1) {
            keep.add(neighbor);
        }
    }
    return keep;
};

/** Groups kept line indices into contiguous `[startIdx, endIdx]` hunks. */
const groupContiguousHunks = (
    total: number,
    keep: ReadonlySet<number>,
): Array<readonly [number, number]> => {
    const hunks: Array<readonly [number, number]> = [];
    let start = -1;
    let prev = -2;
    for (let idx = 0; idx < total; idx += 1) {
        if (!keep.has(idx)) continue;
        if (idx - prev > 1) {
            if (start !== -1) hunks.push([start, prev]);
            start = idx;
        }
        prev = idx;
    }
    if (start !== -1) hunks.push([start, prev]);
    return hunks;
};

/** Counts old/new lines and earliest line numbers across `[startIdx, endIdx]`. */
const measureHunkBounds = (
    raw: readonly RawDiffLine[],
    startIdx: number,
    endIdx: number,
): { oldStart: number; oldCount: number; newStart: number; newCount: number } => {
    const slice = raw.slice(startIdx, endIdx + 1);
    const oldLines = slice.filter((entry) => entry.oldNum !== undefined);
    const newLines = slice.filter((entry) => entry.newNum !== undefined);
    return {
        oldStart: oldLines[0]?.oldNum ?? 1,
        oldCount: oldLines.length,
        newStart: newLines[0]?.newNum ?? 1,
        newCount: newLines.length,
    };
};

/** Formats a real unified diff hunk header (`@@ -oldStart,oldCount +newStart,newCount @@`). */
const formatUnifiedHunkHeader = (
    raw: readonly RawDiffLine[],
    startIdx: number,
    endIdx: number,
): string => {
    const bounds = measureHunkBounds(raw, startIdx, endIdx);
    return `@@ -${bounds.oldStart},${bounds.oldCount} +${bounds.newStart},${bounds.newCount} @@`;
};

/** Maps a `RawDiffLine` into a renderable `UnifiedDiffRow`. */
const toUnifiedContentRow = (entry: RawDiffLine): UnifiedDiffRow => {
    if (entry.type === "same") {
        return { type: "context", line: entry.line, oldNum: entry.oldNum, newNum: entry.newNum };
    }
    if (entry.type === "add") {
        return { type: "add", line: entry.line, newNum: entry.newNum };
    }
    return { type: "remove", line: entry.line, oldNum: entry.oldNum };
};

/** Appends a single hunk's rows (with header when multi-hunk or offset past line 1) onto `out`. */
const appendUnifiedHunkRows = (
    out: UnifiedDiffRow[],
    raw: readonly RawDiffLine[],
    hunk: readonly [number, number],
    emitHeader: boolean,
): void => {
    const [startIdx, endIdx] = hunk;
    if (emitHeader) {
        out.push({ type: "hunk", line: formatUnifiedHunkHeader(raw, startIdx, endIdx) });
    }
    for (const entry of raw.slice(startIdx, endIdx + 1)) {
        out.push(toUnifiedContentRow(entry));
    }
};

/** Splits a `diffLines` chunk value into lines without trailing empty split element. */
const splitDiffPartLines = (value: string): string[] => {
    const lines = value.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines;
};

/** Builds numbered `RawDiffLine` entries from `original` and `replacement`. */
const buildRawDiffLines = (original: string, replacement: string): RawDiffLine[] => {
    const raw: RawDiffLine[] = [];
    let oldNum = 1;
    let newNum = 1;
    for (const part of diffLines(original, replacement)) {
        for (const line of splitDiffPartLines(part.value)) {
            if (part.added) {
                raw.push({ type: "add", line, newNum });
                newNum += 1;
            } else if (part.removed) {
                raw.push({ type: "remove", line, oldNum });
                oldNum += 1;
            } else {
                raw.push({ type: "same", line, oldNum, newNum });
                oldNum += 1;
                newNum += 1;
            }
        }
    }
    return raw;
};

/** Unified diff with a few context lines around each change. */
export function unifiedDiffRows(
    original: string,
    replacement: string,
    context = 2,
): UnifiedDiffRow[] {
    const raw = buildRawDiffLines(original || "", replacement || "");
    const keep = collectKeptDiffIndices(raw, context);
    if (keep.size === 0) return [];
    const hunks = groupContiguousHunks(raw.length, keep);
    const emitHeaders = hunks.length > 1 || (hunks[0]?.[0] ?? 0) > 0;
    const out: UnifiedDiffRow[] = [];
    for (const hunk of hunks) {
        appendUnifiedHunkRows(out, raw, hunk, emitHeaders);
    }
    return out;
}

/** Parse a unified git/patch body into display rows. */
export function parseUnifiedDiffBody(body: string): UnifiedDiffRow[] {
    const out: UnifiedDiffRow[] = [];
    for (const line of body.split("\n")) {
        if (line.startsWith("@@")) {
            out.push({ type: "hunk", line });
        } else if (line.startsWith("+") && !line.startsWith("+++")) {
            out.push({ type: "add", line: line.slice(1) });
        } else if (line.startsWith("-") && !line.startsWith("---")) {
            out.push({ type: "remove", line: line.slice(1) });
        } else if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
            out.push({ type: "hunk", line });
        } else {
            const text = line.startsWith(" ") ? line.slice(1) : line;
            out.push({ type: "context", line: text });
        }
    }
    return out;
}

export function countChangedLines(original: string, replacement: string): { add: number; del: number } {
    let add = 0;
    let del = 0;
    for (const row of changedDiffLines(original, replacement)) {
        if (row.type === "add") add += 1;
        else del += 1;
    }
    return { add, del };
}
