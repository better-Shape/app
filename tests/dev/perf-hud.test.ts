import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    isPerfHudEnabled,
    perfHud,
    resetPerfHudEnabledCache,
} from "@/lib/dev/perf-hud";
import { mountPerfHud } from "@/lib/dev/perf-hud-overlay";

describe("perf hud store", () => {
    beforeEach(() => {
        perfHud.reset();
    });

    it("reports no samples before anything is recorded", () => {
        expect(perfHud.frames()).toEqual({ fps: 0, avgMs: 0, worstMs: 0 });
        expect(perfHud.invokeStats()).toEqual({ count: 0, avgMs: 0, p95Ms: 0, slowest: null });
        expect(perfHud.renderReport()).toEqual([]);
    });

    it("summarises invoke latency over a rolling window", () => {
        perfHud.recordInvoke("git_status", 10);
        perfHud.recordInvoke("read_file", 30);
        perfHud.recordInvoke("pty_spawn", 5);
        const stats = perfHud.invokeStats();
        expect(stats.count).toBe(3);
        expect(stats.avgMs).toBe(15);
        expect(stats.slowest).toEqual({ command: "read_file", ms: 30 });
        expect(stats.p95Ms).toBe(30);
    });

    it("reports the nearest-rank p95 rather than the maximum", () => {
        // 20 samples is the size where `floor(n * 0.95)` lands on the last index.
        for (let i = 1; i <= 20; i++) perfHud.recordInvoke("cmd", i);
        const stats = perfHud.invokeStats();
        expect(stats.count).toBe(20);
        // ceil(20 * 0.95) - 1 = 18 → the 19th smallest of 1..20.
        expect(stats.p95Ms).toBe(19);
        expect(stats.p95Ms).not.toBe(20);
    });

    it("caps the invoke window so memory stays flat", () => {
        for (let i = 0; i < 250; i++) perfHud.recordInvoke("cmd", 1);
        expect(perfHud.invokeStats().count).toBe(200);
    });

    it("orders component commit counts hottest first and caps the list", () => {
        perfHud.recordRender("chat.list");
        perfHud.recordRender("chat.list");
        perfHud.recordRender("terminal");
        for (let i = 0; i < 8; i++) perfHud.recordRender(`widget-${i}`);
        const report = perfHud.renderReport();
        expect(report[0]).toEqual({ id: "chat.list", count: 2 });
        expect(report).toHaveLength(6);
        expect(report.filter((entry) => entry.id === "terminal")).toHaveLength(1);
    });

    it("clears counters on reset", () => {
        perfHud.recordInvoke("x", 2);
        perfHud.recordRender("y");
        perfHud.reset();
        expect(perfHud.invokeStats().count).toBe(0);
        expect(perfHud.renderReport()).toEqual([]);
    });

    it("is disabled in the test environment by default", () => {
        resetPerfHudEnabledCache();
        expect(isPerfHudEnabled()).toBe(false);
        // The decision is cached, so a production render costs one boolean read.
        expect(isPerfHudEnabled()).toBe(false);
    });

    it("stops sampling when the last subscriber leaves", () => {
        const stop = vi.spyOn(perfHud, "stop");
        const unsubscribe = perfHud.subscribe(() => undefined);
        expect(perfHud.subscriberCount()).toBe(1);
        unsubscribe();
        expect(perfHud.subscriberCount()).toBe(0);
        expect(stop).toHaveBeenCalledTimes(1);
        expect(perfHud.isRunning()).toBe(false);
        stop.mockRestore();
    });

    it("ignores a repeated unsubscribe", () => {
        const stop = vi.spyOn(perfHud, "stop");
        const unsubscribe = perfHud.subscribe(() => undefined);
        unsubscribe();
        unsubscribe();
        expect(perfHud.subscriberCount()).toBe(0);
        expect(stop).toHaveBeenCalledTimes(1);
        stop.mockRestore();
    });

    it("keeps sampling while another subscriber remains", () => {
        const stop = vi.spyOn(perfHud, "stop");
        const first = perfHud.subscribe(() => undefined);
        const second = perfHud.subscribe(() => undefined);
        first();
        expect(stop).not.toHaveBeenCalled();
        second();
        expect(stop).toHaveBeenCalledTimes(1);
        stop.mockRestore();
    });

    it("keeps the collapsed header showing live frames", async () => {
        vi.useFakeTimers();
        window.history.replaceState({}, "", "/?perfhud=1");
        resetPerfHudEnabledCache();
        const frames = vi.spyOn(perfHud, "frames").mockReturnValue({ fps: 61, avgMs: 16.4, worstMs: 40 });
        const unmount = mountPerfHud();
        const root = document.querySelector("[data-perf-hud]");
        expect(root).not.toBeNull();
        const collapse = Array.from(root!.querySelectorAll("button"))
            .find((button) => button.getAttribute("aria-label") === "Collapse performance HUD");
        expect(collapse).toBeDefined();
        collapse!.click();
        expect(root!.textContent).toContain("61 fps");

        // A later commit must refresh the label, not leave the first value frozen.
        frames.mockReturnValue({ fps: 44, avgMs: 22.7, worstMs: 90 });
        perfHud.recordRender("chat.list");
        await vi.advanceTimersByTimeAsync(300);
        expect(root!.textContent).toContain("44 fps");

        unmount();
        frames.mockRestore();
        vi.useRealTimers();
        window.history.replaceState({}, "", "/");
        resetPerfHudEnabledCache();
    });

    it("does not mount the overlay while disabled", () => {
        const unmount = mountPerfHud();
        expect(document.querySelector("[data-perf-hud]")).toBeNull();
        expect(() => unmount()).not.toThrow();
    });
});
