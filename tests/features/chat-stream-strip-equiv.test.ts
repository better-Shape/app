import { describe, expect, it } from "vitest";
import {
    stripLeakedToolCode,
    stripLeakedToolMarkup,
    looksLikeLeakedToolCode,
    LEAKED_TOOL_XML_TAGS,
} from "@/features/chat/ui/md/stream";

const STRIP_ACROSS_FENCES = ["tool_result", "terminal_read", "terminal_input", "list_terminals"] as const;

/**
 * CommonMark fence tracking, mirroring `stream.ts`. The older `split(/(```[\s\S]*?```)/)`
 * version paired any three backticks with the next one, so a line like "``` trailing"
 * closed a block here but not in the real renderer. This oracle must not disagree with
 * the splitter about which text is code, only about the strip rules inside prose.
 */
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
    let proseStart = 0;
    let fenceStart = -1;
    let fenceChar = "";
    let fenceLen = 0;
    let cursor = 0;
    while (cursor < text.length) {
        const nl = text.indexOf("\n", cursor);
        const afterLine = nl === -1 ? text.length : nl + 1;
        const parsed = marker(nl === -1 ? text.slice(cursor) : text.slice(cursor, nl));
        const opens = Boolean(parsed && (parsed.char !== "`" || !parsed.suffix.includes("`")));
        const closes = Boolean(
            parsed && fenceChar && parsed.char === fenceChar && parsed.len >= fenceLen
            && /^[ \t]*$/.test(parsed.suffix),
        );
        if (!fenceChar && parsed && opens) {
            if (cursor > proseStart) out.push(fn(text.slice(proseStart, cursor)));
            fenceStart = cursor;
            fenceChar = parsed.char;
            fenceLen = parsed.len;
        } else if (fenceChar && closes) {
            out.push(text.slice(fenceStart, afterLine));
            proseStart = afterLine;
            fenceStart = -1;
            fenceChar = "";
            fenceLen = 0;
        }
        cursor = afterLine;
    }
    if (fenceChar) out.push(text.slice(fenceStart));
    else if (proseStart < text.length) out.push(fn(text.slice(proseStart)));
    return out.join("");
}

