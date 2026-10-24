import { describe, expect, it } from "vitest";
import { formatRowsAsMarkdownTable } from "@/features/chat/ui/md/data-table";
import { parseMessageContent } from "@/features/chat/ui/md/renderer";
import { preprocessChatMarkdown } from "@/features/chat/ui/md/stream";
import { terminalSessionStore } from "@/features/terminal/session";
import { formatTranscriptAsMarkdown } from "@/lib/chat/export-markdown";
import { splitStreamingMarkdownBlocks } from "@/lib/chat/markdown-blocks";
import {
    mergeNewestFirstPrompts,
    stepPromptHistoryDown,
} from "@/lib/chat/prompt-history";
import { findTranscriptMatches } from "@/lib/chat/transcript-search";

describe("PR #53 review regression coverage", () => {
    it("escapes backslashes before pipes in Markdown table export so \\| stays inside the cell", () => {
        const md = formatRowsAsMarkdownTable(["Expr", "Meaning"], [["a\\|b", "path\\to\\dir"]]);
        expect(md).toContain("| a\\\\\\|b | path\\\\to\\\\dir |");
    });

    it("strips nested HTML injection attempts to a fixed point without deleting normal print/functions prose", () => {
        const nestedHtml = "Hello <ifr<iframe src=\"https://evil.example\">ame src=\"x\"> world <im<img src=x>g src=y>";
        const sanitized = preprocessChatMarkdown(nestedHtml);
        expect(sanitized.toLowerCase()).not.toContain("<iframe");
        expect(sanitized.toLowerCase()).not.toContain("<img");
        expect(sanitized).toContain("Hello");
        expect(sanitized).toContain("world");

        const proseExample = [
            "In Python you can write:",
            "print(foo(bar))",
            "And in JS:",
            "functions.run({ retries: 2 })",
            "Both examples above should remain visible.",
        ].join("\n");
        const out = preprocessChatMarkdown(proseExample);
        expect(out).toContain("print(foo(bar))");
        expect(out).toContain("functions.run({ retries: 2 })");
        expect(out).toContain("Both examples above should remain visible.");

        const actualLeak = [
            "Checking file.",
            "print(default_api.read_file(path='README.md'))",
            "Done.",
        ].join("\n");
        const cleanedLeak = preprocessChatMarkdown(actualLeak);
        expect(cleanedLeak).toContain("Checking file.");
        expect(cleanedLeak).toContain("Done.");
        expect(cleanedLeak).not.toContain("default_api.read_file");
    });

    it("preserves multiline shell commands in pending terminal approvals and decodes web_result query entities", () => {
        const msg = [
            '<terminal_command status="pending" id="cmd-1">git add -A && \\',
            'git commit -m "chore: release"',
            "Awaiting approval: mutates git history</terminal_command>",
            '<web_result query="rust &amp; &quot;tauri&quot; &lt;2.0&gt;">result body</web_result>',
        ].join("\n");

        const chunks = parseMessageContent(msg);
        const term = chunks.find((c) => c.type === "terminal_command");
        expect(term?.command).toBe('git add -A && \\\ngit commit -m "chore: release"');
        expect(term?.commandReason).toBe("mutates git history");

        const web = chunks.find((c) => c.type === "web_result");
        expect(web?.query).toBe('rust & "tauri" <2.0>');
    });

    it("strips <think> and <thought> reasoning tags from exported Markdown transcripts", () => {
        const md = formatTranscriptAsMarkdown("Session", [
            { role: "user", content: "Explain this" },
            {
                role: "assistant",
                content: "<think>internal chain</think><thought>drafting</thought>Clean final answer.",
            },
        ]);
        expect(md).toContain("Clean final answer.");
        expect(md).not.toContain("internal chain");
        expect(md).not.toContain("drafting");
        expect(md).not.toContain("<think>");
        expect(md).not.toContain("<thought>");
    });

    it("preserves UTF-16 code-unit offsets when matching case-expanding Unicode characters and respects maxMatches <= 0", () => {
        const messages = [{ role: "assistant", content: "Prefix İSTANBUL and target word" }];
        const matches = findTranscriptMatches(messages, "target");
        expect(matches).toHaveLength(1);
        const m = matches[0];
        expect(m).toBeDefined();
        if (m) {
            expect(messages[0]?.content.slice(m.start, m.end)).toBe("target");
        }
        expect(findTranscriptMatches(messages, "target", 0)).toEqual([]);
    });

    it("keeps blank lines inside indented code blocks and ignores [ref]: inside fenced code", () => {
        const indented = [
            "Intro paragraph.",
            "",
            "    const a = 1;",
            "",
            "    const b = 2;",
            "",
            "Trailing paragraph.",
        ].join("\n");
        const splitIndented = splitStreamingMarkdownBlocks(indented);
        expect(splitIndented.settled).toEqual([
            "Intro paragraph.",
            "    const a = 1;\n\n    const b = 2;",
        ]);
        expect(splitIndented.tail).toBe("Trailing paragraph.");

        const fencedRef = [
            "```markdown",
            "[docs]: https://example.com",
            "```",
            "",
            "Next paragraph.",
        ].join("\n");
        const splitFenced = splitStreamingMarkdownBlocks(fencedRef);
        expect(splitFenced.settled).toHaveLength(1);
        expect(splitFenced.tail).toBe("Next paragraph.");
    });

    it("keeps newest-first prompt order in mergeNewestFirstPrompts and clamps shrunk history cursors", () => {
        const merged = mergeNewestFirstPrompts(
            ["second prompt", "first prompt"],
            ["third prompt", "fourth prompt"],
        );
        expect(merged).toEqual([
            "fourth prompt",
            "third prompt",
            "second prompt",
            "first prompt",
        ]);

        const stepped = stepPromptHistoryDown(
            { index: 4, stashedDraft: "draft", recalledValue: "old" },
            ["newest", "older"],
        );
        expect(stepped).toEqual({
            cursor: { index: 1, stashedDraft: "draft", recalledValue: "older" },
            value: "older",
        });
    });

    it("scopes pending terminal command insertion to the targeted shell tab", () => {
        const prevTabs = terminalSessionStore.tabs;
        try {
            terminalSessionStore.setTabs(() => [
                { id: "tab-a", title: "gitbash", shell: "gitbash", cwd: "/repo", group: "left" },
                { id: "tab-b", title: "wsl", shell: "wsl", cwd: "/repo", group: "left" },
            ]);
            terminalSessionStore.pendingCommandInsert = "npm test";
            terminalSessionStore.pendingCommandTargetTabId = "tab-b";

            expect(terminalSessionStore.takePendingCommandInsert("tab-a")).toBeNull();
            expect(terminalSessionStore.takePendingCommandInsert("tab-b")).toBe("npm test");
            expect(terminalSessionStore.takePendingCommandInsert("tab-b")).toBeNull();
        } finally {
            terminalSessionStore.setTabs(() => prevTabs);
            terminalSessionStore.clearPendingCommandInsertForTab();
        }
    });
});
