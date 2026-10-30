import { describe, expect, it, vi } from "vitest";
import { getSubagents, resetSubagents, upsertSubagent } from "@/features/agent/subagents/store";
import { formatAiTerminalTitle } from "@/features/agent/terminal-dock";
import { applyInsertedPromptEvent } from "@/features/chat/lib/use-chat-session";
import { detectErrorBillingProvider } from "@/features/chat/ui/blocks/error";
import { detectPendingHitl } from "@/features/chat/ui/chat";
import { readComposerClipboardTextWithFeedback } from "@/features/chat/ui/composer/input-helpers";
import {
    computeMentionPickerPosition,
    isImeKeyEvent,
    isPlainPickerConfirmKey,
} from "@/features/chat/ui/composer/mentions";
import { formatRowsAsMarkdownTable } from "@/features/chat/ui/md/data-table";
import { parseMessageContent } from "@/features/chat/ui/md/renderer";
import { preprocessChatMarkdown, repairStreamGlitches } from "@/features/chat/ui/md/stream";
import { extractCleanSelectionText, splitLeadingQuoteBlock } from "@/features/chat/ui/quote-selection";
import { openChatFindBar, registerMountedChatSurface } from "@/features/chat/ui/shell/find-bar";
import { notificationStore } from "@/features/notifications";
import {
    insertCommandIntoWorkspaceTerminal,
    terminalSessionStore,
} from "@/features/terminal/session";
import {
    applyTestResultEvent,
    getTestStoreSnapshot,
    resetTestStore,
    setTestRunning,
} from "@/features/testing/store";
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
import {
    extractSearchableMessageText,
    findTranscriptMatches,
    parseWebResults,
} from "@/lib/chat/transcript-search";
import { buildPlanBuildMessage } from "@/lib/chat/continue-action";
import { userMessageCopyText } from "@/features/chat/ui/message/item";
import { providerIcon } from "@/lib/ui/provider-icon";

