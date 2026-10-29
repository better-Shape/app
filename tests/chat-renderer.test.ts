import { describe, expect, it } from "vitest";
import { dedupeTerminalChunks, parseMessageContent, getMessageCopyText } from "@/features/chat/ui/md/renderer";
import { preprocessChatMarkdown, repairStreamGlitches, stripLeakedToolCode } from "@/features/chat/ui/md/stream";

describe("parseMessageContent", () => {
    it("parses fenced OpenUI programs separately from surrounding prose", () => {
        const message = 'A compact view:\n```openui-lang\nroot = Surface([label], "Summary")\nlabel = Text("Ready")\n```\nThat is the result.';
        const chunks = parseMessageContent(message);
        expect(chunks.map((chunk) => chunk.type)).toEqual(["text", "openui", "text"]);
        expect(chunks[1]?.content).toContain('root = Surface([label], "Summary")');
        expect(chunks[1]?.isGenerating).toBe(false);
        expect(chunks[1]?.openuiSourceStart).toBe(message.indexOf("```openui-lang"));
        expect(chunks[0]?.content).toContain("A compact view");
        expect(chunks[2]?.content).toContain("That is the result.");
    });

    it("keeps incomplete OpenUI fences renderable while streaming", () => {
        const chunks = parseMessageContent("```openui-lang\nroot = Surface([metric])\nmetric = Metric(\"Tests\", \"12\")");
        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.type).toBe("openui");
        expect(chunks[0]?.isGenerating).toBe(true);
        expect(chunks[0]?.content).toContain("Metric");
    });

    it("does not let an incomplete unknown tag hide a later OpenUI fence", () => {
        const message = [
            "An unfinished tag appears here: <example",
            "```openui-lang",
            "root = Surface([label])",
            'label = Text("Still rendered")',
            "```",
        ].join("\n");
        const chunks = parseMessageContent(message);

        expect(chunks.map((chunk) => chunk.type)).toContain("openui");
        expect(chunks.find((chunk) => chunk.type === "openui")?.content).toContain("Still rendered");
    });

    it("matches hidden wrappers case-insensitively without treating tag prefixes as wrappers", () => {
        const hidden = parseMessageContent(
            "<TOOL_RESULT>\n```openui-lang\nroot = Surface([])\n```\n</TOOL_RESULT>\nVisible prose",
        );
        expect(hidden.some((chunk) => chunk.type === "openui")).toBe(false);
        expect(hidden.map((chunk) => chunk.content ?? "").join("")).toContain("Visible prose");
        expect(hidden.map((chunk) => chunk.content ?? "").join("")).not.toContain("root = Surface");

        const prefixed = parseMessageContent("<editor>ordinary prose without an edit wrapper");
        expect(prefixed.map((chunk) => chunk.type)).toEqual(["text"]);
        expect(prefixed[0]?.content).toContain("<editor>");
    });

    it("does not route ordinary or nested code fences through the OpenUI renderer", () => {
        const ordinary = parseMessageContent("```typescript\nconst answer = 42;\n```");
        const nested = parseMessageContent(
            "````markdown\n```openui-lang\nroot = Surface([])\n```\n````",
        );
        const inline = parseMessageContent("Use ```openui-lang on a new line to start a visual block.");

        expect(ordinary.some((chunk) => chunk.type === "openui")).toBe(false);
        expect(nested.some((chunk) => chunk.type === "openui")).toBe(false);
        expect(inline.some((chunk) => chunk.type === "openui")).toBe(false);
    });

    it("accepts tilde fences, indentation, and case-insensitive language labels", () => {
        const chunks = parseMessageContent("  ~~~OPENUI-LANG\r\nroot = Surface([])\r\n  ~~~\r\n");
        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.type).toBe("openui");
        expect(chunks[0]?.content).toBe("root = Surface([])");
        expect(chunks[0]?.isGenerating).toBe(false);
    });

    it("bounds oversized OpenUI source and marks it as truncated", () => {
        const chunks = parseMessageContent(`\`\`\`openui-lang\n${"x".repeat(40_000)}\n\`\`\``);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.type).toBe("openui");
        expect(chunks[0]?.content).toHaveLength(32_000);
        expect(chunks[0]?.openuiTruncated).toBe(true);
    });

    it("limits rendered OpenUI blocks while keeping excess source visible", () => {
        const fence = "```";
        const message = Array.from({ length: 4 }, (_, index) =>
            `${fence}openui-lang\nroot = Surface([])\n// block ${index}${index === 3 ? "\n<tool_result>hidden tool output</tool_result>\n<analysis>hidden reasoning</analysis>" : ""}\n${fence}`,
        ).join("\n");
        const chunks = parseMessageContent(message);

        expect(chunks.filter((chunk) => chunk.type === "openui")).toHaveLength(3);
        expect(chunks.some((chunk) => chunk.type === "text" && chunk.content?.includes("block 3"))).toBe(true);
        expect(chunks.some((chunk) => chunk.type === "tool_result")).toBe(false);
        expect(chunks.some((chunk) => chunk.type === "text" && chunk.content?.includes("hidden tool output"))).toBe(false);
        expect(chunks.some((chunk) => chunk.type === "text" && chunk.content?.includes("hidden reasoning"))).toBe(false);
        expect(chunks.some((chunk) => chunk.type === "text" && chunk.content?.includes("<analysis>"))).toBe(false);
    });

    it("copies rendered visual text instead of leaking the OpenUI DSL", () => {
        const chunks = parseMessageContent("Before\n```openui-lang\nroot = Surface([])\n```\nAfter");
        expect(getMessageCopyText(chunks, ["Visual summary\n42 tests passed"])).toBe(
            "Before\n\nVisual summary\n42 tests passed\n\nAfter",
        );
    });

    it("copies structured content with rendered text or a readable data fallback", () => {
        const payload = JSON.stringify({ questions: [{ id: "q1", prompt: "Pick a layout", options: [{ id: "grid", label: "Grid view" }] }] });
        const chunks = parseMessageContent(`<questions>${payload}</questions>`);
        expect(getMessageCopyText(chunks, [], "Pick a layout")).toBe("Pick a layout");

        const structured = parseMessageContent(
            'Results:\n<chart>{"title":"Build status","points":[{"label":"Passed","value":42}]}</chart>\n<questions>' + payload + "</questions>",
        );
        const copied = getMessageCopyText(structured);
        expect(copied).toContain("Results:");
        expect(copied).toContain("Build status");
        expect(copied).toContain("Passed: 42");
        expect(copied).toContain("Pick a layout");
        expect(copied).toContain("Grid view");
    });

    it("keeps OpenUI source out of the embedded-block parser and strips leaked tool output", () => {
        const chunks = parseMessageContent('```openui-lang\nroot = Surface([label])\nlabel = Text("visible <tool_result>hidden tool output</tool_result> text")\n```');
        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.type).toBe("openui");
        expect(chunks[0]?.content).toContain("visible");
        expect(chunks[0]?.content).toContain("text");
        expect(chunks[0]?.content).not.toContain("hidden tool output");

        const streaming = parseMessageContent('```openui-lang\nroot = Surface([label])\nlabel = Text("visible <tool_result>hidden tool output');
        expect(streaming[0]?.type).toBe("openui");
        expect(streaming[0]?.content).toContain("visible");
        expect(streaming[0]?.content).not.toContain("hidden tool output");

        const partialTag = parseMessageContent('```openui-lang\nroot = Surface([label])\nlabel = Text("visible <tool_result');
        expect(partialTag[0]?.content).toContain("visible");
        expect(partialTag[0]?.content).not.toContain("tool_result");

        const unclosedAttribute = parseMessageContent('```openui-lang\nroot = Surface([label])\nlabel = Text("visible <tool_result title=\"unfinished>hidden tool output');
        expect(unclosedAttribute[0]?.content).toContain("visible");
        expect(unclosedAttribute[0]?.content).not.toContain("hidden tool output");

        const emptyTag = parseMessageContent('```openui-lang\nroot = Surface([label])\nlabel = Text("visible <tool_result /> text")\n```');
        expect(emptyTag[0]?.content).toContain("visible");
        expect(emptyTag[0]?.content).toContain("text");
        expect(emptyTag[0]?.content).not.toContain("tool_result");

        const nestedToolResult = parseMessageContent(
            '```openui-lang\nroot = Surface([label])\nlabel = Text("visible")\n<tool_result>outer <tool_result>inner</tool_result>trailing hidden</tool_result>\n```',
        );
        expect(nestedToolResult[0]?.content).toContain("visible");
        expect(nestedToolResult[0]?.content).not.toContain("trailing hidden");
        expect(nestedToolResult[0]?.content).not.toContain("inner");
    });

    it("does not extract OpenUI fences from BetterShape block payloads", () => {
        const chunks = parseMessageContent(
            "<tool_result\nsource=hidden>\n```openui-lang\nroot = Surface([])\n```\n</tool_result>\nVisible prose",
        );
        expect(chunks.some((chunk) => chunk.type === "openui")).toBe(false);
        expect(chunks.some((chunk) => chunk.type === "text" && chunk.content?.includes("root = Surface"))).toBe(false);
        expect(chunks.some((chunk) => chunk.type === "text" && chunk.content?.includes("Visible prose"))).toBe(true);
    });

    it("reopens OpenUI extraction after closed hidden tool-call and tool-response wrappers", () => {
        for (const tag of ["tool_call", "tool_response"]) {
            const chunks = parseMessageContent(
                `<${tag}>hidden payload</${tag}>\n\`\`\`openui-lang\nroot = Surface([])\n\`\`\``,
            );
            expect(chunks.some((chunk) => chunk.type === "openui")).toBe(true);
            expect(chunks.some((chunk) => chunk.type === "text" && chunk.content?.includes("hidden payload"))).toBe(false);
        }
    });

    it("does not treat quoted structural closing text as a real close", () => {
        const chunks = parseMessageContent(
            '<tool_result note="literal </tool_result> still hidden">\n```openui-lang\nroot = Surface([])\n```\n</tool_result>\n```openui-lang\nroot = Surface([])\n```',
        );
        expect(chunks.filter((chunk) => chunk.type === "openui")).toHaveLength(1);
    });

    it("keeps a long, multiline structural tag opaque without truncating scanner state", () => {
        const longAttribute = "x".repeat(2_600);
        const chunks = parseMessageContent(
            `<tool_result title="\n${longAttribute}\n\`\`\`openui-lang\nroot = Surface([])\n\`\`\`\n">payload</tool_result>\nAfter`,
        );
        expect(chunks.some((chunk) => chunk.type === "openui")).toBe(false);
        expect(chunks.some((chunk) => chunk.type === "text" && chunk.content?.includes("root = Surface"))).toBe(false);
        expect(chunks.some((chunk) => chunk.type === "text" && chunk.content?.includes("After"))).toBe(true);
    });

    it("strips hidden markup inside nested Markdown fences in OpenUI source", () => {
        const chunks = parseMessageContent(
            '```openui-lang\nroot = Surface([label])\nlabel = Text("```\n<analysis>hidden reasoning</analysis>\n```")\n```',
        );
        expect(chunks[0]?.type).toBe("openui");
        expect(chunks[0]?.content).not.toContain("hidden reasoning");
    });

    it("resumes structural parsing after an excess OpenUI block", () => {
        const visual = "```openui-lang\nroot = Surface([])\n```";
        const chunks = parseMessageContent(
            `${visual}\n${visual}\n${visual}\n${visual}\n<edit file="src/a.ts"><original>a</original><replacement>b</replacement></edit>`,
        );
        expect(chunks.filter((chunk) => chunk.type === "openui")).toHaveLength(3);
        expect(chunks.some((chunk) => chunk.type === "edit" && chunk.file === "src/a.ts")).toBe(true);
    });

    it("parses redacted_thinking blocks instead of leaking closing tags", () => {
        const chunks = parseMessageContent(
            "Hello\n<think>Checking project layout</think>\n\nReady.",
        );
        const think = chunks.find((c) => c.type === "think");
        expect(think?.content).toContain("Checking project layout");
        expect(chunks.some((c) => c.type === "text" && c.content?.includes("</think>"))).toBe(false);
    });

    it("dedupes terminal commands with the same id, keeping completed over pending", () => {
        const text = [
            '<terminal_command status="pending" id="cmd-1">npx create-next-app@latest .',
            "Awaiting approval: review",
            "</terminal_command>",
            '<terminal_command status="completed" id="cmd-1">npx create-next-app@latest .',
            "</terminal_command>",
        ].join("\n");

        const chunks = parseMessageContent(text);
        const terminals = chunks.filter((c) => c.type === "terminal_command");
        expect(terminals).toHaveLength(1);
        expect(terminals[0].commandStatus).toBe("completed");
    });

    it("dedupes duplicate pending commands with the same command text", () => {
        const cmd = "npx create-next-app@latest . --yes";
        const text = [
            `<terminal_command status="pending" id="cmd-1">${cmd}\nAwaiting approval: a</terminal_command>`,
            `<terminal_command status="pending" id="cmd-2">${cmd}\nAwaiting approval: b</terminal_command>`,
        ].join("\n");

        const chunks = parseMessageContent(text);
        const terminals = chunks.filter((c) => c.type === "terminal_command");
        expect(terminals).toHaveLength(1);
    });

    it("parses cat blocks with line ranges", () => {
        const chunks = parseMessageContent(
            '<cat path="features/chat/ui/messages/turn-workflow.tsx" start="1" end="244"></cat>',
        );
        const cat = chunks.find((c) => c.type === "cat");
        expect(cat?.content).toBe("features/chat/ui/messages/turn-workflow.tsx");
        expect(cat?.catStartLine).toBe(1);
        expect(cat?.catEndLine).toBe(244);
    });

    it("parses click-through ask_user questions", () => {
        const payload = JSON.stringify({
            questions: [
                {
                    id: "q1",
                    prompt: "What visual concept direction fits \"shape\" best?",
                    options: [
                        { id: "geo", label: "Abstract geometric shape", recommended: true },
                        { id: "morph", label: "Morphing/transforming form" },
                    ],
                },
            ],
            answers: null,
        });
        const chunks = parseMessageContent(
            `<questions id="ask-1" status="pending">\n${payload}\n</questions>`,
        );
        const q = chunks.find((c) => c.type === "question");
        expect(q?.commandId).toBe("ask-1");
        expect(q?.commandStatus).toBe("pending");
        expect(q?.questions?.[0]?.prompt).toContain("visual concept");
        expect(q?.questions?.[0]?.options[0]?.recommended).toBe(true);
    });

    it("parses uppercase edit tags and attributes consistently", () => {
        const [edit] = parseMessageContent(
            '<EDIT FILE="src/a.ts"><ORIGINAL>before</ORIGINAL><REPLACEMENT>after</REPLACEMENT></EDIT>',
        );

        expect(edit).toMatchObject({
            type: "edit",
            file: "src/a.ts",
            original: "before",
            replacement: "after",
        });
    });

    it("dedupes edit_pending chunks for the same id, keeping applied over pending", () => {
        const text = [
            '<edit_pending id="e1" file="src/a.ts" status="pending"><original>a</original><replacement>b</replacement></edit_pending>',
            '<edit_pending id="e1" file="src/a.ts" status="applied"><original>a</original><replacement>b</replacement></edit_pending>',
        ].join("\n");
        const chunks = parseMessageContent(text);
        const edits = chunks.filter((c) => c.type === "edit_pending");
        expect(edits).toHaveLength(1);
        expect(edits[0].commandStatus).toBe("applied");
        expect(edits[0].file).toBe("src/a.ts");
    });
});

