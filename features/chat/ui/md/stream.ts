/** Remove stray thinking tags that leaked into plain text. */
export const stripOrphanThinkTags = (text: string): string => {
    if (!text.includes("<")) return text;
    return text
        .replace(/<\/?redacted_thinking[^>]*>\s*/gi, "")
        .replace(/<\/?thinking[^>]*>\s*/gi, "")
        .replace(/<\/?reasoning[^>]*>\s*/gi, "")
        .replace(/<\/?think[^>]*>\s*/gi, "");
};

const LEAKED_TOOL_CALL_FN_RE =
    /(?:default_api\.[a-zA-Z_]\w*|render_design_previews|read_file|edit_file|write_file|grep_search|run_terminal|web_search|list_terminals|terminal_read|terminal_input)/;
const LEAKED_PRINT_FN_RE = new RegExp(
    `\\bprint\\s*\\(\\s*${LEAKED_TOOL_CALL_FN_RE.source}\\s*\\(`,
);
const LEAKED_FUNCTIONS_CALL_RE = new RegExp(
    `^functions\\.${LEAKED_TOOL_CALL_FN_RE.source}\\s*\\(`,
);
const GENERIC_FUNCTIONS_CALL_RE = /^functions\.[a-zA-Z_][a-zA-Z0-9_]*\s*\(/;
const GENERIC_PRINT_CALL_RE = /\bprint\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\(/;
const LEAKED_XML_OPEN_RE =
    /<(?:tool_call|function_call|minimax:tool_call|tool_code)\b/i;

const LEAKED_PRINT_LINE_RE = new RegExp(
    `(?:^|\\n)[ \\t]*print\\s*\\(\\s*${LEAKED_TOOL_CALL_FN_RE.source}\\s*\\([^\\n]*\\)\\s*\\)[ \\t]*(?=\\n|$)`,
    "g",
);
const LEAKED_PRINT_TAIL_RE = new RegExp(
    `(?:^|\\n)[ \\t]*print\\s*\\(\\s*${LEAKED_TOOL_CALL_FN_RE.source}\\s*\\([^\\n]*$`,
    "g",
);
const LEAKED_FN_LINE_RE = new RegExp(
    `(?:^|\\n)[ \\t]*functions\\.${LEAKED_TOOL_CALL_FN_RE.source}\\s*\\(\\{[^\\n]*\\}\\)[ \\t]*(?=\\n|$)`,
    "g",
);
const LEAKED_FN_TAIL_RE = new RegExp(
    `(?:^|\\n)[ \\t]*functions\\.${LEAKED_TOOL_CALL_FN_RE.source}\\s*\\(\\{[^\\n]*$`,
    "g",
);

/** Checks whether a single trimmed line matches a leaked tool invocation signature. */
const isLeakedToolInvocationLine = (
    line: string,
    hasPrintCall: boolean,
    hasExecute: boolean,
): boolean => {
    if (hasPrintCall && line === "tool_code") return true;
    if (LEAKED_FUNCTIONS_CALL_RE.test(line)) return true;
    return hasExecute && GENERIC_FUNCTIONS_CALL_RE.test(line);
};

/** Checks whether any line in `trimmed` matches a leaked `tool_code` or `functions.*` call. */
const hasLeakedInvocationLine = (
    trimmed: string,
    hasExecute: boolean,
): boolean => {
    const hasPrintCall = /\bprint\s*\(/.test(trimmed);
    for (const rawLine of trimmed.split("\n")) {
        const line = rawLine.trim();
        if (line && isLeakedToolInvocationLine(line, hasPrintCall, hasExecute)) {
            return true;
        }
    }
    return false;
};

/** Checks whether `trimmed` starts with a leaked JSON `tool_code` or `print(...)` wrapper. */
const hasDirectToolLeakSignature = (
    trimmed: string,
    hasExecute: boolean,
): boolean => {
    if (/"tool_code"\s*:/.test(trimmed) || LEAKED_PRINT_FN_RE.test(trimmed)) {
        return true;
    }
    return hasExecute && GENERIC_PRINT_CALL_RE.test(trimmed);
};

/** True when a fenced/JSON blob is a leaked model tool invocation, not user-facing code. */
export const looksLikeLeakedToolCode = (body: string): boolean => {
    const trimmed = body.trim();
    if (!trimmed) return false;
    const hasExecute = trimmed.includes("_execute");
    if (hasDirectToolLeakSignature(trimmed, hasExecute)) return true;
    if (hasLeakedInvocationLine(trimmed, hasExecute)) return true;
    return LEAKED_XML_OPEN_RE.test(trimmed);
};

/**
 * XML / sentinel tags that models leak into `content` instead of structured
 * tool_calls. Cover BetterShape catalog families (Claude, GPT, Gemini/Auto, Grok,
 * DeepSeek) plus common OpenRouter proxies. Do NOT include intentional BetterShape
 * UI tags (`edit`, `terminal_command`, `todos`, ...) — those are parsed separately.
 */
export const LEAKED_TOOL_XML_TAGS = [
    "list_terminals",
    "terminal_input",
    "terminal_read",
    "tool_result",
    "tool_code",
    "new_path",
    "file_content",
    "analysis",
    "tool_call",
    "tool_calls",
    "function_call",
    "function_calls",
    "function_response",
    "tool_response",
    "minimax:tool_call",
    "invoke",
    "parameter",
    "arg_key",
    "arg_value",
    "tools",
    "pre_dispatch_explanation",
] as const;

/** BetterShape UI wrappers. Strip even when they contain markdown fences (edit_file excerpts). */
const STRIP_ACROSS_FENCES = [
    "tool_result",
    "terminal_read",
    "terminal_input",
    "list_terminals",
] as const;

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

const STRIP_ACROSS_FENCES_PATTERNS = STRIP_ACROSS_FENCES.map((tag) => {
    const esc = tag.replace(ESCAPE_RE, "\\$&");
    return new RegExp(`<${esc}\\b[^>]*>[\\s\\S]*?<\\/${esc}>`, "gi");
});

const LEAKED_TAG_PATTERNS = LEAKED_TOOL_XML_TAGS.map((tag) => {
    const esc = tag.replace(ESCAPE_RE, "\\$&");
    return {
        paired: new RegExp(`<${esc}\\b[^>]*>[\\s\\S]*?<\\/${esc}>`, "gi"),
        selfClosing: new RegExp(`<${esc}\\b[^>]*\\/?>`, "gi"),
        openTail: new RegExp(`<${esc}\\b[^>]*>[\\s\\S]*$`, "gi"),
        strayCloser: new RegExp(`<\\/${esc}>`, "gi"),
    };
});

const FW_BAR = "\uFF5C";
const DSML_PAIRED_RE = new RegExp(
    `<${FW_BAR}{0,2}DSML${FW_BAR}{1,2}[\\w.]*?>[\\s\\S]*?<\\/${FW_BAR}{0,2}DSML${FW_BAR}{1,2}[\\w.]*?>`,
    "gi",
);
const DSML_OPEN_TAIL_RE = new RegExp(
    `<${FW_BAR}{0,2}DSML${FW_BAR}{1,2}[\\w.]*?>[\\s\\S]*$`,
    "gi",
);
const DSML_STRAY_RE = new RegExp(
    `<\\/?${FW_BAR}{0,2}DSML${FW_BAR}{1,2}[\\w.]*?>`,
    "gi",
);

type FenceMarkerInfo = {
    char: string;
    len: number;
    suffix: string;
};

/** Counts up to 3 leading ASCII spaces at the start of `line`. */
const countFenceIndentSpaces = (line: string): number => {
    let spaces = 0;
    while (spaces < 3 && line.charCodeAt(spaces) === 32) {
        spaces += 1;
    }
    return spaces;
};

/** Counts consecutive `markerChar` characters starting at `from`. */
const countRepeatedChar = (
    line: string,
    from: number,
    markerChar: string,
): number => {
    let end = from;
    while (end < line.length && line.charAt(end) === markerChar) {
        end += 1;
    }
    return end - from;
};

/** Reads a CommonMark backtick or tilde fence marker (`>= 3` chars) on a single line. */
const readStreamFenceMarker = (rawLine: string): FenceMarkerInfo | null => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const spaces = countFenceIndentSpaces(line);
    const markerChar = line.charAt(spaces);
    if (markerChar !== "`" && markerChar !== "~") return null;
    const len = countRepeatedChar(line, spaces, markerChar);
    if (len < 3) return null;
    return { char: markerChar, len, suffix: line.slice(spaces + len) };
};

/** Checks whether `parsed` opens a CommonMark fenced code block. */
const isOpeningStreamFence = (
    parsed: FenceMarkerInfo | null,
): parsed is FenceMarkerInfo =>
    Boolean(parsed && (parsed.char !== "`" || !parsed.suffix.includes("`")));

/** Checks whether `parsed` closes an open CommonMark fenced code block. */
const isClosingStreamFence = (
    parsed: FenceMarkerInfo | null,
    fenceChar: string,
    fenceLen: number,
): boolean =>
    Boolean(
        parsed &&
            parsed.char === fenceChar &&
            parsed.len >= fenceLen &&
            /^[ \t]*$/.test(parsed.suffix),
    );

/** Flushes any trailing open code fence or remaining prose tail into `out`. */
const flushRemainingFenceSegments = (
    out: string[],
    text: string,
    proseStart: number,
    fenceStart: number,
    hasOpenFence: boolean,
    fn: (prose: string) => string,
): void => {
    if (hasOpenFence) {
        out.push(text.slice(fenceStart));
    } else if (proseStart < text.length) {
        out.push(fn(text.slice(proseStart)));
    }
};

/** Reads one line from `text` starting at `cursor`, returning the line text and next offset. */
const readLineSliceAt = (
    text: string,
    cursor: number,
): { lineText: string; afterLine: number } => {
    const nl = text.indexOf("\n", cursor);
    if (nl === -1) {
        return { lineText: text.slice(cursor), afterLine: text.length };
    }
    return { lineText: text.slice(cursor, nl), afterLine: nl + 1 };
};

type FenceScanState = {
    proseStart: number;
    fenceStart: number;
    fenceChar: string;
    fenceLen: number;
};

/** Enters fenced code state starting at `cursor` and flushes any preceding prose segment. */
const enterFenceAt = (
    state: FenceScanState,
    out: string[],
    text: string,
    cursor: number,
    parsed: FenceMarkerInfo,
    fn: (prose: string) => string,
): void => {
    if (cursor > state.proseStart) {
        out.push(fn(text.slice(state.proseStart, cursor)));
    }
    state.fenceStart = cursor;
    state.fenceChar = parsed.char;
    state.fenceLen = parsed.len;
};

/** Advances `FenceScanState` across one line at `[cursor, afterLine)`. */
const stepFenceScanLine = (
    state: FenceScanState,
    out: string[],
    text: string,
    cursor: number,
    afterLine: number,
    parsed: FenceMarkerInfo | null,
    fn: (prose: string) => string,
): void => {
    if (!state.fenceChar) {
        if (isOpeningStreamFence(parsed)) {
            enterFenceAt(state, out, text, cursor, parsed, fn);
        }
        return;
    }
    if (isClosingStreamFence(parsed, state.fenceChar, state.fenceLen)) {
        out.push(text.slice(state.fenceStart, afterLine));
        state.proseStart = afterLine;
        state.fenceStart = -1;
        state.fenceChar = "";
        state.fenceLen = 0;
    }
};

/** Apply `fn` only to prose outside CommonMark backtick or tilde fenced code blocks. */
const mapOutsideCodeFences = (
    text: string,
    fn: (prose: string) => string,
): string => {
    if (!text.includes("```") && !text.includes("~~~")) return fn(text);
    const out: string[] = [];
    const state: FenceScanState = {
        proseStart: 0,
        fenceStart: -1,
        fenceChar: "",
        fenceLen: 0,
    };
    let cursor = 0;

    while (cursor < text.length) {
        const { lineText, afterLine } = readLineSliceAt(text, cursor);
        stepFenceScanLine(
            state,
            out,
            text,
            cursor,
            afterLine,
            readStreamFenceMarker(lineText),
            fn,
        );
        cursor = afterLine;
    }

    flushRemainingFenceSegments(
        out,
        text,
        state.proseStart,
        state.fenceStart,
        Boolean(state.fenceChar),
        fn,
    );
    return out.join("");
};

/** Collapses runs of 3+ consecutive newlines down to paragraph-break pairs. */
const collapseExcessNewlines = (text: string): string =>
    text.includes("\n\n\n") ? text.replace(/\n{3,}/g, "\n\n") : text;

/** Checks whether `text` contains any sentinel token that could represent leaked tool markup. */
const hasAnyToolMarkupSentinel = (text: string): boolean =>
    text.includes("<") ||
    text.includes(FW_BAR) ||
    text.includes("[TOOL_CALLS]") ||
    text.includes("_execute");

/** Strips XML leaked tool tags from a prose slice when `<` is present. */
const stripLeakedXmlTagsInProse = (prose: string): string => {
    let out = prose;
    for (const rule of LEAKED_TAG_PATTERNS) {
        if (!out.includes("<")) break;
        out = out
            .replace(rule.paired, "")
            .replace(rule.selfClosing, "")
            .replace(rule.openTail, "")
            .replace(rule.strayCloser, "");
    }
    return out;
};

/** Strips DSML and pipe-delimited model tool sentinels from a prose slice. */
const stripDsmlAndPipeSentinels = (prose: string): string =>
    prose
        .replace(DSML_PAIRED_RE, "")
        .replace(DSML_OPEN_TAIL_RE, "")
        .replace(DSML_STRAY_RE, "")
        .replace(
            /<\s*\|\s*DSML\s*\|\s*[\w.]*?>[\s\S]*?<\/\s*\|\s*DSML\s*\|\s*[\w.]*?>/gi,
            "",
        )
        .replace(/<\/?\s*\|\s*DSML\s*\|\s*[\w.]*?>/gi, "")
        .replace(
            /<\|(?:tool_calls_section_begin|tool_calls_section_end|tool_call_section_begin|tool_call_section_end|tool_call_begin|tool_call_end|tool_call_argument_begin|tool_call|tool_response|python_tag)\|>/gi,
            "",
        )
        .replace(/<\|[^|]{0,48}tool[^|]{0,48}\|>/gi, "")
        .replace(/<\/?function\s*=[^>]*>/gi, "")
        .replace(/<\/?parameter\s*=[^>]*>/gi, "");

/** Strips Mistral `[TOOL_CALLS]` and `_execute` tool-call blocks from a prose slice. */
const stripMistralAndExecuteBlocks = (prose: string): string => {
    let out = prose;
    if (out.includes("[TOOL_CALLS]")) {
        out = out
            .replace(/\[TOOL_CALLS\]\s*\[[\s\S]*?\](?=\s*(?:\n|$))/g, "")
            .replace(/\[TOOL_CALLS\][^\n]*(?:\n\[(?:ARGS|CALL_ID)\][^\n]*)*/g, "");
    }
    if (out.includes("_execute")) {
        out = out.replace(
            /(?:^|\n)_execute\s*\n(?:tool_name|name)\s*:[^\n]*(?:\n[a-z_]+\s*:[^\n]*)*/gi,
            "\n",
        );
    }
    return out;
};

/** Sanitizes a single non-fenced prose segment for leaked tool markup. */
const sanitizeProseToolMarkup = (prose: string): string => {
    if (!hasAnyToolMarkupSentinel(prose)) return prose;
    let out = prose.includes("<") ? stripLeakedXmlTagsInProse(prose) : prose;
    if (out.includes("<") || out.includes(FW_BAR)) {
        out = stripDsmlAndPipeSentinels(out);
    }
    return stripMistralAndExecuteBlocks(out);
};

/**
 * Strip provider/model tool-call grammars that leaked into assistant text.
 * Surveyed shapes: DeepSeek DSML, Qwen/Hermes/GLM `<tool_call>`, MiniMax,
 * Kimi/Llama/Gemma `<|...|>` sentinels, Gemini `<function_calls>` / `tool_code`,
 * Mistral `[TOOL_CALLS]`, plus BetterShape terminal UI chunks.
 */
export const stripLeakedToolMarkup = (text: string): string => {
    if (!hasAnyToolMarkupSentinel(text)) {
        return collapseExcessNewlines(text);
    }
    let out = text;
    if (out.includes("<")) {
        for (const pattern of STRIP_ACROSS_FENCES_PATTERNS) {
            out = out.replace(pattern, "");
        }
    }
    out = mapOutsideCodeFences(out, sanitizeProseToolMarkup);
    return collapseExcessNewlines(out);
};

/** Replaces a fenced block with `""` when its body matches `looksLikeLeakedToolCode`. */
const replaceLeakedFenceMatch = (
    full: string,
    _fence: string,
    body: string,
): string => (looksLikeLeakedToolCode(body) ? "" : full);

/** Strips backtick- or tilde-fenced code blocks (closed or mid-stream) whose bodies are leaked tool calls. */
const stripLeakedFencedToolBlocks = (text: string): string => {
    if (!text.includes("```") && !text.includes("~~~")) return text;
    return text
        .replace(
            /(`{3,}|~{3,})[\w-]*[ \t]*\r?\n([\s\S]*?)\1/gu,
            replaceLeakedFenceMatch,
        )
        .replace(
            /(`{3,}|~{3,})[\w-]*[ \t]*\r?\n([\s\S]*)$/gu,
            replaceLeakedFenceMatch,
        );
};

/** Strips bare `{ "tool_code": "..." }` JSON dumps and leaked `print`/`functions.*` lines. */
const stripBareToolInvocations = (text: string): string => {
    let out = text;
    if (out.includes("tool_code")) {
        out = out.replace(/\{\s*"tool_code"\s*:[\s\S]*$/g, (match) =>
            /print\s*\(|render_design_previews|concepts\s*=/.test(match)
                ? ""
                : match,
        );
    }
    if (out.includes("print") || out.includes("functions.")) {
        out = mapOutsideCodeFences(out, (prose) =>
            prose
                .replace(LEAKED_PRINT_LINE_RE, "\n")
                .replace(LEAKED_PRINT_TAIL_RE, "\n")
                .replace(LEAKED_FN_LINE_RE, "\n")
                .replace(LEAKED_FN_TAIL_RE, "\n"),
        );
    }
    return out;
};

/**
 * Strip Gemini/OpenRouter-style tool leaks that models sometimes paste as
 * markdown JSON instead of issuing a real tool call, plus cross-model XML sentinels.
 */
export const stripLeakedToolCode = (text: string): string => {
    const withoutFences = stripLeakedFencedToolBlocks(text);
    const withoutInvocations = stripBareToolInvocations(withoutFences);
    return collapseExcessNewlines(stripLeakedToolMarkup(withoutInvocations));
};

/** Fast 3-point character precheck before comparing `text.slice(i, i + len)` against `i + len`. */
const matchesAdjacentRepeatAt = (
    text: string,
    i: number,
    len: number,
    midOffset: number,
): boolean => {
    const matchesEnds =
        text.charCodeAt(i) === text.charCodeAt(i + len) &&
        text.charCodeAt(i + len - 1) === text.charCodeAt(i + len * 2 - 1);
    if (!matchesEnds) return false;
    return (
        text.charCodeAt(i + midOffset) ===
            text.charCodeAt(i + len + midOffset) &&
        text.startsWith(text.slice(i, i + len), i + len)
    );
};

/** Collapses an immediate back-to-back repeated substring (`>= 20` chars) if present. */
const collapseAdjacentDuplicateSpan = (text: string): string | null => {
    const maxAdjLen = Math.min(120, Math.floor(text.length / 2));
    for (let len = maxAdjLen; len >= 20; len -= 1) {
        const limit = text.length - len * 2;
        const midOffset = len >> 1;
        for (let i = 0; i <= limit; i += 1) {
            if (matchesAdjacentRepeatAt(text, i, len, midOffset)) {
                return text.slice(0, i + len) + text.slice(i + len * 2);
            }
        }
    }
    return null;
};

/** Measures how many characters starting at `0` and `start` match identically (`>= 20`). */
const measurePrefixReplayLength = (text: string, start: number): number => {
    const maxLen = Math.min(start, text.length - start);
    let matched = 20;
    while (
        matched < maxLen &&
        text.charCodeAt(matched) === text.charCodeAt(start + matched)
    ) {
        matched += 1;
    }
    return matched;
};

/** Checks whether a repeated opening prefix at `start` is an accidental stream replay glitch. */
const isPrefixReplayGlitch = (
    text: string,
    start: number,
    matched: number,
): boolean => {
    if (matched === start || matched >= 80) return true;
    const prevChar = text.charAt(start - 1);
    return prevChar.length > 0 && !/\s/.test(prevChar);
};

/** Removes an accidental re-emission of the message opening (`>= 20` chars) while keeping valid prose. */
const collapseOpeningPrefixReplay = (text: string): string | null => {
    const prefix20 = text.slice(0, 20);
    let searchFrom = 20;
    while (searchFrom <= text.length - 20) {
        const start = text.indexOf(prefix20, searchFrom);
        if (start === -1 || start > text.length - 20) break;
        const matched = measurePrefixReplayLength(text, start);
        if (isPrefixReplayGlitch(text, start, matched)) {
            return text.slice(0, start) + text.slice(start + matched);
        }
        searchFrom = start + 1;
    }
    return null;
};

/** Collapses mid-word `camelGlued` tail replays (`>= 16` chars) when present. */
const collapseGluedTailReplay = (text: string): string | null => {
    const glued = text.match(/([a-z])([A-Z][a-z]{4,})/);
    if (glued?.index === undefined) return null;
    const splitAt = glued.index + 1;
    const prefix = text.slice(0, splitAt);
    const suffix = text.slice(splitAt);
    const maxCheck = Math.min(80, prefix.length);
    for (let checkLen = 16; checkLen <= maxCheck; checkLen += 1) {
        const tail = prefix.slice(-checkLen);
        if (suffix.startsWith(tail)) {
            return prefix + suffix.slice(tail.length);
        }
    }
    return null;
};

/** Repair cumulative-stream glitches and obvious duplicate phrases in assistant text. */
export const repairStreamGlitches = (text: string): string => {
    if (text.length < 40) return text;
    const adjacent = collapseAdjacentDuplicateSpan(text);
    if (adjacent !== null) return adjacent;
    const replay = collapseOpeningPrefixReplay(text);
    if (replay !== null) return replay;
    return collapseGluedTailReplay(text) ?? text;
};

/** Normalize assistant markdown before ReactMarkdown. */
export const looksLikeProseMarkdown = (text: string): boolean =>
    /(^|\n)#{1,6}\s+\S/.test(text) ||
    /(^|\n)[-*+]\s+\S/.test(text) ||
    /(^|\n)\d+\.\s+\S/.test(text);

/** Unindents a single 4-space or tab-indented Markdown heading or list item line. */
const demoteSingleIndentedMarkdownLine = (line: string): string => {
    const match = /^( {4,}|\t+)(.*)$/.exec(line);
    if (!match) return line;
    const inner = match[2];
    return /^(#{1,6}\s|[-*+]\s|\d+\.\s)/.test(inner) ? inner : line;
};

/** Demotes 4-space/tab indented Markdown headings and list items back to top-level prose. */
const demoteIndentedMarkdown = (text: string): string => {
    if (!text.includes("    ") && !text.includes("\t")) return text;
    return text.split("\n").map(demoteSingleIndentedMarkdownLine).join("\n");
};

/** Unwraps an accidental outer triple-backtick fence wrapping ordinary prose Markdown. */
const unwrapOuterProseFence = (text: string): string => {
    const trimmed = text.trim();
    if (!trimmed.startsWith("```")) return text;
    const outer = /^```(?:[\w-]*)?\s*\n([\s\S]*?)\n```\s*$/.exec(trimmed);
    return outer && looksLikeProseMarkdown(outer[1]) ? outer[1] : text;
};

const PAIRED_STRIP_TAG_LIST = [
    "iframe",
    "script",
    "style",
    "object",
    "embed",
] as const;
const PAIRED_STRIP_TAGS = new Set<string>(PAIRED_STRIP_TAG_LIST);
const LAYOUT_HTML_TAGS = new Set([
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "div",
    "span",
    "a",
    "ul",
    "ol",
    "li",
    "strong",
    "em",
    "b",
    "i",
    "section",
    "article",
    "header",
    "footer",
]);
const DISALLOWED_UNQUOTED_TAG_CHARS = new Set([
    "<",
    "&",
    "|",
    ",",
    ";",
    "(",
    ")",
]);

/** Counts consecutive backticks starting at `start`. */
const countBacktickRun = (input: string, start: number): number => {
    let end = start;
    while (end < input.length && input.charCodeAt(end) === 96) end += 1;
    return end - start;
};

/** Finds the closing backtick run of exact length `runLen`, or `-1` if unclosed. */
const findMatchingBackticks = (
    input: string,
    from: number,
    runLen: number,
): number => {
    let pos = from;
    while (pos < input.length) {
        const next = input.indexOf("`", pos);
        if (next === -1) return -1;
        const count = countBacktickRun(input, next);
        if (count === runLen) return next + count;
        pos = next + count;
    }
    return -1;
};

/** Checks whether `[tick, closeEnd]` forms a valid single-paragraph inline code span. */
const isValidInlineCodeSpan = (
    input: string,
    tick: number,
    closeEnd: number,
): boolean => closeEnd !== -1 && !input.slice(tick, closeEnd).includes("\n\n");

/** Collects `[start, end]` offsets for closed inline backtick code spans. */
const collectInlineCodeRanges = (input: string): Array<[number, number]> => {
    if (!input.includes("`")) return [];
    const ranges: Array<[number, number]> = [];
    let pos = 0;
    while (pos < input.length) {
        const tick = input.indexOf("`", pos);
        if (tick === -1) break;
        const runLen = countBacktickRun(input, tick);
        const closeEnd = findMatchingBackticks(input, tick + runLen, runLen);
        if (isValidInlineCodeSpan(input, tick, closeEnd)) {
            ranges.push([tick, closeEnd]);
            pos = closeEnd;
        } else {
            pos = tick + runLen;
        }
    }
    return ranges;
};

/** True when `ch` is an ASCII letter (`A-Z` or `a-z`). */
const isAsciiAlpha = (ch: string): boolean => {
    if (!ch) return false;
    const code = ch.charCodeAt(0);
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
};

/** Checks whether `input[start..end)` consists exclusively of whitespace characters. */
const isOnlyWhitespaceSlice = (
    input: string,
    start: number,
    end: number,
): boolean => /^\s*$/.test(input.slice(start, end));

/** Updates active quote state (`"` or `'`) when `ch` is a quote delimiter. */
const stepQuoteState = (quote: string | null, ch: string): string | null => {
    if (quote) return ch === quote ? null : quote;
    return ch === '"' || ch === "'" ? ch : null;
};

/** Checks whether an unquoted character `ch` is forbidden inside an HTML opening-tag tail. */
const isDisallowedUnquotedChar = (
    quote: string | null,
    nextQuote: string | null,
    ch: string,
): boolean =>
    quote === null &&
    nextQuote === null &&
    DISALLOWED_UNQUOTED_TAG_CHARS.has(ch);

/**
 * Validates the substring between `<tagName` and `>` for layout HTML tags so
 * math/code expressions like `f(a<b, c>d)` or `x<b && c>y` are never stripped.
 */
const hasPlausibleHtmlTagTail = (
    input: string,
    start: number,
    end: number,
    isClosing: boolean,
): boolean => {
    if (isClosing) return isOnlyWhitespaceSlice(input, start, end);
    let quote: string | null = null;
    for (let i = start; i < end; i += 1) {
        const ch = input.charAt(i);
        const nextQuote = stepQuoteState(quote, ch);
        if (isDisallowedUnquotedChar(quote, nextQuote, ch)) return false;
        quote = nextQuote;
    }
    return quote === null;
};

type TagCloseScanState = {
    quote: string | null;
    unclosedQuoteGt: number;
};

/** Handles one unquoted character while scanning for a tag's closing `>`. */
const stepUnquotedTagScan = (
    state: TagCloseScanState,
    ch: string,
    index: number,
): number => {
    if (ch === ">") return index;
    if (ch === '"' || ch === "'") state.quote = ch;
    return -1;
};

/** Handles one character inside an open attribute quote while scanning for `>`. */
const stepQuotedTagScan = (
    state: TagCloseScanState,
    ch: string,
    index: number,
): number => {
    if (ch === state.quote) {
        state.quote = null;
        state.unclosedQuoteGt = -1;
        return -1;
    }
    if (ch === ">" && state.unclosedQuoteGt === -1) {
        state.unclosedQuoteGt = index;
    }
    if (ch !== "\n") return -1;
    const fallbackGt = state.unclosedQuoteGt;
    state.quote = null;
    state.unclosedQuoteGt = -1;
    return fallbackGt;
};

/**
 * Finds the closing `>` of an HTML tag starting at `start`, ignoring `>` inside
 * single- or double-quoted attribute values across single- and multi-line tags.
 */
const findHtmlTagClose = (input: string, start: number): number => {
    const state: TagCloseScanState = { quote: null, unclosedQuoteGt: -1 };
    for (let i = start; i < input.length; i += 1) {
        const ch = input.charAt(i);
        const hit =
            state.quote === null
                ? stepUnquotedTagScan(state, ch, i)
                : stepQuotedTagScan(state, ch, i);
        if (hit !== -1) return hit;
    }
    return state.unclosedQuoteGt;
};

/** Checks whether the character immediately following an HTML tag name is a valid delimiter. */
const isHtmlTagNameBoundary = (ch: string): boolean =>
    ch === "" || ch === ">" || ch === "/" || /\s/.test(ch);

/** Finds the matching `</tagName>` boundary, rejecting longer prefixes such as `</scriptx>`. */
const findPairedClosingTagEnd = (
    lowerInput: string,
    tagName: string,
    searchFrom: number,
): number => {
    const closeNeedle = `</${tagName}`;
    let from = searchFrom;
    while (from < lowerInput.length) {
        const closeIdx = lowerInput.indexOf(closeNeedle, from);
        if (closeIdx === -1) return -1;
        const afterNamePos = closeIdx + closeNeedle.length;
        if (isHtmlTagNameBoundary(lowerInput.charAt(afterNamePos))) {
            const closeGt = findHtmlTagClose(lowerInput, afterNamePos);
            return closeGt === -1 ? lowerInput.length : closeGt + 1;
        }
        from = afterNamePos;
    }
    return -1;
};

type ParsedHtmlTagHeader = {
    isClosing: boolean;
    tagName: string;
    afterNamePos: number;
    isPairedStripTag: boolean;
};

/** Scans contiguous ASCII alphanumeric tag-name characters starting at `start`. */
const scanAsciiTagNameEnd = (input: string, start: number): number => {
    let pos = start;
    while (pos < input.length && /[a-zA-Z0-9]/.test(input.charAt(pos))) {
        pos += 1;
    }
    return pos;
};

/** Checks whether `(tagName, validBoundary)` should be stripped as a dangerous/paired tag. */
const shouldStripAsPairedOrScriptTag = (
    tagName: string,
    validBoundary: boolean,
): boolean =>
    (validBoundary && PAIRED_STRIP_TAGS.has(tagName)) ||
    tagName.startsWith("script");

/** Parses `<tagName` or `</tagName` starting at `lt`; returns `null` when not a candidate HTML tag. */
const parseHtmlTagHeaderAt = (
    input: string,
    lt: number,
): ParsedHtmlTagHeader | null => {
    const isClosing = input.charAt(lt + 1) === "/";
    const nameStart = isClosing ? lt + 2 : lt + 1;
    if (!isAsciiAlpha(input.charAt(nameStart))) return null;
    const afterNamePos = scanAsciiTagNameEnd(input, nameStart);
    const tagName = input.slice(nameStart, afterNamePos).toLowerCase();
    const validBoundary = isHtmlTagNameBoundary(input.charAt(afterNamePos));
    const isPairedStripTag = shouldStripAsPairedOrScriptTag(
        tagName,
        validBoundary,
    );
    if (!validBoundary && !isPairedStripTag) return null;
    return { isClosing, tagName, afterNamePos, isPairedStripTag };
};

/** Advances `rangeIndex` and checks whether `lt` lies inside an inline backtick code span. */
const advanceInlineCodeRange = (
    codeRanges: Array<[number, number]>,
    rangeIndex: number,
    lt: number,
): { nextRangeIndex: number; insideCode: boolean } => {
    let idx = rangeIndex;
    while (idx < codeRanges.length && codeRanges[idx][1] <= lt) idx += 1;
    const active = codeRanges.at(idx);
    return {
        nextRangeIndex: idx,
        insideCode: Boolean(active && lt >= active[0] && lt < active[1]),
    };
};

const SELF_STRIP_OPEN_REPLACEMENTS: Partial<Record<string, string>> = {
    br: "\n",
    img: "",
};

/** Maps a validated standard HTML tag (`br`, `img`, layout tags, or unknown) to its replacement text. */
const mapValidatedHtmlTagText = (
    input: string,
    lt: number,
    gt: number,
    header: ParsedHtmlTagHeader,
): string => {
    if (!header.isClosing) {
        const direct = SELF_STRIP_OPEN_REPLACEMENTS[header.tagName];
        if (direct !== undefined) return direct;
    }
    if (LAYOUT_HTML_TAGS.has(header.tagName)) {
        return header.isClosing ? "\n" : "";
    }
    return input.slice(lt, gt + 1);
};

/** Resolves the replacement text (`""`, `"\n"`, or original slice) for a non-paired HTML tag. */
const resolveStandardHtmlTagReplacement = (
    input: string,
    lt: number,
    gt: number,
    header: ParsedHtmlTagHeader,
): { chunk: string; nextCursor: number } => {
    if (
        gt === -1 ||
        !hasPlausibleHtmlTagTail(
            input,
            header.afterNamePos,
            gt,
            header.isClosing,
        )
    ) {
        return { chunk: "<", nextCursor: lt + 1 };
    }
    return {
        chunk: mapValidatedHtmlTagText(input, lt, gt, header),
        nextCursor: gt + 1,
    };
};

/** Checks whether a paired-strip header represents an opening tag with an expected closing tag. */
const needsPairedClosingSearch = (header: ParsedHtmlTagHeader): boolean =>
    !header.isClosing && PAIRED_STRIP_TAGS.has(header.tagName);

/** Resolves the next scanner cursor when stripping a paired `<script>`/`<style>` tag. */
const resolvePairedStripCursor = (
    input: string,
    gt: number,
    header: ParsedHtmlTagHeader,
    cachedLower: string | null,
): { nextCursor: number; lowerInput: string | null } => {
    if (gt === -1) return { nextCursor: input.length, lowerInput: cachedLower };
    if (!needsPairedClosingSearch(header)) {
        return { nextCursor: gt + 1, lowerInput: cachedLower };
    }
    const lowerInput = cachedLower ?? input.toLowerCase();
    const closeEnd = findPairedClosingTagEnd(lowerInput, header.tagName, gt + 1);
    return { nextCursor: closeEnd !== -1 ? closeEnd : gt + 1, lowerInput };
};

/** Evaluates one `<` candidate at `lt` and returns `{ chunk, nextCursor, lowerInput }`. */
const stepHtmlTagAt = (
    input: string,
    lt: number,
    insideCode: boolean,
    cachedLower: string | null,
): { chunk: string; nextCursor: number; lowerInput: string | null } => {
    const header = insideCode ? null : parseHtmlTagHeaderAt(input, lt);
    if (!header) {
        return { chunk: "<", nextCursor: lt + 1, lowerInput: cachedLower };
    }
    const gt = findHtmlTagClose(input, header.afterNamePos);
    if (header.isPairedStripTag) {
        const paired = resolvePairedStripCursor(input, gt, header, cachedLower);
        return {
            chunk: "",
            nextCursor: paired.nextCursor,
            lowerInput: paired.lowerInput,
        };
    }
    const step = resolveStandardHtmlTagReplacement(input, lt, gt, header);
    return {
        chunk: step.chunk,
        nextCursor: step.nextCursor,
        lowerInput: cachedLower,
    };
};

/** Single linear character-scanner pass stripping raw HTML tags without regex backtracking. */
const stripHtmlTagsOnce = (input: string): string => {
    const codeRanges = collectInlineCodeRanges(input);
    let rangeIndex = 0;
    let lowerInput: string | null = null;
    let out = "";
    let cursor = 0;

    while (cursor < input.length) {
        const lt = input.indexOf("<", cursor);
        if (lt === -1) return out + input.slice(cursor);
        out += input.slice(cursor, lt);
        const rangeCheck = advanceInlineCodeRange(codeRanges, rangeIndex, lt);
        rangeIndex = rangeCheck.nextRangeIndex;
        const step = stepHtmlTagAt(
            input,
            lt,
            rangeCheck.insideCode,
            lowerInput,
        );
        out += step.chunk;
        cursor = step.nextCursor;
        lowerInput = step.lowerInput;
    }

    return out;
};

/** Iteratively strips nested raw HTML fragments up to a fixed point of 8 passes. */
const stripRawHtmlToFixedPoint = (part: string): string => {
    let out = part;
    for (let pass = 0; pass < 8; pass += 1) {
        const next = stripHtmlTagsOnce(out);
        if (next === out) break;
        out = next;
    }
    return out;
};

/** Strips raw HTML tags from prose while preserving fenced and inline code blocks. */
const stripRawHtml = (text: string): string => {
    if (!text.includes("<")) return text;
    return mapOutsideCodeFences(text, stripRawHtmlToFixedPoint);
};

const MAX_DISPLAY_CHARS = 48_000;

/** Truncates excessively long finished responses so ReactMarkdown layout stays responsive. */
const truncateForDisplay = (text: string): string => {
    if (text.length <= MAX_DISPLAY_CHARS) return text;
    return `${text.slice(0, MAX_DISPLAY_CHARS)}\n\n... (response truncated for display)`;
};

export type CodeFenceState = {
    ranges: Array<readonly [number, number]>;
    fenceStart: number;
    fenceChar: string;
    fenceLen: number;
};

/** Advances `CodeFenceState` across one line `[cursor, afterLine)`. */
const stepCodeFenceRangeLine = (
    state: CodeFenceState,
    cursor: number,
    afterLine: number,
    parsed: FenceMarkerInfo | null,
): void => {
    if (!state.fenceChar) {
        if (isOpeningStreamFence(parsed)) {
            state.fenceStart = cursor;
            state.fenceChar = parsed.char;
            state.fenceLen = parsed.len;
        }
        return;
    }
    if (isClosingStreamFence(parsed, state.fenceChar, state.fenceLen)) {
        state.ranges.push([state.fenceStart, afterLine]);
        state.fenceStart = -1;
        state.fenceChar = "";
        state.fenceLen = 0;
    }
};

/** Scans CommonMark fenced code blocks from `fromIndex`, returning `[start, end)` ranges plus any open tail. */
export const scanMarkdownCodeFences = (
    text: string,
    fromIndex = 0,
): CodeFenceState => {
    const state: CodeFenceState = {
        ranges: [],
        fenceStart: -1,
        fenceChar: "",
        fenceLen: 0,
    };
    if (!text.includes("```", fromIndex) && !text.includes("~~~", fromIndex)) {
        return state;
    }
    let cursor = fromIndex;
    while (cursor < text.length) {
        const { lineText, afterLine } = readLineSliceAt(text, cursor);
        stepCodeFenceRangeLine(
            state,
            cursor,
            afterLine,
            readStreamFenceMarker(lineText),
        );
        cursor = afterLine;
    }
    if (state.fenceChar) {
        state.ranges.push([state.fenceStart, text.length]);
    }
    return state;
};

/** Close an unclosed fenced code block so streaming markdown does not swallow the rest as mono code. */
const balanceMarkdownFences = (text: string): string => {
    const state = scanMarkdownCodeFences(text, 0);
    if (!state.fenceChar) return text;
    return `${text}\n${state.fenceChar.repeat(state.fenceLen)}`;
};

/** Applies streaming-specific fence balancing or finished-turn glitch repair + length cap. */
const finalizeStreamOrStaticMarkdown = (
    text: string,
    streaming: boolean | undefined,
): string => {
    if (!streaming) {
        return truncateForDisplay(repairStreamGlitches(text));
    }
    const balanced = balanceMarkdownFences(text);
    return balanced !== text ? stripLeakedToolCode(balanced) : text;
};

/** Normalize assistant markdown before ReactMarkdown. */
export const preprocessChatMarkdown = (
    text: string,
    options?: { trim?: boolean; streaming?: boolean },
): string => {
    let normalized = stripOrphanThinkTags(text);
    normalized = stripLeakedToolCode(normalized);
    normalized = stripRawHtml(normalized);
    normalized = unwrapOuterProseFence(normalized);
    normalized = demoteIndentedMarkdown(normalized);
    normalized = finalizeStreamOrStaticMarkdown(normalized, options?.streaming);
    normalized = normalized
        .replace(/^[•●▪◦]\s+/gmu, "- ")
        .replace(/^\s*[-*_]{3,}\s*$/gmu, "");
    normalized = collapseExcessNewlines(normalized);
    return options?.trim !== false ? normalized.trim() : normalized;
};
