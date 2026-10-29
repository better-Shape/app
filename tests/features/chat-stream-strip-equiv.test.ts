import { describe, expect, it } from "vitest";
import {
    appendInlineCodeSpansInRange,
    scanMarkdownCodeFences,
    stripLeakedToolCode,
    stripLeakedToolMarkup,
    stripNestedTagBlocks,
    stripUnclosedToolTag,
    looksLikeLeakedToolCode,
    LEAKED_TOOL_XML_TAGS,
} from "@/features/chat/ui/md/stream";

const STRIP_ACROSS_FENCES = [
    "tool_result",
    "terminal_read",
    "terminal_input",
    "list_terminals",
] as const;

/**
 * CommonMark fence tracking wrapper for reference stripping transforms.
 * Routes prose outside CommonMark fences through `onProse` and fenced slices through `onFence`.
 */
const scanReferenceFences = (
    source: string,
    onProse: (prose: string) => string,
    onFence: (fenceSlice: string, isClosed: boolean) => string,
): string => {
    const fenceState = scanMarkdownCodeFences(source, 0);
    if (fenceState.ranges.length === 0) return onProse(source);
    const { output, endOffset } = fenceState.ranges.reduce(
        (acc, [rangeStart, rangeEnd], index) => {
            const isOpenTail =
                Boolean(fenceState.fenceChar) &&
                index === fenceState.ranges.length - 1;
            const before =
                rangeStart > acc.endOffset
                    ? onProse(source.slice(acc.endOffset, rangeStart))
                    : "";
            const fenced = onFence(
                source.slice(rangeStart, rangeEnd),
                !isOpenTail,
            );
            return {
                output: `${acc.output}${before}${fenced}`,
                endOffset: rangeEnd,
            };
        },
        { output: "", endOffset: 0 },
    );
    const trailing =
        endOffset < source.length ? onProse(source.slice(endOffset)) : "";
    return `${output}${trailing}`;
};

/** Maps `transformProse` across non-fenced regions of `source`. */
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
        cleaned = cleaned.replace(new RegExp(`<${esc}\\b[^>]*>[\\s\\S]*?<\\/${esc}>`, "giu"), "");
        cleaned = stripUnclosedToolTag(cleaned, tag);
        cleaned = cleaned
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

/** Maps `transformSlice` across prose regions outside CommonMark inline code spans. */
const mapOutsideReferenceInlineCode = (
    prose: string,
    transformSlice: (slice: string) => string,
): string => {
    const spans: Array<[number, number]> = [];
    appendInlineCodeSpansInRange(prose, 0, prose.length, spans);
    if (spans.length === 0) return transformSlice(prose);
    const { textAcc, cursorPos } = spans.reduce(
        (acc, [spanStart, spanEnd]) => {
            const leading =
                spanStart > acc.cursorPos
                    ? transformSlice(prose.slice(acc.cursorPos, spanStart))
                    : "";
            return {
                textAcc: `${acc.textAcc}${leading}${prose.slice(spanStart, spanEnd)}`,
                cursorPos: spanEnd,
            };
        },
        { textAcc: "", cursorPos: 0 },
    );
    const tail =
        cursorPos < prose.length ? transformSlice(prose.slice(cursorPos)) : "";
    return `${textAcc}${tail}`;
};

const collectReferenceProseInlineSpans = (text: string): Array<[number, number]> => {
    const spans: Array<[number, number]> = [];
    const { ranges } = scanMarkdownCodeFences(text, 0);
    let cursor = 0;
    for (const [start, end] of ranges) {
        if (cursor < start) appendInlineCodeSpansInRange(text, cursor, start, spans);
        cursor = end;
    }
    if (cursor < text.length) appendInlineCodeSpansInRange(text, cursor, text.length, spans);
    return spans;
};