describe("dedupeTerminalChunks", () => {
    it("prefers higher-status terminal chunks for the same id", () => {
        const result = dedupeTerminalChunks([
            { type: "terminal_command", commandId: "cmd-1", commandStatus: "pending", command: "npm test" },
            { type: "terminal_command", commandId: "cmd-1", commandStatus: "completed", command: "npm test" },
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].commandStatus).toBe("completed");
    });

    it("dedupes edit_pending by id independently from terminal commands", () => {
        const result = dedupeTerminalChunks([
            {
                type: "edit_pending",
                commandId: "e1",
                commandStatus: "pending",
                file: "a.ts",
                original: "x",
                replacement: "y",
            },
            {
                type: "edit_pending",
                commandId: "e1",
                commandStatus: "applied",
                file: "a.ts",
                original: "x",
                replacement: "y",
            },
            {
                type: "terminal_command",
                commandId: "e1",
                commandStatus: "pending",
                command: "echo",
            },
        ]);
        const edits = result.filter((c) => c.type === "edit_pending");
        const terms = result.filter((c) => c.type === "terminal_command");
        expect(edits).toHaveLength(1);
        expect(edits[0].commandStatus).toBe("applied");
        expect(terms).toHaveLength(1);
    });
});
describe("preprocessChatMarkdown", () => {
    it("strips standalone horizontal rules", () => {
        expect(preprocessChatMarkdown("Hello\n---\nWorld")).toBe("Hello\n\nWorld");
    });

    it("repairs glued duplicate stream text", () => {
        const glitched =
            "Here's a thorough analysis of your repo combined withHere's a thorough analysis of your repo combined with current best-practice research:";
        const fixed = repairStreamGlitches(glitched);
        expect(fixed).not.toContain("combined withHere's");
    });

    it("converts unicode bullets to markdown lists", () => {
        expect(preprocessChatMarkdown("• Modern stack:\nNext.js")).toContain("- Modern stack:");
    });

    it("dedents indented markdown headings", () => {
        const input = "    ## Step 3\n    - item one";
        expect(preprocessChatMarkdown(input)).toContain("## Step 3\n- item one");
    });

    it("unwraps outer prose code fence while preserving explicitly labeled or multi-fence blocks", () => {
        const input = "```\n## Title\n\nBody\n```";
        expect(preprocessChatMarkdown(input)).toBe("## Title\n\nBody");

        const labeledMarkdown = "```markdown\n# Sample Heading\n\n- item one\n```";
        expect(preprocessChatMarkdown(labeledMarkdown)).toBe(labeledMarkdown);

        const labeledMd = "```md\n## Changelog\n\n1. First entry\n```";
        expect(preprocessChatMarkdown(labeledMd)).toBe(labeledMd);

        const labeledBash = "```bash\n# Install dependencies\nnpm ci\n```";
        expect(preprocessChatMarkdown(labeledBash)).toBe(labeledBash);

        const twoUnlabeledFences = "```\nconst a = 1;\n```\n\n## Middle Heading\n\n```\nconst b = 2;\n```";
        expect(preprocessChatMarkdown(twoUnlabeledFences)).toBe(twoUnlabeledFences);
    });

    it("strips leaked tool markup while preserving prose around malformed tags", () => {
        const input = `Here are two concepts.

\`\`\`json
{ "tool_code": "print(render_design_previews(concepts=[
  {
\`\`\`
`;
        const out = preprocessChatMarkdown(input);
        expect(out).toContain("Here are two concepts");
        expect(out).not.toContain("tool_code");
        expect(out).not.toContain("render_design_previews");

        const prose = stripLeakedToolCode("<analysis it's fine> following prose");
        const broken = stripLeakedToolCode('<analysis title="unfinished>hidden prose');
        expect(prose).toContain("following prose");
        expect(prose).not.toContain("<analysis");
        expect(broken).not.toContain("hidden prose");

        const nested = stripLeakedToolCode(
            "Before <tool_result>outer <tool_result>inner</tool_result> trailing hidden</tool_result> After",
        );
        expect(nested).toContain("Before");
        expect(nested).toContain("After");
        expect(nested).not.toContain("inner");
        expect(nested).not.toContain("trailing hidden");

        const quotedCloseTag = stripLeakedToolCode(
            'Before <tool_result><div data-value="</tool_result>">hidden content</div></tool_result> After',
        );
        expect(quotedCloseTag).toContain("Before");
        expect(quotedCloseTag).toContain("After");
        expect(quotedCloseTag).not.toContain("hidden content");

        const unclosed = stripLeakedToolCode("Before <tool_result>hidden trailing");
        expect(unclosed.trim()).toBe("Before");

        const strayAngle = stripLeakedToolCode(
            "Before <value <tool_result>hidden payload</tool_result> After",
        );
        expect(strayAngle).toContain("Before <value");
        expect(strayAngle).toContain("After");
        expect(strayAngle).not.toContain("hidden payload");
    });

    it("hides Gemini function_calls / tool_code XML (Auto + Gemini)", () => {
        const input = [
            "Searching keys.",
            "<function_calls>",
            "<tool_code>grep_search(pattern='secret')</tool_code>",
            "</function_calls>",
            "<pre_dispatch_explanation>Looking for secrets.</pre_dispatch_explanation>",
            "Done.",
        ].join("\n");
        const out = preprocessChatMarkdown(input);
        expect(out).toContain("Searching keys");
        expect(out).toContain("Done");
        expect(out).not.toContain("function_calls");
        expect(out).not.toContain("grep_search");
        expect(out).not.toContain("pre_dispatch");
    });

    it("hides Claude/Qwen/Hermes tool_call XML", () => {
        const input = [
            "Checking weather.",
            "<tool_call>",
            '<function=get_weather>',
            "<parameter=location>Paris</parameter>",
            "</function>",
            "</tool_call>",
            "Paris looks clear.",
        ].join("\n");
        const out = preprocessChatMarkdown(input);
        expect(out).toContain("Checking weather");
        expect(out).toContain("Paris looks clear");
        expect(out).not.toContain("<tool_call");
        expect(out).not.toContain("get_weather");
    });

    it("hides DeepSeek DSML tool markup", () => {
        const fw = "\uFF5C";
        const input = [
            "Running search.",
            `<${fw}${fw}DSML${fw}${fw}tool_calls>`,
            `<${fw}${fw}DSML${fw}${fw}invoke name="web_search">`,
            `<${fw}${fw}DSML${fw}${fw}parameter name="query" string="true">news</${fw}${fw}DSML${fw}${fw}parameter>`,
            `</${fw}${fw}DSML${fw}${fw}invoke>`,
            `</${fw}${fw}DSML${fw}${fw}tool_calls>`,
            "Found three results.",
        ].join("\n");
        const out = preprocessChatMarkdown(input);
        expect(out).toContain("Running search");
        expect(out).toContain("Found three results");
        expect(out).not.toContain("DSML");
        expect(out).not.toContain("web_search");
    });

    it("hides MiniMax tool_call XML", () => {
        const input = [
            "Opening terminal.",
            "<minimax:tool_call>",
            '<invoke name="run_terminal">',
            "<parameter name=\"command\">ls</parameter>",
            "</invoke>",
            "</minimax:tool_call>",
            "Listed files.",
        ].join("\n");
        const out = preprocessChatMarkdown(input);
        expect(out).toContain("Opening terminal");
        expect(out).toContain("Listed files");
        expect(out).not.toContain("minimax");
        expect(out).not.toContain("run_terminal");
    });

    it("hides Kimi / Llama special tool tokens", () => {
        const input = [
            "Searching.",
            "<|tool_calls_section_begin|>",
            "<|tool_call_begin|>functions.web_search:0<|tool_call_argument_begin|>{\"query\":\"x\"}<|tool_call_end|>",
            "<|tool_calls_section_end|>",
            "<|python_tag|>",
            "Done.",
        ].join("\n");
        const out = preprocessChatMarkdown(input);
        expect(out).toContain("Searching");
        expect(out).toContain("Done");
        expect(out).not.toContain("<|tool_");
        expect(out).not.toContain("python_tag");
    });

    it("hides BetterShape list_terminals / terminal_input dumps", () => {
        const input = [
            "Waiting.",
            "<list_terminals>",
            "session_id: 1 | running: true | command: npx create-next-app",
            "</list_terminals>",
            '<terminal_input session="1">|</terminal_input>',
            "Still waiting.",
        ].join("\n");
        const out = preprocessChatMarkdown(input);
        expect(out).toContain("Waiting");
        expect(out).toContain("Still waiting");
        expect(out).not.toContain("session_id");
        expect(out).not.toContain("terminal_input");
    });

    it("preserves intentional BetterShape UI tags for the chunk parser", () => {
        const input = 'Before\n<terminal_command status="pending" id="c1">npm test</terminal_command>\nAfter';
        // strip path must not erase terminal_command — parseMessageContent owns that.
        const out = preprocessChatMarkdown(input);
        expect(out).toContain("<terminal_command");
        expect(out).toContain("npm test");
    });

    it("does not leak edit_file error excerpts that wrap markdown fences", () => {
        const css = `@import 'tailwindcss';\n${"body{color:red}".repeat(80)}`;
        const content = [
            "Working on styles.",
            "<tool_result>",
            "[edit_file] ERROR: Could not apply the edit to app/globals.css. Reason: Incomplete SEARCH/REPLACE block.",
            "Nearest region of the current file (40 lines around best match):",
            "```",
            css,
            "```",
            "Call read_file for the full content before retrying.",
            "</tool_result>",
            "Retrying the edit.",
        ].join("\n");

        const chunks = parseMessageContent(content);
        const text = chunks
            .filter((c) => c.type === "text")
            .map((c) => c.content)
            .join("");
        expect(text).toContain("Working on styles");
        expect(text).toContain("Retrying the edit");
        expect(text).not.toContain("[edit_file]");
        expect(text).not.toContain("@import");
        expect(text).not.toContain("Incomplete SEARCH");

        const md = preprocessChatMarkdown(content);
        expect(md).toContain("Working on styles");
        expect(md).toContain("Retrying the edit");
        expect(md).not.toContain("@import");
        expect(md).not.toContain("[edit_file]");
    });

    it("handles quoted '>' inside HTML attributes and ignores prefix-only closing tags like </scriptx>", () => {
        const quoted = preprocessChatMarkdown('<div title="a > b">Visible copy</div>');
        expect(quoted).toContain("Visible copy");
        expect(quoted).not.toContain('b">');

        const scriptx = preprocessChatMarkdown(
            "Intro\n<script>const leaked = 1;</scriptx>still secret</script>\nSafe conclusion",
        );
        expect(scriptx).toContain("Intro");
        expect(scriptx).toContain("Safe conclusion");
        expect(scriptx).not.toContain("leaked");
        expect(scriptx).not.toContain("still secret");
    });

    it("parses mixed-case and uppercase <TODOS>/<TODO> and <PLAN>/<STEP> child elements without dropping items", () => {
        const chunks = parseMessageContent(
            '<TODOS TITLE="Sprint &amp; Release"><TODO ID="t1" STATUS="completed">Ship parser</TODO><Todo id="t2" status="in_progress">Verify İ</Todo></TODOS>',
        );
        expect(chunks).toEqual([
            {
                type: "todos",
                content: "Sprint & Release",
                todos: [
                    { id: "t1", label: "Ship parser", status: "done" },
                    { id: "t2", label: "Verify İ", status: "active" },
                ],
                sourceStart: 0,
            },
        ]);
    });

    it("preserves exact closing offsets on Turkish İ inside structural tags and ignores inline-code <terminal_command> before openui-lang", () => {
        const turkishChunks = parseMessageContent(
            '<think>İstanbul</think>Next<edit file="src/tr.ts"><original>İstanbul</original><replacement>İzmir</replacement></edit>Tail',
        );
        expect(turkishChunks).toEqual([
            {
                type: "think",
                content: "İstanbul",
                isGenerating: false,
                sourceStart: 0,
            },
            { type: "text", content: "Next", sourceStart: 23 },
            {
                type: "edit",
                file: "src/tr.ts",
                original: "İstanbul",
                replacement: "İzmir",
                isGenerating: false,
                sourceStart: 27,
            },
            { type: "text", content: "Tail", sourceStart: 118 },
        ]);

        const openuiWithInlineTag = parseMessageContent(
            "Use `<terminal_command>` for shell steps.\n\n```openui-lang\nroot = Card([])\n```",
        );
        expect(
            openuiWithInlineTag.some((chunk) => chunk.type === "openui"),
        ).toBe(true);

        expect(
            preprocessChatMarkdown(
                "Intro\n  _execute\n  tool_name: read_file\n  path: src/a.ts\nAfter",
            ),
        ).not.toContain("_execute");
        expect(
            preprocessChatMarkdown(
                '> ```python\n> print(default_api.read_file("a.ts"))\n> ```\nVisible summary',
            ),
        ).not.toContain("default_api");
        expect(preprocessChatMarkdown("• one\r• two")).toBe("- one\r- two");
    });
});

