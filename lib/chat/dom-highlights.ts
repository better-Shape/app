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

let ownedMatchesHighlight: unknown = null;
let ownedActiveHighlight: unknown = null;

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

interface CustomHighlightRegistry {
    get?(name: string): unknown;
    set(name: string, highlight: unknown): void;
    delete(name: string): boolean;
}

type HighlightConstructor = new (...ranges: AbstractRange[]) => unknown;

function getHighlightApi(): {
    registry: CustomHighlightRegistry;
    HighlightCtor: HighlightConstructor;
} | null {
    if (typeof window === "undefined") return null;
    const cssObj = (window as unknown as { CSS?: { highlights?: CustomHighlightRegistry } }).CSS;
    const HighlightCtor = (window as unknown as { Highlight?: HighlightConstructor }).Highlight;
    if (!cssObj?.highlights || typeof HighlightCtor !== "function") return null;
    return { registry: cssObj.highlights, HighlightCtor };
}

/** Returns true when the browser supports the CSS Custom Highlight API. */
export function isCssHighlightsSupported(): boolean {
    return getHighlightApi() !== null;
}

function deleteOwnedHighlight(
    registry: CustomHighlightRegistry,
    name: string,
    ownedInstance: unknown,
): void {
    if (ownedInstance === null) return;
    if (typeof registry.get === "function") {
        const current = registry.get(name);
        if (current !== undefined && current !== ownedInstance) return;
    }
    registry.delete(name);
}

/** Removes owned chat transcript highlight entries without disturbing other highlights. */
export function clearChatDomHighlights(): void {
    const api = getHighlightApi();
    if (!api) {
        ownedMatchesHighlight = null;
        ownedActiveHighlight = null;
        return;
    }
    deleteOwnedHighlight(api.registry, CHAT_FIND_HIGHLIGHT_NAME, ownedMatchesHighlight);
    deleteOwnedHighlight(api.registry, CHAT_FIND_ACTIVE_HIGHLIGHT_NAME, ownedActiveHighlight);
    ownedMatchesHighlight = null;
    ownedActiveHighlight = null;
}

function shouldSkipTextNode(node: Text, root: HTMLElement): boolean {
    const parent = node.parentElement;
    if (!parent) return true;
    const tag = parent.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
        return true;
    }
    let cur: HTMLElement | null = parent;
    while (cur && cur !== root) {
        const curTag = cur.tagName;
        if (
            (curTag === "BUTTON" && !cur.hasAttribute("data-chat-find-text")) ||
            curTag === "KBD" ||
            cur.hasAttribute("inert") ||
            cur.getAttribute("aria-hidden") === "true" ||
            cur.hasAttribute("data-quote-skip") ||
            cur.hasAttribute("data-find-skip") ||
            cur.hasAttribute("data-chat-find-bar") ||
            cur.classList.contains("t-think-sizer") ||
            cur.classList.contains("sr-only")
        ) {
            return true;
        }
        cur = cur.parentElement;
    }
    return false;
}

export interface DomMatchRange {
    range: Range;
    messageIndex: number | null;
}

interface TextSegment {
    node: Text;
    start: number;
    end: number;
}

interface MessageTextRun {
    messageIndex: number | null;
    text: string;
    segments: TextSegment[];
    lastBlock: Element | null;
}

const BLOCK_ANCESTOR_SELECTOR =
    "p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, tr, td, th, div, section, article";

const resolveMessageIndex = (textNode: Text): number | null => {
    const msgEl = textNode.parentElement?.closest<HTMLElement>("[data-chat-message-index]") ?? null;
    const parsed = msgEl ? Number(msgEl.getAttribute("data-chat-message-index")) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
};

const collectMessageTextRuns = (container: HTMLElement): MessageTextRun[] => {
    const runs: MessageTextRun[] = [];
    const byKey = new Map<string, MessageTextRun>();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
        const textNode = current as Text;
        current = walker.nextNode();
        const raw = textNode.nodeValue;
        if (!raw || shouldSkipTextNode(textNode, container)) continue;

        const messageIndex = resolveMessageIndex(textNode);
        const key = messageIndex === null ? "__root__" : String(messageIndex);
        let run = byKey.get(key);
        if (!run) {
            run = { messageIndex, text: "", segments: [], lastBlock: null };
            byKey.set(key, run);
            runs.push(run);
        }
        const block = textNode.parentElement?.closest(BLOCK_ANCESTOR_SELECTOR) ?? container;
        if (run.lastBlock && run.lastBlock !== block && !run.text.endsWith("\n")) {
            run.text += "\n";
        }
        const start = run.text.length;
        run.text += raw;
        run.segments.push({ node: textNode, start, end: start + raw.length });
        run.lastBlock = block;
    }
    return runs;
};

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
        const seg = segments[mid];
        if (!seg) break;
        const before = isEnd ? seg.end < offset : seg.end <= offset;
        if (before) {
            lo = mid + 1;
        } else {
            found = seg;
            hi = mid - 1;
        }
    }
    if (!found) return null;
    const maxLen = found.node.nodeValue?.length ?? 0;
    const localOffset = Math.min(Math.max(0, offset - found.start), maxLen);
    return { node: found.node, offset: localOffset };
};

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

