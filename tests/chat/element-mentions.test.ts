import { describe, expect, it } from "vitest";
import {
    elementMentionBlock,
    lookupElementMention,
    registerElementMention,
} from "@/lib/chat/element-mentions";

const base = {
    tag: "button",
    label: "SubmitButton",
    selector: "main > form > button",
    rect: { x: 0, y: 0, w: 120, h: 32 },
    text: "Submit",
    styles: { color: "rgb(255, 255, 255)" },
    size: { w: 120, h: 32 },
};

describe("element mentions", () => {
    it("registers a token, sanitises the tag and keeps the given label", () => {
        const token = registerElementMention({ ...base, tag: "My Button!" });
        expect(token).toMatch(/^@element:mybutton-\d+$/);
        expect(lookupElementMention(token)?.selector).toBe(base.selector);
        // The id without the `@` resolves the same record.
        expect(lookupElementMention(token.slice(1))?.tag).toBe("My Button!");
    });

    it("falls back to the tag when no label was given", () => {
        const token = registerElementMention({ ...base, label: "" });
        expect(lookupElementMention(token)).not.toBeNull();
        expect(elementMentionBlock(token, { ...base, label: "" })).toContain('selector="main &gt; form &gt; button"');
    });

    it("names the Browser tab for a browser pick", () => {
        const block = elementMentionBlock("@element:browser", base);
        expect(block).toContain("selected this element in the Browser tab");
        expect(block).not.toContain("Source:");
    });

    it("names the Design tab and the source file for a design pick", () => {
        const block = elementMentionBlock("@element:design", {
            ...base,
            origin: "design",
            source: "components/submit.tsx:42",
        });
        expect(block).toContain("selected this element in the Design tab");
        expect(block).toContain("Source: components/submit.tsx:42");
    });

    it("escapes markup from the page so a stray quote cannot break the block", () => {
        const block = elementMentionBlock("@element:quoted", {
            ...base,
            selector: 'a[title="x"]',
            text: "<script>",
        });
        expect(block).toContain("&quot;");
        expect(block).not.toContain("<script>");
    });
});
