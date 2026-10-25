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

/**
 * Collects DOM `Range`s for every visible text-node match inside `container`,
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

    const caseSensitive = Boolean(options.caseSensitive);
    const maxRanges = options.maxRanges ?? 500;
    const escapedNeedle = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matcher = new RegExp(escapedNeedle, caseSensitive ? "g" : "gi");

    const collected: DomMatchRange[] = [];
    const perMessageCounter = new Map<number, number>();
    let matchedTargetRange: Range | null = null;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current && collected.length < maxRanges) {
        const textNode = current as Text;
        current = walker.nextNode();
        const raw = textNode.nodeValue;
        if (!raw) continue;
        if (shouldSkipTextNode(textNode, container)) continue;

        matcher.lastIndex = 0;
        let resolvedMsgIdx: number | null | undefined;
        let match = matcher.exec(raw);

        while (match !== null && collected.length < maxRanges) {
            const idx = match.index;
            const matchLen = match[0].length;
            if (matchLen === 0) {
                matcher.lastIndex += 1;
                match = matcher.exec(raw);
                continue;
            }
            if (resolvedMsgIdx === undefined) {
                const msgEl = textNode.parentElement?.closest<HTMLElement>("[data-chat-message-index]") ?? null;
                const parsed = msgEl ? Number(msgEl.getAttribute("data-chat-message-index")) : Number.NaN;
                resolvedMsgIdx = Number.isFinite(parsed) ? parsed : null;
            }
            const range = document.createRange();
            range.setStart(textNode, idx);
            range.setEnd(textNode, idx + matchLen);
            collected.push({ range, messageIndex: resolvedMsgIdx });

            if (resolvedMsgIdx !== null) {
                const occ = perMessageCounter.get(resolvedMsgIdx) ?? 0;
                perMessageCounter.set(resolvedMsgIdx, occ + 1);
                if (
                    matchedTargetRange === null &&
                    options.targetMessageIndex === resolvedMsgIdx &&
                    options.targetOccurrenceInMessage === occ
                ) {
                    matchedTargetRange = range;
                }
            }
            match = matcher.exec(raw);
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
