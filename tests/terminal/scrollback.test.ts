import { describe, expect, it } from "vitest";
import { TerminalSessionStore } from "@/features/terminal/session";

/** The cap the store keeps, mirrored here so the test states its own contract. */
const MAX = 400_000;

/** Deterministic PRNG so a failure is reproducible. */
function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

describe("terminal scrollback", () => {
    it("returns everything below the cap", () => {
        const store = new TerminalSessionStore();
        store.appendPtyOutput(1, "hello ");
        store.appendPtyOutput(1, "world");
        expect(store.takePtyScrollback(1)).toBe("hello world");
    });

    it("returns empty string for an unknown pty", () => {
        const store = new TerminalSessionStore();
        expect(store.takePtyScrollback(99)).toBe("");
    });

    it("keeps the newest text and stays bounded under many chunks", () => {
        const store = new TerminalSessionStore();
        const rand = rng(42);
        let all = "";
        let largest = 0;
        for (let i = 0; i < 2_000; i++) {
            const size = 100 + Math.floor(rand() * 400);
            largest = Math.max(largest, size);
            const chunk = String.fromCharCode(97 + (i % 26)).repeat(size);
            all += chunk;
            store.appendPtyOutput(1, chunk);
        }
        const kept = store.takePtyScrollback(1);
        expect(kept.length).toBeLessThanOrEqual(MAX);
        // It is a suffix of everything written...
        expect(all.endsWith(kept)).toBe(true);
        // ...and it keeps a full window, within one chunk of the cap.
        expect(kept.length).toBeGreaterThan(MAX - largest - 1);
    });

    it("trims a single chunk larger than the cap to its tail", () => {
        const store = new TerminalSessionStore();
        const huge = "x".repeat(MAX + 50_000) + "TAIL";
        store.appendPtyOutput(7, huge);
        const kept = store.takePtyScrollback(7);
        expect(kept.length).toBe(MAX);
        expect(kept.endsWith("TAIL")).toBe(true);
    });

    it("keeps pty buffers independent and clearable", () => {
        const store = new TerminalSessionStore();
        store.appendPtyOutput(1, "one");
        store.appendPtyOutput(2, "two");
        expect(store.takePtyScrollback(1)).toBe("one");
        expect(store.takePtyScrollback(2)).toBe("two");
        store.clearPtyScrollback(1);
        expect(store.takePtyScrollback(1)).toBe("");
        expect(store.takePtyScrollback(2)).toBe("two");
    });

    it("appends into a buffer that was cleared and reused", () => {
        const store = new TerminalSessionStore();
        store.appendPtyOutput(3, "a".repeat(10));
        store.clearPtyScrollback(3);
        store.appendPtyOutput(3, "b");
        expect(store.takePtyScrollback(3)).toBe("b");
    });
});
