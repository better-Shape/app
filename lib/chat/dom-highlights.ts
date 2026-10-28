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

/** Collapses runs of whitespace into single spaces for context alignment. */
const collapseContextSpaces = (value: string): string =>
    value.replace(/\s+/gu, " ");

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

/** Traces `table` to find the DOM hit index aligned to `targetSrcIdx`, or `-1`. */
const traceAlignedDomIndex = (
    table: AlignmentTable,
    targetSrcIdx: number,
): number => {
    let d = 0;
    let s = 0;
    while (isInsideAlignmentBounds(table, d, s)) {
        const action = table.actions[d * table.cols + s];
        if (action === 2 && s === targetSrcIdx) return d;
        [d, s] = advanceAlignmentCursor(d, s, action);
    }
    return -1;
};

/** Resolves the DOM `Range` matching `targetOcc` via monotonic source-context alignment. */
const lookupAlignedOccurrenceRange = (
    runText: string,
    runHits: readonly RunRangeHit[],
    sourceText: string,
    matcher: RegExp,
): ((targetOcc: number) => Range | null) => {
    const srcSpans = collectNonEmptyMatchSpans(sourceText, matcher, 500);
    if (runHits.length === srcSpans.length) {
        return (targetOcc) => getHitRangeAtIndex(runHits, targetOcc);
    }
    const domCtxs = runHits.map((hit) => extractSpanContext(runText, hit));
    const srcCtxs = srcSpans.map((sp) => extractSpanContext(sourceText, sp));
    const table = buildAlignmentTable(domCtxs, srcCtxs);
    return (targetOcc) => {
        if (targetOcc < 0 || targetOcc >= srcSpans.length) return null;
        return getHitRangeAtIndex(
            runHits,
            traceAlignedDomIndex(table, targetOcc),
        );
    };
};

/** Resolves the active `Range` inside `run` when `run.messageIndex` matches `options`. */
const resolveTargetRangeInRun = (
    run: MessageTextRun,
    runHits: readonly RunRangeHit[],
    matcher: RegExp,
    options: SyncChatHighlightOptions,
): Range | null => {
    if (options.targetMessageIndex !== run.messageIndex) return null;
    const targetOcc = options.targetOccurrenceInMessage;
    if (typeof targetOcc !== "number") return null;
    if (typeof options.targetMessageSearchText !== "string") {
        return getHitRangeAtIndex(runHits, targetOcc);
    }
    return lookupAlignedOccurrenceRange(
        run.text,
        runHits,
        options.targetMessageSearchText,
        matcher,
    )(targetOcc);
};

/** Collects up to `maxRanges` regex matches inside a single `MessageTextRun`. */
const collectMatchesInSingleRun = (
    run: MessageTextRun,
    matcher: RegExp,
    maxRanges: number,
    options: SyncChatHighlightOptions,
    collected: DomMatchRange[],
): Range | null => {
    const remaining = maxRanges - collected.length;
    if (remaining <= 0) return null;
    const runHits = collectRunRangeHits(run, matcher, remaining);
    for (const hit of runHits) {
        collected.push({ range: hit.range, messageIndex: run.messageIndex });
    }
    return resolveTargetRangeInRun(run, runHits, matcher, options);
};

/** Collects match ranges across all `runs` up to `maxRanges`. */
const collectAllDomMatchRanges = (
    runs: MessageTextRun[],
    matcher: RegExp,
    maxRanges: number,
    options: SyncChatHighlightOptions,
): { collected: DomMatchRange[]; matchedTargetRange: Range | null } => {
    const collected: DomMatchRange[] = [];
    let matchedTargetRange: Range | null = null;
    for (const run of runs) {
        if (collected.length >= maxRanges) break;
        const hit = collectMatchesInSingleRun(
            run,
            matcher,
            maxRanges,
            options,
            collected,
        );
        if (!matchedTargetRange && hit) {
            matchedTargetRange = hit;
        }
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

/** Registers or clears `CSS.highlights` entries for `collected` and `activeRange`. */
const paintHighlightRegistry = (
    api: HighlightApiHandle,
    collected: DomMatchRange[],
    activeRange: Range | null,
): void => {
    if (collected.length === 0) {
        clearChatDomHighlights();
        return;
    }
    ensureHighlightStylesheet();
    const matchesInstance = new api.HighlightCtor(
        ...collected.map((item) => item.range),
    );
    ownedMatchesHighlight = matchesInstance;
    api.registry.set(CHAT_FIND_HIGHLIGHT_NAME, matchesInstance);
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
