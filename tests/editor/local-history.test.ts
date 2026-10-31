import { describe, expect, it } from "vitest";
import {
    filterHistoryItems,
    formatHistorySize,
    formatHistoryWhen,
    historyPickItems,
    LOCAL_HISTORY_EVENT,
    requestLocalHistory,
    restoredVersionMessage,
    type LocalHistoryRequest,
} from "@/lib/editor/local-history";

/** 31 October 2026, 15:30 local time. */
const NOW = new Date(2026, 9, 31, 15, 30, 0).getTime();
const at = (year: number, month: number, day: number, hour: number, minute: number) =>
    Math.floor(new Date(year, month, day, hour, minute, 0).getTime() / 1000);

describe("local history formatting", () => {
    it("names today, yesterday and older versions without a locale lookup", () => {
        expect(formatHistoryWhen(at(2026, 9, 31, 14, 5), NOW)).toBe("Today 14:05");
        expect(formatHistoryWhen(at(2026, 9, 30, 9, 12), NOW)).toBe("Yesterday 09:12");
        expect(formatHistoryWhen(at(2026, 2, 3, 9, 12), NOW)).toBe("3 Mar 09:12");
        expect(formatHistoryWhen(at(2025, 11, 24, 23, 59), NOW)).toBe("24 Dec 2025 23:59");
    });

    it("handles a missing timestamp instead of printing 1970", () => {
        expect(formatHistoryWhen(0, NOW)).toBe("Unknown time");
        expect(formatHistoryWhen(Number.NaN, NOW)).toBe("Unknown time");
    });

    it("formats sizes in the unit a person reads", () => {
        expect(formatHistorySize(0)).toBe("0 B");
        expect(formatHistorySize(812)).toBe("812 B");
        expect(formatHistorySize(4300)).toBe("4.2 kB");
        expect(formatHistorySize(19_456)).toBe("19 kB");
        expect(formatHistorySize(1_468_006)).toBe("1.4 MB");
    });
});

describe("local history rows", () => {
    const entries = [
        { id: "b", timestamp: at(2026, 9, 31, 14, 5), label: "Save at 14:05", size: 640 },
        { id: "a", timestamp: at(2026, 9, 31, 15, 20), label: "Save at 15:20", size: 900 },
        { id: "c", timestamp: at(2026, 9, 30, 9, 12), label: "Save at 09:12", size: 128 },
    ];

    it("puts the newest version first and carries the id and size", () => {
        const items = historyPickItems(entries, NOW);
        expect(items.map((item) => item.id)).toEqual(["a", "b", "c"]);
        expect(items[0]).toMatchObject({ label: "Today 15:20", description: "900 B" });
        expect(items[2]).toMatchObject({ label: "Yesterday 09:12", description: "128 B" });
    });

    it("drops duplicate ids so a migrated store cannot list a version twice", () => {
        const items = historyPickItems([...entries, { ...entries[0] }], NOW);
        expect(items.filter((item) => item.id === "b")).toHaveLength(1);
    });

    it("filters rows by the text a person sees", () => {
        const items = historyPickItems(entries, NOW);
        expect(filterHistoryItems(items, "yesterday").map((item) => item.id)).toEqual(["c"]);
        expect(filterHistoryItems(items, "128").map((item) => item.id)).toEqual(["c"]);
        expect(filterHistoryItems(items, "   ").map((item) => item.id)).toEqual(["a", "b", "c"]);
        expect(filterHistoryItems(items, "nothing matches")).toEqual([]);
    });

    it("says the restored version only fills the buffer", () => {
        expect(restoredVersionMessage(at(2026, 9, 31, 14, 5), NOW)).toBe(
            "Restored the version from Today 14:05. Save the file to keep it.",
        );
    });
});

describe("local history request", () => {
    it("carries the path so only the matching file opens a picker", () => {
        const seen: LocalHistoryRequest[] = [];
        const listener = (event: Event) => seen.push((event as CustomEvent<LocalHistoryRequest>).detail);
        window.addEventListener(LOCAL_HISTORY_EVENT, listener);
        requestLocalHistory("/repo/src/App.tsx");
        window.removeEventListener(LOCAL_HISTORY_EVENT, listener);
        expect(seen).toEqual([{ path: "/repo/src/App.tsx" }]);
    });

    it("stays quiet when no file is open", () => {
        const seen: unknown[] = [];
        const listener = (event: Event) => seen.push((event as CustomEvent).detail);
        window.addEventListener(LOCAL_HISTORY_EVENT, listener);
        requestLocalHistory(null);
        requestLocalHistory(undefined);
        requestLocalHistory("");
        window.removeEventListener(LOCAL_HISTORY_EVENT, listener);
        expect(seen).toEqual([]);
    });
});
