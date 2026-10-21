/** Remove stray thinking tags that leaked into plain text. */
export function stripOrphanThinkTags(text: string): string {
    return text
        .replace(/<\/?redacted_thinking[^>]*>\s*/gi, "")
        .replace(/<\/?thinking[^>]*>\s*/gi, "")
        .replace(/<\/?reasoning[^>]*>\s*/gi, "")
        .replace(/<\/?think[^>]*>\s*/gi, "");
}

/** True when a fenced/JSON blob is a leaked model tool invocation, not user-facing code. */
export function looksLikeLeakedToolCode(body: string): boolean {
    const t = body.trim();
    if (!t) return false;
    if (/"tool_code"\s*:/.test(t)) return true;
    if (/\bprint\s*\(\s*[a-zA-Z_][\w]*\s*\(/.test(t)) return true;
    if (/^\s*tool_code\s*$/m.test(t) && /\bprint\s*\(/.test(t)) return true;
    if (/^\s*functions\.[a-zA-Z_][\w.]*\s*\(/.test(t)) return true;
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

const WORD_CHAR = /[A-Za-z0-9_]/;

/** `\b` from the regexes this replaced: the name must end at a non-word character. */
const isWordChar = (ch: string | undefined) => ch !== undefined && WORD_CHAR.test(ch);

/** Index of the next `<tag` opener at or after `from`, or -1 when there is none. */
function findOpenTag(text: string, from: number, tag: string): number {
    let at = text.indexOf("<", from);
    while (at !== -1) {
        const nameStart = at + 1;
        const nameEnd = nameStart + tag.length;
        if (
            text.charCodeAt(nameStart) !== 47 /* "/" */
            && text.slice(nameStart, nameEnd).toLowerCase() === tag
            && !isWordChar(text[nameEnd])
            && text.indexOf(">", nameEnd) !== -1
        ) {
            return at;
        }
        at = text.indexOf("<", at + 1);
    }
    return -1;
}

/** Index of the next exact `</tag>` closer at or after `from`, or -1. */
function findCloseTag(text: string, from: number, tag: string): number {
    const needle = `</${tag}>`;
    let at = text.indexOf("</", from);
    while (at !== -1) {
        if (text.slice(at, at + needle.length).toLowerCase() === needle) return at;
        at = text.indexOf("</", at + 1);
    }
    return -1;
}

/**
 * Remove `<tag ...>…</tag>` pairs, nearest closer first, exactly like the global
 * non-greedy regex this replaced. Written with index scans because the analyzer
 * flags `new RegExp(<interpolated tag>)` as a ReDoS risk, and because a scan
 * allocates nothing per call.
 */
function stripPairedBlocks(text: string, tag: string): string {
    let out = "";
    let from = 0;
    for (;;) {
        const open = findOpenTag(text, from, tag);
        if (open === -1) break;
        const gt = text.indexOf(">", open + 1 + tag.length);
        const close = findCloseTag(text, gt + 1, tag);
        // No closer after this opener means none after any later opener either.
        if (close === -1) break;
        out += text.slice(from, open);
        from = close + tag.length + 3;
    }
    if (from === 0) return text;
    return out + text.slice(from);
}

/** Remove stray `<tag ...>` openers and exact `</tag>` closers. */
function stripStrayTags(text: string, tag: string): string {
    const needle = `</${tag}>`;
    const nameEndOffset = 1 + tag.length;
    let out = "";
    let from = 0;
    let at = text.indexOf("<", from);
    while (at !== -1) {
        if (text.slice(at, at + needle.length).toLowerCase() === needle) {
            out += text.slice(from, at);
            from = at + needle.length;
            at = text.indexOf("<", from);
            continue;
        }
        if (
            text.charCodeAt(at + 1) !== 47 /* "/" */
            && text.slice(at + 1, at + nameEndOffset).toLowerCase() === tag
            && !isWordChar(text[at + nameEndOffset])
        ) {
            const gt = text.indexOf(">", at + nameEndOffset);
            if (gt !== -1) {
                out += text.slice(from, at);
                from = gt + 1;
                at = text.indexOf("<", from);
                continue;
            }
        }
        at = text.indexOf("<", at + 1);
    }
    if (from === 0) return text;
    return out + text.slice(from);
}

/**
 * Run the tag passes in list order. Across-fence tags only lose paired blocks
 * (their stray tags are stripped later, outside fences); leaked-tool tags also
 * lose any leftover openers and closers.
 */
function stripTagMarkup(text: string, tags: readonly string[], stray: boolean): string {
    let out = text;
    for (const tag of tags) {
        // Stray openers are removed before the original "eat the rest of the
        // segment" rule could run, so that rule was unreachable: a `<tag>` that
        // survives it has no `>` and could not open a block either.
        out = stray ? stripStrayTags(stripPairedBlocks(out, tag), tag) : stripPairedBlocks(out, tag);
    }
    return out;
}

/** Apply `fn` only to prose outside fenced code blocks (preserve legitimate examples). */
function mapOutsideCodeFences(text: string, fn: (prose: string) => string): string {
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts
        .map((part, index) => {
            if (index % 2 === 1) return part;
            return fn(part);
        })
        .join("");
}

/** Fullwidth bar used by DeepSeek DSML sentinels. */
const FW = "\uFF5C";

/** Fixed grammars: compiled once instead of on every parse pass. */
const DSML_PAIRED = new RegExp(
    `<${FW}{0,2}DSML${FW}{1,2}[\\w.]*?>[\\s\\S]*?<\\/${FW}{0,2}DSML${FW}{1,2}[\\w.]*?>`,
    "gi",
);
const DSML_INCOMPLETE = new RegExp(`<${FW}{0,2}DSML${FW}{1,2}[\\w.]*?>[\\s\\S]*$`, "gi");
const DSML_TAG = new RegExp(`<\\/?${FW}{0,2}DSML${FW}{1,2}[\\w.]*?>`, "gi");
const DSML_ASCII_PAIRED = /<\s*\|\s*DSML\s*\|\s*[\w.]*?>[\s\S]*?<\/\s*\|\s*DSML\s*\|\s*[\w.]*?>/gi;
const DSML_ASCII_TAG = /<\/?\s*\|\s*DSML\s*\|\s*[\w.]*?>/gi;
const SPECIAL_TOKENS =
    /<\|(?:tool_calls_section_begin|tool_calls_section_end|tool_call_section_begin|tool_call_section_end|tool_call_begin|tool_call_end|tool_call_argument_begin|tool_call|tool_response|python_tag)\|>/gi;
const SPECIAL_TOKEN_BROAD = /<\|[^|]{0,48}tool[^|]{0,48}\|>/gi;
const MISTRAL_ARRAY = /\[TOOL_CALLS\]\s*\[[\s\S]*?\](?=\s*(?:\n|$))/g;
const MISTRAL_LINE = /\[TOOL_CALLS\][^\n]*(?:\n\[(?:ARGS|CALL_ID)\][^\n]*)*/g;
const EXECUTE_DUMP = /(?:^|\n)_execute\s*\n(?:tool_name|name)\s*:[^\n]*(?:\n[a-z_]+\s*:[^\n]*)*/gi;
const FUNCTION_ATTR = /<\/?function\s*=[^>]*>/gi;
const PARAMETER_ATTR = /<\/?parameter\s*=[^>]*>/gi;
const TRIPLE_NEWLINE = /\n{3,}/g;

/**
 * Strip provider/model tool-call grammars that leaked into assistant text.
 * Surveyed shapes: DeepSeek DSML, Qwen/Hermes/GLM `<tool_call>`, MiniMax,
 * Kimi/Llama/Gemma `<|…|>` sentinels, Gemini `<function_calls>` / `tool_code`,
 * Mistral `[TOOL_CALLS]`, plus BetterShape terminal UI chunks.
 */
export function stripLeakedToolMarkup(text: string): string {
    let s = stripTagMarkup(text, STRIP_ACROSS_FENCES, false);

    s = mapOutsideCodeFences(s, (prose) => {
        let p = prose;

        if (p.includes("<")) {
            // Every tag rule needs a `<`; skipping the sweep on plain prose
            // keeps the common streaming case cheap.
            p = stripTagMarkup(p, LEAKED_TOOL_XML_TAGS, true);

            // DeepSeek DSML (fullwidth bars, double/single/no leading bar).
            // e.g. <｜｜DSML｜｜tool_calls>…</｜｜DSML｜｜tool_calls>
            //      <｜DSML｜invoke name="x">…</｜DSML｜invoke>
            p = p.replace(DSML_PAIRED, "");
            p = p.replace(DSML_INCOMPLETE, "");
            p = p.replace(DSML_TAG, "");
            // ASCII-pipe proxy variant: < | DSML | tool_calls>
            p = p.replace(DSML_ASCII_PAIRED, "");
            p = p.replace(DSML_ASCII_TAG, "");

            // Kimi / Llama / Gemma / OpenAI-compat special tokens.
            p = p.replace(SPECIAL_TOKENS, "");
            // Broader catch for unknown <|…tool…|> sentinels (keep short).
            p = p.replace(SPECIAL_TOKEN_BROAD, "");

        }

        // Mistral sentinel + JSON payload on the same/following lines.
        p = p.replace(MISTRAL_ARRAY, "");
        p = p.replace(MISTRAL_LINE, "");

        // DeepSeek / Hermes `_execute` textual tool dumps.
        p = p.replace(EXECUTE_DUMP, "\n");

        // Qwen Hermes bare function= / parameter= lines without outer wrapper.
        if (p.includes("<")) {
            p = p.replace(FUNCTION_ATTR, "");
            p = p.replace(PARAMETER_ATTR, "");
        }

        return p;
    });

    return s.replace(TRIPLE_NEWLINE, "\n\n");
}

/**
 * Strip Gemini/OpenRouter-style tool leaks that models sometimes paste as
 * markdown JSON instead of issuing a real tool call, e.g.
 * ```json
 * { "tool_code": "print(render_design_previews(...))" }
 * ```
 * Also strips cross-model XML / sentinel tool grammars from prose.
 */
// The rule it guards is `/gi`, so probe case-insensitively: `_EXECUTE` must not
// fall through the fast path and survive in the rendered message.
const hasExecuteDump = (text: string) => /_[eE]xecute/i.test(text);

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

    // Complete fenced blocks whose body looks like a tool leak.
    s = s.replace(/```[\w-]*\s*\n([\s\S]*?)```/g, (full, body: string) =>
        looksLikeLeakedToolCode(body) ? "" : full,
    );

    // Incomplete fence still streaming (common mid-tool-arg dump).
    s = s.replace(/```[\w-]*\s*\n([\s\S]*)$/g, (full, body: string) =>
        looksLikeLeakedToolCode(body) ? "" : full,
    );

    // Bare JSON objects: { "tool_code": "..." }
    s = s.replace(/\{\s*"tool_code"\s*:[\s\S]*$/g, (match) => {
        // Only strip if it looks like the start of a tool dump (not normal prose).
        return /print\s*\(|render_design_previews|concepts\s*=/.test(match) ? "" : match;
    });

    // Bare print(tool_name(...)) dumps without JSON wrapper (Gemini).
    s = s.replace(/(?:^|\n)\s*print\s*\(\s*[a-zA-Z_][\w]*\s*\([\s\S]*$/g, "\n");

    // MiniMax-Text-01 style: functions.name({...}) after a function_call fence remnant.
    s = s.replace(/(?:^|\n)\s*functions\.[a-zA-Z_][\w.]*\s*\(\{[\s\S]*$/g, "\n");

    s = stripLeakedToolMarkup(s);

    return s.replace(/\n{3,}/g, "\n\n");
}

/** True when `text[i..i+len)` equals `text[j..j+len)`, without allocating slices. */
function sameRange(text: string, i: number, j: number, len: number): boolean {
    for (let k = 0; k < len; k++) {
        if (text.charCodeAt(i + k) !== text.charCodeAt(j + k)) return false;
    }
    return true;
}

const HASH_BASE = 131;

/**
 * Rolling-hash prefix table for adjacent-duplicate search. Keys are compared
 * with `sameRange` before a hit is trusted, so a collision only costs time.
 */
function adjacentDuplicate(text: string, maxLen: number): { start: number; len: number } | null {
    const n = text.length;
    const prefix = new Uint32Array(n + 1);
    const power = new Uint32Array(maxLen + 1);
    power[0] = 1;
    for (let i = 0; i < n; i++) {
        prefix[i + 1] = (Math.imul(prefix[i] ?? 0, HASH_BASE) + text.charCodeAt(i)) >>> 0;
    }
    for (let i = 1; i <= maxLen; i++) {
        power[i] = Math.imul(power[i - 1] ?? 0, HASH_BASE) >>> 0;
    }
    const windowHash = (at: number, len: number) => {
        const head = prefix[at + len] ?? 0;
        const tail = prefix[at] ?? 0;
        const scale = power[len] ?? 0;
        return (head - Math.imul(tail, scale)) >>> 0;
    };

    for (let len = maxLen; len >= 20; len--) {
        for (let i = 0; i + len * 2 <= n; i++) {
            if (windowHash(i, len) !== windowHash(i + len, len)) continue;
            if (sameRange(text, i, i + len, len)) return { start: i, len };
        }
    }
    return null;
}

/** Z-array: z[i] is the length of the longest common prefix of `text` and `text[i..]`. */
function zFunction(text: string): Uint32Array {
    const n = text.length;
    const z = new Uint32Array(n);
    let left = 0;
    let right = 0;
    for (let i = 1; i < n; i++) {
        let k = 0;
        if (i < right) k = Math.min(right - i, z[i - left] ?? 0);
        while (i + k < n && text.charCodeAt(k) === text.charCodeAt(i + k)) k++;
        z[i] = k;
        if (i + k > right) {
            left = i;
            right = i + k;
        }
    }
    return z;
}

/** Repair cumulative-stream glitches and obvious duplicate phrases in assistant text. */
export function repairStreamGlitches(text: string): string {
    if (text.length < 24) return text;

    const duplicate = adjacentDuplicate(text, Math.min(120, Math.floor(text.length / 2)));
    if (duplicate) {
        return text.slice(0, duplicate.start + duplicate.len) + text.slice(duplicate.start + duplicate.len * 2);
    }

    if (text.length >= 41) {
        // The loop below needs `start < length - 20` to run at all, which holds
        // from 41 characters on; a 41-char duplicate prefix is still a glitch.
        const z = zFunction(text);
        for (let start = 20; start < text.length - 20; start++) {
            const shared = z[start] ?? 0;
            if (shared < 20) continue;
            const len = Math.min(Math.min(start, text.length - start), shared);
            return text.slice(0, start) + text.slice(start + len);
        }
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
    const outer = /^```(?:[\w-]*)?\s*\n([\s\S]*?)\n```\s*$/.exec(trimmed);
    if (outer && looksLikeProseMarkdown(outer[1])) {
        return outer[1];
    }
    return text;
}

function stripRawHtml(text: string): string {
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts
        .map((part, index) => {
            if (index % 2 === 1) return part;
            return part
                .replace(/<img[^>]*>/gi, "")
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<\/?(h[1-6]|p|div|span|a|ul|ol|li|strong|em|b|i|section|article|header|footer)[^>]*>/gi, (tag) =>
                    tag.startsWith("</") ? "\n" : "",
                );
        })
        .join("");
}

const MAX_DISPLAY_CHARS = 48_000;

function truncateForDisplay(text: string): string {
    if (text.length <= MAX_DISPLAY_CHARS) return text;
    return `${text.slice(0, MAX_DISPLAY_CHARS)}\n\n… (response truncated for display)`;
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
    s = s.replace(/\n{3,}/g, "\n\n");
    if (options?.streaming) {
        s = balanceMarkdownFences(s);
        // Re-strip after fence balancing in case a closed fence still looks like a leak.
        s = stripLeakedToolCode(s);
    }
    if (options?.trim !== false) {
        s = s.trim();
    }
    return s;
}

/**
 * Fence markers at the start of a line: three or more backticks, or three or more
 * tildes, optionally indented up to three spaces.
 */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/gm;

/**
 * Close an unclosed fenced code block so streaming markdown does not swallow the
 * rest as mono code. Tracks the open fence instead of counting markers, so a
 * streamed ````` example, a `~~~` block, or an info string on the opener all
 * close with the right marker — counting `^```` used to leave them open.
 */
function balanceMarkdownFences(text: string): string {
    let open: { char: string; len: number } | null = null;
    FENCE_LINE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FENCE_LINE.exec(text)) !== null) {
        const marker = match[1];
        if (!marker) continue;
        const info = (match[2] ?? "").trim();
        if (open) {
            // A closer has the same character, at least the opener's length, and
            // no info string (CommonMark); anything else is just content.
            if (marker[0] === open.char && marker.length >= open.len && info === "") {
                open = null;
            }
            continue;
        }
        // A backtick fence's info string cannot itself contain a backtick.
        if (marker[0] === "`" && info.includes("`")) continue;
        open = { char: marker.charAt(0), len: marker.length };
    }
    if (!open) return text;
    return `${text}\n${open.char.repeat(open.len)}`;
}