it("renders the submitted image body when a filename contains a tag delimiter", async () => {
    const { messageWithAttachments } = await import("@/features/chat/lib/send-attachments");
    const dataUrl = "data:image/png;base64,aGVsbG8=";
    const body = await messageWithAttachments("message", [{
        id: "one", name: 'a>b".png', kind: "image", status: "ready", size: 5, mimeType: "image/png", dataUrl,
        file: new File(["hello"], 'a>b".png', { type: "image/png" }),
    }], new AbortController().signal);
    expect(parseMessageContent(body).filter(chunk => chunk.type === "attached_image")).toEqual([
        { type: "attached_image", content: dataUrl, isGenerating: false, sourceStart: 0 },
    ]);
});

it("scans repeated malformed <div openers in linear time without quadratic rescanning", () => {
    const repeatedUnclosed = `${"<div ".repeat(6000)}<span>clean</span>`;
    const quotedSyncAdversarial = `${'<div a="<div \'" '.repeat(2500)}(tail`;
    const startedAt = performance.now();
    const outUnclosed = preprocessChatMarkdown(repeatedUnclosed);
    const outAdversarial = preprocessChatMarkdown(quotedSyncAdversarial);
    const elapsedMs = performance.now() - startedAt;

    expect(outUnclosed.endsWith("clean")).toBe(true);
    expect(outUnclosed).not.toContain("<span>");
    expect(outAdversarial.endsWith("(tail")).toBe(true);
    expect(elapsedMs).toBeLessThan(500);
});

