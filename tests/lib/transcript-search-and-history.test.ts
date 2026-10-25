import { describe, expect, it } from "vitest";
import {
    extractSearchableMessageText,
    findTranscriptMatches,
} from "@/lib/chat/transcript-search";
import {
    extractCleanUserPrompts,
    isCaretOnFirstLogicalLine,
    isCaretOnLastLogicalLine,
    stepPromptHistoryDown,
    stepPromptHistoryUp,
    tryWrapMarkdownLinkOnPaste,
} from "@/lib/chat/prompt-history";
import {
    formatTranscriptAsMarkdown,
    slugifyTranscriptFilename,
} from "@/lib/chat/export-markdown";
import { formatRowsAsMarkdownTable } from "@/features/chat/ui/md/data-table";

describe("transcript-search", () => {
    it("strips internal agent XML tags while keeping prose, code, and edited file paths searchable", () => {
        const raw = [
            "<thinking>secret chain of thought token_xyz</thinking>",
            "<todos><todo status=\"in_progress\">secret_todo</todo></todos>",
            "Updated the token refresh logic:",
            "```ts\nexport function refreshSession() {}\n```",
            "<edit file=\"src/lib/auth.ts\"><original>old</original><replacement>new</replacement></edit>",
        ].join("\n");

        const searchable = extractSearchableMessageText(raw);
        expect(searchable).not.toContain("token_xyz");
        expect(searchable).not.toContain("secret_todo");
        expect(searchable).toContain("refreshSession");
        expect(searchable).toContain("src/lib/auth.ts");
    });

    it("indexes multiple case-insensitive matches across user and assistant messages", () => {
        const messages = [
            { role: "user", content: "Why does Auth Guard reject valid cookies?" },
            { role: "system", content: "System auth prompt ignored" },
            { role: "assistant", content: "<thinking>auth</thinking>Auth Guard checks cookie signature; auth fallback runs next." },
        ];

        const matches = findTranscriptMatches(messages, "auth");
        expect(matches).toHaveLength(3);
        expect(matches[0]?.messageIndex).toBe(0);
        expect(matches[1]?.messageIndex).toBe(2);
        expect(matches[1]?.occurrenceInMessage).toBe(0);
        expect(matches[2]?.messageIndex).toBe(2);
        expect(matches[2]?.occurrenceInMessage).toBe(1);
    });
});

describe("prompt-history & smart URL paste", () => {
    it("deduplicates user prompts newest-first and strips attached file payloads", () => {
        const prompts = extractCleanUserPrompts(
            [
                { role: "user", content: "first prompt" },
                { role: "assistant", content: "reply" },
                {
                    role: "user",
                    content: "<attached_file name=\"log.txt\">stacktrace</attached_file>\nsecond prompt",
                },
                { role: "user", content: "first prompt" },
            ],
            ["latest session prompt"],
        );

        expect(prompts).toEqual(["latest session prompt", "first prompt", "second prompt"]);
    });

    it("preserves unsent working draft across ArrowUp/ArrowDown recall cycles", () => {
        const prompts = ["most recent", "older prompt"];
        const up1 = stepPromptHistoryUp(null, "half-typed draft", prompts);
        if (!up1) throw new Error("expected first history step");
        expect(up1).toMatchObject({
            cursor: { index: 0, stashedDraft: "half-typed draft", recalledValue: "most recent" },
            value: "most recent",
        });

        const up2 = stepPromptHistoryUp(up1.cursor, up1.value, prompts);
        if (!up2) throw new Error("expected second history step");
        expect(up2.value).toBe("older prompt");

        // Clamps at oldest entry
        expect(stepPromptHistoryUp(up2.cursor, up2.value, prompts)).toBeNull();

        const down1 = stepPromptHistoryDown(up2.cursor, prompts);
        if (!down1) throw new Error("expected downward history step");
        expect(down1.value).toBe("most recent");
        expect(down1.cursor).not.toBeNull();

        const down2 = stepPromptHistoryDown(down1.cursor, prompts);
        expect(down2).toEqual({
            cursor: null,
            value: "half-typed draft",
        });
    });

    it("detects first and last logical lines without hijacking active selections", () => {
        const multi = "line one\nline two\nline three";
        expect(isCaretOnFirstLogicalLine(multi, 4, 4)).toBe(true);
        expect(isCaretOnFirstLogicalLine(multi, 4, 7)).toBe(false);
        expect(isCaretOnFirstLogicalLine(multi, 10, 10)).toBe(false);

        expect(isCaretOnLastLogicalLine(multi, 22, 22)).toBe(true);
        expect(isCaretOnLastLogicalLine(multi, 10, 10)).toBe(false);
        expect(isCaretOnLastLogicalLine(multi, 20, 25)).toBe(false);
    });

    it("wraps single-line text selection into a Markdown link when pasting an HTTP(S) URL", () => {
        const text = "Check the tracking issue before merging";
        const start = text.indexOf("tracking issue");
        const end = start + "tracking issue".length;

        const wrapped = tryWrapMarkdownLinkOnPaste(
            text,
            start,
            end,
            "https://github.com/better-Shape/app/issues/42",
        );
        expect(wrapped).toMatchObject({
            start,
            end,
            replacement: "[tracking issue](https://github.com/better-Shape/app/issues/42)",
            nextValue: "Check the [tracking issue](https://github.com/better-Shape/app/issues/42) before merging",
            nextCaret: "Check the [tracking issue](https://github.com/better-Shape/app/issues/42)".length,
        });

        // Pasting a URL over an existing selected URL replaces normally (returns null)
        expect(
            tryWrapMarkdownLinkOnPaste("https://old.example.com", 0, 23, "https://new.example.com"),
        ).toBeNull();

        // Pasting plain non-URL text over selection returns null
        expect(tryWrapMarkdownLinkOnPaste(text, start, end, "not a url")).toBeNull();
    });
});

describe("export-markdown", () => {
    it("formats conversation turns cleanly and strips hidden control markup", () => {
        const md = formatTranscriptAsMarkdown("Auth token audit", [
            {
                role: "user",
                content: "<attached_file name=\"trace.log\">raw</attached_file>\nInspect @src/auth.ts",
            },
            {
                role: "assistant",
                model: "anthropic/claude-sonnet-4-5",
                content:
                    "<thinking>internal</thinking>Found the expiry bug.\n<edit file=\"src/auth.ts\"><original>a</original><replacement>b</replacement></edit>",
            },
        ]);

        expect(md).toContain("# Auth token audit");
        expect(md).toContain("## You");
        expect(md).toContain("_Attached: `trace.log`_");
        expect(md).toContain("Inspect @src/auth.ts");
        expect(md).not.toContain("internal");
        expect(md).toContain("> Edited `src/auth.ts`");
        expect(slugifyTranscriptFilename("Auth token audit!")).toBe("auth-token-audit-transcript.md");
    });

    it("serializes GFM tables cleanly with pipe escaping for Copy Table as Markdown", () => {
        const tableMd = formatRowsAsMarkdownTable(
            ["Metric", "Before | After"],
            [
                ["Latency", "160ms -> 24ms"],
                ["Status", "Pass\nVerified"],
            ],
        );
        expect(tableMd).toBe(
            [
                "| Metric | Before \\| After |",
                "| --- | --- |",
                "| Latency | 160ms -> 24ms |",
                "| Status | Pass Verified |",
            ].join("\n"),
        );
    });
});
