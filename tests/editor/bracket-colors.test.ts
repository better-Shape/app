import { describe, expect, it } from "vitest";
import { bracketMarks } from "@/features/editor/ui/codemirror/bracket-colors";

const depths = (text: string) => bracketMarks(text).map((mark) => mark.depth);

describe("bracket depths", () => {
    it("gives an opening bracket and its partner the same depth", () => {
        // (  (  )  )
        expect(depths("(())")).toEqual([0, 1, 1, 0]);
    });

    it("keeps sibling brackets at the same level", () => {
        expect(depths("[a][b]")).toEqual([0, 0, 0, 0]);
    });

    it("counts mixed bracket kinds together", () => {
        expect(depths("{[()]}")).toEqual([0, 1, 2, 2, 1, 0]);
    });

    it("clamps a stray closing bracket instead of going negative", () => {
        expect(depths(")(")).toEqual([0, 0]);
    });

    it("ignores brackets that never close", () => {
        expect(depths("(((")).toEqual([0, 1, 2]);
    });

    it("reports the position of every bracket it marks", () => {
        expect(bracketMarks("a(b)").map((mark) => mark.pos)).toEqual([1, 3]);
    });

    it("returns nothing for text without brackets", () => {
        expect(bracketMarks("const value = 1;")).toEqual([]);
    });
});
