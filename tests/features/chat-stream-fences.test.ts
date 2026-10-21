import { describe, expect, it } from "vitest";
import { preprocessChatMarkdown, stripLeakedToolCode } from "@/features/chat/ui/md/stream";

const stream = (t: string) => preprocessChatMarkdown(t, { streaming: true });

describe("streaming fence balancing", () => {
    // One table instead of one `it` per shape: the cases differ only in text, and
    // separate blocks were flagged as duplicated code.
    const balanced: Array<[name: string, input: string, expected: string]> = [
        ["closes a ``` block", "Hi\n```ts\nconst a = 1;", "Hi\n```ts\nconst a = 1;\n```"],
        ["leaves a closed block alone", "```ts\na\n```\ndone", "```ts\na\n```\ndone"],
        ["closes a ~~~ block with tildes", "~~~\nx = 1", "~~~\nx = 1\n~~~"],
        ["closes four backticks with four", "````md\n```js\nx\n```", "````md\n```js\nx\n```\n````"],
        ["does not close four backticks with three", "````\nbody\n```", "````\nbody\n```\n````"],
        ["treats a longer closer as closing", "```\nbody\n`````", "```\nbody\n`````"],
        ["balances an indented fence inside a list", "- example:\n  ```sh\n  ls", "- example:\n  ```sh\n  ls\n```"],
        ["ignores markers indented by four spaces", "text\n    ```\nbody", "text\n    ```\nbody"],
        ["closes only once when balanced twice", "```\nx", "```\nx\n```"],
        ["keeps CRLF endings", "```\r\nbody", "```\r\nbody\n```"],
        ["returns plain prose untouched", "no fences here", "no fences here"],
    ];

    for (const [name, input, expected] of balanced) {
        it(name, () => {
            expect(stream(input)).toBe(expected);
        });
    }

    it("does not balance a fence whose info string contains a backtick", () => {
        expect(stream("```a`b\nx")).toBe("```a`b\nx");
    });

    it("allows tildes in the info string", () => {
        expect(stream("~~~js~~~\nbody")).toBe("~~~js~~~\nbody\n~~~");
    });

    it("accepts markers indented by up to three spaces", () => {
        expect(stream("text\n   ```\nbody")).toBe("text\n   ```\nbody\n```");
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
