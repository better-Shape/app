import { describe, expect, it, vi } from "vitest";
import { applyInsertedPromptEvent } from "@/features/chat/lib/use-chat-session";
import { formatRowsAsMarkdownTable } from "@/features/chat/ui/md/data-table";
import { parseMessageContent } from "@/features/chat/ui/md/renderer";
import { preprocessChatMarkdown, repairStreamGlitches } from "@/features/chat/ui/md/stream";
import { extractCleanSelectionText, splitLeadingQuoteBlock } from "@/features/chat/ui/quote-selection";
import {
    insertCommandIntoWorkspaceTerminal,
    terminalSessionStore,
} from "@/features/terminal/session";
import { defaultProvidersSettings, modelIdsFor } from "@/lib/ai/providers";
import { syncChatDomHighlights } from "@/lib/chat/dom-highlights";
import { formatTranscriptAsMarkdown } from "@/lib/chat/export-markdown";
import { splitStreamingMarkdownBlocks } from "@/lib/chat/markdown-blocks";
import { formatMentionToken, parseMentionTokens } from "@/lib/chat/mentions";
import {
    mergeNewestFirstPrompts,
    stepPromptHistoryDown,
    stripShellPromptPrefix,
    tryWrapMarkdownLinkOnPaste,
} from "@/lib/chat/prompt-history";
import { extractSearchableMessageText, findTranscriptMatches } from "@/lib/chat/transcript-search";
import { providerIcon } from "@/lib/ui/provider-icon";

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
        const match = matches.at(0);
        expect(match).toBeDefined();
        if (match) {
            expect(messages[0]?.content.slice(match.start, match.end)).toBe("target");
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

    it("strips unclosed and nested <script variants to a fixed point and keeps legitimate repeated prose phrases", () => {
        const tricky = "Before <s<img src=x>cript src=evil> and <scriptx> and <script<script after";
        const out = preprocessChatMarkdown(tricky);
        expect(out.toLowerCase()).not.toContain("<script");
        expect(out).toContain("Before");

        const repeatedOpener =
            "In summary, we need a clean validation step first.\n\nDetails follow in paragraph two with full context.\n\nIn summary, we need a final check before shipping.";
        expect(repairStreamGlitches(repeatedOpener)).toBe(repeatedOpener);
    });

    it("preserves literal XML such as <think>code</think> inside user messages during Markdown export", () => {
        const md = formatTranscriptAsMarkdown("XML repro", [
            { role: "user", content: "Why did `<think>code</think>` fail to parse?" },
            { role: "assistant", content: "<think>hidden</think>Use a closing tag." },
        ]);
        expect(md).toContain("<think>code</think>");
        expect(md).not.toContain("hidden");
    });

    it("strips mixed $ prompt prefixes without altering $ENV vars and prevents nested Markdown link wrapping", () => {
        expect(stripShellPromptPrefix("$ npm install\nnpm test\necho $HOME")).toBe(
            "npm install\nnpm test\necho $HOME",
        );

        const existingLink = "Read [the migration guide](https://example.com/old) first.";
        const partialStart = existingLink.indexOf("migration");
        const partialEnd = partialStart + "migration".length;
        expect(
            tryWrapMarkdownLinkOnPaste(
                existingLink,
                partialStart,
                partialEnd,
                "https://example.com/new",
            ),
        ).toBeNull();
    });

    it("incrementally splits streaming Markdown blocks in O(tail) and separates table cells in quotes", () => {
        let stream = "First paragraph.";
        expect(splitStreamingMarkdownBlocks(stream)).toEqual({
            settled: [],
            tail: "First paragraph.",
        });
        stream += "\n\nSecond paragraph";
        expect(splitStreamingMarkdownBlocks(stream)).toEqual({
            settled: ["First paragraph."],
            tail: "Second paragraph",
        });
        stream += " extended.\n\nThird";
        expect(splitStreamingMarkdownBlocks(stream)).toEqual({
            settled: ["First paragraph.", "Second paragraph extended."],
            tail: "Third",
        });

        const host = document.createElement("div");
        host.innerHTML = "<table><tr><th>ColA</th><th>ColB</th></tr><tr><td>10</td><td>20</td></tr></table>";
        const range = document.createRange();
        range.selectNodeContents(host);
        expect(extractCleanSelectionText(range, host)).toBe("ColA\tColB\n10\t20");
    });

    it("guards Object.prototype keys in providerIcon and keeps custom native local/ extra model slugs", () => {
        expect(() => providerIcon("constructor/gpt-4", 14)).not.toThrow();
        expect(() => providerIcon("toString/model", 14)).not.toThrow();

        const defaults = defaultProvidersSettings();
        const customConn = {
            ...defaults.connections.custom,
            enabled: true,
            baseUrl: "http://127.0.0.1:8080/v1",
            extraModels: ["local/llama-3"],
        };
        const ids = modelIdsFor("custom", {
            ...defaults.connections,
            custom: customConn,
        });
        expect(ids).toContain("custom/local/llama-3");
    });

    it("does not truncate pending approval commands containing 'Awaiting approval:' inside shell strings", () => {
        const payload = [
            '<terminal_command status="pending" id="cmd-sec">',
            'echo "Awaiting approval: decoy"',
            "rm -rf ./important-dir",
            "Awaiting approval: Shell command requires confirmation",
            "</terminal_command>",
        ].join("\n");
        const chunks = parseMessageContent(payload);
        const cmdChunk = chunks.find((c) => c.type === "terminal_command");
        expect(cmdChunk?.command).toContain('echo "Awaiting approval: decoy"');
        expect(cmdChunk?.command).toContain("rm -rf ./important-dir");
        expect(cmdChunk?.commandReason).toBe("Shell command requires confirmation");
    });

    it("preserves file and folder mention paths containing spaces and accumulates pre-attach terminal inserts", () => {
        const token = formatMentionToken({
            kind: "file",
            path: "docs/Architecture Notes/API Spec.md",
            label: "API Spec.md",
        });
        expect(token).not.toMatch(/\s/);
        const parsed = parseMentionTokens(`Check ${token} please`);
        expect(parsed[0]?.path).toBe("docs/Architecture Notes/API Spec.md");

        terminalSessionStore.pendingCommandInsert = null;
        terminalSessionStore.pendingCommandTargetTabId = null;
        terminalSessionStore.tabs = [];
        insertCommandIntoWorkspaceTerminal("npm install");
        insertCommandIntoWorkspaceTerminal("npm test");
        expect(terminalSessionStore.takePendingCommandInsert()).toBe("npm install\nnpm test");
    });

    it("handles quote-only messages, <cat> inner paths, and data-chat-find-text button highlights", () => {
        expect(splitLeadingQuoteBlock("> Only quoted excerpt")).toEqual({
            quotes: ["Only quoted excerpt"],
            rest: "",
        });
        expect(extractSearchableMessageText("<cat>src/agent/runner.ts</cat>")).toContain(
            "src/agent/runner.ts",
        );

        const container = document.createElement("div");
        container.setAttribute("data-chat-message-index", "0");
        container.innerHTML =
            '<button type="button" data-chat-find-text data-quote-allow="">src/lib/router.ts</button><button type="button">Copy</button>';
        document.body.appendChild(container);
        const { ranges } = syncChatDomHighlights(container, "router.ts");
        expect(ranges).toHaveLength(1);
        const { ranges: skippedCopy } = syncChatDomHighlights(container, "Copy");
        expect(skippedCopy).toHaveLength(0);

        const selRange = document.createRange();
        selRange.selectNodeContents(container);
        expect(extractCleanSelectionText(selRange, container)).toBe("src/lib/router.ts");
        container.remove();
    });

    it("preserves literal HTML tags (including <script> and <style>) inside inline backtick code spans while stripping raw tags", () => {
        const md = preprocessChatMarkdown(
            "Use `<div>`, `<script src=\"app.js\">x</script>`, or `<style>body{}</style>` in examples, never <script>alert(1)</script>.",
        );
        expect(md).toContain("`<div>`");
        expect(md).toContain('`<script src="app.js">x</script>`');
        expect(md).toContain("`<style>body{}</style>`");
        expect(md).not.toContain("alert(1)");
    });

    it("highlights text safely after case-expanding Unicode (İ), peeks pending terminal commands non-destructively, and preserves fenced tags in search", () => {
        const container = document.createElement("div");
        container.setAttribute("data-chat-message-index", "0");
        container.textContent = "İstanbul İETT route end";
        document.body.appendChild(container);
        const { ranges } = syncChatDomHighlights(container, "end", { caseSensitive: false });
        expect(ranges).toHaveLength(1);
        expect(ranges.at(0)?.range.toString()).toBe("end");
        container.remove();

        terminalSessionStore.pendingCommandInsert = null;
        terminalSessionStore.pendingCommandTargetTabId = null;
        terminalSessionStore.tabs = [];
        insertCommandIntoWorkspaceTerminal("cargo test");
        expect(terminalSessionStore.peekPendingCommandInsert()).toBe("cargo test");
        expect(terminalSessionStore.takePendingCommandInsert()).toBe("cargo test");
        expect(terminalSessionStore.peekPendingCommandInsert()).toBeNull();

        const searchable = extractSearchableMessageText(
            "<thinking>secret reasoning</thinking>\n```xml\n<thinking>documented tag</thinking>\n```",
        );
        expect(searchable).not.toContain("secret reasoning");
        expect(searchable).toContain("documented tag");

        const quotedRef = [
            "Read [guide][docs] first.",
            "",
            "> [docs]: https://example.com/guide",
            "",
            "Final paragraph.",
        ].join("\n");
        expect(splitStreamingMarkdownBlocks(quotedRef)).toEqual({
            settled: [],
            tail: quotedRef,
        });
    });

    it("disambiguates duplicate-basename file mentions instead of overwriting earlier registrations", () => {
        const first = formatMentionToken({
            kind: "file",
            path: "src/shared/config.ts",
            label: "config.ts",
        });
        const second = formatMentionToken({
            kind: "file",
            path: "packages/core/config.ts",
            label: "config.ts",
        });
        expect(first).toBe("@config.ts");
        expect(second).toBe("@packages/core/config.ts");

        const parsed = parseMentionTokens(`Compare ${first} with ${second}`);
        expect(parsed).toHaveLength(2);
        expect(parsed.at(0)?.path).toBe("src/shared/config.ts");
        expect(parsed.at(1)?.path).toBe("packages/core/config.ts");
    });

    it("keeps composer clean on idle auto-send, preserves drafts when busy, and restores rejected auto-sends", async () => {
        let draft = "";
        const setInputValue = (updater: string | ((prev: string) => string)) => {
            draft = typeof updater === "function" ? updater(draft) : updater;
        };
        const enqueued: string[] = [];
        const sent: string[] = [];

        applyInsertedPromptEvent(
            { prompt: "@Button.tsx tighten padding", send: true },
            {
                isBusy: false,
                setInputValue,
                enqueue: (text) => enqueued.push(text),
                sendNow: async (text) => {
                    sent.push(text);
                    return true;
                },
            },
        );
        await Promise.resolve();
        expect(sent).toEqual(["@Button.tsx tighten padding"]);
        expect(draft).toBe("");

        draft = "work-in-progress note";
        applyInsertedPromptEvent(
            { prompt: "@Header.tsx align icon", send: true },
            {
                isBusy: true,
                setInputValue,
                enqueue: (text) => enqueued.push(text),
                sendNow: vi.fn(async () => true),
            },
        );
        expect(enqueued).toEqual(["@Header.tsx align icon"]);
        expect(draft).toBe("work-in-progress note");

        draft = "";
        applyInsertedPromptEvent(
            { prompt: "@Card.tsx check contrast", send: true },
            {
                isBusy: false,
                setInputValue,
                enqueue: (text) => enqueued.push(text),
                sendNow: async () => false,
            },
        );
        await Promise.resolve();
        expect(draft).toBe("@Card.tsx check contrast");
    });
});
