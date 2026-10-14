import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../../scripts/build/frontmatter.mjs";

describe("data-only documentation frontmatter", () => {
    it("parses YAML mappings, block scalars, and CRLF while retaining the body", () => {
        expect(parseFrontmatter('\uFEFF---\r\ntitle: "Build: locally"\r\norder: 3\r\ndescription: >\r\n  Windows and\r\n  Linux\r\n---\r\n# Hello\r\nBody')).toEqual({
            data: { title: "Build: locally", order: 3, description: "Windows and Linux\n" }, content: "# Hello\nBody",
        });
    });
    it("keeps plain markdown and empty frontmatter valid", () => {
        expect(parseFrontmatter("# Plain\nBody")).toEqual({ data: {}, content: "# Plain\nBody" });
        expect(parseFrontmatter("---\n---\nBody")).toEqual({ data: {}, content: "Body" });
        expect(parseFrontmatter("---yaml\ntitle: Title\n...\nBody")).toEqual({ data: { title: "Title" }, content: "Body" });
    });
    it("rejects executable engines, custom tags, invalid mappings and unclosed headers", () => {
        for (const source of ["---javascript\n({order: 1})\n---", "---\nx: !!js/function >\n  function() { return 1; }\n---", "---\n- one\n---", "---\nhello\n---", "---\ntitle: Title"]) {
            expect(() => parseFrontmatter(source)).toThrow();
        }
    });
    it("preserves indented delimiters inside YAML block scalars", () => {
        expect(parseFrontmatter("---\ndescription: |\n  ---\n  ...\n  text\n--- \t\nBody")).toEqual({
            data: { description: "---\n...\ntext\n" }, content: "Body",
        });
    });
    it("does not coerce dates into Date objects", () => {
        expect(parseFrontmatter("---\ndate: 2026-10-14\n---").data).toEqual({ date: "2026-10-14" });
    });
});
