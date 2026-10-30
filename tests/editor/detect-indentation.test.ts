import { describe, expect, it } from "vitest";
import { detectIndentation } from "@/features/editor/lib/detect-indentation";

describe("detect indentation", () => {
    it("returns nothing for a file with no indentation", () => {
        expect(detectIndentation("a\nb\nc\n")).toBeNull();
        expect(detectIndentation("")).toBeNull();
    });

    it("reads the smallest space indent as the tab size", () => {
        const source = ["function a() {", "  if (x) {", "    return 1;", "  }", "}"].join("\n");
        expect(detectIndentation(source)).toEqual({ tabSize: 2, insertSpaces: true });
    });

    it("matches a four-space file and a tabbed file", () => {
        expect(detectIndentation("a {\n    b\n        c\n}\n")).toEqual({ tabSize: 4, insertSpaces: true });
        expect(detectIndentation("a {\n\tb\n\t\tc\n}\n")).toEqual({ tabSize: 1, insertSpaces: false });
    });

    it("follows the majority when a file mixes both", () => {
        const source = ["a", "\tb", "\tc", "  d"].join("\n");
        expect(detectIndentation(source)).toEqual({ tabSize: 1, insertSpaces: false });
    });

    it("ignores blank lines and refuses an implausible indent", () => {
        expect(detectIndentation("a\n\n   \n  b\n")).toEqual({ tabSize: 2, insertSpaces: true });
        expect(detectIndentation(`${" ".repeat(20)}a\n${" ".repeat(40)}b\n`)).toBeNull();
    });
});
