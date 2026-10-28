/**
 * Zero-DOM-mutation sub-node text highlighting via the CSS Custom Highlight API
 * (`CSS.highlights` + `::highlight(chat-find)` / `::highlight(chat-find-active)`).
 *
 * Preserves React text nodes, avoids layout reflow, keeps user text selection intact,
 * and tracks owned `Highlight` instances so teardown never clobbers another owner.
 */

export const CHAT_FIND_HIGHLIGHT_NAME = "chat-find";
export const CHAT_FIND_ACTIVE_HIGHLIGHT_NAME = "chat-find-active";

const HIGHLIGHT_STYLE_ID = "bettershape-chat-find-highlights";

const IGNORED_TEXT_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "BR"]);

const SKIPPED_ANCESTOR_ATTRS = [
    "inert",
    "data-quote-skip",
    "data-find-skip",
    "data-chat-find-bar",
];

const BLOCK_ANCESTOR_SELECTOR =
    "p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, tr, td, th, div, section, article";

export interface DomMatchRange {
    range: Range;
    messageIndex: number;
}

interface TextSegment {
    node: Text;
    start: number;
    end: number;
}

interface MessageTextRun {
    messageIndex: number;
    text: string;
    segments: TextSegment[];
    lastBlock: Element | null;
    pendingGap: boolean;
}

interface CustomHighlightRegistry {
    get?(name: string): unknown;
    set(name: string, highlight: unknown): void;
    delete(name: string): boolean;
}

type HighlightConstructor = new (...ranges: AbstractRange[]) => unknown;

type HighlightApiHandle = {
    registry: CustomHighlightRegistry;
    HighlightCtor: HighlightConstructor;
};

type SyncChatHighlightOptions = {
    caseSensitive?: boolean;
    activeIndex?: number;
    targetMessageIndex?: number | null;
    targetOccurrenceInMessage?: number | null;
    targetMessageSearchText?: string | null;
    maxRanges?: number;
};

let ownedMatchesHighlight: unknown = null;
let ownedActiveHighlight: unknown = null;
let cachedOccurrenceAlignment: {
    messageIndex: number;
    matcherKey: string;
    runText: string;
    sourceText: string;
    domCount: number;
    srcToDom: Int32Array;
} | null = null;

