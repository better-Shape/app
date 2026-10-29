import { describe, expect, it } from "vitest";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { appendStreamAnsiChunk } from "@/features/chat/ui/blocks/terminal-live";
import { parseMessageContent, resolveLiveStatusLabel } from "@/features/chat/ui/md/renderer";
import {
    appendInlineCodeSpansInRange,
    preprocessChatMarkdown,
    scanMarkdownCodeFences,
    stripLeakedToolCode,
} from "@/features/chat/ui/md/stream";

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
        ["balances an indented fence inside a list", "- example:\n  ```sh\n  ls", "- example:\n  ```sh\n  ls\n  ```"],
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

    it("indents synthetic closing fences inside ordered list items so CommonMark emits one code block", () => {
        const balancedOrdered = stream("1. Step:\n    ```bash\n    npm i");
        expect(balancedOrdered.endsWith("\n   ```")).toBe(true);
        const tree = unified().use(remarkParse).parse(balancedOrdered);
        expect(tree.children).toHaveLength(1);
        expect(tree.children[0]?.type).toBe("list");

        const dedentedFence = scanMarkdownCodeFences("1. Step:\n   ```bash\n   npm i\n```\nafter");
        expect(dedentedFence.ranges).toHaveLength(2);
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

    it("preserves 4-space indented --- code lines and decodes XML-escaped web_visit URLs", () => {
        const md = "Example:\n\n    const a = 1;\n    ---\n    const b = 2;";
        expect(preprocessChatMarkdown(md)).toContain("    ---");
        expect(preprocessChatMarkdown("Alpha\n- - -\nBeta\n* * *\nGamma\n_ _ _\n- item")).toBe(
            "Alpha\n\nBeta\n\nGamma\n\n- item",
        );

        const visit = parseMessageContent(
            '<web_visit url="https://example.com/search?a=1&amp;b=2" title="Docs &amp; Guide"></web_visit>',
        ).find((c) => c.type === "web_visit");
        expect(visit?.visitUrl).toBe("https://example.com/search?a=1&b=2");
        expect(visit?.visitTitle).toBe("Docs & Guide");
    });

    it("clears stale Editing activity labels once the trailing edit block has closed", () => {
        const closedEdit = parseMessageContent(
            '<edit file="src/done.ts"><original>a</original><replacement>b</replacement></edit>',
        );
        expect(
            resolveLiveStatusLabel(
                undefined,
                [{ kind: "workflow", blocks: closedEdit }],
                "Editing file",
                true,
            ),
        ).toBe("Working");

        const openEdit = parseMessageContent(
            '<edit file="src/live.ts"><original>a</original>',
        );
        expect(
            resolveLiveStatusLabel(
                undefined,
                [{ kind: "workflow", blocks: openEdit }],
                "Editing file",
                true,
            ),
        ).toBe("Editing live.ts");
    });

    it("measures tab stops from list marker columns and retains truncation notices after stripping 96k+ markup", () => {
        type MdastLike = { type?: string; value?: string; children?: MdastLike[] };
        const findCodeValues = (node: MdastLike): string[] => [
            ...(node.type === "code" && typeof node.value === "string" ? [node.value] : []),
            ...(node.children ?? []).flatMap(findCodeValues),
        ];

        const nestedTabList = "1.\t1.\t```ts\n        const x = 1;";
        const closedNested = stream(nestedTabList);
        expect(closedNested).toBe("1.\t1.\t```ts\n        const x = 1;\n        ```");
        const ast = unified().use(remarkParse).parse(closedNested);
        expect(findCodeValues(ast as unknown as MdastLike)).toEqual(["const x = 1;"]);

        const largeStripped = `<tool_result>${"x".repeat(60_000)}</tool_result>\n\`\`\`ts\n${"a".repeat(38_000)}`;
        const settled = preprocessChatMarkdown(largeStripped, { streaming: false });
        expect(settled.length).toBeLessThan(40_000);
        expect(settled).toContain("\n```\n\n... (response truncated for display)");

        const planChunks = parseMessageContent(
            '<plan id="p-1" title="Auth &amp; Rollout"><step status="pending">Ship</step></plan>',
        );
        expect(planChunks.find((c) => c.type === "plan")?.file).toBe("Auth & Rollout");

        const sentChunks = parseMessageContent(
            '<sent_file name="quarterly-&gt;report.pdf" title="Quarterly -&gt; Annual &amp;gt; Summary" type="application/pdf">data:application/pdf;base64,AA==</sent_file>',
        );
        const sentChunk = sentChunks.find((c) => c.type === "sent_file");
        expect(sentChunk?.file).toBe("quarterly->report.pdf");
        expect(sentChunk?.mediaPrompt).toBe("Quarterly -> Annual &gt; Summary");

        const inlineSample = "Use `foo <edit> \\` end";
        const spans: Array<[number, number]> = [];
        appendInlineCodeSpansInRange(inlineSample, 0, inlineSample.length, spans);
        const para = unified().use(remarkParse).parse(inlineSample).children[0];
        const codeNode =
            para && "children" in para
                ? para.children.find((n) => n.type === "inlineCode")
                : undefined;
        expect(spans).toEqual([
            [
                codeNode?.position?.start.offset ?? -1,
                codeNode?.position?.end.offset ?? -1,
            ],
        ]);
    });
});