/** The original implementation, kept here as the behavioural reference. */
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
        const dsmlOpen = new RegExp(
            `<${fw}{0,2}DSML${fw}{1,2}[\\w.]*?>[\\s\\S]*?<\\/${fw}{0,2}DSML${fw}{1,2}[\\w.]*?>`,
            "gi",
        );
        p = p.replace(dsmlOpen, "");
        p = p.replace(new RegExp(`<${fw}{0,2}DSML${fw}{1,2}[\\w.]*?>[\\s\\S]*$`, "gi"), "");
        p = p.replace(new RegExp(`<\\/?${fw}{0,2}DSML${fw}{1,2}[\\w.]*?>`, "gi"), "");
        p = p.replace(/<\s*\|\s*DSML\s*\|\s*[\w.]*?>[\s\S]*?<\/\s*\|\s*DSML\s*\|\s*[\w.]*?>/gi, "");
        p = p.replace(/<\/?\s*\|\s*DSML\s*\|\s*[\w.]*?>/gi, "");
        p = p.replace(
            /<\|(?:tool_calls_section_begin|tool_calls_section_end|tool_call_section_begin|tool_call_section_end|tool_call_begin|tool_call_end|tool_call_argument_begin|tool_call|tool_response|python_tag)\|>/gi,
            "",
        );
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
    // Unknown helper names are prose, not a leak: `print(foo(bar))` is a normal
    // Python example. Only the app's own tool helpers (and `default_api.*`) are
    // stripped, matching production.
    const toolFn = /(?:default_api\.[a-zA-Z_]\w*|render_design_previews|read_file|edit_file|write_file|grep_search|run_terminal|web_search|list_terminals|terminal_read|terminal_input)/;
    s = s.replace(/```[\w-]*\s*\n([\s\S]*?)```/g, (full, body: string) =>
        looksLikeLeakedToolCode(body) ? "" : full,
    );
    s = s.replace(/```[\w-]*\s*\n([\s\S]*)$/g, (full, body: string) =>
        looksLikeLeakedToolCode(body) ? "" : full,
    );
    s = s.replace(/\{\s*"tool_code"\s*:[\s\S]*$/g, (match) =>
        /print\s*\(|render_design_previews|concepts\s*=/.test(match) ? "" : match,
    );
    s = mapOutsideCodeFences(s, (prose) => {
        const printLine = new RegExp(`(?:^|\\n)[ \\t]*print\\s*\\(\\s*${toolFn.source}\\s*\\([^\\n]*\\)\\s*\\)[ \\t]*(?=\\n|$)`, "g");
        const printTail = new RegExp(`(?:^|\\n)[ \\t]*print\\s*\\(\\s*${toolFn.source}\\s*\\([^\\n]*$`, "g");
        const fnLine = new RegExp(`(?:^|\\n)[ \\t]*functions\\.${toolFn.source}\\s*\\(\\{[^\\n]*\\}\\)[ \\t]*(?=\\n|$)`, "g");
        const fnTail = new RegExp(`(?:^|\\n)[ \\t]*functions\\.${toolFn.source}\\s*\\(\\{[^\\n]*$`, "g");
        return prose
            .replace(printLine, "\n")
            .replace(printTail, "\n")
            .replace(fnLine, "\n")
            .replace(fnTail, "\n");
    });
    s = referenceMarkup(s);
    return s.replace(/\n{3,}/g, "\n\n");
}

const cases: string[] = [
    "plain prose with no markers at all",
    "prose with a < in a comparison: a < b and c > d",
    "prose with ```code fence``` inline",
    "```ts\nconst a = 1;\n```",
    "```json\n{ \"tool_code\": \"print(render_design_previews(x))\" }\n```",
    "hello\n\n\n\nworld",
    "<tool_call>{\"name\":\"read_file\"}</tool_call> after",
    "<tool_call>",
    "<function_calls><invoke name=\"x\"><parameter name=\"p\">1</parameter></invoke></function_calls>",
    "<|tool_call_begin|>{\"a\":1}<|tool_call_end|>",
    "<|python_tag|>print(foo())",
    "[TOOL_CALLS] [{\"name\": \"read\"}]\nnext line",
    "[TOOL_CALLS]name\n[ARGS]{}\nrest",
    "\n_execute\ntool_name: read\narg: 1\nkept",
    "<terminal_read>secret output</terminal_read>visible",
    "<tool_result>\n```\ncode inside\n```\n</tool_result>\nafter",
    "<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name=\"x\">body</｜｜DSML｜｜invoke>",
    "< | DSML | tool_calls>body</ | DSML | tool_calls>rest",
    "<function name=\"x\">y</function>",
    "<parameter name=\"a\">1</parameter>",
    "text <analysis>thinking</analysis> more",
    "```\ncode not a leak\n```\n<tool_code>x</tool_code>",
    "<tools><tool>x</tool></tools>tail",
    "a < b < c < d",
    "<new_path>foo</new_path>",
    "<content>1</content>",
    "<arg_key>k</arg_key><arg_value>v</arg_value>",
    "print(tool_name(x))",
    "prefix\n\n\n\n_something",
    "<invoke name=\"a\"></invoke>done",
    "text with print( but no call",
    "some { \"tool_code\": \"render_design_previews(...)\" }",
];

describe("strip equivalence", () => {
    it("stripLeakedToolMarkup matches reference", () => {
        for (const c of cases) {
            expect(stripLeakedToolMarkup(c), c).toBe(referenceMarkup(c));
        }
    });
    it("stripLeakedToolCode matches reference", () => {
        for (const c of cases) {
            expect(stripLeakedToolCode(c), c).toBe(referenceCode(c));
        }
    });
    it("random combinations", () => {
        let seed = 99;
        const rand = () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 0x100000000;
        };
        for (let i = 0; i < 300; i++) {
            const parts: string[] = [];
            for (let j = 0; j < 4; j++) parts.push(cases[Math.floor(rand() * cases.length)]!);
            const text = parts.join(rand() > 0.5 ? "\n" : " ");
            expect(stripLeakedToolCode(text), text).toBe(referenceCode(text));
            expect(stripLeakedToolMarkup(text), text).toBe(referenceMarkup(text));
        }
    });
});
