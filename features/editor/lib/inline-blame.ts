import type { BlameLine } from "@/lib/backend";
import {
    formatBlameDate,
    regionEndLine,
    toBlameEntry,
    type BlameEntry,
} from "@/features/git/ui/blame/model";

/**
 * Inline blame shows the last commit for the line the caret sits on. Git
 * reports *regions* — one record per run of lines from the same commit — so
 * the lookup has to find the region that covers a line, not just an exact
 * line number.
 */
export function toInlineBlameEntries(raw: readonly (BlameLine | null | undefined)[] | null): BlameEntry[] {
    if (!raw) return [];
    // `toBlameEntry` clamps a missing line to 1, so records git cannot place
    // have to be rejected before conversion.
    const placeable = raw.filter((line) => Number(line?.line) > 0);
    // git prints regions in file order, but a defensive sort keeps the binary
    // search below correct if that ever changes.
    return placeable.map((line) => toBlameEntry(line)).sort((a, b) => a.line - b.line);
}

/** The region covering `line` (one-based), or null when git has no record. */
export function blameEntryAt(entries: readonly BlameEntry[], line: number): BlameEntry | null {
    if (!Number.isFinite(line) || line < 1 || entries.length === 0) return null;
    let low = 0;
    let high = entries.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const entry = entries[mid];
        if (!entry) return null;
        const end = regionEndLine(entry);
        if (line < entry.line) {
            high = mid - 1;
        } else if (line > end) {
            low = mid + 1;
        } else {
            return entry;
        }
    }
    return null;
}

/**
 * One line of text for the widget. `toBlameEntry` already substitutes
 * placeholders for an unknown author, date or summary, so this never has to
 * deal with empty segments.
 */
export function inlineBlameLabel(entry: BlameEntry, nowSeconds: number): string {
    return [entry.author, formatBlameDate(entry.at, nowSeconds), entry.summary].join(" · ");
}
