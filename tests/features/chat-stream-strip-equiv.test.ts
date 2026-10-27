import { describe, expect, it } from "vitest";
import {
    stripLeakedToolCode,
    stripLeakedToolMarkup,
    looksLikeLeakedToolCode,
    LEAKED_TOOL_XML_TAGS,
} from "@/features/chat/ui/md/stream";

const STRIP_ACROSS_FENCES = [
    "tool_result",
    "terminal_read",
    "terminal_input",
    "list_terminals",
] as const;

type ReferenceFenceMarker = {
    char: string;
    len: number;
    suffix: string;
};

type ReferenceFenceTracker = {
    proseStart: number;
    fenceStart: number;
    fenceChar: string;
    fenceLen: number;
};

const countLeadingIndent = (line: string): number => {
    let spaces = 0;
    while (spaces < 3 && line.charCodeAt(spaces) === 32) spaces += 1;
    return spaces;
};

const countRunOfChar = (line: string, from: number, ch: string): number => {
    let end = from;
    while (end < line.length && line.charAt(end) === ch) end += 1;
    return end - from;
};

const parseReferenceFenceMarker = (
    rawLine: string,
): ReferenceFenceMarker | null => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const indent = countLeadingIndent(line);
    const ch = line.charAt(indent);
    if (ch !== "`" && ch !== "~") return null;
    const len = countRunOfChar(line, indent, ch);
    return len >= 3 ? { char: ch, len, suffix: line.slice(indent + len) } : null;
};

const isReferenceFenceOpen = (
    marker: ReferenceFenceMarker | null,
): marker is ReferenceFenceMarker =>
    Boolean(marker && (marker.char !== "`" || !marker.suffix.includes("`")));

const isReferenceFenceClose = (
    marker: ReferenceFenceMarker | null,
    tracker: ReferenceFenceTracker,
): boolean =>
    Boolean(
        marker &&
            tracker.fenceChar &&
            marker.char === tracker.fenceChar &&
            marker.len >= tracker.fenceLen &&
            /^[ \t]*$/u.test(marker.suffix),
    );

const sliceReferenceLineWithoutLf = (
    source: string,
    lineStart: number,
    afterLine: number,
): string => {
    const end = source.charCodeAt(afterLine - 1) === 10 ? afterLine - 1 : afterLine;
    return source.slice(lineStart, end);
};

const openReferenceFence = (
    tracker: ReferenceFenceTracker,
    segments: string[],
    source: string,
    lineStart: number,
    parsed: ReferenceFenceMarker,
    transformProse: (prose: string) => string,
): void => {
    if (lineStart > tracker.proseStart) {
        segments.push(transformProse(source.slice(tracker.proseStart, lineStart)));
    }
    tracker.fenceStart = lineStart;
    tracker.fenceChar = parsed.char;
    tracker.fenceLen = parsed.len;
};

const advanceReferenceFenceLine = (
    tracker: ReferenceFenceTracker,
    segments: string[],
    source: string,
    lineStart: number,
    afterLine: number,
    callbacks: {
        onProse: (prose: string) => string;
        onFence: (fenceSlice: string, isClosed: boolean) => string;
    },
): void => {
    const parsed = parseReferenceFenceMarker(
        sliceReferenceLineWithoutLf(source, lineStart, afterLine),
    );
    if (!tracker.fenceChar) {
        if (isReferenceFenceOpen(parsed)) {
            openReferenceFence(
                tracker,
                segments,
                source,
                lineStart,
                parsed,
                callbacks.onProse,
            );
        }
        return;
    }
    if (isReferenceFenceClose(parsed, tracker)) {
        segments.push(
            callbacks.onFence(source.slice(tracker.fenceStart, afterLine), true),
        );
        tracker.proseStart = afterLine;
        tracker.fenceStart = -1;
        tracker.fenceChar = "";
        tracker.fenceLen = 0;
    }
};

/**
 * CommonMark fence tracking oracle. Tracks closed vs open fences so prose transforms
 * and leaked-fence filtering agree with CommonMark line-start rules.
 */
const scanReferenceFences = (
    source: string,
    onProse: (prose: string) => string,
    onFence: (fenceSlice: string, isClosed: boolean) => string,
): string => {
    const segments: string[] = [];
    const tracker: ReferenceFenceTracker = {
        proseStart: 0,
        fenceStart: -1,
        fenceChar: "",
        fenceLen: 0,
    };
    const callbacks = { onProse, onFence };
    let offset = 0;
    while (offset < source.length) {
        const nlIdx = source.indexOf("\n", offset);
        const nextOffset = nlIdx === -1 ? source.length : nlIdx + 1;
        advanceReferenceFenceLine(
            tracker,
            segments,
            source,
            offset,
            nextOffset,
            callbacks,
        );
        offset = nextOffset;
    }
    if (tracker.fenceChar) {
        segments.push(onFence(source.slice(tracker.fenceStart), false));
    } else if (tracker.proseStart < source.length) {
        segments.push(onProse(source.slice(tracker.proseStart)));
    }
    return segments.join("");
};