const buildQueryMatcher = (trimmed: string, caseSensitive: boolean): RegExp => {
    const pattern = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(pattern, caseSensitive ? "g" : "gi");
};

/**
 * Collects DOM `Range`s for every visible text match inside `container`,
 * paints `CSS.highlights` when supported, and returns the ordered ranges so the
 * caller can scroll precisely to `ranges[activeIndex].range.getBoundingClientRect()`.
 */
export function syncChatDomHighlights(
    container: HTMLElement | null,
    query: string,
    options: {
        caseSensitive?: boolean;
        activeIndex?: number;
        targetMessageIndex?: number | null;
        targetOccurrenceInMessage?: number | null;
        maxRanges?: number;
    } = {},
): { ranges: DomMatchRange[]; activeRange: Range | null } {
    const trimmed = query.trim();
    if (!container || !trimmed || typeof document === "undefined") {
        clearChatDomHighlights();
        return { ranges: [], activeRange: null };
    }

    const maxRanges = options.maxRanges ?? 500;
    const matcher = buildQueryMatcher(trimmed, Boolean(options.caseSensitive));
    const runs = collectMessageTextRuns(container);

    const collected: DomMatchRange[] = [];
    const perMessageCounter = new Map<number, number>();
    let matchedTargetRange: Range | null = null;

    for (const run of runs) {
        if (collected.length >= maxRanges) break;
        matcher.lastIndex = 0;
        let match = matcher.exec(run.text);
        while (match !== null && collected.length < maxRanges) {
            const matchLen = match[0].length;
            if (matchLen === 0) {
                matcher.lastIndex += 1;
                match = matcher.exec(run.text);
                continue;
            }
            const range = createRunMatchRange(run.segments, match.index, match.index + matchLen);
            if (range) {
                collected.push({ range, messageIndex: run.messageIndex });
                if (run.messageIndex !== null) {
                    const occ = perMessageCounter.get(run.messageIndex) ?? 0;
                    perMessageCounter.set(run.messageIndex, occ + 1);
                    if (
                        matchedTargetRange === null
                        && options.targetMessageIndex === run.messageIndex
                        && options.targetOccurrenceInMessage === occ
                    ) {
                        matchedTargetRange = range;
                    }
                }
            }
            match = matcher.exec(run.text);
        }
    }

    const fallbackIndex =
        collected.length > 0
            ? Math.min(Math.max(0, options.activeIndex ?? 0), collected.length - 1)
            : -1;
    const fallbackInTargetMessage =
        options.targetMessageIndex != null
            ? collected.find((item) => item.messageIndex === options.targetMessageIndex)?.range ?? null
            : null;
    const activeRange =
        matchedTargetRange ??
        fallbackInTargetMessage ??
        (fallbackIndex >= 0 ? (collected[fallbackIndex]?.range ?? null) : null);

    const api = getHighlightApi();
    if (api) {
        if (collected.length === 0) {
            clearChatDomHighlights();
        } else {
            ensureHighlightStylesheet();
            const matchesInstance = new api.HighlightCtor(...collected.map((item) => item.range));
            ownedMatchesHighlight = matchesInstance;
            api.registry.set(CHAT_FIND_HIGHLIGHT_NAME, matchesInstance);
            if (activeRange) {
                const activeInstance = new api.HighlightCtor(activeRange);
                ownedActiveHighlight = activeInstance;
                api.registry.set(CHAT_FIND_ACTIVE_HIGHLIGHT_NAME, activeInstance);
            } else {
                deleteOwnedHighlight(api.registry, CHAT_FIND_ACTIVE_HIGHLIGHT_NAME, ownedActiveHighlight);
                ownedActiveHighlight = null;
            }
        }
    }

    return { ranges: collected, activeRange };
}
