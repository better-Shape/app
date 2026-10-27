type FenceMarkerInfo = {
    char: string;
    len: number;
    suffix: string;
};

type LineFenceScan = {
    quoteDepth: number;
    marker: FenceMarkerInfo | null;
};

/** Advances past up to 3 ASCII spaces starting at `from`. */
const skipUpToThreeSpaces = (line: string, from: number): number => {
    let idx = from;
    while (idx - from < 3 && line.charCodeAt(idx) === 32) {
        idx += 1;
    }
    return idx;
};

/** Advances past one optional space or tab following a `>` blockquote marker. */
const skipOptionalQuoteSpace = (line: string, afterGt: number): number => {
    const code = line.charCodeAt(afterGt);
    return code === 32 || code === 9 ? afterGt + 1 : afterGt;
};

/** Strips CommonMark `>` blockquote prefixes and up to 3 fence indent spaces. */
const readLineFencePrefix = (
    line: string,
): { offset: number; afterQuotes: number; quoteDepth: number } => {
    let cursor = 0;
    let quoteDepth = 0;
    while (cursor < line.length) {
        const afterSpaces = skipUpToThreeSpaces(line, cursor);
        if (line.charCodeAt(afterSpaces) !== 62) {
            return { offset: afterSpaces, afterQuotes: cursor, quoteDepth };
        }
        quoteDepth += 1;
        cursor = skipOptionalQuoteSpace(line, afterSpaces + 1);
    }
    return { offset: cursor, afterQuotes: cursor, quoteDepth };
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

/** Reads blockquote depth and any CommonMark fence marker (`>= 3` backticks/tildes) on `rawLine`. */
const scanStreamFenceLine = (rawLine: string): LineFenceScan => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const { offset, quoteDepth } = readLineFencePrefix(line);
    const markerChar = line.charAt(offset);
    if (markerChar !== "`" && markerChar !== "~") {
        return { quoteDepth, marker: null };
    }
    const len = countRepeatedChar(line, offset, markerChar);
    if (len < 3) return { quoteDepth, marker: null };
    return {
        quoteDepth,
        marker: { char: markerChar, len, suffix: line.slice(offset + len) },
    };
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
            /^[ \t]*$/u.test(parsed.suffix),
    );

/** Checks whether `lineScan` explicitly closes a fenced block opened at `fenceQuoteDepth`. */
const isMatchingLineFenceClose = (
    lineScan: LineFenceScan,
    fenceChar: string,
    fenceLen: number,
    fenceQuoteDepth: number,
): boolean =>
    lineScan.quoteDepth === fenceQuoteDepth &&
    isClosingStreamFence(lineScan.marker, fenceChar, fenceLen);

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
    fenceQuoteDepth: number;
};

/** Enters fenced code state starting at `cursor` and flushes any preceding prose segment. */
const enterFenceAt = (
    state: FenceScanState,
    out: string[],
    text: string,
    cursor: number,
    lineScan: { quoteDepth: number; marker: FenceMarkerInfo },
    fn: (prose: string) => string,
): void => {
    if (cursor > state.proseStart) {
        out.push(fn(text.slice(state.proseStart, cursor)));
    }
    state.fenceStart = cursor;
    state.fenceChar = lineScan.marker.char;
    state.fenceLen = lineScan.marker.len;
    state.fenceQuoteDepth = lineScan.quoteDepth;
};

/** Resets open fence fields on `FenceScanState` after flushing through `endOffset`. */
const closeFenceScanAt = (
    state: FenceScanState,
    out: string[],
    text: string,
    endOffset: number,
): void => {
    out.push(text.slice(state.fenceStart, endOffset));
    state.proseStart = endOffset;
    state.fenceStart = -1;
    state.fenceChar = "";
    state.fenceLen = 0;
    state.fenceQuoteDepth = 0;
};

/** Closes `state` at `cursor` when `lineScan` exits the blockquote containing the fence. */
const maybeExitBlockquoteFence = (
    state: FenceScanState,
    out: string[],
    text: string,
    cursor: number,
    quoteDepth: number,
): void => {
    if (state.fenceChar && quoteDepth < state.fenceQuoteDepth) {
        closeFenceScanAt(state, out, text, cursor);
    }
};

