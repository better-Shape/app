import type { HistoryEntry } from "@/lib/backend/types";
import type { QuickPickItem } from "@/components/ui/quick-pick";

/**
 * Local history is written by the Rust save pipeline (50 versions per file) and
 * has never had a surface: `get_file_history_command` and
 * `restore_history_version_command` are implemented and unreachable. These
 * helpers keep the picker's wording, ordering and filtering out of the
 * component so they can be tested.
 */

/** Window event the editor surface listens for, so the request works from the
 * context menu, the command palette and any other surface that has a path. */
export const LOCAL_HISTORY_EVENT = "bettershape-local-history";

export type LocalHistoryRequest = {
    path: string;
    /** Set by the surface that opens the picker, so the others stand down. */
    claimed?: boolean;
};

export function requestLocalHistory(path: string | null | undefined): void {
    if (!path || typeof window === "undefined") return;
    const detail: LocalHistoryRequest = { path };
    window.dispatchEvent(new CustomEvent(LOCAL_HISTORY_EVENT, { detail }));
}

const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
] as const;

const pad = (value: number): string => String(value).padStart(2, "0");

/** `Today 14:05`, `Yesterday 09:12`, `3 Mar 09:12`, `3 Mar 2025 09:12`. */
export function formatHistoryWhen(timestampSeconds: number, now: number = Date.now()): string {
    if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) return "Unknown time";
    const date = new Date(timestampSeconds * 1000);
    const today = new Date(now);
    const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (date.toDateString() === today.toDateString()) return `Today ${clock}`;
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${clock}`;
    const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
    return date.getFullYear() === today.getFullYear() ? `${day} ${clock}` : `${day} ${date.getFullYear()} ${clock}`;
}

/** `0 B`, `812 B`, `4.2 kB`, `19 kB`, `1.4 MB`. */
export function formatHistorySize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    const kilobytes = bytes / 1024;
    if (kilobytes < 1024) return kilobytes < 10 ? `${kilobytes.toFixed(1)} kB` : `${Math.round(kilobytes)} kB`;
    return `${(kilobytes / 1024).toFixed(1)} MB`;
}

/** Newest first, one row per version id, ready for `QuickPick`. */
export function historyPickItems(entries: readonly HistoryEntry[], now: number = Date.now()): QuickPickItem[] {
    const seen = new Set<string>();
    return [...entries]
        .filter((entry) => {
            if (!entry.id || seen.has(entry.id)) return false;
            seen.add(entry.id);
            return true;
        })
        .sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id))
        .map((entry) => ({
            id: entry.id,
            label: formatHistoryWhen(entry.timestamp, now),
            description: formatHistorySize(entry.size),
        }));
}

/** Filter by the visible row text, case-insensitively. */
export function filterHistoryItems(items: readonly QuickPickItem[], query: string): QuickPickItem[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [...items];
    return items.filter((item) => `${item.label} ${item.description ?? ""}`.toLowerCase().includes(needle));
}

/** Toast text after a restore, which only fills the buffer until the file is saved. */
export function restoredVersionMessage(timestampSeconds: number, now: number = Date.now()): string {
    return `Restored the version from ${formatHistoryWhen(timestampSeconds, now)}. Save the file to keep it.`;
}