/** Behavioural reference for `stripLeakedToolMarkup`. */
const referenceMarkup = (inputText: string): string => {
    let working = inputText;
    for (const tag of STRIP_ACROSS_FENCES) {
        const spans = collectReferenceProseInlineSpans(working);
        working = stripNestedTagBlocks(working, tag, spans);
        const tailSpans = collectReferenceProseInlineSpans(working);
        working = stripUnclosedToolTag(working, tag, true, tailSpans);
    }
    working = mapOutsideReferenceFences(working, (prose) =>
        mapOutsideReferenceInlineCode(prose, stripReferenceSentinelsInProse),
    );
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

/** Truncates from the earliest unfenced `{ "tool_code":` whose remaining tail triggers bare tool stripping. */
const stripReferenceBareToolCode = (source: string): string => {
    const fencedSpans = scanMarkdownCodeFences(source, 0).ranges;
    const candidates = Array.from(source.matchAll(/\{\s*"tool_code"\s*:/gu))
        .map((hit) => hit.index)
        .filter((pos) =>
            fencedSpans.every(([from, until]) => pos < from || pos >= until),
        );
    const firstPos = candidates[0];
    if (firstPos === undefined) return source;
    return /print\s*\(|render_design_previews|concepts\s*=/u.test(
        source.slice(firstPos),
    )
        ? source.slice(0, firstPos)
        : source;
};

/** Behavioural reference for `stripLeakedToolCode`. */
const referenceCode = (inputText: string): string => {
    let working = stripReferenceBareToolCode(stripReferenceFences(inputText));
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
    "```json\n{ \"tool_code\": \"sample\" }\n```\nLater prose calls print(x).",
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
    "Documented `<terminal_read>example output</terminal_read>` stays intact",
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
    // Adversarial shapes for the index-based tag scanner that replaced the
    // per-tag RegExp passes: bare `<`, closers inside attributes, casing, word
    // boundaries, nesting, crossed pairs, missing `>` and extra brackets.
    "a < b </tool_call>",
    "<tool_call a=\"</tool_call>\">x",
    "<TOOL_CALL>x</TOOL_CALL>",
    "</tool_call >kept",
    "<tool_call",
    "<tool_calls>x</tool_calls>",
    "<tool_call><tool_call>x</tool_call></tool_call>",
    "<invoke><tool_code>x</invoke></tool_code>",
    "<tool_call x='1'>a</tool_call>tail",
    "<tool_call/>",
    "<tool_call />",
    "<minimax:tool_call>z</minimax:tool_call>",
    "<tool_call\u00e9>x</tool_call\u00e9>",
    "text < tool_call>x</tool_call>",
    "```\n<tool_result>x</tool_result>\n```",
    "<analysis>a</analysis><tool_call>b</tool_call>",
    "<tool_call>unclosed opener only",
    "<<tool_call>>x</tool_call>",
    "<list_terminals>x</list_terminals><tool_code>y</tool_code>",
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

    it("matches reference on tag-heavy random input", () => {
        let seed = 7;
        const nextRand = (): number => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 0x100000000;
        };
        const fragments = [
            "<", ">", "/", " ", "\n", "x", "a", "```",
            "<tool_call>", "</tool_call>", "<tool_call ", "<tool_calls>", "</tool_calls>",
            "<invoke>", "</invoke>", "<tool_code>", "</tool_code>", "<analysis>", "</analysis>",
            "<parameter name=\"p\">", "</parameter>", "<function_calls>", "</function_calls>",
            "<tool_result>", "</tool_result>", "<|tool_call_begin|>", "[TOOL_CALLS]", "print(foo(",
        ];
        const sampleFragments = (count: number): string =>
            Array.from(
                { length: count },
                () => fragments[Math.floor(nextRand() * fragments.length)] ?? "",
            ).join("");
        for (let iter = 0; iter < 2000; iter += 1) {
            const text = sampleFragments(1 + Math.floor(nextRand() * 12));
            expect(stripLeakedToolMarkup(text), text).toBe(referenceMarkup(text));
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
