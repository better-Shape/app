import { describe, expect, it } from "vitest";
import { minimapBand, minimapRows } from "@/features/editor/ui/codemirror/minimap";

describe("minimap rows", () => {
    it("reports the indent and the body length of each line", () => {
        expect(minimapRows("root\n  child\n\tdeep", 10)).toEqual([
            { indent: 0, length: 4 },
            { indent: 2, length: 5 },
            { indent: 1, length: 4 },
        ]);
    });

    it("keeps blank lines as empty rows so the shape of the document survives", () => {
        expect(minimapRows("a\n\nb", 10)).toEqual([
            { indent: 0, length: 1 },
            { indent: 0, length: 0 },
            { indent: 0, length: 1 },
        ]);
    });

    it("samples a long document instead of drawing every line", () => {
        const text = Array.from({ length: 1000 }, (_, index) => `line ${index}`).join("\n");

        const rows = minimapRows(text, 100);

        expect(rows.length).toBeLessThanOrEqual(101);
        expect(rows[0]).toEqual({ indent: 0, length: 6 });
        // Sampling keeps the spread across the file, not just the top of it.
        expect(rows.at(-1)?.length).toBeGreaterThan(0);
    });

    it("handles an empty document", () => {
        expect(minimapRows("", 10)).toEqual([{ indent: 0, length: 0 }]);
    });
});

describe("minimap viewport band", () => {
    const base = { scrollTop: 0, scrollHeight: 4000, clientHeight: 800, height: 800, lineHeight: 20, totalLines: 200 };

    it("is absent when the whole document fits on screen", () => {
        expect(minimapBand({ ...base, totalLines: 30 })).toBeNull();
    });

    it("scales the band by visible lines, not by the scroller's minimum height", () => {
        // 40 of 200 lines visible -> a fifth of the map.
        expect(minimapBand(base)).toEqual({ top: 0, height: 160 });
    });

    it("moves the band as the document scrolls and stops at the bottom", () => {
        expect(minimapBand({ ...base, scrollTop: 1600 })).toEqual({ top: 320, height: 160 });
        expect(minimapBand({ ...base, scrollTop: 99999 })).toEqual({ top: 640, height: 160 });
    });

    it("never returns a band shorter than a few pixels", () => {
        expect(minimapBand({ ...base, totalLines: 100_000 })?.height).toBe(6);
    });
});