/** Advances `FenceScanState` across one line at `[cursor, afterLine)`. */
const stepFenceScanLine = (
    state: FenceScanState,
    out: string[],
    text: string,
    cursor: number,
    afterLine: number,
    lineScan: LineFenceScan,
    fn: (prose: string) => string,
): void => {
    maybeExitBlockquoteFence(state, out, text, cursor, lineScan.quoteDepth);
    if (!state.fenceChar) {
        if (isOpeningStreamFence(lineScan.marker)) {
            enterFenceAt(
                state,
                out,
                text,
                cursor,
                { quoteDepth: lineScan.quoteDepth, marker: lineScan.marker },
                fn,
            );
        }
        return;
    }
    if (
        isMatchingLineFenceClose(
            lineScan,
            state.fenceChar,
            state.fenceLen,
            state.fenceQuoteDepth,
        )
    ) {
        closeFenceScanAt(state, out, text, afterLine);
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
        fenceQuoteDepth: 0,
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
            scanStreamFenceLine(lineText),
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

type BacktickRunToken = {
    tick: number;
    fullLen: number;
    escapedFirst: boolean;
};

type BacktickCloserBuckets = Map<number, { indices: number[]; cursor: number }>;

/** Checks whether `text[index]` is preceded by an odd number of `\` within `[segStart, index)`. */
const isBackslashEscapedAt = (
    text: string,
    segStart: number,
    index: number,
): boolean => {
    let backslashes = 0;
    let cursor = index - 1;
    while (cursor >= segStart && text.charCodeAt(cursor) === 0x5c) {
        backslashes += 1;
        cursor -= 1;
    }
    return backslashes % 2 === 1;
};

/** Counts consecutive backticks starting at `from` up to `limit`. */
const countBoundedBacktickRun = (
    text: string,
    from: number,
    limit: number,
): number => {
    let idx = from;
    while (idx < limit && text.charCodeAt(idx) === 0x60) {
        idx += 1;
    }
    return idx - from;
};

/** Appends run index `runIdx` into the closer bucket for `fullLen`. */
const pushCloserBucketEntry = (
    buckets: BacktickCloserBuckets,
    fullLen: number,
    runIdx: number,
): void => {
    const existing = buckets.get(fullLen);
    if (existing) {
        existing.indices.push(runIdx);
    } else {
        buckets.set(fullLen, { indices: [runIdx], cursor: 0 });
    }
};

/** Collects all maximal backtick runs within a single paragraph `[pStart, pEnd)` in one O(n) pass. */
const scanParagraphBacktickRuns = (
    text: string,
    pStart: number,
    pEnd: number,
): { runs: BacktickRunToken[]; buckets: BacktickCloserBuckets } => {
    const runs: BacktickRunToken[] = [];
    const buckets: BacktickCloserBuckets = new Map();
    let pos = pStart;
    while (pos < pEnd) {
        const tick = text.indexOf("`", pos);
        if (tick === -1 || tick >= pEnd) break;
        const fullLen = countBoundedBacktickRun(text, tick, pEnd);
        const escapedFirst = isBackslashEscapedAt(text, pStart, tick);
        pushCloserBucketEntry(buckets, fullLen, runs.length);
        runs.push({ tick, fullLen, escapedFirst });
        pos = tick + fullLen;
    }
    return { runs, buckets };
};

/** Resolves the effective opener start and backtick count for `token`, or `null` when fully escaped. */
const resolveBacktickOpener = (
    token: BacktickRunToken,
): { openStart: number; openLen: number } | null => {
    if (!token.escapedFirst) {
        return { openStart: token.tick, openLen: token.fullLen };
    }
    return token.fullLen > 1
        ? { openStart: token.tick + 1, openLen: token.fullLen - 1 }
        : null;
};

/** Finds the next closer run index `> openRunIdx` of length `openLen` in amortized O(1) time. */
const takeNextMatchingCloserIndex = (
    buckets: BacktickCloserBuckets,
    openLen: number,
    openRunIdx: number,
): number => {
    const bucket = buckets.get(openLen);
    if (!bucket) return -1;
    while (
        bucket.cursor < bucket.indices.length &&
        bucket.indices[bucket.cursor] <= openRunIdx
    ) {
        bucket.cursor += 1;
    }
    if (bucket.cursor >= bucket.indices.length) return -1;
    const matched = bucket.indices[bucket.cursor];
    bucket.cursor += 1;
    return matched;
};

/** Attempts to pair `runs[idx]` with a matching closer in `buckets`, returning the span end or `-1`. */
const tryPairParagraphBacktickSpan = (
    runs: BacktickRunToken[],
    buckets: BacktickCloserBuckets,
    idx: number,
    out: Array<[number, number]>,
): number => {
    const opener = resolveBacktickOpener(runs[idx]);
    if (!opener) return -1;
    const closerIdx = takeNextMatchingCloserIndex(buckets, opener.openLen, idx);
    if (closerIdx === -1) return -1;
    const closer = runs[closerIdx];
    const closeEnd = closer.tick + closer.fullLen;
    out.push([opener.openStart, closeEnd]);
    return closeEnd;
};

/** Matches backtick runs inside a single paragraph `[pStart, pEnd)` in O(n) time and appends spans to `out`. */
const appendParagraphInlineCodeSpans = (
    text: string,
    pStart: number,
    pEnd: number,
    out: Array<[number, number]>,
): void => {
    if (pEnd <= pStart) return;
    const { runs, buckets } = scanParagraphBacktickRuns(text, pStart, pEnd);
    let minTick = pStart;
    for (let idx = 0; idx < runs.length; idx += 1) {
        if (runs[idx].tick >= minTick) {
            const closeEnd = tryPairParagraphBacktickSpan(runs, buckets, idx, out);
            if (closeEnd !== -1) minTick = closeEnd;
        }
    }
};

/** Returns `nl - 1` when preceded by `\r` within `[segStart, nl)`, otherwise `nl`. */
const resolveBreakStartAtNewline = (
    text: string,
    segStart: number,
    nl: number,
): number =>
    nl > segStart && text.charCodeAt(nl - 1) === 0x0d ? nl - 1 : nl;

/** Checks whether `text` has `\r\n` starting at `pos` within `segEnd`. */
const isCrLfAt = (text: string, segEnd: number, pos: number): boolean =>
    pos + 1 < segEnd &&
    text.charCodeAt(pos) === 0x0d &&
    text.charCodeAt(pos + 1) === 0x0a;

/** Advances past ASCII spaces (`0x20`) and tabs (`0x09`) starting at `from` up to `limit`. */
const skipHorizontalSpace = (
    text: string,
    from: number,
    limit: number,
): number => {
    let idx = from;
    while (idx < limit) {
        const code = text.charCodeAt(idx);
        if (code !== 0x20 && code !== 0x09) break;
        idx += 1;
    }
    return idx;
};

/** Returns the index right after a CommonMark blank line starting after `nl`, or `-1` when non-blank. */
const resolveBreakEndAfterNewline = (
    text: string,
    segEnd: number,
    nl: number,
): number => {
    const afterWs = skipHorizontalSpace(text, nl + 1, segEnd);
    if (afterWs >= segEnd) return -1;
    if (text.charCodeAt(afterWs) === 0x0a) return afterWs + 1;
    return isCrLfAt(text, segEnd, afterWs) ? afterWs + 2 : -1;
};

/** Finds the next `\n` within `[from, limit)`, or `-1` when none exists. */
const indexOfNewlineInRange = (
    text: string,
    from: number,
    limit: number,
): number => {
    const nl = text.indexOf("\n", from);
    return nl !== -1 && nl < limit ? nl : -1;
};

/** Appends closed single-paragraph CommonMark inline code spans within `[segStart, segEnd)` to `out` in O(n) time. */
export const appendInlineCodeSpansInRange = (
    text: string,
    segStart: number,
    segEnd: number,
    out: Array<[number, number]>,
): void => {
    let paraStart = segStart;
    let scanPos = segStart;
    while (scanPos < segEnd) {
        const nl = indexOfNewlineInRange(text, scanPos, segEnd);
        if (nl === -1) break;
        const resumeAt = resolveBreakEndAfterNewline(text, segEnd, nl);
        if (resumeAt !== -1) {
            const paraEnd = resolveBreakStartAtNewline(text, paraStart, nl);
            appendParagraphInlineCodeSpans(text, paraStart, paraEnd, out);
            paraStart = resumeAt;
            scanPos = resumeAt;
        } else {
            scanPos = nl + 1;
        }
    }
    appendParagraphInlineCodeSpans(text, paraStart, segEnd, out);
};

/** Collects `[start, end]` offsets for closed inline backtick code spans in O(n) time. */
const collectInlineCodeRanges = (input: string): Array<[number, number]> => {
    if (!input.includes("`")) return [];
    const ranges: Array<[number, number]> = [];
    appendInlineCodeSpansInRange(input, 0, input.length, ranges);
    return ranges;
};

/** Applies `fn` only to prose slices outside closed inline backtick code spans. */
const mapOutsideInlineCodeSpans = (
    prose: string,
    fn: (slice: string) => string,
): string => {
    const ranges = collectInlineCodeRanges(prose);
    if (ranges.length === 0) return fn(prose);
    const parts: string[] = [];
    let cursor = 0;
    for (const [start, end] of ranges) {
        if (start > cursor) parts.push(fn(prose.slice(cursor, start)));
        parts.push(prose.slice(start, end));
        cursor = end;
    }
    if (cursor < prose.length) parts.push(fn(prose.slice(cursor)));
    return parts.join("");
};

export type CodeFenceState = {
    ranges: Array<readonly [number, number]>;
    fenceStart: number;
    fenceChar: string;
    fenceLen: number;
    fenceQuoteDepth: number;
};

/** Resets open fence tracking fields on `CodeFenceState` after recording `[fenceStart, endOffset)`. */
const closeCodeFenceRangeAt = (
    state: CodeFenceState,
    endOffset: number,
): void => {
    state.ranges.push([state.fenceStart, endOffset]);
    state.fenceStart = -1;
    state.fenceChar = "";
    state.fenceLen = 0;
    state.fenceQuoteDepth = 0;
};

/** Closes `CodeFenceState` at `cursor` when `quoteDepth` exits the blockquote containing the fence. */
const maybeExitBlockquoteRange = (
    state: CodeFenceState,
    cursor: number,
    quoteDepth: number,
): void => {
    if (state.fenceChar && quoteDepth < state.fenceQuoteDepth) {
        closeCodeFenceRangeAt(state, cursor);
    }
};

/** Advances `CodeFenceState` across one line `[cursor, afterLine)`. */
const stepCodeFenceRangeLine = (
    state: CodeFenceState,
    cursor: number,
    afterLine: number,
    lineScan: LineFenceScan,
): void => {
    maybeExitBlockquoteRange(state, cursor, lineScan.quoteDepth);
    if (!state.fenceChar) {
        if (isOpeningStreamFence(lineScan.marker)) {
            state.fenceStart = cursor;
            state.fenceChar = lineScan.marker.char;
            state.fenceLen = lineScan.marker.len;
            state.fenceQuoteDepth = lineScan.quoteDepth;
        }
        return;
    }
    if (
        isMatchingLineFenceClose(
            lineScan,
            state.fenceChar,
            state.fenceLen,
            state.fenceQuoteDepth,
        )
    ) {
        closeCodeFenceRangeAt(state, afterLine);
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
        fenceQuoteDepth: 0,
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
            scanStreamFenceLine(lineText),
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
    const quotePrefix = "> ".repeat(state.fenceQuoteDepth);
    return `${text}\n${quotePrefix}${state.fenceChar.repeat(state.fenceLen)}`;
};

/** Removes stray thinking tags that leaked into plain prose outside code fences. */
const stripOrphanThinkTagsInProse = (prose: string): string => {
    if (!prose.includes("<")) return prose;
    return prose.replace(
        /<\/?(?:redacted_thinking|thinking|reasoning|think)(?:[ \t][^<>\n]*)?>[ \t]*\r?\n?/giu,
        "",
    );
};

/** Remove stray thinking tags that leaked into plain text. */
export const stripOrphanThinkTags = (text: string): string => {
    if (!text.includes("<")) return text;
    return mapOutsideCodeFences(text, (prose) =>
        mapOutsideInlineCodeSpans(prose, stripOrphanThinkTagsInProse),
    );
};

const LEAKED_PRINT_FN_RE =
    /\bprint\s*\(\s*(?:default_api\.[a-zA-Z_]\w*|render_design_previews|read_file|edit_file|write_file|grep_search|run_terminal|web_search|list_terminals|terminal_read|terminal_input)\s*\(/;
const LEAKED_FUNCTIONS_CALL_RE =
    /^functions\.(?:default_api\.[a-zA-Z_]\w*|render_design_previews|read_file|edit_file|write_file|grep_search|run_terminal|web_search|list_terminals|terminal_read|terminal_input)\s*\(/;
const GENERIC_FUNCTIONS_CALL_RE = /^functions\.[a-zA-Z_][a-zA-Z0-9_]*\s*\(/;
const GENERIC_PRINT_CALL_RE = /\bprint\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\(/;
const LEAKED_XML_OPEN_RE =
    /<(?:tool_call|function_call|minimax:tool_call|tool_code)\b/i;

const LEAKED_PRINT_LINE_RE =
    /(?:^|\n)[ \t]*print\s*\(\s*(?:default_api\.[a-zA-Z_]\w*|render_design_previews|read_file|edit_file|write_file|grep_search|run_terminal|web_search|list_terminals|terminal_read|terminal_input)\s*\([^\n]*\)\s*\)[ \t]*(?=\n|$)/g;
const LEAKED_PRINT_TAIL_RE =
    /(?:^|\n)[ \t]*print\s*\(\s*(?:default_api\.[a-zA-Z_]\w*|render_design_previews|read_file|edit_file|write_file|grep_search|run_terminal|web_search|list_terminals|terminal_read|terminal_input)\s*\([^\n]*$/g;
const LEAKED_FN_LINE_RE =
    /(?:^|\n)[ \t]*functions\.(?:default_api\.[a-zA-Z_]\w*|render_design_previews|read_file|edit_file|write_file|grep_search|run_terminal|web_search|list_terminals|terminal_read|terminal_input)\s*\(\{[^\n]*\}\)[ \t]*(?=\n|$)/g;
const LEAKED_FN_TAIL_RE =
    /(?:^|\n)[ \t]*functions\.(?:default_api\.[a-zA-Z_]\w*|render_design_previews|read_file|edit_file|write_file|grep_search|run_terminal|web_search|list_terminals|terminal_read|terminal_input)\s*\(\{[^\n]*$/g;

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

/** Case-insensitive probe for leaked `_execute` / `_EXECUTE` tool-dump blocks. */
const hasExecuteDump = (text: string): boolean => /_execute/i.test(text);

/** Checks whether a `"tool_code"` JSON payload contains a leaked tool-call trigger. */
const isLeakedToolCodeJson = (trimmed: string): boolean =>
    /"tool_code"\s*:/u.test(trimmed);

/** Checks whether `trimmed` starts with a leaked JSON `tool_code` or `print(...)` wrapper. */
const hasDirectToolLeakSignature = (
    trimmed: string,
    hasExecute: boolean,
): boolean => {
    if (isLeakedToolCodeJson(trimmed) || LEAKED_PRINT_FN_RE.test(trimmed)) {
        return true;
    }
    return hasExecute && GENERIC_PRINT_CALL_RE.test(trimmed);
};

/** True when a fenced/JSON blob is a leaked model tool invocation, not user-facing code. */
export const looksLikeLeakedToolCode = (body: string): boolean => {
    const trimmed = body.trim();
    if (!trimmed) return false;
    const hasExecute = hasExecuteDump(trimmed);
    if (hasDirectToolLeakSignature(trimmed, hasExecute)) return true;
    if (hasLeakedInvocationLine(trimmed, hasExecute)) return true;
    return LEAKED_XML_OPEN_RE.test(trimmed);
};

/**
 * XML / sentinel tags that models leak into `content` instead of structured
 * tool_calls. Cover BetterShape catalog families (Claude, GPT, Gemini/Auto, Grok,
 * DeepSeek) plus common OpenRouter proxies. Do NOT include intentional BetterShape
 * UI tags (`edit`, `terminal_command`, `todos`, ...); those are parsed separately.
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
const STRIP_ACROSS_FENCES_RE =
    /<(tool_result|terminal_read|terminal_input|list_terminals)\b[^>]*>[\s\S]*?<\/\1>/gi;

const LEAKED_TAG_PAIRED_RE =
    /<(list_terminals|terminal_input|terminal_read|tool_result|tool_code|new_path|file_content|analysis|tool_calls|tool_call|function_calls|function_call|function_response|tool_response|minimax:tool_call|invoke|parameter|arg_key|arg_value|tools|pre_dispatch_explanation)\b[^>]*>[\s\S]*?<\/\1>/gi;
const LEAKED_TAG_SELF_CLOSING_RE =
    /<(?:list_terminals|terminal_input|terminal_read|tool_result|tool_code|new_path|file_content|analysis|tool_calls|tool_call|function_calls|function_call|function_response|tool_response|minimax:tool_call|invoke|parameter|arg_key|arg_value|tools|pre_dispatch_explanation)\b[^>]*\/?>/gi;
const LEAKED_TAG_OPEN_TAIL_RE =
    /<(?:list_terminals|terminal_input|terminal_read|tool_result|tool_code|new_path|file_content|analysis|tool_calls|tool_call|function_calls|function_call|function_response|tool_response|minimax:tool_call|invoke|parameter|arg_key|arg_value|tools|pre_dispatch_explanation)\b[^>]*>[\s\S]*$/gi;
const LEAKED_TAG_STRAY_CLOSER_RE =
    /<\/(?:list_terminals|terminal_input|terminal_read|tool_result|tool_code|new_path|file_content|analysis|tool_calls|tool_call|function_calls|function_call|function_response|tool_response|minimax:tool_call|invoke|parameter|arg_key|arg_value|tools|pre_dispatch_explanation)>/gi;

const FW_BAR = "\uFF5C";
const DSML_PAIRED_RE =
    /<\uFF5C{0,2}DSML\uFF5C{1,2}[\w.]*?>[\s\S]*?<\/\uFF5C{0,2}DSML\uFF5C{1,2}[\w.]*?>/giu;
const DSML_OPEN_TAIL_RE = /<\uFF5C{0,2}DSML\uFF5C{1,2}[\w.]*?>[\s\S]*$/giu;
const DSML_STRAY_RE = /<\/?\uFF5C{0,2}DSML\uFF5C{1,2}[\w.]*?>/giu;

/** Collapses runs of 3+ consecutive newlines down to paragraph-break pairs. */
const collapseExcessNewlines = (text: string): string =>
    text.includes("\n\n\n") ? text.replace(/\n{3,}/g, "\n\n") : text;

/** Checks whether `text` contains any sentinel token that could represent leaked tool markup. */
const hasAnyToolMarkupSentinel = (text: string): boolean =>
    text.includes("<") ||
    text.includes(FW_BAR) ||
    text.includes("[TOOL_CALLS]") ||
    hasExecuteDump(text);

/** Strips XML leaked tool tags from a prose slice. */
const stripLeakedXmlTagsInProse = (prose: string): string =>
    prose
        .replace(LEAKED_TAG_PAIRED_RE, "")
        .replace(LEAKED_TAG_SELF_CLOSING_RE, "")
        .replace(LEAKED_TAG_OPEN_TAIL_RE, "")
        .replace(LEAKED_TAG_STRAY_CLOSER_RE, "");

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
    if (hasExecuteDump(out)) {
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
    let out = text.includes("<")
        ? text.replace(STRIP_ACROSS_FENCES_RE, "")
        : text;
    out = mapOutsideCodeFences(out, (prose) =>
        mapOutsideInlineCodeSpans(prose, sanitizeProseToolMarkup),
    );
    return collapseExcessNewlines(out);
};

const BARE_TOOL_CODE_TRIGGER_RE =
    /print\s*\(|render_design_previews|concepts\s*=/u;
const COMPLETE_BACKTICK_FENCE_RE = /```[\w-]*[ \t\r\f\v]*\n([\s\S]*?)```/gu;
const COMPLETE_TILDE_FENCE_RE = /~~~[\w-]*[ \t\r\f\v]*\n([\s\S]*?)~~~/gu;
const UNCLOSED_BACKTICK_HEAD_RE = /^```[\w-]*[ \t\r\f\v]*\n/u;
const UNCLOSED_TILDE_HEAD_RE = /^~~~[\w-]*[ \t\r\f\v]*\n/u;
const BARE_TOOL_CODE_OPEN_RE = /\{[ \t\r\n]*"tool_code"[ \t\r\n]*:/u;

/** Strips an unclosed trailing code fence (`marker`) when its body looks like a leaked tool call. */
const stripUnclosedLeakedFenceTail = (
    text: string,
    marker: "```" | "~~~",
    headRe: RegExp,
): string => {
    let idx = text.indexOf(marker);
    while (idx !== -1) {
        const tail = text.slice(idx);
        const head = headRe.exec(tail);
        if (head && looksLikeLeakedToolCode(tail.slice(head[0].length))) {
            return text.slice(0, idx);
        }
        idx = text.indexOf(marker, idx + 3);
    }
    return text;
};

/** Strips complete and streaming fenced blocks for a single fence marker (` ``` ` or `~~~`). */
const stripLeakedFenceMarkerBlocks = (
    text: string,
    marker: "```" | "~~~",
    completeRe: RegExp,
    headRe: RegExp,
): string => {
    if (!text.includes(marker)) return text;
    const withoutComplete = text.replace(
        completeRe,
        (full, body: string) => (looksLikeLeakedToolCode(body) ? "" : full),
    );
    return stripUnclosedLeakedFenceTail(withoutComplete, marker, headRe);
};

/** Strips complete and streaming fenced code blocks (` ``` ` and `~~~`) whose bodies look like leaked tool calls. */
const stripLeakedFencedToolBlocks = (text: string): string => {
    const afterBackticks = stripLeakedFenceMarkerBlocks(
        text,
        "```",
        COMPLETE_BACKTICK_FENCE_RE,
        UNCLOSED_BACKTICK_HEAD_RE,
    );
    return stripLeakedFenceMarkerBlocks(
        afterBackticks,
        "~~~",
        COMPLETE_TILDE_FENCE_RE,
        UNCLOSED_TILDE_HEAD_RE,
    );
};

/** Strips a bare `{ "tool_code": ... }` tail when its body contains a leaked tool trigger. */
const stripBareToolCodeTail = (text: string): string => {
    const match = BARE_TOOL_CODE_OPEN_RE.exec(text);
    if (!match) return text;
    const tail = text.slice(match.index);
    return BARE_TOOL_CODE_TRIGGER_RE.test(tail)
        ? text.slice(0, match.index)
        : text;
};

/** Strips bare `{ "tool_code": "..." }` JSON dumps and leaked `print`/`functions.*` lines. */
const stripBareToolInvocations = (text: string): string => {
    let out = text.includes("tool_code") ? stripBareToolCodeTail(text) : text;
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

const TOOL_CODE_MARKERS = ["`", "~", "tool_code", "print", "functions."] as const;

/** Checks whether `text` contains any fence, invocation, or JSON marker for tool-code stripping. */
const hasToolCodeMarker = (text: string): boolean =>
    TOOL_CODE_MARKERS.some((marker) => text.includes(marker));

/**
 * Strip Gemini/OpenRouter-style tool leaks that models sometimes paste as
 * markdown JSON instead of issuing a real tool call, plus cross-model XML sentinels.
 */
export const stripLeakedToolCode = (text: string): string => {
    if (!hasToolCodeMarker(text) && !hasAnyToolMarkupSentinel(text)) {
        return collapseExcessNewlines(text);
    }
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

/** Collapses an immediate back-to-back repeated span (`>= 20` chars) if present. */
const collapseAdjacentDuplicateSpan = (text: string): string | null => {
    const maxAdjLen = Math.min(120, Math.floor(text.length / 2));
    for (let len = maxAdjLen; len >= 20; len -= 1) {
        const limit = text.length - len * 2;
        const midOffset = Math.floor(len / 2);
        for (let i = 0; i <= limit; i += 1) {
            if (matchesAdjacentRepeatAt(text, i, len, midOffset)) {
                return text.slice(0, i + len) + text.slice(i + len * 2);
            }
        }
    }
    return null;
};

/** Measures how many characters starting at `0` and `start` match identically (`>= minMatched`). */
const measurePrefixReplayLength = (
    text: string,
    start: number,
    minMatched: number,
): number => {
    const maxLen = Math.min(start, text.length - start);
    let matched = minMatched;
    while (
        matched < maxLen &&
        text.charCodeAt(matched) === text.charCodeAt(start + matched)
    ) {
        matched += 1;
    }
    return matched;
};

/** Checks whether `start` sits immediately after a non-whitespace character (a mid-token seam). */
const isGluedReplaySeam = (text: string, start: number): boolean => {
    const prevChar = text.charAt(start - 1);
    return prevChar.length > 0 && !/\s/u.test(prevChar);
};

/** Checks whether a `matched`-char prefix match at `start` qualifies as a stream glitch replay. */
const isPrefixGlitchReplay = (
    text: string,
    start: number,
    matched: number,
): boolean =>
    matched === start ||
    matched >= 80 ||
    start + matched >= text.length - 1 ||
    isGluedReplaySeam(text, start);

/** Removes an accidental re-emission of the message opening (`>= 20` chars) while keeping valid prose. */
const collapseOpeningPrefixReplay = (text: string): string | null => {
    const prefix20 = text.slice(0, 20);
    const maxStart = text.length - 20;
    let searchFrom = 20;
    while (searchFrom <= maxStart) {
        const start = text.indexOf(prefix20, searchFrom);
        if (start === -1 || start > maxStart) break;
        const matched = measurePrefixReplayLength(text, start, 20);
        if (isPrefixGlitchReplay(text, start, matched)) {
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

/** Advances past consecutive characters with UTF-16 `targetCode` starting at `start`. */
const skipRepeatedCharCode = (
    line: string,
    start: number,
    targetCode: number,
): number => {
    let idx = start;
    while (idx < line.length && line.charCodeAt(idx) === targetCode) {
        idx += 1;
    }
    return idx;
};

/** Strips 4+ leading spaces or 1+ leading tabs from `line`, returning `null` when unindented. */
const stripMarkdownCodeIndent = (line: string): string | null => {
    if (line.startsWith("\t")) {
        return line.slice(skipRepeatedCharCode(line, 1, 9));
    }
    if (!line.startsWith("    ")) return null;
    return line.slice(skipRepeatedCharCode(line, 4, 32));
};

/** Unindents a single 4-space or tab-indented Markdown heading or list item line. */
const demoteSingleIndentedMarkdownLine = (line: string): string => {
    const inner = stripMarkdownCodeIndent(line);
    if (inner === null) return line;
    return /^(?:#{1,6}[ \t]|[-*+][ \t]|\d+\.[ \t])/u.test(inner) ? inner : line;
};

/** Demotes 4-space/tab indented Markdown headings and list items in prose outside code fences. */
const demoteIndentedMarkdown = (text: string): string => {
    if (!text.includes("    ") && !text.includes("\t")) return text;
    return mapOutsideCodeFences(text, (prose) =>
        prose.split("\n").map(demoteSingleIndentedMarkdownLine).join("\n"),
    );
};

/** Checks whether `trimmed` starts and ends with valid standalone triple-backtick fence lines. */
const hasOuterTripleBacktickBounds = (
    trimmed: string,
    firstNl: number,
    closeFenceIdx: number,
): boolean => {
    if (firstNl === -1 || firstNl >= closeFenceIdx - 1) return false;
    if (trimmed.charAt(closeFenceIdx - 1) !== "\n") return false;
    return /^[\w-]*$/u.test(trimmed.slice(3, firstNl).trim());
};

/** Extracts inner body of a standalone ` ```lang\n...\n``` ` block, or `null` when not matching. */
const extractOuterTripleBacktickBody = (trimmed: string): string | null => {
    if (!trimmed.startsWith("```") || !trimmed.endsWith("```")) return null;
    const firstNl = trimmed.indexOf("\n");
    const closeFenceIdx = trimmed.length - 3;
    if (!hasOuterTripleBacktickBounds(trimmed, firstNl, closeFenceIdx)) {
        return null;
    }
    return trimmed.slice(firstNl + 1, closeFenceIdx - 1);
};

/** Unwraps an accidental outer triple-backtick fence wrapping ordinary prose Markdown. */
const unwrapOuterProseFence = (text: string): string => {
    const inner = extractOuterTripleBacktickBody(text.trim());
    return inner !== null && looksLikeProseMarkdown(inner) ? inner : text;
};

const PAIRED_STRIP_TAGS = new Set(
    "iframe script style object embed".split(" "),
);
const LAYOUT_HTML_TAGS = new Set(
    "h1 h2 h3 h4 h5 h6 p div span a ul ol li strong em b i section article header footer".split(
        " ",
    ),
);
const DISALLOWED_UNQUOTED_TAG_CHARS = new Set(["<", "&", "|", ",", ";", "(", ")"]);

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
const MAX_PREPROCESS_HEAD_CHARS = MAX_DISPLAY_CHARS * 2;
const GRAPHEME_SEGMENTER =
    typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;

/** Checks whether `code` is a UTF-16 high (leading) surrogate (`0xD800..0xDBFF`). */
const isHighSurrogateCode = (code: number): boolean =>
    code >= 0xd800 && code <= 0xdbff;

/** Checks whether `code` is a UTF-16 low (trailing) surrogate (`0xDC00..0xDFFF`). */
const isLowSurrogateCode = (code: number): boolean =>
    code >= 0xdc00 && code <= 0xdfff;

/** Adjusts `index` backward across a UTF-16 surrogate split or trailing lone high surrogate. */
const stepBackFromTrailingHighSurrogate = (
    text: string,
    index: number,
): number =>
    index > 0 && isHighSurrogateCode(text.charCodeAt(index - 1))
        ? index - 1
        : index;

/** Aligns a window start offset backward so it does not begin on a UTF-16 low surrogate. */
const alignWindowStart = (text: string, rawStart: number): number =>
    rawStart > 0 && isLowSurrogateCode(text.charCodeAt(rawStart))
        ? rawStart - 1
        : rawStart;

/** Aligns a window end offset forward so it includes a trailing surrogate pair partner. */
const alignWindowEnd = (text: string, rawEnd: number): number =>
    rawEnd < text.length && isHighSurrogateCode(text.charCodeAt(rawEnd - 1))
        ? rawEnd + 1
        : rawEnd;

/** Finds the largest grapheme boundary `<= limit` inside a small tail window around `limit`. */
const findGraphemeCutIndex = (text: string, limit: number): number => {
    if (!GRAPHEME_SEGMENTER) return stepBackFromTrailingHighSurrogate(text, limit);
    const winStart = alignWindowStart(text, Math.max(0, limit - 32));
    const winEnd = alignWindowEnd(text, Math.min(text.length, limit + 16));
    let bestCut = winStart;
    for (const seg of GRAPHEME_SEGMENTER.segment(text.slice(winStart, winEnd))) {
        const boundary = winStart + seg.index + seg.segment.length;
        if (boundary > limit) break;
        bestCut = boundary;
    }
    return stepBackFromTrailingHighSurrogate(text, bestCut);
};

/** Slices `text` at `limit` without splitting emoji grapheme clusters or UTF-16 surrogate pairs. */
const sliceSurrogateSafe = (text: string, limit: number): string => {
    if (limit <= 0) return "";
    if (text.length <= limit) return text;
    return text.slice(0, findGraphemeCutIndex(text, limit));
};

const TRUNCATED_DISPLAY_SUFFIX = "\n\n... (response truncated for display)";

/** Truncates excessively long streaming or finished responses without splitting emoji or UTF-16 surrogates. */
const truncateForDisplay = (text: string): string => {
    if (text.length <= MAX_DISPLAY_CHARS) return text;
    const safePrefix = sliceSurrogateSafe(text, MAX_DISPLAY_CHARS);
    return `${safePrefix}${TRUNCATED_DISPLAY_SUFFIX}`;
};

/** Caps raw settled input at `2 * MAX_DISPLAY_CHARS` so glitch repair stays O(1) before the 48k cap. */
const capSettledPreprocessInput = (text: string): string =>
    text.length <= MAX_PREPROCESS_HEAD_CHARS
        ? text
        : sliceSurrogateSafe(text, MAX_PREPROCESS_HEAD_CHARS);

/** Applies streaming-specific fence balancing or finished-turn glitch repair + fence safety. */
const finalizeStreamOrStaticMarkdown = (
    text: string,
    streaming: boolean | undefined,
): string => {
    if (!streaming) {
        return balanceMarkdownFences(truncateForDisplay(repairStreamGlitches(text)));
    }
    const balanced = balanceMarkdownFences(text);
    return balanced !== text ? stripLeakedToolCode(balanced) : text;
};

const UNICODE_BULLET_SET = new Set(["•", "●", "▪", "◦"]);

/** Checks whether `trimmed` is a standalone horizontal rule of 3+ `-`, `*`, or `_` chars. */
const isStandaloneHorizontalRule = (trimmed: string): boolean => {
    if (trimmed.length < 3) return false;
    const ch = trimmed.charAt(0);
    if (ch !== "-" && ch !== "*" && ch !== "_") return false;
    return countRepeatedChar(trimmed, 0, ch) === trimmed.length;
};

/** Advances past ASCII spaces and tabs starting at `start`. */
const skipLineSpacesAndTabs = (line: string, start: number): number => {
    let idx = start;
    while (idx < line.length) {
        const code = line.charCodeAt(idx);
        if (code !== 32 && code !== 9) break;
        idx += 1;
    }
    return idx;
};

/** Normalizes a single prose line's Unicode bullet prefix or standalone horizontal rule. */
const normalizeSingleProseLine = (line: string): string => {
    if (isStandaloneHorizontalRule(line.trim())) return "";
    if (!UNICODE_BULLET_SET.has(line.charAt(0))) return line;
    const afterWs = skipLineSpacesAndTabs(line, 1);
    return afterWs > 1 ? `- ${line.slice(afterWs)}` : line;
};

/** Normalizes Unicode bullet glyphs and standalone horizontal rules in prose outside code fences. */
const normalizeProseBulletsAndRules = (prose: string): string =>
    prose.split("\n").map(normalizeSingleProseLine).join("\n");

type PreprocessCacheEntry = {
    bounded: string;
    streaming: boolean;
    trim: boolean;
    output: string;
};

let lastPreprocessedCache: PreprocessCacheEntry | null = null;

/** Checks whether `lastPreprocessedCache` matches `(bounded, streaming, trim)`. */
const matchesPreprocessCache = (
    entry: PreprocessCacheEntry | null,
    bounded: string,
    streaming: boolean,
    trim: boolean,
): entry is PreprocessCacheEntry =>
    Boolean(
        entry &&
            entry.bounded === bounded &&
            entry.streaming === streaming &&
            entry.trim === trim,
    );

/** Runs the core markdown sanitization and normalization passes on an already-bounded string. */
const computePreprocessedMarkdown = (
    bounded: string,
    streaming: boolean,
    trim: boolean,
): string => {
    let normalized = stripOrphanThinkTags(bounded);
    normalized = stripLeakedToolCode(normalized);
    normalized = stripRawHtml(normalized);
    normalized = unwrapOuterProseFence(normalized);
    normalized = demoteIndentedMarkdown(normalized);
    normalized = finalizeStreamOrStaticMarkdown(normalized, streaming);
    normalized = mapOutsideCodeFences(normalized, normalizeProseBulletsAndRules);
    normalized = collapseExcessNewlines(normalized);
    return trim ? normalized.trim() : normalized;
};

/** Normalize assistant markdown before ReactMarkdown. */
export const preprocessChatMarkdown = (
    text: string,
    options?: { trim?: boolean; streaming?: boolean },
): string => {
    const streaming = Boolean(options?.streaming);
    const bounded = streaming
        ? truncateForDisplay(text)
        : capSettledPreprocessInput(text);
    const trim = options?.trim !== false;
    if (matchesPreprocessCache(lastPreprocessedCache, bounded, streaming, trim)) {
        return lastPreprocessedCache.output;
    }
    const output = computePreprocessedMarkdown(bounded, streaming, trim);
    lastPreprocessedCache = { bounded, streaming, trim, output };
    return output;
};