const mapOutsideReferenceFences = (
    source: string,
    transformProse: (prose: string) => string,
): string => scanReferenceFences(source, transformProse, (slice) => slice);

const escapeRegexLiteral = (token: string): string =>
    token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const stripReferenceTagList = (prose: string): string => {
    let cleaned = prose;
    for (const tag of LEAKED_TOOL_XML_TAGS) {
        const esc = escapeRegexLiteral(tag);
        cleaned = cleaned
            .replace(new RegExp(`<${esc}\\b[^>]*>[\\s\\S]*?<\\/${esc}>`, "giu"), "")
            .replace(new RegExp(`<${esc}\\b[^>]*\\/?>`, "giu"), "")
            .replace(new RegExp(`<${esc}\\b[^>]*>[\\s\\S]*$`, "giu"), "")
            .replace(new RegExp(`<\\/${esc}>`, "giu"), "");
    }
    return cleaned;
};

const stripReferenceSentinelsInProse = (prose: string): string => {
    const fw = "\uFF5C";
    let cleaned = stripReferenceTagList(prose);
    cleaned = cleaned
        .replace(
            new RegExp(
                `<${fw}{0,2}DSML${fw}{1,2}[\\w.]*?>[\\s\\S]*?<\\/${fw}{0,2}DSML${fw}{1,2}[\\w.]*?>`,
                "giu",
            ),
            "",
        )
        .replace(new RegExp(`<${fw}{0,2}DSML${fw}{1,2}[\\w.]*?>[\\s\\S]*$`, "giu"), "")
        .replace(new RegExp(`<\\/?${fw}{0,2}DSML${fw}{1,2}[\\w.]*?>`, "giu"), "")
        .replace(
            /<\s*\|\s*DSML\s*\|\s*[\w.]*?>[\s\S]*?<\/\s*\|\s*DSML\s*\|\s*[\w.]*?>/giu,
            "",
        )
        .replace(/<\/?\s*\|\s*DSML\s*\|\s*[\w.]*?>/giu, "")
        .replace(
            /<\|(?:tool_calls_section_begin|tool_calls_section_end|tool_call_section_begin|tool_call_section_end|tool_call_begin|tool_call_end|tool_call_argument_begin|tool_call|tool_response|python_tag)\|>/giu,
            "",
        )
        .replace(/<\|[^|]{0,48}tool[^|]{0,48}\|>/giu, "")
        .replace(/\[TOOL_CALLS\]\s*\[[\s\S]*?\](?=\s*(?:\n|$))/gu, "")
        .replace(/\[TOOL_CALLS\][^\n]*(?:\n\[(?:ARGS|CALL_ID)\][^\n]*)*/gu, "")
        .replace(
            /(?:^|\n)_execute\s*\n(?:tool_name|name)\s*:[^\n]*(?:\n[a-z_]+\s*:[^\n]*)*/giu,
            "\n",
        )
        .replace(/<\/?function\s*=[^>]*>/giu, "")
        .replace(/<\/?parameter\s*=[^>]*>/giu, "");
    return cleaned;
};

/** Behavioural reference for `stripLeakedToolMarkup`. */
const referenceMarkup = (inputText: string): string => {
    let working = inputText;
    for (const tag of STRIP_ACROSS_FENCES) {
        const esc = escapeRegexLiteral(tag);
        working = working.replace(
            new RegExp(`<${esc}\\b[^>]*>[\\s\\S]*?<\\/${esc}>`, "giu"),
            "",
        );
    }
    working = mapOutsideReferenceFences(working, stripReferenceSentinelsInProse);
    return working.replace(/\n{3,}/gu, "\n\n");
};

const detectTrailingLineBreak = (fenceSlice: string): string => {
    if (fenceSlice.endsWith("\r\n")) return "\r\n";
    return fenceSlice.endsWith("\n") ? "\n" : "";
};

const filterClosedReferenceFence = (
    fenceSlice: string,
    nlPos: number,
): string => {
    const suffixBreak = detectTrailingLineBreak(fenceSlice);
    const trimmedFence = suffixBreak
        ? fenceSlice.slice(0, -suffixBreak.length)
        : fenceSlice;
    const closeNl = trimmedFence.lastIndexOf("\n");
    const bodySlice =
        closeNl > nlPos ? trimmedFence.slice(nlPos + 1, closeNl + 1) : "";
    return looksLikeLeakedToolCode(bodySlice) ? suffixBreak : fenceSlice;
};

