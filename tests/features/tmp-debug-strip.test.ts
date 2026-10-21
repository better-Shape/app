import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { stripLeakedToolCode, stripLeakedToolMarkup, LEAKED_TOOL_XML_TAGS } from "@/features/chat/ui/md/stream";

const STRIP_ACROSS_FENCES = ["tool_result", "terminal_read", "terminal_input", "list_terminals"] as const;

function mapOutsideCodeFences(text: string, fn: (prose: string) => string): string {
    const marker = (rawLine: string) => {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        let spaces = 0;
        while (spaces < 3 && line.charCodeAt(spaces) === 32) spaces += 1;
        const char = line.charAt(spaces);
        if (char !== "`" && char !== "~") return null;
        let end = spaces;
        while (end < line.length && line.charAt(end) === char) end += 1;
        const len = end - spaces;
        if (len < 3) return null;
        return { char, len, suffix: line.slice(end) };
    };
    const out: string[] = [];
    let proseStart = 0, fenceStart = -1, fenceChar = "", fenceLen = 0, cursor = 0;
    while (cursor < text.length) {
        const nl = text.indexOf("\n", cursor);
        const afterLine = nl === -1 ? text.length : nl + 1;
        const parsed = marker(nl === -1 ? text.slice(cursor) : text.slice(cursor, nl));
        const opens = Boolean(parsed && (parsed.char !== "`" || !parsed.suffix.includes("`")));
        const closes = Boolean(parsed && fenceChar && parsed.char === fenceChar && parsed.len >= fenceLen && /^[ \t]*$/.test(parsed.suffix));
        if (!fenceChar && parsed && opens) {
            if (cursor > proseStart) out.push(fn(text.slice(proseStart, cursor)));
            fenceStart = cursor; fenceChar = parsed.char; fenceLen = parsed.len;
        } else if (fenceChar && closes) {
            out.push(text.slice(fenceStart, afterLine));
            proseStart = afterLine; fenceStart = -1; fenceChar = ""; fenceLen = 0;
        }
        cursor = afterLine;
    }
    if (fenceChar) out.push(text.slice(fenceStart));
    else if (proseStart < text.length) out.push(fn(text.slice(proseStart)));
    return out.join("");
}

function referenceMarkup(text: string): string {
    const fw = "\uFF5C";
    let s = text;
    for (const tag of STRIP_ACROSS_FENCES) {
        const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        s = s.replace(new RegExp(`<${esc}\\b[^>]*>[\\s\\S]*?<\\/${esc}>`, "gi"), "");
    }
    s = mapOutsideCodeFences(s, (prose) => {
        let p = prose;
        for (const tag of LEAKED_TOOL_XML_TAGS) {
            const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            p = p.replace(new RegExp(`<${esc}\\b[^>]*>[\\s\\S]*?<\\/${esc}>`, "gi"), "");
            p = p.replace(new RegExp(`<${esc}\\b[^>]*\\/?>`, "gi"), "");
            p = p.replace(new RegExp(`<${esc}\\b[^>]*>[\\s\\S]*$`, "gi"), "");
            p = p.replace(new RegExp(`<\\/${esc}>`, "gi"), "");
        }
        p = p.replace(new RegExp(`<${fw}{0,2}DSML${fw}{1,2}[\\w.]*?>[\\s\\S]*?<\\/${fw}{0,2}DSML${fw}{1,2}[\\w.]*?>`, "gi"), "");
        p = p.replace(new RegExp(`<${fw}{0,2}DSML${fw}{1,2}[\\w.]*?>[\\s\\S]*$`, "gi"), "");
        p = p.replace(new RegExp(`<\\/?${fw}{0,2}DSML${fw}{1,2}[\\w.]*?>`, "gi"), "");
        p = p.replace(/<\s*\|\s*DSML\s*\|\s*[\w.]*?>[\s\S]*?<\/\s*\|\s*DSML\s*\|\s*[\w.]*?>/gi, "");
        p = p.replace(/<\/?\s*\|\s*DSML\s*\|\s*[\w.]*?>/gi, "");
        p = p.replace(/<\|(?:tool_calls_section_begin|tool_calls_section_end|tool_call_section_begin|tool_call_section_end|tool_call_begin|tool_call_end|tool_call_argument_begin|tool_call|tool_response|python_tag)\|>/gi, "");
        p = p.replace(/<\|[^|]{0,48}tool[^|]{0,48}\|>/gi, "");
        p = p.replace(/\[TOOL_CALLS\]\s*\[[\s\S]*?\](?=\s*(?:\n|$))/g, "");
        p = p.replace(/\[TOOL_CALLS\][^\n]*(?:\n\[(?:ARGS|CALL_ID)\][^\n]*)*/g, "");
        p = p.replace(/(?:^|\n)_execute\s*\n(?:tool_name|name)\s*:[^\n]*(?:\n[a-z_]+\s*:[^\n]*)*/gi, "\n");
        p = p.replace(/<\/?function\s*=[^>]*>/gi, "");
        p = p.replace(/<\/?parameter\s*=[^>]*>/gi, "");
        return p;
    });
    return s.replace(/\n{3,}/g, "\n\n");
}

