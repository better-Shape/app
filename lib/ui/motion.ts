/**
 * Read the live app/OS reduced-motion preference for JavaScript-driven motion.
 *
 * Keep this separate from CSS: WAAPI animations and timed, non-CSS sequences
 * must also be able to jump directly to their final state.
 */
export function prefersReducedMotion(node?: Node | null): boolean {
    const view = viewOf(node);
    const doc = node?.nodeType === 9 ? (node as Document) : node?.ownerDocument ?? view?.document;
    if (doc?.documentElement?.dataset.motionPreference === "reduced") return true;
    if (!view || typeof view.matchMedia !== "function") return false;
    try {
        return view.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
    } catch {
        return false;
    }
}

function viewOf(node: Node | null | undefined): Window | null {
    if (node) {
        const doc = node.nodeType === 9 ? (node as Document) : node.ownerDocument;
        if (doc?.defaultView) return doc.defaultView;
    }
    return typeof window === "undefined" ? null : window;
}
