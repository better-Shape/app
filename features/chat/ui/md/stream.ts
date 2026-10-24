/** Remove stray thinking tags that leaked into plain text. */
export function stripOrphanThinkTags(text: string): string {
    if (!text.includes("<")) return text;
    return text
        .replace(/<\/?redacted_thinking[^>]*>\s*/gi, "")
        .replace(/<\/?thinking[^>]*>\s*/gi, "")
        .replace(/<\/?reasoning[^>]*>\s*/gi, "")
        .replace(/<\/?think[^>]*>\s*/gi, "");
}

const LEAKED_TOOL_CALL_FN_RE =
    /(?:default_api\.[a-zA-Z_]\w*|render_design_previews|read_file|edit_file|write_file|grep_search|run_terminal|web_search|list_terminals|terminal_read|terminal_input)/;

/** True when a fenced/JSON blob is a leaked model tool invocation, not user-facing code. */
export function looksLikeLeakedToolCode(body: string): boolean {
    const t = body.trim();
    if (!t) return false;
    if (/"tool_code"\s*:/.test(t)) return true;
    if (
        new RegExp(`\\bprint\\s*\\(\\s*${LEAKED_TOOL_CALL_FN_RE.source}\\s*\\(`).test(t) ||
        /\bprint\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(t) && t.includes("_execute")
    ) {
        return true;
    }
    if (/^\s*tool_code\s*$/m.test(t) && /\bprint\s*\(/.test(t)) return true;
    if (
        new RegExp(`^\\s*functions\\.${LEAKED_TOOL_CALL_FN_RE.source}\\s*\\(`, "m").test(t) ||
        /^\s*functions\.[a-zA-Z_][a-zA-Z0-9_]*\s*\(/m.test(t) && t.includes("_execute")
    ) {
        return true;
    }
    if (/<(?:tool_call|function_call|minimax:tool_call|tool_code)\b/i.test(t)) return true;
    return false;
}

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
const DSML_PAIRED_RE = new RegExp(
    `<${FW_BAR}{0,2}DSML${FW_BAR}{1,2}[\\w.]*?>[\\s\\S]*?<\\/${FW_BAR}{0,2}DSML${FW_BAR}{1,2}[\\w.]*?>`,
    "gi",
);
const DSML_OPEN_TAIL_RE = new RegExp(`<${FW_BAR}{0,2}DSML${FW_BAR}{1,2}[\\w.]*?>[\\s\\S]*$`, "gi");
const DSML_STRAY_RE = new RegExp(`<\\/?${FW_BAR}{0,2}DSML${FW_BAR}{1,2}[\\w.]*?>`, "gi");

/** Apply `fn` only to prose outside fenced code blocks (including an open trailing streaming fence). */
function mapOutsideCodeFences(text: string, fn: (prose: string) => string): string {
    if (!text.includes("```")) return fn(text);
    const parts = text.split(/(```[\s\S]*?(?:```|$))/g);
    return parts
        .map((part, index) => {
            if (index % 2 === 1) return part;
            return fn(part);
        })
        .join("");
}

/**
 * Strip provider/model tool-call grammars that leaked into assistant text.
 * Surveyed shapes: DeepSeek DSML, Qwen/Hermes/GLM `<tool_call>`, MiniMax,
 * Kimi/Llama/Gemma `<|…|>` sentinels, Gemini `<function_calls>` / `tool_code`,
 * Mistral `[TOOL_CALLS]`, plus BetterShape terminal UI chunks.
 */
export function stripLeakedToolMarkup(text: string): string {
    const hasAngle = text.includes("<");
    const hasDsml = text.includes(FW_BAR);
    const hasMistral = text.includes("[TOOL_CALLS]");
    const hasExecute = text.includes("_execute");
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
        const proseExecute = prose.includes("_execute");
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
}

/**
 * Strip Gemini/OpenRouter-style tool leaks that models sometimes paste as
 * markdown JSON instead of issuing a real tool call, e.g.
 * ```json
 * { "tool_code": "print(render_design_previews(...))" }
 * ```
 * Also strips cross-model XML / sentinel tool grammars from prose.
 */
export function stripLeakedToolCode(text: string): string {
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
}

/** Repair cumulative-stream glitches and obvious duplicate phrases in assistant text. */
export function repairStreamGlitches(text: string): string {
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
    while (searchFrom <= text.length - 20) {
        const start = text.indexOf(prefix20, searchFrom);
        if (start === -1 || start > text.length - 20) break;
        const maxLen = Math.min(start, text.length - start);
        let matched = 20;
        while (matched < maxLen && text.charCodeAt(matched) === text.charCodeAt(start + matched)) {
            matched++;
        }
        const prevChar = text.charAt(start - 1);
        const isGlitchReplay =
            matched === start || matched >= 80 || (prevChar.length > 0 && !/\s/.test(prevChar));
        if (matched >= 20 && isGlitchReplay) {
            return text.slice(0, start) + text.slice(start + matched);
        }
        searchFrom = start + 1;
    }

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

    return text;
}

/** Normalize assistant markdown before ReactMarkdown. */
export function looksLikeProseMarkdown(text: string): boolean {
    return /(^|\n)#{1,6}\s+\S/.test(text)
        || /(^|\n)[-*+]\s+\S/.test(text)
        || /(^|\n)\d+\.\s+\S/.test(text);
}

function demoteIndentedMarkdown(text: string): string {
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
}

function unwrapOuterProseFence(text: string): string {
    const trimmed = text.trim();
    if (!trimmed.startsWith("```")) return text;
    const outer = /^```(?:[\w-]*)?\s*\n([\s\S]*?)\n```\s*$/.exec(trimmed);
    if (outer && looksLikeProseMarkdown(outer[1])) {
        return outer[1];
    }
    return text;
}

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

/** True when `offset` falls inside one of `ranges`. */
const isOffsetInRanges = (offset: number, ranges: ReadonlyArray<[number, number]>): boolean =>
    ranges.some(([start, end]) => offset >= start && offset < end);

/** Single linear character-scanner pass stripping raw HTML tags without regex backtracking. */
function stripHtmlTagsOnce(input: string): string {
    const codeRanges = collectInlineCodeRanges(input);
    let out = "";
    let cursor = 0;
    const len = input.length;

    while (cursor < len) {
        const lt = input.indexOf("<", cursor);
        if (lt === -1) {
            out += input.slice(cursor);
            break;
        }
        out += input.slice(cursor, lt);

        if (isOffsetInRanges(lt, codeRanges)) {
            out += "<";
            cursor = lt + 1;
            continue;
        }

        let pos = lt + 1;
        while (pos < len && /\s/.test(input.charAt(pos))) pos++;
        let isClosing = false;
        if (pos < len && input.charAt(pos) === "/") {
            isClosing = true;
            pos++;
            while (pos < len && /\s/.test(input.charAt(pos))) pos++;
        }

        const nameStart = pos;
        while (pos < len && /[a-zA-Z0-9]/.test(input.charAt(pos))) pos++;
        const tagName = input.slice(nameStart, pos).toLowerCase();
        const nextChar = pos < len ? input.charAt(pos) : "";
        const validBoundary =
            tagName.length > 0 &&
            (nextChar === "" || nextChar === ">" || nextChar === "/" || /\s/.test(nextChar));

        const matchedPairedPrefix = PAIRED_STRIP_TAG_LIST.find((t) => tagName.startsWith(t));

        if (!validBoundary && !matchedPairedPrefix) {
            out += "<";
            cursor = lt + 1;
            continue;
        }

        const gt = input.indexOf(">", pos);
        if (matchedPairedPrefix) {
            if (gt === -1) break;
            if (!isClosing && PAIRED_STRIP_TAGS.has(tagName)) {
                const lowerRest = input.slice(gt + 1).toLowerCase();
                const closeNeedle = `</${tagName}`;
                const closeRel = lowerRest.indexOf(closeNeedle);
                if (closeRel !== -1) {
                    const closeGt = input.indexOf(">", gt + 1 + closeRel + closeNeedle.length);
                    cursor = closeGt === -1 ? len : closeGt + 1;
                    continue;
                }
            }
            cursor = gt + 1;
            continue;
        }

        if (gt === -1) {
            out += "<";
            cursor = lt + 1;
            continue;
        }

        if (tagName === "br" && !isClosing) {
            out += "\n";
            cursor = gt + 1;
            continue;
        }
        if (tagName === "img" && !isClosing) {
            cursor = gt + 1;
            continue;
        }
        if (LAYOUT_HTML_TAGS.has(tagName)) {
            if (isClosing) out += "\n";
            cursor = gt + 1;
            continue;
        }

        out += input.slice(lt, gt + 1);
        cursor = gt + 1;
    }

    return out;
}

function stripRawHtml(text: string): string {
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
    if (!text.includes("```")) return replaceHtml(text);
    const parts = text.split(/(```[\s\S]*?(?:```|$))/g);
    return parts
        .map((part, index) => (index % 2 === 1 ? part : replaceHtml(part)))
        .join("");
}

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

/** Close an unclosed fenced code block so streaming markdown does not swallow the rest as mono code. */
function balanceMarkdownFences(text: string): string {
    if (!text.includes("```")) return text;
    const fenceCount = (text.match(/^```/gm) || []).length;
    if (fenceCount % 2 !== 0) {
        return `${text}\n\`\`\``;
    }
    return text;
}
