import { describe, expect, it } from "vitest";
import { isNumericDraft, parseNumericDraft } from "@/features/preview/design/panel/numeric-draft";

/** The pattern the inspector used before it was written as a scan. */
const OLD_INSPECTOR_PATTERN = /^-?(?:\d+(?:\.\d+)?|\.\d+)\s*\S*$/;

describe("inspector numeric drafts", () => {
    it("accepts a number with or without a unit", () => {
        expect(parseNumericDraft("12")).toEqual({ value: "12", unit: "" });
        expect(parseNumericDraft("-1.5rem")).toEqual({ value: "-1.5", unit: "rem" });
        expect(parseNumericDraft(".5")).toEqual({ value: ".5", unit: "" });
    });

    it("keeps the space in a spaced unit so a step does not reformat the value", () => {
        expect(parseNumericDraft("12 px")).toEqual({ value: "12", unit: " px" });
    });

    it("rejects text that is not a single number plus a single unit", () => {
        for (const value of ["", "auto", "px12", "-", "+12", "12 px extra"]) {
            expect(parseNumericDraft(value), value).toBeNull();
        }
    });

    it("agrees with the pattern it replaced on the values the field sees", () => {
        const samples = [
            "12",
            "-1.5",
            "12px",
            "-1.5rem",
            "0.5 rem",
            "auto",
            "1e3",
            ".5",
            "-.5px",
            "12  ",
            "1.2.3",
            "px12",
            "-",
            "12 px extra",
            "+12",
            " 12 ",
            "1.",
            "-.",
        ];
        for (const sample of samples) {
            expect(isNumericDraft(sample), sample).toBe(OLD_INSPECTOR_PATTERN.test(sample.trim()));
        }
    });
});
