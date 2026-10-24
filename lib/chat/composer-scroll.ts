/** Keep the mention/slash highlight overlay aligned 1:1 with the composer textarea, including scrollbar gutter shifts. */
export function syncComposerOverlayScroll(
    source: { scrollLeft: number; scrollTop: number; clientWidth?: number },
    overlay:
        | {
              scrollLeft: number;
              scrollTop: number;
              style?: { width: string };
          }
        | null
        | undefined,
) {
    if (!overlay) return;
    if (overlay.style && typeof source.clientWidth === "number" && source.clientWidth > 0) {
        const nextWidth = `${source.clientWidth}px`;
        if (overlay.style.width !== nextWidth) {
            overlay.style.width = nextWidth;
        }
    }
    overlay.scrollLeft = source.scrollLeft;
    overlay.scrollTop = source.scrollTop;
}

/** Determine whether a scrollable composer viewport has hidden content above or below its visible window. */
export function computeComposerScrollMask(
    source: { scrollTop: number; scrollHeight: number; clientHeight: number },
    threshold = 2,
): { top: boolean; bottom: boolean } {
    const maxScrollTop = Math.max(0, source.scrollHeight - source.clientHeight);
    if (maxScrollTop <= threshold) {
        return { top: false, bottom: false };
    }
    return {
        top: source.scrollTop > threshold,
        bottom: maxScrollTop - source.scrollTop > threshold,
    };
}

/**
 * Build a truthful two-layer CSS `mask-image` gradient that dissolves only edges with
 * genuine hidden overflow while keeping the 8px right scrollbar gutter crisp and unmasked.
 */
export function buildComposerScrollMaskImage(
    edges: { top: boolean; bottom: boolean },
    fadePx = 18,
): string | undefined {
    if (!edges.top && !edges.bottom) return undefined;
    const topStop = edges.top ? `transparent 0px, black ${fadePx}px` : "black 0px, black 0px";
    const bottomStop = edges.bottom
        ? `black calc(100% - ${fadePx}px), transparent 100%`
        : "black 100%, black 100%";
    const scrollbarKeep = "linear-gradient(to left, black 8px, transparent 8px)";
    const textEdgeFade = `linear-gradient(to bottom, ${topStop}, ${bottomStop})`;
    return `${scrollbarKeep}, ${textEdgeFade}`;
}

/** If the caret is at the end of the text, scroll horizontally/vertically so newly typed characters stay in view. */
export function revealComposerCaret(
    textarea: {
        selectionStart: number | null;
        value: string;
        scrollWidth: number;
        clientWidth: number;
        scrollLeft: number;
        scrollHeight?: number;
        clientHeight?: number;
        scrollTop?: number;
    },
) {
    const caret = textarea.selectionStart ?? textarea.value.length;
    if (caret < textarea.value.length) return textarea.scrollLeft;
    const maxLeft = Math.max(0, textarea.scrollWidth - textarea.clientWidth);
    textarea.scrollLeft = maxLeft;
    if (
        typeof textarea.scrollHeight === "number" &&
        typeof textarea.clientHeight === "number" &&
        typeof textarea.scrollTop === "number" &&
        textarea.scrollHeight > textarea.clientHeight
    ) {
        textarea.scrollTop = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
    }
    return maxLeft;
}
