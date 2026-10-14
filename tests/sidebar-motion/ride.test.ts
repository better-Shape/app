import { describe, expect, it } from "vitest";
import { ridingDelta, ridingDirection, ridingFor } from "@/features/agent/sidebar/motion";

/**
 * The trap this module documents: a row's *measured* delta already contains the
 * displacement caused by everything above it, so "what did I inherit from the
 * row above" cannot be read from a row's own delta. These tests therefore pin
 * the reconstruction from structural events, including the off-by-one that an
 * entering row must not displace itself.
 */

describe("ridingDelta", () => {
    it("attributes an insertion to every row it displaces but not to itself", () => {
        // n arrives at index 0, so the first row it displaces is index 1.
        const deltas = ridingDelta([{ id: "n", contribution: 40, index: 1 }], ["n", "a", "b", "c"]);

        expect(deltas.get("n")).toEqual({ own: 40, inherited: 0, leader: 0 });
        expect(deltas.get("a")).toEqual({ own: 0, inherited: 40, leader: 40 });
        expect(deltas.get("b")?.inherited).toBe(40);
        expect(deltas.get("c")?.inherited).toBe(40);
    });

    it("stops attributing at the end of the list", () => {
        // The new row is last, so its displacement index is one past the end.
        const deltas = ridingDelta([{ id: "n", contribution: 40, index: 4 }], ["a", "b", "c", "n"]);

        expect(deltas.get("n")).toEqual({ own: 40, inherited: 0, leader: 0 });
        expect(deltas.get("a")?.inherited).toBe(0);
        expect(deltas.get("c")?.inherited).toBe(0);
    });

    it("accumulates separate blocks and keeps the current leader", () => {
        const deltas = ridingDelta(
            [
                { id: "n", contribution: 40, index: 1 },
                { id: "m", contribution: 25, index: 3 },
            ],
            ["n", "a", "m", "b", "c"],
        );

        expect(deltas.get("n")?.inherited).toBe(0);
        expect(deltas.get("a")).toEqual({ own: 0, inherited: 40, leader: 40 });
        expect(deltas.get("m")).toEqual({ own: 25, inherited: 40, leader: 40 });
        // b and c are below both insertions.
        expect(deltas.get("b")?.inherited).toBe(65);
        expect(deltas.get("c")?.inherited).toBe(65);
        // The leader is what started the *running total*, which is still n: the
        // 25 has been added on top of the 40, it has not replaced it.
        expect(deltas.get("c")?.leader).toBe(40);
    });

    it("treats a removal as a negative contribution from where it was", () => {
        // b was removed from between a and c, so c is the first row it displaced.
        const deltas = ridingDelta([{ id: "b", contribution: -40, index: 1 }], ["a", "c"]);

        expect(deltas.get("a")).toEqual({ own: 0, inherited: 0, leader: 0 });
        expect(deltas.get("c")?.inherited).toBe(-40);
        // A row that left has no position to read, but callers still see what it
        // took with it.
        expect(deltas.get("b")).toEqual({ own: -40, inherited: 0, leader: 0 });
    });

    it("does not let a leading removal reach the rows above it", () => {
        const deltas = ridingDelta([{ id: "top", contribution: -40, index: 0 }], ["a", "b"]);

        expect(deltas.get("a")?.inherited).toBe(-40);
        expect(deltas.get("b")?.inherited).toBe(-40);
        expect(deltas.get("top")?.own).toBe(-40);
    });

    it("gives a pure reorder no block at all", () => {
        const deltas = ridingDelta([], ["c", "b", "a"]);

        expect(deltas.get("c")).toEqual({ own: 0, inherited: 0, leader: 0 });
        expect(deltas.get("a")?.inherited).toBe(0);
    });

    it("sums two events that land on the same index", () => {
        const deltas = ridingDelta(
            [
                { id: "n", contribution: 40, index: 1 },
                { id: "m", contribution: 10, index: 1 },
            ],
            ["a", "n", "m", "b"],
        );

        expect(deltas.get("b")?.inherited).toBe(50);
        expect(deltas.get("n")?.own).toBe(40);
        expect(deltas.get("m")?.own).toBe(10);
    });

    it("returns nothing for an empty order", () => {
        expect(ridingDelta([{ id: "n", contribution: 40, index: 0 }], []).size).toBe(0);
    });

    it("ignores a non-finite contribution rather than poisoning the running total", () => {
        const deltas = ridingDelta([{ id: "n", contribution: Number.NaN, index: 1 }], ["a", "b"]);

        expect(deltas.get("b")?.inherited).toBe(0);
        expect(deltas.get("n")?.own).toBe(0);
    });
});

describe("ridingFor", () => {
    it("returns zeros for an unknown id instead of throwing", () => {
        expect(ridingFor(new Map(), "missing")).toEqual({ own: 0, inherited: 0, leader: 0 });
    });
});

describe("ridingDirection", () => {
    it("reads a negative start offset as a block pushing down, so the row comes from above", () => {
        expect(ridingDirection(-40)).toBe(-1);
        expect(ridingDirection(-0.5)).toBe(-1);
    });

    it("reads a positive start offset as a block moving up, so the row rises", () => {
        expect(ridingDirection(40)).toBe(1);
        expect(ridingDirection(0.5)).toBe(1);
    });

    it("defaults to a rise when nothing is moving or the signal is unusable", () => {
        expect(ridingDirection(null)).toBe(1);
        expect(ridingDirection(undefined)).toBe(1);
        expect(ridingDirection(0)).toBe(1);
        expect(ridingDirection(Number.NaN)).toBe(1);
    });
});