describe("chat stream sanitization, transcript utilities, and workbench bridges", () => {
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
            '<button type="button" data-chat-find-text data-quote-allow="">src/lib/router.ts</button><button type="button" aria-expanded="false">Thought for a moment</button><button type="button">Copy</button>';
        document.body.appendChild(container);
        const { ranges } = syncChatDomHighlights(container, "router.ts");
        expect(ranges).toHaveLength(1);
        const { ranges: skippedCopy } = syncChatDomHighlights(container, "Copy");
        expect(skippedCopy).toHaveLength(0);
        const { ranges: skippedThought } = syncChatDomHighlights(container, "Thought");
        expect(skippedThought).toHaveLength(0);

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

    it("guards picker confirmation keys, preserves code-fenced XML in assistant exports, isolates project terminals/tests, and routes OpenRouter billing", () => {
        expect(isImeKeyEvent({ isComposing: true, keyCode: 13 })).toBe(true);
        expect(isImeKeyEvent({ isComposing: false, keyCode: 229 })).toBe(true);
        expect(
            isPlainPickerConfirmKey({
                key: "Enter",
                shiftKey: true,
                metaKey: false,
                ctrlKey: false,
                altKey: false,
            }),
        ).toBe(false);
        expect(
            isPlainPickerConfirmKey({
                key: "Enter",
                shiftKey: false,
                metaKey: false,
                ctrlKey: false,
                altKey: false,
            }),
        ).toBe(true);

        const md = formatTranscriptAsMarkdown("Assistant code fences", [
            {
                role: "assistant",
                content: [
                    "<thinking>internal scratchpad</thinking>",
                    "Example control tags in docs:",
                    "```xml",
                    "<thinking>example reasoning</thinking>",
                    '<edit file="src/demo.ts">kept</edit>',
                    "```",
                    "Inline `<todos>sample</todos>` stays intact too.",
                ].join("\n"),
            },
        ]);
        expect(md).not.toContain("internal scratchpad");
        expect(md).toContain("<thinking>example reasoning</thinking>");
        expect(md).toContain('<edit file="src/demo.ts">kept</edit>');
        expect(md).toContain("`<todos>sample</todos>`");

        const foreignPaste = vi.fn();
        terminalSessionStore.tabs = [
            { id: "other-tab", title: "wsl", cwd: "/other-repo", shell: "wsl", group: "left" },
        ];
        terminalSessionStore.instances.set("other-tab", {
            ptyId: 1,
            term: { paste: foreignPaste },
            fitAddon: null,
            unlistenOutput: () => {},
        });
        terminalSessionStore.panel = { visible: true, cwd: "/active-repo" };
        terminalSessionStore.pendingCommandInsert = null;
        terminalSessionStore.pendingCommandTargetTabId = null;
        insertCommandIntoWorkspaceTerminal("npm test");
        expect(foreignPaste).not.toHaveBeenCalled();
        expect(terminalSessionStore.peekPendingCommandInsert()).toBe("npm test");
        terminalSessionStore.instances.delete("other-tab");
        terminalSessionStore.tabs = [];

        resetTestStore("/repo-a");
        setTestRunning(true, null, "/repo-a");
        resetTestStore("/repo-b");
        applyTestResultEvent({
            event_type: "test",
            framework: "vitest",
            test: {
                id: "stale-1",
                name: "old repo failure",
                file: "/repo-a/foo.test.ts",
                suite: "foo",
                status: "failed",
                error: "stale failure",
            },
        });
        expect(getTestStoreSnapshot().suites).toHaveLength(0);
        resetTestStore(null);

        expect(detectErrorBillingProvider("OpenRouter API error: insufficient credits for openrouter/openai/gpt-5", true)).toBe("openrouter");
        expect(detectErrorBillingProvider("OpenAI API error: insufficient_quota on gpt-5", true)).toBe("openai");
        expect(detectErrorBillingProvider("401 Unauthorized calling https://openrouter.ai/api/v1/chat/completions", false)).toBeNull();
        expect(detectErrorBillingProvider("401 Unauthorized calling https://api.openai.com/v1/responses", false)).toBeNull();
        expect(detectErrorBillingProvider("Add credits at https://openrouter.ai/settings/credits", false)).toBe("openrouter");
        expect(detectErrorBillingProvider("Top up at https://platform.openai.com/account/billing", false)).toBe("openai");
        expect(detectErrorBillingProvider("Quota exceeded at https://evil-openrouter.ai/settings/credits", true)).toBeNull();
        expect(detectErrorBillingProvider("Quota exceeded at https://openrouter.ai.attacker.example/credits", true)).toBeNull();
        expect(detectErrorBillingProvider("Quota exceeded at https://api.openai.com.attacker.example/v1", true)).toBeNull();

        const emojiCmd = `${"a".repeat(47)}🚀 trailing`;
        const title = formatAiTerminalTitle(emojiCmd);
        expect(Array.from(title)).toHaveLength(48);
        expect(title.endsWith("🚀")).toBe(true);

        const mismatchedMd = formatTranscriptAsMarkdown("Mismatched control tags", [
            {
                role: "assistant",
                content: "<thinking>draft\nVisible answer before </analysis> after.",
            },
        ]);
        expect(mismatchedMd).toContain("Visible answer before");

        const spanHost = document.createElement("div");
        spanHost.innerHTML =
            '<div data-chat-message-index="0"><p><span>const</span> <strong>tokenStore</strong> = 1;</p><p>alpha</p><p>beta</p></div>';
        document.body.appendChild(spanHost);
        const crossNode = syncChatDomHighlights(spanHost, "const tokenStore");
        expect(crossNode.ranges).toHaveLength(1);
        expect(crossNode.ranges.at(0)?.range.toString()).toBe("const tokenStore");
        const crossBlock = syncChatDomHighlights(spanHost, "alpha beta");
        expect(crossBlock.ranges).toHaveLength(0);
        expect(
            findTranscriptMatches(
                [{ role: "assistant", content: "alpha\n\nbeta" }],
                "alpha beta",
            ),
        ).toHaveLength(0);
        spanHost.remove();

        expect(
            detectPendingHitl(
                [
                    {
                        role: "assistant",
                        content:
                            '<design_previews id="dp-1" status="pending"><design_preview id="c1" name="Concept 1" kind="html"><div>ok</div></design_preview></design_previews>',
                    },
                ],
                false,
            ),
        ).toEqual({ kind: "approval", count: 1 });
        expect(
            detectPendingHitl(
                [
                    {
                        role: "assistant",
                        content:
                            '<design_previews id="dp-1" status="selected" selected="c1"><design_preview id="c1" name="Concept 1" kind="html"><div>ok</div></design_preview></design_previews>',
                    },
                ],
                true,
            ),
        ).toBeNull();

        resetSubagents();
        upsertSubagent({
            id: "sub-preserve-model",
            title: "Reviewer",
            model: "anthropic/claude-sonnet-4.5",
            activity: "Working...",
            status: "running",
        });
        upsertSubagent({
            id: "sub-preserve-model",
            title: "Reviewer",
            model: undefined,
            activity: "Completed",
            status: "done",
        });
        expect(getSubagents().find((c) => c.id === "sub-preserve-model")?.model).toBe(
            "anthropic/claude-sonnet-4.5",
        );
        resetSubagents();
    });

    it("exports attachments containing Markdown code fences as summaries while keeping fenced examples and tilde code blocks intact", () => {
        const md = formatTranscriptAsMarkdown("Fence edge cases", [
            {
                role: "user",
                content: [
                    '<attached_file name="README.md">',
                    "# Attached Doc",
                    "```ts",
                    "export const secretBody = 42;",
                    "```",
                    "</attached_file>",
                    "Please review the snippet below:",
                    "```xml",
                    '<attached_file name="example.txt">literal example</attached_file>',
                    "```",
                ].join("\n"),
            },
            {
                role: "assistant",
                content: [
                    "<thinking>",
                    "```python",
                    "internal_plan = True",
                    "```",
                    "</thinking>",
                    "Outside <div>stripped</div> prose:",
                    "~~~html",
                    "<script>window.keepMe = 1;</script>",
                    "<div class=\"card\">kept inside tilde fence</div>",
                    "~~~",
                ].join("\n"),
            },
        ]);

        expect(md).toContain("_Attached: `README.md`_");
        expect(md).not.toContain("secretBody");
        expect(md).toContain('<attached_file name="example.txt">literal example</attached_file>');
        expect(md).not.toContain("internal_plan");

        const processed = preprocessChatMarkdown(
            [
                "Before <div>strip-me</div> text",
                "~~~html",
                "<script>window.keepMe = 1;</script>",
                "<div class=\"card\">kept inside tilde fence</div>",
                "~~~",
                "After <span>also-stripped</span>",
            ].join("\n"),
        );
        expect(processed).not.toContain("<div>strip-me</div>");
        expect(processed).not.toContain("<span>also-stripped</span>");
        expect(processed).toContain("<script>window.keepMe = 1;</script>");
        expect(processed).toContain('<div class="card">kept inside tilde fence</div>');
    });

    it("preserves math/code comparisons in preprocessChatMarkdown and strips many paired scripts in linear time", () => {
        const mathMd = preprocessChatMarkdown(
            "Check that x < b > y and x <b && c> y and f(a<p, q>z) hold, while <b>bold</b> strips tags.",
        );
        expect(mathMd).toContain("x < b > y");
        expect(mathMd).toContain("x <b && c> y");
        expect(mathMd).toContain("f(a<p, q>z)");
        expect(mathMd).toContain("bold");
        expect(mathMd).not.toContain("<b>");

        const repeatedScripts = `${Array.from({ length: 400 }, (_, idx) => `<script>evil(${idx})</script>`).join(" ")}Safe output`;
        const t0 = performance.now();
        const cleaned = preprocessChatMarkdown(repeatedScripts);
        expect(performance.now() - t0).toBeLessThan(250);
        expect(cleaned).not.toContain("evil(");
        expect(cleaned).toContain("Safe output");
    });

    it("preserves FIFO terminal command order during the 60ms pending drain, clears evicted toast actions, and switches center view on Find", () => {
        const pasted: string[] = [];
        terminalSessionStore.tabs = [
            { id: "shell-fifo", title: "pwsh", cwd: "/repo", shell: "pwsh", group: "left" },
        ];
        terminalSessionStore.panel.cwd = "/repo";
        terminalSessionStore.pendingCommandInsert = "echo first";
        terminalSessionStore.pendingCommandTargetTabId = "shell-fifo";
        terminalSessionStore.instances.set("shell-fifo", {
            ptyId: 1,
            fitAddon: null,
            unlistenOutput: () => undefined,
            term: {
                paste: (data: string) => pasted.push(data),
            },
        });

        insertCommandIntoWorkspaceTerminal("echo second");
        expect(pasted).toHaveLength(0);
        expect(terminalSessionStore.takePendingCommandInsert("shell-fifo")).toBe(
            "echo first\necho second",
        );

        insertCommandIntoWorkspaceTerminal("echo third");
        expect(pasted).toEqual(["echo third"]);
        terminalSessionStore.instances.delete("shell-fifo");

        notificationStore.clearAll();
        const firstId = notificationStore.add("First", "info", "desc", {
            action: { label: "Insert inline", onClick: () => undefined },
        });
        notificationStore.add("Second", "info");
        notificationStore.add("Third", "info");
        notificationStore.add("Fourth", "info");
        const snap = notificationStore.getSnapshot();
        const evicted = snap.notifications.find((n) => n.id === firstId);
        expect(snap.toastIds).not.toContain(firstId);
        expect(evicted?.action).toBeUndefined();
        notificationStore.clearAll();

        const centerViews: string[] = [];
        const onCenter = (e: Event) => {
            const detail = (e as CustomEvent<string>).detail;
            centerViews.push(detail);
        };
        window.addEventListener("bettershape-center-view", onCenter);
        const unregister = registerMountedChatSurface();
        openChatFindBar("needle");
        unregister();
        window.removeEventListener("bettershape-center-view", onCenter);
        expect(centerViews).toContain("chat");

        const host = document.createElement("div");
        const msgEl = document.createElement("div");
        msgEl.setAttribute("data-chat-message-index", "0");
        const rows = Array.from({ length: 504 }, (_, idx) => `row-${idx} needle`);
        const domParagraph = document.createElement("p");
        domParagraph.textContent = `Jump ${rows.join(" | ")}`;
        const trailingChip = document.createElement("button");
        trailingChip.setAttribute("data-chat-find-text", "");
        trailingChip.textContent = "chip needle";
        msgEl.append(domParagraph, trailingChip);
        host.appendChild(msgEl);
        document.body.appendChild(host);

        const sourceText = `[Jump](https://needle.dev/docs) ${rows.join(" | ")}`;
        const aligned = syncChatDomHighlights(host, "needle", {
            targetMessageIndex: 0,
            targetOccurrenceInMessage: 500,
            targetMessageSearchText: sourceText,
        });
        expect(aligned.activeRange).not.toBeNull();
        const activeStart = aligned.activeRange?.startOffset ?? 0;
        const domSliceAroundActive = (domParagraph.firstChild?.textContent ?? "").slice(
            Math.max(0, activeStart - 10),
            activeStart + 6,
        );
        expect(domSliceAroundActive).toContain("row-499 needle");

        msgEl.replaceChildren();
        const singleLink = document.createElement("a");
        singleLink.href = "https://very-long-domain-for-context-window-test.example.com/guide";
        singleLink.textContent = "hello";
        msgEl.appendChild(singleLink);
        const singleAligned = syncChatDomHighlights(host, "hello", {
            targetMessageIndex: 0,
            targetOccurrenceInMessage: 0,
            targetMessageSearchText:
                "[hello](https://very-long-domain-for-context-window-test.example.com/guide)",
        });
        expect(singleAligned.activeRange?.toString()).toBe("hello");
        host.remove();
    });

    it("handles clipboard denial feedback, category Back-row geometry, multiline inline-code OpenUI examples, apostrophe attributes, and code-quoted control tags", async () => {
        notificationStore.clearAll();
        const textarea = document.createElement("textarea");
        document.body.appendChild(textarea);
        const origClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                readText: () => Promise.reject(new DOMException("Denied", "NotAllowedError")),
            },
        });
        const onText = vi.fn();
        readComposerClipboardTextWithFeedback(textarea, onText);
        await Promise.resolve();
        await Promise.resolve();
        expect(onText).not.toHaveBeenCalled();
        expect(
            notificationStore
                .getSnapshot()
                .notifications.some((n) => n.message === "Clipboard access denied"),
        ).toBe(true);
        if (origClipboard) {
            Object.defineProperty(navigator, "clipboard", origClipboard);
        }
        notificationStore.clearAll();
        textarea.remove();

        const anchorRect = { left: 24, top: 280, bottom: 340, width: 320, height: 60 };
        const rootPos = computeMentionPickerPosition({
            rect: anchorRect,
            viewportWidth: 800,
            viewportHeight: 600,
            menuHeight: 240,
            hasBackRow: false,
        });
        const categoryPos = computeMentionPickerPosition({
            rect: anchorRect,
            viewportWidth: 800,
            viewportHeight: 600,
            menuHeight: 240,
            hasBackRow: true,
        });
        expect((rootPos.maxListHeight ?? 0) - (categoryPos.maxListHeight ?? 0)).toBe(34);
        expect(78 + (categoryPos.maxListHeight ?? 0)).toBeLessThanOrEqual(anchorRect.top - 14);

        const multilineInlineOpenUI = parseMessageContent(
            "Inline literal: ``\n```openui-lang\nroot = Surface([])\n```\n`` stays prose.",
        );
        expect(multilineInlineOpenUI.some((c) => c.type === "openui")).toBe(false);

        const multilineInlineTagThenOpenUI = parseMessageContent(
            'See `<terminal_command\nid="demo">` first.\n\n```openui-lang\nroot = Surface([])\n```',
        );
        expect(multilineInlineTagThenOpenUI.some((c) => c.type === "openui")).toBe(true);

        const exported = formatTranscriptAsMarkdown("Apostrophe paths", [
            {
                role: "user",
                content: "<attached_file name=\"O'Brien's notes.md\">body</attached_file>\nCheck this",
            },
            {
                role: "assistant",
                content: "<edit file=\"src/it's.ts\"><original>a</original><replacement>b</replacement></edit>\nDone.",
            },
        ]);
        expect(exported).toContain("`O'Brien's notes.md`");
        expect(exported).toContain("> Edited `src/it's.ts`");

        const hiddenWithCodeTagExamples = [
            "<thinking>",
            "Explain `<thinking>` and `</thinking>` plus:",
            "```xml",
            "<thinking>",
            "```",
            "internal_hidden_secret_phrase",
            "</thinking>",
            "Visible final answer.",
        ].join("\n");
        const searchable = extractSearchableMessageText(hiddenWithCodeTagExamples);
        expect(searchable).not.toContain("internal_hidden_secret_phrase");
        expect(searchable).toContain("Visible final answer.");
        expect(
            findTranscriptMatches(
                [{ role: "assistant", content: hiddenWithCodeTagExamples }],
                "internal_hidden_secret_phrase",
            ),
        ).toHaveLength(0);

        const truncatedFenceBetweenThoughts = [
            "<thinking>",
            "```ts",
            "const hiddenTruncated = 1;",
            "</thinking>",
            "Visible middle answer.",
            "<thinking>second hidden thought</thinking>",
        ].join("\n");
        const middleSearchable = extractSearchableMessageText(truncatedFenceBetweenThoughts);
        expect(middleSearchable).toContain("Visible middle answer.");
        expect(middleSearchable).not.toContain("hiddenTruncated");
        expect(middleSearchable).not.toContain("second hidden thought");

        expect(userMessageCopyText(buildPlanBuildMessage("PLAN.md", "Ship it"))).toBe("Continue");

        const apostropheSearchable = extractSearchableMessageText(
            [
                "<edit file=\"src/it's.ts\"><original>a</original><replacement>b</replacement></edit>",
                "<cat path=\"docs/O'Brien.md\">body</cat>",
                "<sent_file title=\"Owner's Spec\" name=\"spec's.md\">body</sent_file>",
            ].join("\n"),
        );
        expect(apostropheSearchable).toContain("src/it's.ts");
        expect(apostropheSearchable).toContain("docs/O'Brien.md");
        expect(apostropheSearchable).toContain("Owner's Spec");

        const legacyVsEncodedExport = formatTranscriptAsMarkdown("Attachment encodings", [
            {
                role: "user",
                content: [
                    '<attached_file name="AT&amp;T.md">legacy</attached_file>',
                    '<attached_file name="AT&amp;T.md" name_encoding="xml">encoded</attached_file>',
                    "Compare both",
                ].join("\n"),
            },
        ]);
        expect(legacyVsEncodedExport).toContain("_Attached: `AT&amp;T.md`_");
        expect(legacyVsEncodedExport).toContain("_Attached: `AT&T.md`_");

        const approvedEditChunks = parseMessageContent(
            [
                '<edit_pending id="ep-1" file="src/app.ts" status="pending">diff</edit_pending>',
                '<edit_pending id="ep-1" file="src/app.ts" status="approved">diff</edit_pending>',
            ].join("\n"),
        ).filter((chunk) => chunk.type === "edit_pending");
        expect(approvedEditChunks).toHaveLength(1);
        expect(approvedEditChunks[0]?.commandStatus).toBe("approved");

        const benignToolCodeDoc = [
            "```json",
            '{ "tool_code": "sample" }',
            "```",
            "",
            "Documentation keeps non-invocation tool_code keys.",
        ].join("\n");
        expect(preprocessChatMarkdown(benignToolCodeDoc)).toContain('{ "tool_code": "sample" }');
        expect(
            preprocessChatMarkdown('```json\n{ "tool_code": "print(read_file(\'x\'))" }\n```'),
        ).not.toContain("read_file");

        const webHits = parseWebResults(
            [
                "### Fetch Spec",
                "Pass a valid URL: parameter when constructing Request.",
                "---",
                "### MDN Guide",
                "URL: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API",
                "Snippet mentioning URL: inline stays intact.",
            ].join("\n"),
        );
        expect(webHits).toEqual([
            {
                title: "Fetch Spec",
                url: "",
                snippet: "Pass a valid URL: parameter when constructing Request.",
            },
            {
                title: "MDN Guide",
                url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API",
                snippet: "Snippet mentioning URL: inline stays intact.",
            },
        ]);

        notificationStore.clearAll();
        const pasteArea = document.createElement("textarea");
        document.body.appendChild(pasteArea);
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                readText: () => Promise.resolve("hello clipboard"),
            },
        });
        readComposerClipboardTextWithFeedback(pasteArea, () => {
            throw new Error("paste callback boom");
        });
        await Promise.resolve();
        await Promise.resolve();
        const pasteNotices = notificationStore.getSnapshot().notifications;
        expect(pasteNotices.some((n) => n.message === "Paste failed")).toBe(true);
        expect(pasteNotices.some((n) => n.message === "Clipboard access denied")).toBe(false);
        if (origClipboard) {
            Object.defineProperty(navigator, "clipboard", origClipboard);
        }
        notificationStore.clearAll();
        pasteArea.remove();
    });
});


