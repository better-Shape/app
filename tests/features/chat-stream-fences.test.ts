import { describe, expect, it } from "vitest";
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
