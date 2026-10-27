/**
 * Dev-only performance HUD.
 *
 * Samples frame pacing, long tasks, IPC round-trips and component commit
 * counts entirely in-process. Nothing is sent anywhere: there is no network
 * call, no beacon and no persistence of measurements.
 *
 * Enabled by default in development; `?perfhud=0` turns it off for a session
 * and `localStorage["bettershape-perf-hud"] === "1"` opts a production build in.
 */

const FRAME_WINDOW = 120;
const INVOKE_WINDOW = 200;
const NOTIFY_INTERVAL_MS = 250;

export type PerfHudFrameStats = {
    fps: number;
    avgMs: number;
    worstMs: number;
};

export type PerfHudInvokeStats = {
    count: number;
    avgMs: number;
    p95Ms: number;
    slowest: { command: string; ms: number } | null;
};

type InvokeSample = { command: string; ms: number };

function isBrowser() {
    return typeof window !== "undefined";
}

function readDevOverride(): boolean | null {
    if (!isBrowser()) return null;
    try {
        const params = new URLSearchParams(window.location.search);
        const flag = params.get("perfhud");
        if (flag === "0" || flag === "false") return false;
        if (flag === "1" || flag === "true") return true;
    } catch {
        /* ignore */
    }
    return null;
}

function readStoredOptIn(): boolean {
    if (!isBrowser()) return false;
    try {
        return window.localStorage.getItem("bettershape-perf-hud") === "1";
    } catch {
        return false;
    }
}

/**
 * Cached because the render counter asks on every commit, including production
 * builds where `localStorage` must not be touched per frame.
 */
let enabledCache: boolean | null = null;

function computePerfHudEnabled(): boolean {
    const override = readDevOverride();
    if (override === false) return false;
    // Tests are not a performance environment; only an explicit flag opts in.
    if (process.env.NODE_ENV === "test") return override === true;
    if (override === true) return true;
    if (process.env.NODE_ENV !== "production") return true;
    return readStoredOptIn();
}

export function isPerfHudEnabled(): boolean {
    if (enabledCache === null) enabledCache = computePerfHudEnabled();
    return enabledCache;
}

/** Tests only: forget the cached decision (for example after changing the URL). */
export function resetPerfHudEnabledCache(): void {
    enabledCache = null;
}

class PerfHudStore {
    private frameDurations: number[] = [];
    private invokeSamples: InvokeSample[] = [];
    private renderCounts = new Map<string, number>();
    private longTasks = 0;
    private longTaskMs = 0;
    private version = 0;
    private started = false;
    private rafId = 0;
    private lastFrameAt = 0;
    private notifyTimer: ReturnType<typeof setTimeout> | null = null;
    private listeners = new Set<() => void>();
    private observer: PerformanceObserver | null = null;
    private subscribers = 0;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        this.subscribers += 1;
        this.start();
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            this.listeners.delete(listener);
            this.subscribers = Math.max(0, this.subscribers - 1);
            // Nothing is displaying samples, so stop the frame loop and the
            // observer instead of sampling forever after an unmount.
            if (this.subscribers === 0) this.stop();
        };
    };

    isRunning(): boolean {
        return this.started;
    }

    subscriberCount(): number {
        return this.subscribers;
    }

    getVersion = (): number => this.version;

    start(): void {
        if (this.started || !isBrowser()) return;
        if (typeof requestAnimationFrame !== "function") return;
        this.started = true;

        const tick = (now: number) => {
            if (this.lastFrameAt) {
                const delta = now - this.lastFrameAt;
                this.frameDurations.push(delta);
                if (this.frameDurations.length > FRAME_WINDOW) this.frameDurations.shift();
            }
            this.lastFrameAt = now;
            this.scheduleNotify();
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);

        try {
            this.observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    this.longTasks += 1;
                    this.longTaskMs += entry.duration;
                }
                this.scheduleNotify();
            });
            this.observer.observe({ entryTypes: ["longtask"] });
        } catch {
            // Safari/WebView2 without longtask support: the frame timer still works.
            this.observer = null;
        }
    }

    stop(): void {
        this.started = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = 0;
        this.lastFrameAt = 0;
        this.observer?.disconnect();
        this.observer = null;
        if (this.notifyTimer !== null) {
            clearTimeout(this.notifyTimer);
            this.notifyTimer = null;
        }
    }

    reset(): void {
        this.frameDurations = [];
        this.invokeSamples = [];
        this.renderCounts.clear();
        this.longTasks = 0;
        this.longTaskMs = 0;
        this.bump();
    }

    recordRender(id: string): void {
        this.renderCounts.set(id, (this.renderCounts.get(id) ?? 0) + 1);
        this.scheduleNotify();
    }

    recordInvoke(command: string, ms: number): void {
        this.invokeSamples.push({ command, ms });
        if (this.invokeSamples.length > INVOKE_WINDOW) this.invokeSamples.shift();
        this.scheduleNotify();
    }

    frames(): PerfHudFrameStats {
        const durations = this.frameDurations;
        if (durations.length === 0) return { fps: 0, avgMs: 0, worstMs: 0 };
        const total = durations.reduce((sum, value) => sum + value, 0);
        const avgMs = total / durations.length;
        return {
            fps: avgMs > 0 ? Math.round(1000 / avgMs) : 0,
            avgMs: Number(avgMs.toFixed(1)),
            worstMs: Number(Math.max(...durations).toFixed(1)),
        };
    }

    longTaskStats(): { count: number; totalMs: number } {
        return { count: this.longTasks, totalMs: Math.round(this.longTaskMs) };
    }

    invokeStats(): PerfHudInvokeStats {
        const samples = this.invokeSamples;
        if (samples.length === 0) {
            return { count: 0, avgMs: 0, p95Ms: 0, slowest: null };
        }
        const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);
        const total = sorted.reduce((sum, value) => sum + value, 0);
        let slowest = samples[0]!;
        for (const sample of samples) {
            if (sample.ms > slowest.ms) slowest = sample;
        }
        return {
            count: samples.length,
            avgMs: Number((total / samples.length).toFixed(1)),
            p95Ms: Number((sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1]!).toFixed(1)),
            slowest: { command: slowest.command, ms: Number(slowest.ms.toFixed(1)) },
        };
    }

    /** Commits per component id, hottest first. */
    renderReport(): { id: string; count: number }[] {
        return [...this.renderCounts.entries()]
            .map(([id, count]) => ({ id, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6);
    }

    private bump() {
        this.version += 1;
        this.listeners.forEach((listener) => {
            try {
                listener();
            } catch {
                /* a broken subscriber must not stop sampling */
            }
        });
    }

    private scheduleNotify() {
        if (this.listeners.size === 0) return;
        if (this.notifyTimer !== null) return;
        this.notifyTimer = setTimeout(() => {
            this.notifyTimer = null;
            this.bump();
        }, NOTIFY_INTERVAL_MS);
    }
}

export const perfHud = new PerfHudStore();

if (typeof window !== "undefined" && isPerfHudEnabled()) {
    (window as unknown as Record<string, unknown>).betterShapePerfHud = {
        report: () => ({
            frames: perfHud.frames(),
            longTasks: perfHud.longTaskStats(),
            invokes: perfHud.invokeStats(),
            renders: perfHud.renderReport(),
        }),
        reset: () => perfHud.reset(),
    };
}
