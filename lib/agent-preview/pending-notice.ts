/**
 * The agent blocks its turn while a design pick is pending, and the gallery
 * records the pending pick as soon as it renders. If the gallery is scrolled
 * out of view — or the user moved to another conversation — nothing says the
 * turn is waiting. The backend already emits `agent-design-pick-pending`; this
 * decides whether that event deserves an announcement.
 *
 * The anchor is the gallery's own `data-pending-approval-kind` marker, so no
 * second source of truth is added for "a pick is on screen".
 */
const PICK_ANCHOR = '[data-pending-approval-kind="approval"]';

export function shouldAnnouncePendingDesignPick(doc: Document): boolean {
    const anchors = Array.from(doc.querySelectorAll(PICK_ANCHOR));
    if (anchors.length === 0) return true;
    const viewportHeight = doc.defaultView?.innerHeight ?? 0;
    const viewportWidth = doc.defaultView?.innerWidth ?? 0;
    return !anchors.some((anchor) => {
        const rect = anchor.getBoundingClientRect();
        if (rect.height <= 0 || rect.width <= 0) return false;
        const verticallyVisible = rect.bottom > 0 && rect.top < viewportHeight;
        const horizontallyVisible = rect.right > 0 && rect.left < viewportWidth;
        return verticallyVisible && horizontallyVisible;
    });
}
