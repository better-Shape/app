import { describe, expect, it, vi } from "vitest";
import {
    cleanPath,
    formatTimeAgo,
    getRepoName,
    upsertRepoHistory,
    loadRepoHistory,
    clearRepoHistory,
    getRepoHistorySnapshot,
    getServerRepoHistorySnapshot,
    subscribeRepoHistory,
    saveRepoHistory,
} from "@/lib/workspace/repo-history";

describe("repo-history", () => {
    it("extracts repo name from path", () => {
        expect(getRepoName("C:/Users/dev/my-app")).toBe("my-app");
        expect(getRepoName("C:/Users/dev/my-app/")).toBe("my-app");
    });

    it("cleans windows user paths", () => {
        expect(cleanPath("C:/Users/alice/projects/app")).toBe("~/projects/app");
    });

    it("formats time ago", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2025-01-01T12:00:00Z"));
        expect(formatTimeAgo(Date.now() - 30_000)).toBe("just now");
        expect(formatTimeAgo(Date.now() - 5 * 60_000)).toBe("5m ago");
        expect(formatTimeAgo(Date.now() - 3 * 60 * 60_000)).toBe("3h ago");
        expect(formatTimeAgo(Date.now() - 2 * 24 * 60 * 60_000)).toBe("2d ago");
        vi.useRealTimers();
    });

    it("upserts and dedupes paths", () => {
        clearRepoHistory();
        upsertRepoHistory("C:/a");
        upsertRepoHistory("C:/b");
        upsertRepoHistory("C:/a");
        const history = loadRepoHistory();
        // New paths prepend; revisiting a known path only updates its timestamp in place.
        expect(history.map((e) => e.path)).toEqual(["C:/b", "C:/a"]);
    });

    it("caps history at fifteen entries", () => {
        clearRepoHistory();
        for (let i = 0; i < 20; i++) {
            upsertRepoHistory(`C:/repo-${i}`);
        }
        expect(loadRepoHistory()).toHaveLength(15);
    });
});

it("keeps render snapshots stable and migrates only after subscribing", () => {
    const raw = JSON.stringify([{ path: "/legacy", lastOpenedAt: 123 }]);
    localStorage.setItem("shape:repo-history", raw);
    const snapshot = getRepoHistorySnapshot();
    expect(snapshot).toEqual([{ path: "/legacy", lastOpenedAt: 123 }]);
    expect(getRepoHistorySnapshot()).toBe(snapshot);
    expect(localStorage.getItem("bettershape:repo-history")).toBeNull();
    expect(localStorage.getItem("shape:repo-history")).toBe(raw);
    const stop = subscribeRepoHistory(() => {});
    try {
        expect(localStorage.getItem("bettershape:repo-history")).toBe(raw);
        expect(localStorage.getItem("shape:repo-history")).toBeNull();
        expect(getRepoHistorySnapshot()).toBe(snapshot);
        expect(getServerRepoHistorySnapshot()).toEqual([]);
    } finally { stop(); }
});

it("notifies for same-window writes, focus, cross-window changes and clear, then unsubscribes", () => {
    const changed = vi.fn();
    const stop = subscribeRepoHistory(changed);
    try {
        saveRepoHistory([{ path: "/current", lastOpenedAt: 123 }]);
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new StorageEvent("storage", { key: "bettershape:repo-history" }));
        expect(changed).toHaveBeenCalledTimes(3);
        expect(getRepoHistorySnapshot()[0]?.path).toBe("/current");
        clearRepoHistory();
        expect(changed).toHaveBeenCalledTimes(4);
        expect(getRepoHistorySnapshot()).toEqual([]);
    } finally { stop(); }
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("bettershape-repo-history-changed"));
    expect(changed).toHaveBeenCalledTimes(4);
});

it("returns stable empty snapshots for malformed storage and rejects nonfinite timestamps", () => {
    localStorage.setItem("bettershape:repo-history", "{broken");
    const empty = getRepoHistorySnapshot();
    expect(empty).toEqual([]);
    expect(getRepoHistorySnapshot()).toBe(empty);
    localStorage.setItem("bettershape:repo-history", '[{"path":"/bad","lastOpenedAt":1e900},{"path":"/ok","lastOpenedAt":12}]');
    expect(getRepoHistorySnapshot()).toEqual([{ path: "/ok", lastOpenedAt: 12 }]);
});