it("parses spaceless URL: entries consistently across parseWebResults and parseWebSearchHits", async () => {
    const { parseWebResults, extractWebSearchResults } = await import(
        "@/features/chat/ui/md/renderer"
    );
    const { parseWebSearchHits } = await import(
        "@/features/chat/ui/blocks/search"
    );
    const block = [
        "### MDN Highlight API",
        "URL:https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API",
        "Custom range highlights without mutating DOM.",
        "---",
        "URL: https://example.com/spaced",
        "Spaced URL line.",
    ].join("\n");

    const parsedRenderer = parseWebResults(block);
    const parsedSearchBlock = parseWebSearchHits(block);
    expect(parsedRenderer).toEqual(parsedSearchBlock);
    expect(parsedRenderer).toEqual([
        {
            title: "MDN Highlight API",
            url: "https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API",
            snippet: "Custom range highlights without mutating DOM.",
        },
        {
            title: "Result",
            url: "https://example.com/spaced",
            snippet: "Spaced URL line.",
        },
    ]);

    const messageSources = extractWebSearchResults(
        `<web_result query="highlight">${block}</web_result>`,
    );
    expect(messageSources.map((entry) => entry.url)).toEqual([
        "https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API",
        "https://example.com/spaced",
    ]);
});

it("preserves multiple blank lines inside fenced code and --- inside multiline inline code", () => {
    const fenced = "Intro\n\n\n\n```py\ndef first():\n    pass\n\n\ndef second():\n    pass\n```\n\n\n\nOutro";
    expect(preprocessChatMarkdown(fenced)).toBe(
        "Intro\n\n```py\ndef first():\n    pass\n\n\ndef second():\n    pass\n```\n\nOutro",
    );

    const multilineInline = "Keep `line1\n---\n• item\nline4` intact\n\n---\n\n• real bullet";
    expect(preprocessChatMarkdown(multilineInline)).toBe(
        "Keep `line1\n---\n• item\nline4` intact\n\n- real bullet",
    );
});


