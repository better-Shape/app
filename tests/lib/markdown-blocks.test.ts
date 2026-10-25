import { describe, expect, it } from "vitest";
import {
    hasUnclosedMarkdownFence,
    splitStreamingMarkdownBlocks,
} from "@/lib/chat/markdown-blocks";

describe("splitStreamingMarkdownBlocks & hasUnclosedMarkdownFence", () => {
    it("returns empty settled blocks and empty tail for empty input", () => {
        expect(splitStreamingMarkdownBlocks("")).toEqual({
            settled: [],
            tail: "",
        });
        expect(hasUnclosedMarkdownFence("")).toBe(false);
    });

    it("splits multi-paragraph prose into immutable settled blocks plus the active tail", () => {
        const md = [
            "## Architecture Summary",
            "",
            "First paragraph explaining incremental block splitting.",
            "",
            "Second paragraph still streaming tokens...",
        ].join("\n");

        const res = splitStreamingMarkdownBlocks(md);
        expect(res.settled).toEqual([
            "## Architecture Summary",
            "First paragraph explaining incremental block splitting.",
        ]);
        expect(res.tail).toBe("Second paragraph still streaming tokens...");
    });

    it("preserves blank lines inside fenced code blocks and detects unclosed fences accurately", () => {
        const openFenceMd = [
            "Intro paragraph.",
            "",
            "```tsx",
            "export function Counter() {",
            "",
            "  return <div>1</div>;",
        ].join("\n");

        expect(hasUnclosedMarkdownFence(openFenceMd)).toBe(true);
        const openSplit = splitStreamingMarkdownBlocks(openFenceMd);
        expect(openSplit.settled).toEqual(["Intro paragraph."]);
        expect(openSplit.tail).toContain("export function Counter()");
        expect(openSplit.tail).toContain("\n\n  return <div>1</div>;");
        expect(hasUnclosedMarkdownFence(openSplit.tail)).toBe(true);

        const closedFenceMd = `${openFenceMd}\n\`\`\`\n\nFollow-up explanation.`;
        expect(hasUnclosedMarkdownFence(closedFenceMd)).toBe(false);
        const closedSplit = splitStreamingMarkdownBlocks(closedFenceMd);
        expect(closedSplit.settled).toHaveLength(2);
        expect(closedSplit.settled[0]).toBe("Intro paragraph.");
        const secondSettled = closedSplit.settled[1];
        if (!secondSettled) throw new Error("expected second settled block");
        expect(secondSettled).toContain("```tsx");
        expect(secondSettled).toContain("```");
        expect(hasUnclosedMarkdownFence(secondSettled)).toBe(false);
        expect(closedSplit.tail).toBe("Follow-up explanation.");
    });

    it("handles longer outer fences (```` and ~~~) without prematurely closing on shorter inner fences", () => {
        const nestedFenceMd = [
            "Before example.",
            "",
            "````markdown",
            "```ts",
            "const x = 1;",
            "```",
            "",
            "Still inside outer 4-backtick fence",
        ].join("\n");

        expect(hasUnclosedMarkdownFence(nestedFenceMd)).toBe(true);
        const closedNested = `${nestedFenceMd}\n\`\`\`\`\n\n~~~~python\n~~~\nstill_in_tilde = True\n~~~~\n\nAfter example.`;
        expect(hasUnclosedMarkdownFence(`${nestedFenceMd}\n\`\`\`\`\n\n~~~~python\n~~~`)).toBe(true);
        expect(hasUnclosedMarkdownFence(closedNested)).toBe(false);
        const res = splitStreamingMarkdownBlocks(closedNested);
        expect(res.settled).toHaveLength(3);
        expect(res.tail).toBe("After example.");
    });

    it("keeps loose ordered and bulleted lists with indented continuations in a single block", () => {
        const listMd = [
            "1. First step",
            "",
            "   Indented continuation paragraph for step 1.",
            "",
            "2. Second step",
            "",
            "3. Third step",
            "",
            "Concluding summary paragraph.",
        ].join("\n");

        const res = splitStreamingMarkdownBlocks(listMd);
        expect(res.settled).toHaveLength(1);
        expect(res.settled[0]).toContain("1. First step");
        expect(res.settled[0]).toContain("2. Second step");
        expect(res.settled[0]).toContain("3. Third step");
        expect(res.tail).toBe("Concluding summary paragraph.");
    });

    it("falls back to whole-document tail when reference-style link or footnote definitions exist", () => {
        const refMd = [
            "Read the [design baseline][baseline] for details.",
            "",
            "Another paragraph in the same reply.",
            "",
            "[baseline]: https://example.com/design",
        ].join("\n");

        const res = splitStreamingMarkdownBlocks(refMd);
        expect(res.settled).toEqual([]);
        expect(res.tail).toBe(refMd);

        const footnoteMd = [
            "Claim backed by a citation.[^1]",
            "",
            "Second paragraph before footnote definition.",
            "",
            "[^1]: Footnote source details.",
        ].join("\n");
        const fnRes = splitStreamingMarkdownBlocks(footnoteMd);
        expect(fnRes.settled).toEqual([]);
        expect(fnRes.tail).toBe(footnoteMd);

        const escapedLabelMd = [
            "Escaped label [ref][foo\\]bar].",
            "",
            "[foo\\]bar]: https://example.com/escaped",
        ].join("\n");
        expect(splitStreamingMarkdownBlocks(escapedLabelMd).settled).toEqual([]);
    });
});