/** Injects the `::highlight(...)` stylesheet into `document.head` once per document. */
const ensureHighlightStylesheet = (): void => {
    if (typeof document === "undefined") return;
    const head = document.head as HTMLHeadElement | null;
    if (!head || document.getElementById(HIGHLIGHT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = [
        `::highlight(${CHAT_FIND_HIGHLIGHT_NAME}) { background-color: color-mix(in srgb, var(--accent) 26%, transparent); color: var(--text-primary); }`,
        `::highlight(${CHAT_FIND_ACTIVE_HIGHLIGHT_NAME}) { background-color: color-mix(in srgb, var(--warning) 44%, var(--accent)); color: var(--text-on-accent); }`,
    ].join("\n");
    head.appendChild(style);
};

/** Resolves the browser CSS Custom Highlight API handles when supported. */
const getHighlightApi = (): HighlightApiHandle | null => {
    if (typeof window === "undefined") return null;
    const cssObj = (
        window as unknown as { CSS?: { highlights?: CustomHighlightRegistry } }
    ).CSS;
    const HighlightCtor = (
        window as unknown as { Highlight?: HighlightConstructor }
    ).Highlight;
    if (!cssObj?.highlights || typeof HighlightCtor !== "function") return null;
    return { registry: cssObj.highlights, HighlightCtor };
};

/** Returns true when the browser supports the CSS Custom Highlight API. */
export const isCssHighlightsSupported = (): boolean =>
    getHighlightApi() !== null;

/** Checks whether a lookup returned a defined non-null highlight instance. */
const isDefinedHighlight = (value: unknown): boolean =>
    value !== undefined && value !== null;

/** Deletes `name` from `registry` only when `ownedInstance` is still the registered highlight. */
const deleteOwnedHighlight = (
    registry: CustomHighlightRegistry,
    name: string,
    ownedInstance: unknown,
): void => {
    if (!ownedInstance) return;
    if (typeof registry.get === "function") {
        const current = registry.get(name);
        if (isDefinedHighlight(current) && !Object.is(current, ownedInstance)) {
            return;
        }
    }
    registry.delete(name);
};

/** Removes owned chat transcript highlight entries without disturbing other highlights. */
export const clearChatDomHighlights = (): void => {
    cachedOccurrenceAlignment = null;
    const api = getHighlightApi();
    if (api) {
        deleteOwnedHighlight(
            api.registry,
            CHAT_FIND_HIGHLIGHT_NAME,
            ownedMatchesHighlight,
        );
        deleteOwnedHighlight(
            api.registry,
            CHAT_FIND_ACTIVE_HIGHLIGHT_NAME,
            ownedActiveHighlight,
        );
    }
    ownedMatchesHighlight = null;
    ownedActiveHighlight = null;
};

const SEARCHABLE_BUTTON_CLASSES = [
    "group/line",
    "underline",
    "chat-text",
    "chat-link-chip",
] as const;

/** Checks whether a `<button>` carries searchable transcript prose, path links, or action labels. */
const isSearchableTranscriptButton = (el: HTMLElement): boolean =>
    el.hasAttribute("data-chat-find-text") ||
    el.hasAttribute("aria-expanded") ||
    SEARCHABLE_BUTTON_CLASSES.some((cls) => el.classList.contains(cls));

/** Checks whether an ancestor element represents non-searchable chrome or hidden text. */
const isNonSearchableChromeElement = (el: HTMLElement): boolean => {
    const tag = el.tagName;
    if (tag === "KBD") return true;
    if (tag === "BUTTON" && !isSearchableTranscriptButton(el)) return true;
    return SKIPPED_ANCESTOR_ATTRS.some((attr) => el.hasAttribute(attr));
};

/** Checks whether an ancestor element is visually or semantically hidden from find-in-chat. */
const isHiddenFromChatFind = (el: HTMLElement): boolean =>
    el.getAttribute("aria-hidden") === "true" ||
    el.classList.contains("t-think-sizer") ||
    el.classList.contains("sr-only");

/** Checks whether any ancestor between `parent` and `root` excludes `node` from search. */
const hasExcludedAncestor = (parent: HTMLElement, root: HTMLElement): boolean => {
    let cur: HTMLElement | null = parent;
    while (cur && cur !== root) {
        if (isNonSearchableChromeElement(cur) || isHiddenFromChatFind(cur)) {
            return true;
        }
        cur = cur.parentElement;
    }
    return false;
};

/** Checks whether a DOM `Text` node should be skipped when indexing message prose. */
const shouldSkipTextNode = (node: Text, root: HTMLElement): boolean => {
    const parent = node.parentElement;
    if (!parent || IGNORED_TEXT_TAGS.has(parent.tagName)) return true;
    return hasExcludedAncestor(parent, root);
};

/** Resolves the numeric `data-chat-message-index` owning `el`, or `null` outside rows. */
const resolveElementMessageIndex = (el: Element | null): number | null => {
    const msgEl = el?.closest<HTMLElement>("[data-chat-message-index]") ?? null;
    const parsed = msgEl
        ? Number(msgEl.getAttribute("data-chat-message-index"))
        : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
};

/** Resolves the numeric `data-chat-message-index` owning `textNode`, or `null` outside rows. */
const resolveMessageIndex = (textNode: Text): number | null =>
    resolveElementMessageIndex(textNode.parentElement);

/** Checks whether `el` itself begins an excluded subtree for find-in-chat indexing. */
const isDirectlyExcludedElement = (el: HTMLElement): boolean =>
    IGNORED_TEXT_TAGS.has(el.tagName) ||
    isNonSearchableChromeElement(el) ||
    isHiddenFromChatFind(el);

/** Gets or creates a `MessageTextRun` bucket for `messageIndex`. */
const getOrCreateMessageRun = (
    byIndex: Map<number, MessageTextRun>,
    runs: MessageTextRun[],
    messageIndex: number,
): MessageTextRun => {
    const existing = byIndex.get(messageIndex);
    if (existing) return existing;
    const created: MessageTextRun = {
        messageIndex,
        text: "",
        segments: [],
        lastBlock: null,
        pendingGap: false,
    };
    byIndex.set(messageIndex, created);
    runs.push(created);
    return created;
};

/** Checks whether `run` moved into a new block ancestor and needs a newline separator. */
const shouldAppendBlockNewline = (
    run: MessageTextRun,
    block: Element,
): boolean =>
    Boolean(
        run.lastBlock && run.lastBlock !== block && !run.text.endsWith("\n"),
    );

/** Inserts `\0` (inline excluded gap) or `\n` (block boundary) before the next searchable segment. */
const appendRunSeparatorIfNeeded = (
    run: MessageTextRun,
    block: Element,
): void => {
    if (run.pendingGap) {
        if (run.text.length > 0 && !run.text.endsWith("\0")) {
            run.text += "\0";
        }
        run.pendingGap = false;
        return;
    }
    if (shouldAppendBlockNewline(run, block)) {
        run.text += "\n";
    }
};

/** Appends a single `Text` node and optional inter-block or excluded-gap separator to `run`. */
const appendNodeToMessageRun = (
    run: MessageTextRun,
    textNode: Text,
    raw: string,
    container: HTMLElement,
): void => {
    const block =
        textNode.parentElement?.closest(BLOCK_ANCESTOR_SELECTOR) ?? container;
    appendRunSeparatorIfNeeded(run, block);
    const start = run.text.length;
    run.text += raw;
    run.segments.push({ node: textNode, start, end: start + raw.length });
    run.lastBlock = block;
};

/** Resolves `(messageIndex, raw)` for a searchable DOM text node, or `null` when excluded. */
const extractIndexedNodeText = (
    textNode: Text,
    container: HTMLElement,
): { messageIndex: number; raw: string } | null => {
    const raw = textNode.nodeValue;
    if (!raw || shouldSkipTextNode(textNode, container)) return null;
    const messageIndex = resolveMessageIndex(textNode);
    return messageIndex === null ? null : { messageIndex, raw };
};

/** Marks a `pendingGap` on the active message run when `el` is an excluded inline subtree. */
const markExcludedElementGap = (
    el: HTMLElement,
    byIndex: Map<number, MessageTextRun>,
): void => {
    const messageIndex = resolveElementMessageIndex(el);
    if (messageIndex === null) return;
    const run = byIndex.get(messageIndex);
    if (run && run.text.length > 0) {
        run.pendingGap = true;
    }
};

/** TreeWalker node filter that prunes excluded subtrees while recording inline run gaps. */
const acceptHighlightWalkerNode = (
    node: Node,
    byIndex: Map<number, MessageTextRun>,
): number => {
    if (node.nodeType === Node.ELEMENT_NODE) {
        if (node instanceof HTMLElement && isDirectlyExcludedElement(node)) {
            markExcludedElementGap(node, byIndex);
            return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
    }
    return NodeFilter.FILTER_ACCEPT;
};

/** Collects indexed message text runs across `container`, skipping unindexed chrome banners. */
const collectMessageTextRuns = (container: HTMLElement): MessageTextRun[] => {
    const runs: MessageTextRun[] = [];
    const byIndex = new Map<number, MessageTextRun>();
    const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        { acceptNode: (node) => acceptHighlightWalkerNode(node, byIndex) },
    );
    let current = walker.nextNode();
    while (current) {
        const textNode = current as Text;
        const entry = extractIndexedNodeText(textNode, container);
        if (entry) {
            const run = getOrCreateMessageRun(byIndex, runs, entry.messageIndex);
            appendNodeToMessageRun(run, textNode, entry.raw, container);
        }
        current = walker.nextNode();
    }
    return runs;
};

/** Checks whether `seg` precedes `offset` during binary search (`isEnd` controls boundary tie-break). */
const isSegmentBeforeOffset = (
    seg: TextSegment,
    offset: number,
    isEnd: boolean,
): boolean => (isEnd ? seg.end < offset : seg.end <= offset);

/** Clamps `offset` into the local `[0, nodeLength]` character range of `found`. */
const toDomBoundaryPoint = (
    found: TextSegment,
    offset: number,
): { node: Text; offset: number } => {
    const maxLen = found.node.nodeValue?.length ?? 0;
    const localOffset = Math.min(Math.max(0, offset - found.start), maxLen);
    return { node: found.node, offset: localOffset };
};

/** Binary-searches `segments` to map a flat run offset back to a `{ node, offset }` boundary. */
const locateDomBoundary = (
    segments: readonly TextSegment[],
    offset: number,
    isEnd: boolean,
): { node: Text; offset: number } | null => {
    let lo = 0;
    let hi = segments.length - 1;
    let found: TextSegment | undefined;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const seg = segments.at(mid);
        if (!seg) break;
        if (isSegmentBeforeOffset(seg, offset, isEnd)) {
            lo = mid + 1;
        } else {
            found = seg;
            hi = mid - 1;
        }
    }
    return found ? toDomBoundaryPoint(found, offset) : null;
};

/** Constructs a live DOM `Range` spanning `[matchStart, matchEnd]` within `segments`. */
const createRunMatchRange = (
    segments: readonly TextSegment[],
    matchStart: number,
    matchEnd: number,
): Range | null => {
    const startPos = locateDomBoundary(segments, matchStart, false);
    const endPos = locateDomBoundary(segments, matchEnd, true);
    if (!startPos || !endPos) return null;
    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    return range;
};

/** Escapes regex metacharacters and compiles a global literal matcher for `trimmed`. */
const buildQueryMatcher = (trimmed: string, caseSensitive: boolean): RegExp => {
    const pattern = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(pattern, caseSensitive ? "g" : "gi");
};

const CONTEXT_WINDOW_CHARS = 32;

type TextSpan = { start: number; end: number };
type RunRangeHit = { range: Range; start: number; end: number };
type SpanContext = { before: string; after: string };
type AlignmentTable = {
    dp: Int32Array;
    actions: Uint8Array;
    rows: number;
    cols: number;
};

/** Collects up to `limit` non-empty regex match spans inside `text`. */
const collectNonEmptyMatchSpans = (
    text: string,
    matcher: RegExp,
    limit: number,
): TextSpan[] => {
    const spans: TextSpan[] = [];
    for (const match of text.matchAll(matcher)) {
        if (spans.length >= limit) break;
        const len = match[0].length;
        if (len > 0) {
            spans.push({ start: match.index, end: match.index + len });
        }
    }
    return spans;
};

/** Maps non-empty regex matches inside `run` into live DOM `Range` hits. */
const collectRunRangeHits = (
    run: MessageTextRun,
    matcher: RegExp,
    remaining: number,
): RunRangeHit[] => {
    const hits: RunRangeHit[] = [];
    for (const span of collectNonEmptyMatchSpans(run.text, matcher, remaining)) {
        const range = createRunMatchRange(run.segments, span.start, span.end);
        if (range) {
            hits.push({ range, start: span.start, end: span.end });
        }
    }
    return hits;
};

/** Safely reads `hits[index].range` when `index` is in bounds, or `null`. */
const getHitRangeAtIndex = (
    hits: readonly RunRangeHit[],
    index: number,
): Range | null =>
    index >= 0 && index < hits.length ? hits[index].range : null;

/** Strips inline Markdown emphasis/code delimiters and collapses whitespace for context alignment. */
const collapseContextSpaces = (value: string): string =>
    value.replace(/[*_`~]+/gu, "").replace(/\s+/gu, " ");

/** Extracts normalized `(before, after)` windows around `span` in `text`. */
const extractSpanContext = (text: string, span: TextSpan): SpanContext => ({
    before: collapseContextSpaces(
        text.slice(Math.max(0, span.start - CONTEXT_WINDOW_CHARS), span.start),
    ),
    after: collapseContextSpaces(
        text.slice(
            span.end,
            Math.min(text.length, span.end + CONTEXT_WINDOW_CHARS),
        ),
    ),
});

/** Counts matching trailing characters shared by `a` and `b`. */
const commonSuffixLength = (a: string, b: string): number => {
    const limit = Math.min(a.length, b.length);
    let len = 0;
    while (
        len < limit &&
        a.charCodeAt(a.length - 1 - len) === b.charCodeAt(b.length - 1 - len)
    ) {
        len += 1;
    }
    return len;
};

/** Counts matching leading characters shared by `a` and `b`. */
const commonPrefixLength = (a: string, b: string): number => {
    const limit = Math.min(a.length, b.length);
    let len = 0;
    while (len < limit && a.charCodeAt(len) === b.charCodeAt(len)) {
        len += 1;
    }
    return len;
};

/** Returns `weight` when both `a` and `b` are empty strings, otherwise `0`. */
const bothEmptyWeight = (a: string, b: string, weight: number): number =>
    a.length === 0 && b.length === 0 ? weight : 0;

/** Scores end-of-message / start-of-message boundary agreement when context is empty. */
const scoreBoundaryTieBreak = (src: SpanContext, dom: SpanContext): number =>
    bothEmptyWeight(src.after, dom.after, 3) +
    bothEmptyWeight(src.before, dom.before, 1);

/** Scores surrounding text similarity between a source match and a rendered DOM match. */
const scoreContextAlignment = (src: SpanContext, dom: SpanContext): number => {
    const charOverlap =
        commonSuffixLength(src.before, dom.before) +
        commonPrefixLength(src.after, dom.after);
    return charOverlap * 4 + scoreBoundaryTieBreak(src, dom);
};

/** Computes alignment gain for pairing `src` with `dom` (`-1` when incompatible). */
const computePairMatchGain = (src: SpanContext, dom: SpanContext): number => {
    const score = scoreContextAlignment(src, dom);
    return score > 0 ? 1000 + score : -1;
};

/** Selects the highest-scoring monotonic alignment transition (`0=skipS, 1=skipD, 2=pair`). */
const pickBestAlignmentStep = (
    skipS: number,
    skipD: number,
    takeDS: number,
): { best: number; action: number } => {
    if (takeDS >= skipS && takeDS >= skipD) {
        return { best: takeDS, action: 2 };
    }
    return skipS >= skipD
        ? { best: skipS, action: 0 }
        : { best: skipD, action: 1 };
};

/** Evaluates and stores the optimal transition at `(d, s)` inside `table`. */
const updateAlignmentCell = (
    table: AlignmentTable,
    d: number,
    s: number,
    gain: number,
): void => {
    const idx = d * table.cols + s;
    const skipS = table.dp[idx + 1];
    const skipD = table.dp[idx + table.cols];
    const takeDS = gain >= 0 ? gain + table.dp[idx + table.cols + 1] : -1;
    const step = pickBestAlignmentStep(skipS, skipD, takeDS);
    table.dp[idx] = step.best;
    table.actions[idx] = step.action;
};

/** Builds the monotonic alignment DP table between `domCtxs` and `srcCtxs`. */
const buildAlignmentTable = (
    domCtxs: readonly SpanContext[],
    srcCtxs: readonly SpanContext[],
): AlignmentTable => {
    const rows = domCtxs.length + 1;
    const cols = srcCtxs.length + 1;
    const table: AlignmentTable = {
        dp: new Int32Array(rows * cols),
        actions: new Uint8Array(rows * cols),
        rows,
        cols,
    };
    for (let d = domCtxs.length - 1; d >= 0; d -= 1) {
        for (let s = srcCtxs.length - 1; s >= 0; s -= 1) {
            const gain = computePairMatchGain(srcCtxs[s], domCtxs[d]);
            updateAlignmentCell(table, d, s, gain);
        }
    }
    return table;
};

/** Advances `(d, s)` by one transition action (`0=skipS, 1=skipD, 2=pair`). */
const advanceAlignmentCursor = (
    d: number,
    s: number,
    action: number,
): [number, number] => {
    if (action === 2) return [d + 1, s + 1];
    return action === 0 ? [d, s + 1] : [d + 1, s];
};

/** Checks whether `(d, s)` remains inside the non-terminal region of `table`. */
const isInsideAlignmentBounds = (
    table: AlignmentTable,
    d: number,
    s: number,
): boolean => d < table.rows - 1 && s < table.cols - 1;

const MAX_EXACT_ALIGNMENT_SPAN = 48;
const GREEDY_ALIGNMENT_LOOKAHEAD = 16;

/** Checks whether `src` and `dom` share identical non-trivial surrounding context. */
const hasExactNonTrivialContext = (src: SpanContext, dom: SpanContext): boolean =>
    src.before.length + src.after.length >= 8 &&
    src.before === dom.before &&
    src.after === dom.after;

/** Peels matching occurrences from the front of `domCtxs` and `srcCtxs` in linear time. */
const peelPrefixMatches = (
    domCtxs: readonly SpanContext[],
    srcCtxs: readonly SpanContext[],
    srcToDom: Int32Array,
): number => {
    const limit = Math.min(domCtxs.length, srcCtxs.length);
    let k = 0;
    while (k < limit && hasExactNonTrivialContext(srcCtxs[k], domCtxs[k])) {
        srcToDom[k] = k;
        k += 1;
    }
    return k;
};

/** Peels matching occurrences from the back of `domCtxs` and `srcCtxs` in linear time. */
const peelSuffixMatches = (
    domCtxs: readonly SpanContext[],
    srcCtxs: readonly SpanContext[],
    prefixLen: number,
    srcToDom: Int32Array,
): number => {
    const maxSuffix = Math.min(domCtxs.length, srcCtxs.length) - prefixLen;
    let k = 0;
    while (
        k < maxSuffix &&
        hasExactNonTrivialContext(
            srcCtxs[srcCtxs.length - 1 - k],
            domCtxs[domCtxs.length - 1 - k],
        )
    ) {
        srcToDom[srcCtxs.length - 1 - k] = domCtxs.length - 1 - k;
        k += 1;
    }
    return k;
};

/** Writes every paired `(s, d)` along the optimal path of `table` into `srcToDom`. */
const populateAlignedPairsFromTable = (
    table: AlignmentTable,
    dOffset: number,
    sOffset: number,
    srcToDom: Int32Array,
): void => {
    let d = 0;
    let s = 0;
    while (isInsideAlignmentBounds(table, d, s)) {
        const action = table.actions[d * table.cols + s];
        if (action === 2) srcToDom[sOffset + s] = dOffset + d;
        [d, s] = advanceAlignmentCursor(d, s, action);
    }
};

/** Finds the highest-scoring source match within `[sFrom, sTo)` for `domCtx`, or `-1`. */
const findBestWindowedSourceMatch = (
    domCtx: SpanContext,
    srcCtxs: readonly SpanContext[],
    sFrom: number,
    sTo: number,
): number => {
    let bestIdx = -1;
    let bestScore = 0;
    for (let s = sFrom; s < sTo; s += 1) {
        const score = scoreContextAlignment(srcCtxs[s], domCtx);
        if (score > bestScore) {
            bestScore = score;
            bestIdx = s;
        }
    }
    return bestIdx;
};

/** Aligns large residual slices monotonically using a bounded lookahead window. */
const populateWindowedGreedyAlignment = (
    domCtxs: readonly SpanContext[],
    srcCtxs: readonly SpanContext[],
    dOffset: number,
    sOffset: number,
    srcToDom: Int32Array,
): void => {
    let sCursor = 0;
    for (let d = 0; d < domCtxs.length && sCursor < srcCtxs.length; d += 1) {
        const sEnd = Math.min(srcCtxs.length, sCursor + GREEDY_ALIGNMENT_LOOKAHEAD);
        const matchedS = findBestWindowedSourceMatch(domCtxs[d], srcCtxs, sCursor, sEnd);
        if (matchedS !== -1) {
            srcToDom[sOffset + matchedS] = dOffset + d;
            sCursor = matchedS + 1;
        }
    }
};

/** Checks whether both slices fit inside the exact DP budget (`48 × 48`). */
const fitsExactAlignmentBudget = (
    domLen: number,
    srcLen: number,
): boolean =>
    domLen <= MAX_EXACT_ALIGNMENT_SPAN && srcLen <= MAX_EXACT_ALIGNMENT_SPAN;

/** Aligns the unpeeled interior slice via small exact DP or bounded greedy lookahead. */
const alignResidualContextSlice = (
    domMid: readonly SpanContext[],
    srcMid: readonly SpanContext[],
    offset: number,
    srcToDom: Int32Array,
): void => {
    if (domMid.length * srcMid.length === 0) return;
    if (fitsExactAlignmentBudget(domMid.length, srcMid.length)) {
        const table = buildAlignmentTable(domMid, srcMid);
        populateAlignedPairsFromTable(table, offset, offset, srcToDom);
        return;
    }
    populateWindowedGreedyAlignment(domMid, srcMid, offset, offset, srcToDom);
};

/** Builds a source-occurrence-to-DOM-index lookup table in bounded linear/windowed time. */
const computeSourceToDomMap = (
    runText: string,
    runHits: readonly RunRangeHit[],
    sourceText: string,
    srcSpans: readonly TextSpan[],
): Int32Array => {
    const srcToDom = new Int32Array(srcSpans.length).fill(-1);
    const domCtxs = runHits.map((hit) => extractSpanContext(runText, hit));
    const srcCtxs = srcSpans.map((sp) => extractSpanContext(sourceText, sp));
    const prefix = peelPrefixMatches(domCtxs, srcCtxs, srcToDom);
    const suffix = peelSuffixMatches(domCtxs, srcCtxs, prefix, srcToDom);
    alignResidualContextSlice(
        domCtxs.slice(prefix, domCtxs.length - suffix),
        srcCtxs.slice(prefix, srcCtxs.length - suffix),
        prefix,
        srcToDom,
    );
    return srcToDom;
};

/** Builds an identity `0..count-1` lookup table when rendered and source counts match. */
const buildIdentityOccurrenceMap = (count: number): Int32Array => {
    const map = new Int32Array(count);
    for (let i = 0; i < count; i += 1) map[i] = i;
    return map;
};

/** Checks whether cached text inputs match `runText`, `sourceText`, and `domCount`. */
const hasMatchingCachedTexts = (
    cache: NonNullable<typeof cachedOccurrenceAlignment>,
    runText: string,
    sourceText: string,
    domCount: number,
): boolean =>
    cache.domCount === domCount &&
    cache.runText === runText &&
    cache.sourceText === sourceText;

/** Checks whether `cachedOccurrenceAlignment` can be reused for this navigation frame. */
const canReuseAlignmentCache = (
    messageIndex: number,
    matcherKey: string,
    runText: string,
    sourceText: string,
    domCount: number,
): boolean =>
    cachedOccurrenceAlignment !== null &&
    cachedOccurrenceAlignment.messageIndex === messageIndex &&
    cachedOccurrenceAlignment.matcherKey === matcherKey &&
    hasMatchingCachedTexts(cachedOccurrenceAlignment, runText, sourceText, domCount);

/** Returns a memoized `srcToDom` occurrence lookup table for `(messageIndex, matcher)`. */
const resolveSourceToDomMap = (
    messageIndex: number,
    runText: string,
    runHits: readonly RunRangeHit[],
    sourceText: string,
    matcher: RegExp,
): Int32Array => {
    const matcherKey = `${matcher.flags}:${matcher.source}`;
    if (
        cachedOccurrenceAlignment &&
        canReuseAlignmentCache(
            messageIndex,
            matcherKey,
            runText,
            sourceText,
            runHits.length,
        )
    ) {
        return cachedOccurrenceAlignment.srcToDom;
    }
    const srcSpans = collectNonEmptyMatchSpans(sourceText, matcher, 500);
    const srcToDom =
        runHits.length === srcSpans.length
            ? buildIdentityOccurrenceMap(srcSpans.length)
            : computeSourceToDomMap(runText, runHits, sourceText, srcSpans);
    cachedOccurrenceAlignment = {
        messageIndex,
        matcherKey,
        runText,
        sourceText,
        domCount: runHits.length,
        srcToDom,
    };
    return srcToDom;
};

/** Reads `srcToDom[targetOcc]`, returning `-1` when `targetOcc` is out of bounds. */
const readMappedDomIndex = (srcToDom: Int32Array, targetOcc: number): number =>
    targetOcc >= 0 && targetOcc < srcToDom.length ? srcToDom[targetOcc] : -1;

/** Resolves the target occurrence index when `run` is the targeted message, else `-1`. */
const extractRunTargetOccurrence = (
    runMessageIndex: number,
    options: SyncChatHighlightOptions,
): number =>
    options.targetMessageIndex === runMessageIndex &&
    typeof options.targetOccurrenceInMessage === "number"
        ? options.targetOccurrenceInMessage
        : -1;

/** Resolves the active `Range` inside `run` when `run.messageIndex` matches `options`. */
const resolveTargetRangeInRun = (
    run: MessageTextRun,
    runHits: readonly RunRangeHit[],
    matcher: RegExp,
    options: SyncChatHighlightOptions,
): Range | null => {
    const targetOcc = extractRunTargetOccurrence(run.messageIndex, options);
    if (targetOcc < 0) return null;
    if (typeof options.targetMessageSearchText !== "string") {
        return getHitRangeAtIndex(runHits, targetOcc);
    }
    const srcToDom = resolveSourceToDomMap(
        run.messageIndex,
        run.text,
        runHits,
        options.targetMessageSearchText,
        matcher,
    );
    return getHitRangeAtIndex(runHits, readMappedDomIndex(srcToDom, targetOcc));
};

/** Appends up to `limit` hits from `runHits` into `collected`. */
const appendCappedRunHits = (
    collected: DomMatchRange[],
    runHits: readonly RunRangeHit[],
    messageIndex: number,
    limit: number,
): void => {
    const count = Math.min(runHits.length, Math.max(0, limit));
    for (let i = 0; i < count; i += 1) {
        collected.push({ range: runHits[i].range, messageIndex });
    }
};

/** Collects up to `maxRanges` regex matches inside a single `MessageTextRun`. */
const collectMatchesInSingleRun = (
    run: MessageTextRun,
    matcher: RegExp,
    maxRanges: number,
    options: SyncChatHighlightOptions,
    collected: DomMatchRange[],
): Range | null => {
    const isTargetRun = options.targetMessageIndex === run.messageIndex;
    const remaining = maxRanges - collected.length;
    if (remaining <= 0 && !isTargetRun) return null;
    const scanBudget = isTargetRun ? Math.max(remaining, 500) : remaining;
    const runHits = collectRunRangeHits(run, matcher, scanBudget);
    appendCappedRunHits(collected, runHits, run.messageIndex, remaining);
    return resolveTargetRangeInRun(run, runHits, matcher, options);
};

/** Checks whether scanning should continue for passive collection or an unresolved target message. */
const shouldContinueScanningRuns = (
    collectedLen: number,
    maxRanges: number,
    matchedTargetRange: Range | null,
    targetMessageIndex: number | null | undefined,
): boolean => {
    if (collectedLen < maxRanges) return true;
    return typeof targetMessageIndex === "number" && matchedTargetRange === null;
};

/** Preserves the first resolved `Range` across runs. */
const keepFirstRange = (
    existing: Range | null,
    candidate: Range | null,
): Range | null => existing ?? candidate;

/** Collects match ranges across all `runs` up to `maxRanges` while always resolving `targetMessageIndex`. */
const collectAllDomMatchRanges = (
    runs: MessageTextRun[],
    matcher: RegExp,
    maxRanges: number,
    options: SyncChatHighlightOptions,
): { collected: DomMatchRange[]; matchedTargetRange: Range | null } => {
    const collected: DomMatchRange[] = [];
    let matchedTargetRange: Range | null = null;
    for (const run of runs) {
        if (
            !shouldContinueScanningRuns(
                collected.length,
                maxRanges,
                matchedTargetRange,
                options.targetMessageIndex,
            )
        ) {
            break;
        }
        const hit = collectMatchesInSingleRun(
            run,
            matcher,
            maxRanges,
            options,
            collected,
        );
        matchedTargetRange = keepFirstRange(matchedTargetRange, hit);
    }
    return { collected, matchedTargetRange };
};

/** Resolves the fallback `Range` at `activeIndex` when `collected` is non-empty. */
const resolveClampedRangeAt = (
    collected: DomMatchRange[],
    activeIndex: number | undefined,
): Range | null => {
    if (collected.length === 0) return null;
    const clamped = Math.min(
        Math.max(0, activeIndex ?? 0),
        collected.length - 1,
    );
    return collected[clamped]?.range ?? null;
};

/** Resolves the first `Range` inside `targetMessageIndex` when specified. */
const findFirstRangeInMessage = (
    collected: DomMatchRange[],
    targetMessageIndex: number | null | undefined,
): Range | null => {
    if (typeof targetMessageIndex !== "number") return null;
    return (
        collected.find((item) => item.messageIndex === targetMessageIndex)
            ?.range ?? null
    );
};

/** Resolves the active highlighted `Range` from target message occurrence or `activeIndex`. */
const resolveActiveHighlightRange = (
    collected: DomMatchRange[],
    matchedTargetRange: Range | null,
    options: SyncChatHighlightOptions,
): Range | null => {
    if (matchedTargetRange) return matchedTargetRange;
    if (typeof options.targetMessageIndex === "number") {
        return typeof options.targetOccurrenceInMessage === "number"
            ? null
            : findFirstRangeInMessage(collected, options.targetMessageIndex);
    }
    return resolveClampedRangeAt(collected, options.activeIndex);
};

/** Registers or clears passive `chat-find` highlights for `collected`. */
const syncPassiveMatchesHighlight = (
    api: HighlightApiHandle,
    collected: DomMatchRange[],
): void => {
    if (collected.length === 0) {
        deleteOwnedHighlight(
            api.registry,
            CHAT_FIND_HIGHLIGHT_NAME,
            ownedMatchesHighlight,
        );
        ownedMatchesHighlight = null;
        return;
    }
    const matchesInstance = new api.HighlightCtor(
        ...collected.map((item) => item.range),
    );
    ownedMatchesHighlight = matchesInstance;
    api.registry.set(CHAT_FIND_HIGHLIGHT_NAME, matchesInstance);
};

/** Registers or clears `CSS.highlights` entries for `collected` and `activeRange`. */
const paintHighlightRegistry = (
    api: HighlightApiHandle,
    collected: DomMatchRange[],
    activeRange: Range | null,
): void => {
    if (collected.length === 0 && !activeRange) {
        clearChatDomHighlights();
        return;
    }
    ensureHighlightStylesheet();
    syncPassiveMatchesHighlight(api, collected);
    if (activeRange) {
        const activeInstance = new api.HighlightCtor(activeRange);
        ownedActiveHighlight = activeInstance;
        api.registry.set(CHAT_FIND_ACTIVE_HIGHLIGHT_NAME, activeInstance);
    } else {
        deleteOwnedHighlight(
            api.registry,
            CHAT_FIND_ACTIVE_HIGHLIGHT_NAME,
            ownedActiveHighlight,
        );
        ownedActiveHighlight = null;
    }
};

/** Checks whether highlight synchronization can run for `container` and `trimmed` query. */
const canSyncDomHighlights = (
    container: HTMLElement | null,
    trimmed: string,
): container is HTMLElement =>
    Boolean(container && trimmed && typeof document !== "undefined");

/**
 * Collects DOM `Range`s for every visible text match inside `container`,
 * paints `CSS.highlights` when supported, and returns the ordered ranges so the
 * caller can scroll precisely to `ranges[activeIndex].range.getBoundingClientRect()`.
 */
export const syncChatDomHighlights = (
    container: HTMLElement | null,
    query: string,
    options: SyncChatHighlightOptions = {},
): { ranges: DomMatchRange[]; activeRange: Range | null } => {
    const trimmed = query.trim();
    if (!canSyncDomHighlights(container, trimmed)) {
        clearChatDomHighlights();
        return { ranges: [], activeRange: null };
    }

    const maxRanges = options.maxRanges ?? 500;
    const matcher = buildQueryMatcher(trimmed, Boolean(options.caseSensitive));
    const runs = collectMessageTextRuns(container);
    const { collected, matchedTargetRange } = collectAllDomMatchRanges(
        runs,
        matcher,
        maxRanges,
        options,
    );
    const activeRange = resolveActiveHighlightRange(
        collected,
        matchedTargetRange,
        options,
    );

    const api = getHighlightApi();
    if (api) {
        paintHighlightRegistry(api, collected, activeRange);
    }

    return { ranges: collected, activeRange };
};
