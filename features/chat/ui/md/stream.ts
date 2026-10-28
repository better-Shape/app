/** Remove stray thinking tags that leaked into plain text. */
export const stripOrphanThinkTags = (text: string): string => {
    if (!text.includes("<")) return text;
    return text
        .replace(/<\/?redacted_thinking[^>]*>\s*/gi, "")
        .replace(/<\/?thinking[^>]*>\s*/gi, "")
        .replace(/<\/?reasoning[^>]*>\s*/gi, "")
        .replace(/<\/?think[^>]*>\s*/gi, "");
};

// The rule it guards is `/gi`, so probe case-insensitively: `_EXECUTE` must not
// fall through the fast path and survive in the rendered message.
const hasExecuteDump = (text: string) => /_[eE]xecute/i.test(text);

const LEAKED_TOOL_CALL_FN_RE =
    /(?:default_api\.[a-zA-Z_]\w*|render_design_previews|read_file|edit_file|write_file|grep_search|run_terminal|web_search|list_terminals|terminal_read|terminal_input)/;
const LEAKED_PRINT_FN_RE = new RegExp(`\\bprint\\s*\\(\\s*${LEAKED_TOOL_CALL_FN_RE.source}\\s*\\(`);
const LEAKED_FUNCTIONS_CALL_RE = new RegExp(`^functions\\.${LEAKED_TOOL_CALL_FN_RE.source}\\s*\\(`);
const GENERIC_FUNCTIONS_CALL_RE = /^functions\.[a-zA-Z_][a-zA-Z0-9_]*\s*\(/;

/** True when a fenced/JSON blob is a leaked model tool invocation, not user-facing code. */
export const looksLikeLeakedToolCode = (body: string): boolean => {
    const t = body.trim();
    if (!t) return false;
    if (/"tool_code"\s*:/.test(t)) return true;
    const hasExecute = hasExecuteDump(t);
    if (
        LEAKED_PRINT_FN_RE.test(t) ||
        (hasExecute && /\bprint\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(t))
    ) {
        return true;
    }
    const hasPrintCall = /\bprint\s*\(/.test(t);
    for (const rawLine of t.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        if (hasPrintCall && line === "tool_code") return true;
        if (LEAKED_FUNCTIONS_CALL_RE.test(line)) return true;
        if (hasExecute && GENERIC_FUNCTIONS_CALL_RE.test(line)) return true;
    }
    return /<(?:tool_call|function_call|minimax:tool_call|tool_code)\b/i.test(t);
};

/**
 * XML / sentinel tags that models leak into `content` instead of structured
 * tool_calls. Cover BetterShape catalog families (Claude, GPT, Gemini/Auto, Grok,
 * DeepSeek) plus common OpenRouter proxies. Do NOT include intentional BetterShape
 * UI tags (`edit`, `terminal_command`, `todos`, …) — those are parsed separately.
 */
export const LEAKED_TOOL_XML_TAGS = [
    // BetterShape-internal tool UI that must never render as prose
    "list_terminals",
    "terminal_input",
    "terminal_read",
    "tool_result",
    "tool_code",
    "new_path",
    "file_content",
    "analysis",
    // Anthropic / Claude / MiniMax / generic OpenRouter
    "tool_call",
    "tool_calls",
    "function_call",
    "function_calls",
    "function_response",
    "tool_response",
    "minimax:tool_call",
    "invoke",
    "parameter",
    // GLM
    "arg_key",
    "arg_value",
    // Qwen2.5 oddball wrapper
    "tools",
    // Gemini CLI / Google
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
const TRIPLE_NEWLINE = /\n{3,}/g;
const DSML_PAIRED_RE = new RegExp(
    `<${FW_BAR}{0,2}DSML${FW_BAR}{1,2}[\\w.]*?>[\\s\\S]*?<\\/${FW_BAR}{0,2}DSML${FW_BAR}{1,2}[\\w.]*?>`,
    "gi",
);
const DSML_OPEN_TAIL_RE = new RegExp(`<${FW_BAR}{0,2}DSML${FW_BAR}{1,2}[\\w.]*?>[\\s\\S]*$`, "gi");
const DSML_STRAY_RE = new RegExp(`<\\/?${FW_BAR}{0,2}DSML${FW_BAR}{1,2}[\\w.]*?>`, "gi");

/** Reads a CommonMark backtick or tilde fence marker (`>= 3` chars) on a single line. */
const readStreamFenceMarker = (
    rawLine: string,
): { char: string; len: number; suffix: string } | null => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    let spaces = 0;
    while (spaces < 3 && line.charCodeAt(spaces) === 32) {
        spaces += 1;
    }
    const markerChar = line.charAt(spaces);
    if (markerChar !== "`" && markerChar !== "~") return null;
    let markerEnd = spaces;
    while (markerEnd < line.length && line.charAt(markerEnd) === markerChar) {
        markerEnd += 1;
    }
    const len = markerEnd - spaces;
    if (len < 3) return null;
    return { char: markerChar, len, suffix: line.slice(markerEnd) };
};

/** Checks whether `parsed` opens a CommonMark fenced code block. */
const isOpeningStreamFence = (
    parsed: { char: string; len: number; suffix: string } | null,
): parsed is { char: string; len: number; suffix: string } =>
    Boolean(parsed && (parsed.char !== "`" || !parsed.suffix.includes("`")));

/** Checks whether `parsed` closes an open CommonMark fenced code block. */
const isClosingStreamFence = (
    parsed: { char: string; len: number; suffix: string } | null,
    fenceChar: string,
    fenceLen: number,
): boolean =>
    Boolean(
        parsed
        && parsed.char === fenceChar
        && parsed.len >= fenceLen
        && /^[ \t]*$/.test(parsed.suffix),
    );

/** Apply `fn` only to prose outside CommonMark backtick or tilde fenced code blocks. */
const mapOutsideCodeFences = (text: string, fn: (prose: string) => string): string => {
    if (!text.includes("```") && !text.includes("~~~")) return fn(text);
    const out: string[] = [];
    let proseStart = 0;
    let fenceStart = -1;
    let fenceChar = "";
    let fenceLen = 0;
    let cursor = 0;

    while (cursor < text.length) {
        const nl = text.indexOf("\n", cursor);
        const afterLine = nl === -1 ? text.length : nl + 1;
        const parsed = readStreamFenceMarker(
            nl === -1 ? text.slice(cursor) : text.slice(cursor, nl),
        );

        if (!fenceChar && isOpeningStreamFence(parsed)) {
            if (cursor > proseStart) out.push(fn(text.slice(proseStart, cursor)));
            fenceStart = cursor;
            fenceChar = parsed.char;
            fenceLen = parsed.len;
        } else if (fenceChar && isClosingStreamFence(parsed, fenceChar, fenceLen)) {
            out.push(text.slice(fenceStart, afterLine));
            proseStart = afterLine;
            fenceStart = -1;
            fenceChar = "";
            fenceLen = 0;
        }

        cursor = afterLine;
    }

    if (fenceChar) {
        out.push(text.slice(fenceStart));
    } else if (proseStart < text.length) {
        out.push(fn(text.slice(proseStart)));
    }

    return out.join("");
};


/**
 * Strip provider/model tool-call grammars that leaked into assistant text.
 * Surveyed shapes: DeepSeek DSML, Qwen/Hermes/GLM `<tool_call>`, MiniMax,
 * Kimi/Llama/Gemma `<|…|>` sentinels, Gemini `<function_calls>` / `tool_code`,
 * Mistral `[TOOL_CALLS]`, plus BetterShape terminal UI chunks.
 */
export const stripLeakedToolMarkup = (text: string): string => {
    const hasAngle = text.includes("<");
    const hasDsml = text.includes(FW_BAR);
    const hasMistral = text.includes("[TOOL_CALLS]");
    const hasExecute = hasExecuteDump(text);
    if (!hasAngle && !hasDsml && !hasMistral && !hasExecute) {
        return text.includes("\n\n\n") ? text.replace(/\n{3,}/g, "\n\n") : text;
    }

    let s = text;
    if (hasAngle) {
        for (const pattern of STRIP_ACROSS_FENCES_PATTERNS) {
            s = s.replace(pattern, "");
        }
    }

    s = mapOutsideCodeFences(s, (prose) => {
        const proseAngle = prose.includes("<");
        const proseDsml = prose.includes(FW_BAR);
        const proseMistral = prose.includes("[TOOL_CALLS]");
        const proseExecute = hasExecuteDump(prose);
        if (!proseAngle && !proseDsml && !proseMistral && !proseExecute) return prose;

        let p = prose;

        if (proseAngle) {
            for (const rule of LEAKED_TAG_PATTERNS) {
                if (!p.includes("<")) break;
                p = p.replace(rule.paired, "");
                p = p.replace(rule.selfClosing, "");
                p = p.replace(rule.openTail, "");
                p = p.replace(rule.strayCloser, "");
            }
        }

        if (proseAngle || proseDsml) {
            p = p.replace(DSML_PAIRED_RE, "");
            p = p.replace(DSML_OPEN_TAIL_RE, "");
            p = p.replace(DSML_STRAY_RE, "");
            p = p.replace(/<\s*\|\s*DSML\s*\|\s*[\w.]*?>[\s\S]*?<\/\s*\|\s*DSML\s*\|\s*[\w.]*?>/gi, "");
            p = p.replace(/<\/?\s*\|\s*DSML\s*\|\s*[\w.]*?>/gi, "");

            p = p.replace(
                /<\|(?:tool_calls_section_begin|tool_calls_section_end|tool_call_section_begin|tool_call_section_end|tool_call_begin|tool_call_end|tool_call_argument_begin|tool_call|tool_response|python_tag)\|>/gi,
                "",
            );
            p = p.replace(/<\|[^|]{0,48}tool[^|]{0,48}\|>/gi, "");
            p = p.replace(/<\/?function\s*=[^>]*>/gi, "");
            p = p.replace(/<\/?parameter\s*=[^>]*>/gi, "");
        }

        if (proseMistral) {
            p = p.replace(/\[TOOL_CALLS\]\s*\[[\s\S]*?\](?=\s*(?:\n|$))/g, "");
            p = p.replace(/\[TOOL_CALLS\][^\n]*(?:\n\[(?:ARGS|CALL_ID)\][^\n]*)*/g, "");
        }

        if (proseExecute) {
            p = p.replace(/(?:^|\n)_execute\s*\n(?:tool_name|name)\s*:[^\n]*(?:\n[a-z_]+\s*:[^\n]*)*/gi, "\n");
        }

        return p;
    });

    return s.includes("\n\n\n") ? s.replace(/\n{3,}/g, "\n\n") : s;
};

/**
 * Strip Gemini/OpenRouter-style tool leaks that models sometimes paste as
 * markdown JSON instead of issuing a real tool call, e.g.
 * ```json
 * { "tool_code": "print(render_design_previews(...))" }
 * ```
 * Also strips cross-model XML / sentinel tool grammars from prose.
 */
export function stripLeakedToolCode(text: string): string {
    // Fast path: no marker any rule can match, so the only work left is the
    // newline collapse the full path ends with.
    if (
        !text.includes("`")
        && !text.includes("<")
        && !text.includes("tool_code")
        && !text.includes("print")
        && !text.includes("functions.")
        && !text.includes("[TOOL_CALLS]")
        && !hasExecuteDump(text)
    ) {
        return text.replace(TRIPLE_NEWLINE, "\n\n");
    }

    let s = text;

    if (s.includes("```")) {
        // Complete fenced blocks whose body looks like a tool leak.
        s = s.replace(/```[\w-]*\s*\n([\s\S]*?)```/g, (full, body: string) =>
            looksLikeLeakedToolCode(body) ? "" : full,
        );

        // Incomplete fence still streaming (common mid-tool-arg dump).
        s = s.replace(/```[\w-]*\s*\n([\s\S]*)$/g, (full, body: string) =>
            looksLikeLeakedToolCode(body) ? "" : full,
        );
    }

    if (s.includes("tool_code")) {
        // Bare JSON objects: { "tool_code": "..." }
        s = s.replace(/\{\s*"tool_code"\s*:[\s\S]*$/g, (match) => {
            return /print\s*\(|render_design_previews|concepts\s*=/.test(match) ? "" : match;
        });
    }

    if (s.includes("print") || s.includes("functions.")) {
        // Only known tool helpers count as a leak; a prose example such as
        // `print(foo(bar))` must stay visible. Both a closed one-line dump and a
        // still-streaming tail are removed.
        const leakedPrintLineRe = new RegExp(
            `(?:^|\\n)[ \\t]*print\\s*\\(\\s*${LEAKED_TOOL_CALL_FN_RE.source}\\s*\\([^\\n]*\\)\\s*\\)[ \\t]*(?=\\n|$)`,
            "g",
        );
        const leakedPrintTailRe = new RegExp(
            `(?:^|\\n)[ \\t]*print\\s*\\(\\s*${LEAKED_TOOL_CALL_FN_RE.source}\\s*\\([^\\n]*$`,
            "g",
        );
        const leakedFnLineRe = new RegExp(
            `(?:^|\\n)[ \\t]*functions\\.${LEAKED_TOOL_CALL_FN_RE.source}\\s*\\(\\{[^\\n]*\\}\\)[ \\t]*(?=\\n|$)`,
            "g",
        );
        const leakedFnTailRe = new RegExp(
            `(?:^|\\n)[ \\t]*functions\\.${LEAKED_TOOL_CALL_FN_RE.source}\\s*\\(\\{[^\\n]*$`,
            "g",
        );
        s = mapOutsideCodeFences(s, (prose) =>
            prose
                .replace(leakedPrintLineRe, "\n")
                .replace(leakedPrintTailRe, "\n")
                .replace(leakedFnLineRe, "\n")
                .replace(leakedFnTailRe, "\n"),
        );
    }

    s = stripLeakedToolMarkup(s);

    return s.includes("\n\n\n") ? s.replace(/\n{3,}/g, "\n\n") : s;
};

/** Repair cumulative-stream glitches and obvious duplicate phrases in assistant text. */
/** Repair cumulative-stream glitches and obvious duplicate phrases in assistant text. */
export function repairStreamGlitches(text: string): string {
    // A duplicated chunk glued to the previous one is a streaming replay even when
    // the whole text is shorter than the 40-character window the searches need.
    const glued = text.match(/([a-z])([A-Z][a-z]{4,})/);
    if (glued && glued.index !== undefined) {
        const splitAt = glued.index + 1;
        const prefix = text.slice(0, splitAt);
        const suffix = text.slice(splitAt);
        for (let checkLen = 16; checkLen <= Math.min(80, prefix.length); checkLen++) {
            const tail = prefix.slice(-checkLen);
            if (suffix.startsWith(tail)) {
                return prefix + suffix.slice(tail.length);
            }
        }
    }

    if (text.length < 40) return text;

    const maxAdjLen = Math.min(120, Math.floor(text.length / 2));
    for (let len = maxAdjLen; len >= 20; len--) {
        const limit = text.length - len * 2;
        const midOffset = len >> 1;
        for (let i = 0; i <= limit; i++) {
            if (
                text.charCodeAt(i) === text.charCodeAt(i + len)
                && text.charCodeAt(i + len - 1) === text.charCodeAt(i + len * 2 - 1)
                && text.charCodeAt(i + midOffset) === text.charCodeAt(i + len + midOffset)
                && text.startsWith(text.slice(i, i + len), i + len)
            ) {
                return text.slice(0, i + len) + text.slice(i + len * 2);
            }
        }
    }

    // Prefix re-emission check: `text.slice(0, len) === text.slice(start, start + len)` for `len >= 20`
    // can only occur at positions `start` where `text.slice(0, 20)` appears again!
    // Require either an immediate back-to-back replay (`matched === start`), a mid-token glue
    // boundary (`!whitespace` before `start`), or a long (`>= 80` char) verbatim replay so
    // legitimate repeated phrases in later paragraphs are preserved.
    const prefix20 = text.slice(0, 20);
    let searchFrom = 20;
    while (searchFrom < text.length - 20) {
        const start = text.indexOf(prefix20, searchFrom);
        if (start === -1 || start >= text.length - 20) break;
        const maxLen = Math.min(start, text.length - start);
        let matched = 20;
        while (matched < maxLen && text.charCodeAt(matched) === text.charCodeAt(start + matched)) {
            matched++;
        }
        const prevChar = text.charAt(start - 1);
        // A copy that runs to the end of the text is a replay, not prose, even
        // when it is one character shorter than its offset (missing a trailing
        // space). Short repeated openers in later paragraphs are left alone.
        const isSuffixReplay = start + matched >= text.length - 1;
        const isGlitchReplay =
            matched === start
            || matched >= 80
            || isSuffixReplay
            || (prevChar.length > 0 && !/\s/.test(prevChar));
        if (matched >= 20 && isGlitchReplay) {
            return text.slice(0, start) + text.slice(start + matched);
        }
        searchFrom = start + 1;
    }

    return text;
}

/** Normalize assistant markdown before ReactMarkdown. */
export const looksLikeProseMarkdown = (text: string): boolean => {
    return /(^|\n)#{1,6}\s+\S/.test(text)
        || /(^|\n)[-*+]\s+\S/.test(text)
        || /(^|\n)\d+\.\s+\S/.test(text);
};

/** Demote indented markdown. */
const demoteIndentedMarkdown = (text: string): string => {
    if (!text.includes("    ") && !text.includes("\t")) return text;
    return text
        .split("\n")
        .map((line) => {
            const m = /^( {4,}|\t+)(.*)$/.exec(line);
            if (!m) return line;
            const inner = m[2];
            if (/^(#{1,6}\s|[-*+]\s|\d+\.\s)/.test(inner)) return inner;
            return line;
        })
        .join("\n");
};

/** Unwrap outer prose fence. */
const unwrapOuterProseFence = (text: string): string => {
    const trimmed = text.trim();
    if (!trimmed.startsWith("```")) return text;
    const outer = /^```(?:[\w-]*)?\s*\n([\s\S]*?)\n```\s*$/.exec(trimmed);
    if (outer && looksLikeProseMarkdown(outer[1])) {
        return outer[1];
    }
    return text;
};

const PAIRED_STRIP_TAG_LIST = ["iframe", "script", "style", "object", "embed"] as const;
const PAIRED_STRIP_TAGS = new Set<string>(PAIRED_STRIP_TAG_LIST);
const LAYOUT_HTML_TAGS = new Set([
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "div", "span", "a", "ul", "ol", "li",
    "strong", "em", "b", "i", "section", "article", "header", "footer",
]);

/** Counts consecutive backticks starting at `start`. */
const countBacktickRun = (input: string, start: number): number => {
    let end = start;
    while (end < input.length && input.charCodeAt(end) === 96) end++;
    return end - start;
};

/** Finds the closing backtick run of exact length `runLen`, or `-1` if unclosed. */
const findMatchingBackticks = (input: string, from: number, runLen: number): number => {
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
        if (closeEnd !== -1 && !input.slice(tick, closeEnd).includes("\n\n")) {
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
    if (isClosing) {
        for (let i = start; i < end; i++) {
            if (!/\s/.test(input.charAt(i))) return false;
        }
        return true;
    }
    let quote: string | null = null;
    for (let i = start; i < end; i++) {
        const ch = input.charAt(i);
        if (quote) {
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (
            ch === "<" ||
            ch === "&" ||
            ch === "|" ||
            ch === "," ||
            ch === ";" ||
            ch === "(" ||
            ch === ")"
        ) {
            return false;
        }
    }
    return quote === null;
};

/**
 * Finds the closing `>` of an HTML tag starting at `start`, ignoring `>` inside
 * single- or double-quoted attribute values on the same line.
 */
const findHtmlTagClose = (input: string, start: number): number => {
    const len = input.length;
    let quote: string | null = null;
    for (let i = start; i < len; i++) {
        const ch = input.charAt(i);
        if (quote) {
            if (ch === quote) quote = null;
            else if (ch === "\n") return input.indexOf(">", start);
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === ">") return i;
    }
    return -1;
};

/** Finds the matching `</tagName>` boundary, rejecting longer prefixes such as `</scriptx>`. */
const findPairedClosingTagEnd = (lowerInput: string, tagName: string, searchFrom: number): number => {
    const closeNeedle = `</${tagName}`;
    let from = searchFrom;
    while (from < lowerInput.length) {
        const closeIdx = lowerInput.indexOf(closeNeedle, from);
        if (closeIdx === -1) return -1;
        const afterNamePos = closeIdx + closeNeedle.length;
        const afterChar = afterNamePos < lowerInput.length ? lowerInput.charAt(afterNamePos) : "";
        if (afterChar === ">" || /\s/.test(afterChar)) {
            const closeGt = lowerInput.indexOf(">", afterNamePos);
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

/** Checks whether the character immediately following an HTML tag name is a valid delimiter. */
const isHtmlTagNameBoundary = (ch: string): boolean =>
    ch === "" || ch === ">" || ch === "/" || /\s/.test(ch);

/** Parses `<tagName` or `</tagName` starting at `lt`; returns `null` when not a candidate HTML tag. */
const parseHtmlTagHeaderAt = (input: string, lt: number): ParsedHtmlTagHeader | null => {
    const len = input.length;
    const isClosing = lt + 1 < len && input.charAt(lt + 1) === "/";
    let pos = isClosing ? lt + 2 : lt + 1;
    if (pos >= len || !isAsciiAlpha(input.charAt(pos))) return null;
    const nameStart = pos;
    while (pos < len && /[a-zA-Z0-9]/.test(input.charAt(pos))) pos++;
    const tagName = input.slice(nameStart, pos).toLowerCase();
    const validBoundary = isHtmlTagNameBoundary(pos < len ? input.charAt(pos) : "");
    const isPairedStripTag =
        (validBoundary && PAIRED_STRIP_TAGS.has(tagName)) || tagName.startsWith("script");
    if (!validBoundary && !isPairedStripTag) return null;
    return { isClosing, tagName, afterNamePos: pos, isPairedStripTag };
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

/** Resolves the replacement text (`""`, `"\n"`, or original slice) for a non-paired HTML tag. */
const resolveStandardHtmlTagReplacement = (
    input: string,
    lt: number,
    gt: number,
    header: ParsedHtmlTagHeader,
): { chunk: string; nextCursor: number } => {
    if (gt === -1 || !hasPlausibleHtmlTagTail(input, header.afterNamePos, gt, header.isClosing)) {
        return { chunk: "<", nextCursor: lt + 1 };
    }
    if (header.tagName === "br" && !header.isClosing) return { chunk: "\n", nextCursor: gt + 1 };
    if (header.tagName === "img" && !header.isClosing) return { chunk: "", nextCursor: gt + 1 };
    if (LAYOUT_HTML_TAGS.has(header.tagName)) {
        return { chunk: header.isClosing ? "\n" : "", nextCursor: gt + 1 };
    }
    return { chunk: input.slice(lt, gt + 1), nextCursor: gt + 1 };
};

/** Resolves the next scanner cursor when stripping a paired `<script>`/`<style>` tag. */
const resolvePairedStripCursor = (
    input: string,
    gt: number,
    header: ParsedHtmlTagHeader,
    cachedLower: string | null,
): { nextCursor: number; lowerInput: string | null } => {
    if (gt === -1) return { nextCursor: input.length, lowerInput: cachedLower };
    if (header.isClosing) return { nextCursor: gt + 1, lowerInput: cachedLower };
    const lowerInput = cachedLower ?? input.toLowerCase();
    const closeEnd = findPairedClosingTagEnd(lowerInput, header.tagName, gt + 1);
    return { nextCursor: closeEnd !== -1 ? closeEnd : gt + 1, lowerInput };
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
        const header = rangeCheck.insideCode ? null : parseHtmlTagHeaderAt(input, lt);
        if (!header) {
            out += "<";
            cursor = lt + 1;
            continue;
        }

        const gt = findHtmlTagClose(input, header.afterNamePos);
        if (header.isPairedStripTag) {
            const paired = resolvePairedStripCursor(input, gt, header, lowerInput);
            lowerInput = paired.lowerInput;
            cursor = paired.nextCursor;
            continue;
        }

        const step = resolveStandardHtmlTagReplacement(input, lt, gt, header);
        out += step.chunk;
        cursor = step.nextCursor;
    }

    return out;
};

/** Strips raw HTML tags from prose while preserving fenced and inline code blocks. */
const stripRawHtml = (text: string): string => {
    if (!text.includes("<")) return text;
    const replaceHtml = (part: string) => {
        let out = part;
        for (let pass = 0; pass < 8; pass++) {
            const next = stripHtmlTagsOnce(out);
            if (next === out) break;
            out = next;
        }
        return out;
    };
    return mapOutsideCodeFences(text, replaceHtml);
};

const MAX_DISPLAY_CHARS = 48_000;

function truncateForDisplay(text: string): string {
    if (text.length <= MAX_DISPLAY_CHARS) return text;
    return `${text.slice(0, MAX_DISPLAY_CHARS)}\n\n... (response truncated for display)`;
}

/** Normalize assistant markdown before ReactMarkdown. */
export function preprocessChatMarkdown(
    text: string,
    options?: { trim?: boolean; streaming?: boolean },
): string {
    let s = stripOrphanThinkTags(text);
    s = stripLeakedToolCode(s);
    s = stripRawHtml(s);
    s = unwrapOuterProseFence(s);
    s = demoteIndentedMarkdown(s);
    if (!options?.streaming) {
        s = repairStreamGlitches(s);
        s = truncateForDisplay(s);
    } else {
        // Cap the live text at the same limit the settled render uses: a model
        // that dumps a huge file mid-stream would otherwise re-parse the whole
        // thing on every frame for text that is never shown past the cap.
        s = truncateForDisplay(s);
    }
    s = s.replace(/^[•●▪◦]\s+/gm, "- ");
    s = s.replace(/^\s*[-*_]{3,}\s*$/gm, "");
    if (s.includes("\n\n\n")) {
        s = s.replace(/\n{3,}/g, "\n\n");
    }
    if (options?.streaming) {
        const balanced = balanceMarkdownFences(s);
        if (balanced !== s) {
            s = stripLeakedToolCode(balanced);
        }
    }
    if (options?.trim !== false) {
        s = s.trim();
    }
    return s;
}

/**
 * Close an unclosed fenced code block so streaming markdown does not swallow the
 * rest as mono code. Tracks the open fence instead of counting markers, so a
 * streamed ````` example, a `~~~` block, or an info string on the opener all
 * close with the right marker — counting `^```` used to leave them open.
 */
function balanceMarkdownFences(text: string): string {
    let open: { char: string; len: number } | null = null;
    for (const line of text.split("\n")) {
        const parsed = readStreamFenceMarker(line);
        if (!parsed) continue;
        if (open) {
            // A closer has the same character, at least the opener's length, and
            // no info string (CommonMark); anything else is just content.
            if (parsed.char === open.char && parsed.len >= open.len && parsed.suffix.trim() === "") {
                open = null;
            }
            continue;
        }
        if (!isOpeningStreamFence(parsed)) continue;
        open = { char: parsed.char, len: parsed.len };
    }
    if (!open) return text;
    return `${text}\n${open.char.repeat(open.len)}`;
}
