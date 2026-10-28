import { describe, expect, it } from "vitest";
import { appendStreamAnsiChunk } from "@/features/chat/ui/blocks/terminal-live";
import { parseMessageContent } from "@/features/chat/ui/md/renderer";
import { preprocessChatMarkdown, stripLeakedToolCode } from "@/features/chat/ui/md/stream";

const stream = (t: string) => preprocessChatMarkdown(t, { streaming: true });

describe("streaming fence balancing", () => {
    it("closes a ``` block", () => {
        expect(stream("Hi\n```ts\nconst a = 1;")).toBe("Hi\n```ts\nconst a = 1;\n```");
    });

    it("leaves a closed block alone", () => {
        expect(stream("```ts\na\n```\ndone")).toBe("```ts\na\n```\ndone");
    });

    it("closes a ~~~ block with tildes", () => {
        expect(stream("~~~\nx = 1")).toBe("~~~\nx = 1\n~~~");
    });

    it("closes a four-backtick block with four, not three", () => {
        expect(stream("````md\n```js\nx\n```")).toBe("````md\n```js\nx\n```\n````");
    });

    it("balances an indented fence inside a list", () => {
        // A closing fence may sit at any indentation up to three spaces, so an
        // unindented closer still ends the list item's code block.
        expect(stream("- example:\n  ```sh\n  ls")).toBe("- example:\n  ```sh\n  ls\n```");
    });

    it("does not balance a fence whose info string contains a backtick", () => {
        expect(stream("```a`b\nx")).toBe("```a`b\nx");
    });

    it("closes only once when balanced twice", () => {
        const once = stream("```\nx");
        expect(stream(once)).toBe(once);
    });
});

describe("streaming length cap", () => {
    it("caps a runaway stream where the settled render caps it", () => {
        const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
        let text = "";
        for (let i = 0; i < 20_000; i++) text += `${words[i % words.length]} `;
        const live = stream(text);
        expect(live.length).toBeLessThan(48_100);
        expect(live).toContain("truncated for display");
        // Same prefix as the settled render, which truncates at the same point.
        expect(preprocessChatMarkdown(text).slice(0, 48_000)).toBe(live.slice(0, 48_000));
    });
});

describe("tool-dump fast path", () => {
    it("still strips an upper-case _EXECUTE dump", () => {
        const out = stripLeakedToolCode("Working.\n_EXECUTE\ntool_name: run_terminal\ncommand: ls\n");
        expect(out).not.toContain("_EXECUTE");
        expect(out).toContain("Working.");
    });

    it("still strips a lower-case _execute dump", () => {
        const out = stripLeakedToolCode("Working.\n_execute\ntool_name: run_terminal\ncommand: ls\n");
        expect(out).not.toContain("_execute");
    });

    it("leaves marker-free prose untouched apart from blank runs", () => {
        expect(stripLeakedToolCode("a\n\n\n\nb")).toBe("a\n\nb");
    });
});

describe("list-indented fences and surrogate-safe terminal cap", () => {
    it("protects <edit> inside 4-space fenced blocks in ordered and nested lists", () => {
        const ordered = [
            "1. Update the file:",
            "    ```xml",
            '    <edit file="src/app.tsx"><original>a</original><replacement>b</replacement></edit>',
            "    ```",
            "Done.",
        ].join("\n");
        expect(parseMessageContent(ordered).some((c) => c.type === "edit_pending")).toBe(false);

        const nested = [
            "- Outer",
            "  - Inner",
            "    ```xml",
            '    <edit file="src/app.tsx"><original>a</original><replacement>b</replacement></edit>',
            "    ```",
        ].join("\n");
        expect(parseMessageContent(nested).some((c) => c.type === "edit_pending")).toBe(false);
    });

    it("closes an unclosed list fence when prose dedents out of the list item", () => {
        const dedented = [
            "1. Example:",
            "    ```xml",
            '    <edit file="src/sample.tsx"><original>a</original><replacement>b</replacement></edit>',
            '<edit_pending id="e-real" file="src/real.tsx" status="pending"><original>x</original><replacement>y</replacement></edit_pending>',
        ].join("\n");
        const edits = parseMessageContent(dedented).filter((c) => c.type === "edit_pending");
        expect(edits).toHaveLength(1);
        expect(edits[0]?.file).toBe("src/real.tsx");
    });

    it("avoids splitting a UTF-16 surrogate pair when terminal output exceeds OUTPUT_CAP", () => {
        const prefix = `x\u{1F680}${"a".repeat(15_999)}`;
        const res = appendStreamAnsiChunk({ output: "", carry: "" }, prefix, true);
        expect(res.output.length).toBe(15_999);
        const firstCode = res.output.charCodeAt(0);
        expect(firstCode < 0xdc00 || firstCode > 0xdfff).toBe(true);
    });
});

