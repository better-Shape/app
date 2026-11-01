/**
 * A dev run's exit event is only meaningful for the PTY that run owns. Before
 * the run's own PTY is known, an exit cannot be attributed, and the spawn path
 * reports its own early exit, so those events are ignored.
 */
import { beforeEach, expect, it, vi } from "vitest";
import {
    clearDevRun,
    getDevRunSnapshot,
    noteDevRunExit,
    setDevRunPtyId,
    startDevRun,
} from "@/features/preview/run-status";

beforeEach(() => {
    clearDevRun();
    vi.useRealTimers();
});

it("ignores an exit that arrives before the run's own PTY is known", () => {
    startDevRun("npm run dev");
    noteDevRunExit(0, 4242);
    expect(getDevRunSnapshot().status).toBe("starting");
    expect(getDevRunSnapshot().alive).toBe(true);
});

it("ignores another terminal's exit once the run is bound", () => {
    startDevRun("npm run dev");
    setDevRunPtyId(11);
    noteDevRunExit(0, 77);
    expect(getDevRunSnapshot().status).toBe("starting");
    noteDevRunExit(0, 11);
    expect(getDevRunSnapshot().status).toBe("idle");
});

it("does not inherit the previous run's PTY id", () => {
    startDevRun("npm run dev");
    setDevRunPtyId(11);
    // A new run starts before its spawn answers; the old id must not carry over,
    // or the new process's own exit would be rejected as a stranger.
    startDevRun("npm run dev");
    setDevRunPtyId(12);
    noteDevRunExit(1, 12);
    expect(getDevRunSnapshot().status).toBe("error");
});