const filterReferenceLeakedFence = (
    fenceSlice: string,
    isClosed: boolean,
): string => {
    const nlPos = fenceSlice.indexOf("\n");
    if (nlPos === -1) return fenceSlice;
    const header = fenceSlice.slice(0, nlPos + 1).trimStart();
    if (!/^(?:`{3,}|~{3,})[\w-]*[ \t\r\f\v]*\n/u.test(header)) {
        return fenceSlice;
    }
    if (!isClosed) {
        return looksLikeLeakedToolCode(fenceSlice.slice(nlPos + 1))
            ? ""
            : fenceSlice;
    }
    return filterClosedReferenceFence(fenceSlice, nlPos);
};

const stripReferenceFences = (inputText: string): string =>
    scanReferenceFences(inputText, (prose) => prose, filterReferenceLeakedFence);

const REFERENCE_TOOL_FN =
    /(?:default_api\.[a-zA-Z_]\w*|render_design_previews|read_file|edit_file|write_file|grep_search|run_terminal|web_search|list_terminals|terminal_read|terminal_input)/u;

/** Behavioural reference for `stripLeakedToolCode`. */
const referenceCode = (inputText: string): string => {
    let working = stripReferenceFences(inputText);
    working = working.replace(/\{\s*"tool_code"\s*:[\s\S]*$/gu, (match) =>
        /print\s*\(|render_design_previews|concepts\s*=/u.test(match) ? "" : match,
    );
    working = mapOutsideReferenceFences(working, (prose) => {
        const src = REFERENCE_TOOL_FN.source;
        const printLine = new RegExp(
            `(?:^|\\n)[ \\t]*print\\s*\\(\\s*${src}\\s*\\([^\\n]*\\)\\s*\\)[ \\t]*(?=\\n|$)`,
            "gu",
        );
        const printTail = new RegExp(
            `(?:^|\\n)[ \\t]*print\\s*\\(\\s*${src}\\s*\\([^\\n]*$`,
            "gu",
        );
        const fnLine = new RegExp(
            `(?:^|\\n)[ \\t]*functions\\.${src}\\s*\\(\\{[^\\n]*\\}\\)[ \\t]*(?=\\n|$)`,
            "gu",
        );
        const fnTail = new RegExp(
            `(?:^|\\n)[ \\t]*functions\\.${src}\\s*\\(\\{[^\\n]*$`,
            "gu",
        );
        return prose
            .replace(printLine, "\n")
            .replace(printTail, "\n")
            .replace(fnLine, "\n")
            .replace(fnTail, "\n");
    });
    working = referenceMarkup(working);
    return working.replace(/\n{3,}/gu, "\n\n");
};

const cases: string[] = [
    "plain prose with no markers at all",
    "prose with a < in a comparison: a < b and c > d",
    "prose with ```code fence``` inline",
    "```ts\nconst a = 1;\n```",
    "```json\n{ \"tool_code\": \"print(render_design_previews(x))\" }\n```",
    "````json\n{ \"tool_code\": \"print(render_design_previews(x))\" }\n````",
    "~~~~json\n{ \"tool_code\": \"print(render_design_previews(x))\" }\n~~~~",
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
        for (const sample of cases) {
            expect(stripLeakedToolMarkup(sample), sample).toBe(
                referenceMarkup(sample),
            );
        }
    });

    it("stripLeakedToolCode matches reference and preserves closed code blocks before leaked tags", () => {
        expect(
            stripLeakedToolCode("```\ncode not a leak\n```\n<tool_code>x</tool_code>"),
        ).toBe("```\ncode not a leak\n```\n");
        expect(
            stripLeakedToolCode(
                "before\n````json\n{\"tool_code\": \"print(read_file('x'))\"}\n````\nafter",
            ),
        ).toBe("before\n\nafter");
        expect(
            stripLeakedToolCode(
                "before\n~~~~json\n{\"tool_code\": \"print(read_file('x'))\"}\n~~~~\nafter",
            ),
        ).toBe("before\n\nafter");
        const midLineEcho = [
            "```bash",
            'echo "```"',
            "```",
            "Prose mentioning `<tool_call>` inline",
            "```ts",
            "const ok = 1;",
            "```",
        ].join("\n");
        expect(stripLeakedToolCode(midLineEcho)).toBe(midLineEcho);
        for (const sample of cases) {
            expect(stripLeakedToolCode(sample), sample).toBe(referenceCode(sample));
        }
    });

    it("random combinations", () => {
        let seed = 99;
        const nextRandom = (): number => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 0x100000000;
        };
        for (let iter = 0; iter < 300; iter++) {
            const parts: string[] = [];
            for (let slot = 0; slot < 4; slot++) {
                const idx = Math.floor(nextRandom() * cases.length);
                parts.push(cases[idx] ?? "");
            }
            const text = parts.join(nextRandom() > 0.5 ? "\n" : " ");
            expect(stripLeakedToolCode(text), text).toBe(referenceCode(text));
            expect(stripLeakedToolMarkup(text), text).toBe(referenceMarkup(text));
        }
    });
});