function referenceCode(text: string): string {
    let s = text;
    const toolFn = /(?:default_api\.[a-zA-Z_]\w*|render_design_previews|read_file|edit_file|write_file|grep_search|run_terminal|web_search|list_terminals|terminal_read|terminal_input)/;
    s = s.replace(/```[\w-]*\s*\n([\s\S]*?)```/g, (full, body: string) => (/^\s*$/.test(body) ? full : full));
    s = s.replace(/\{\s*"tool_code"\s*:[\s\S]*$/g, (match) => /print\s*\(|render_design_previews|concepts\s*=/.test(match) ? "" : match);
    s = mapOutsideCodeFences(s, (prose) => {
        const printLine = new RegExp(`(?:^|\\n)[ \\t]*print\\s*\\(\\s*${toolFn.source}\\s*\\([^\\n]*\\)\\s*\\)[ \\t]*(?=\\n|$)`, "g");
        const printTail = new RegExp(`(?:^|\\n)[ \\t]*print\\s*\\(\\s*${toolFn.source}\\s*\\([^\\n]*$`, "g");
        const fnLine = new RegExp(`(?:^|\\n)[ \\t]*functions\\.${toolFn.source}\\s*\\(\\{[^\\n]*\\}\\)[ \\t]*(?=\\n|$)`, "g");
        const fnTail = new RegExp(`(?:^|\\n)[ \\t]*functions\\.${toolFn.source}\\s*\\(\\{[^\\n]*$`, "g");
        return prose.replace(printLine, "\n").replace(printTail, "\n").replace(fnLine, "\n").replace(fnTail, "\n");
    });
    s = referenceMarkup(s);
    return s.replace(/\n{3,}/g, "\n\n");
}

const cases: string[] = [
    "<tool_result>\n<list_terminals>x</list_terminals><tool_code>y</tool_code>",
    'a<parameter name="p"></tool_code>/</parameter><tool_result><tool_result>></parameter>',
    '<analysis title="unfinished>hidden prose',
    "Before <tool_result>outer <tool_result>inner</tool_result> trailing hidden</tool_result> After",
    'Before <tool_result><div data-value="</tool_result>">hidden content</div></tool_result> After',
    "Before <tool_result>hidden trailing",
];

describe("debug", () => {
    it("logs", () => {
        const lines: string[] = [];
        for (const c of cases) {
            lines.push(`INPUT ${JSON.stringify(c)}`);
            lines.push(`ours markup ${JSON.stringify(stripLeakedToolMarkup(c))}`);
            lines.push(`ref  markup ${JSON.stringify(referenceMarkup(c))}`);
            lines.push(`ours code   ${JSON.stringify(stripLeakedToolCode(c))}`);
            lines.push(`ref  code   ${JSON.stringify(referenceCode(c))}`);
        }
        writeFileSync("/tmp/opencode/debug-strip.txt", lines.join("\n"));
    });
});
