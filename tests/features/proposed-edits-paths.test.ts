import { describe, expect, it } from "vitest";
import { editContentHash, pathsEqual } from "@/features/chat/lib/proposed-edits";

describe("proposed-edits path matching", () => {
    it("matches exact and relative-vs-absolute paths", () => {
        expect(pathsEqual("src/a.ts", "src/a.ts")).toBe(true);
        expect(pathsEqual("C:/proj/src/a.ts", "src/a.ts")).toBe(true);
        expect(pathsEqual("src\\a.ts", "src/a.ts")).toBe(true);
    });

    it("does not collide short suffixes like a.ts vs data.ts", () => {
        expect(pathsEqual("src/a.ts", "src/data.ts")).toBe(false);
        expect(pathsEqual("a.ts", "data.ts")).toBe(false);
    });

    it("hashes replacement content stably", () => {
        expect(editContentHash("hello\n")).toBe(editContentHash("hello\n"));
        expect(editContentHash("hello\n")).not.toBe(editContentHash("hello\r\nworld"));
    });

    // Pins the int32 hash used to match accepted/rejected edits. A refactor away from
    // `| 0` must keep these values or persisted edit statuses stop matching.
    it("keeps the int32 fingerprint for existing content", () => {
        expect(editContentHash("")).toBe("0:0");
        expect(editContentHash("hello")).toBe("5:1n1e4y");
        expect(editContentHash("hello\n")).toBe("6:-k6wvpk");
        expect(editContentHash("hello\r\nworld")).toBe("11:j968ey");
    });
});
