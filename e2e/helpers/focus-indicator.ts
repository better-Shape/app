import type { Page } from "@playwright/test";

/** What a focus walk records about the element that has focus. */
export interface FocusStop {
    key: string;
    name: string;
    isButton: boolean;
    inEditor: boolean;
    visible: boolean;
}

/**
 * Reads the focused element and whether it shows a focus indicator: an outline, or a ring drawn
 * as a box shadow on the element or on its `::before` layer, as the commit rows draw theirs.
 */
export const readFocusStop = (page: Page): Promise<FocusStop | null> =>
    page.evaluate(() => {
        const el = document.activeElement;
        if (!(el instanceof HTMLElement) || el === document.body) return null;
        // A stable number per element, so the walk can tell when focus comes back around.
        const store = window as unknown as { __focusStopIds?: WeakMap<Element, number>; __focusStopNext?: number };
        store.__focusStopIds ??= new WeakMap();
        if (!store.__focusStopIds.has(el)) {
            store.__focusStopNext = (store.__focusStopNext ?? 0) + 1;
            store.__focusStopIds.set(el, store.__focusStopNext);
        }
        const isTransparent = (color: string) => color === "transparent" || /,\s*0\)$/.test(color);
        const outlineShows = (style: CSSStyleDeclaration) =>
            style.outlineStyle !== "none" &&
            Number.parseFloat(style.outlineWidth) >= 1 &&
            !isTransparent(style.outlineColor);
        const shadowShows = (style: CSSStyleDeclaration) =>
            style.boxShadow !== "none" &&
            style.boxShadow.split(/,(?![^(]*\))/).some((layer) => {
                const color = /rgba?\([^)]*\)/.exec(layer)?.[0] ?? "";
                const lengths = layer.replace(/rgba?\([^)]*\)/, "").match(/-?\d+(\.\d+)?px/g) ?? [];
                const spread = lengths.length >= 4 ? Number.parseFloat(lengths[3]) : 0;
                return color !== "" && !isTransparent(color) && spread > 0;
            });
        const own = getComputedStyle(el);
        const before = getComputedStyle(el, "::before");
        const name =
            el.getAttribute("aria-label") ??
            (el.textContent?.trim().replaceAll(/\s+/g, " ").slice(0, 60) || el.outerHTML.slice(0, 120));
        return {
            key: String(store.__focusStopIds.get(el)),
            name,
            isButton: el.matches('button, [role="button"]'),
            inEditor: el.matches(".cm-content"),
            visible: outlineShows(own) || shadowShows(own) || outlineShows(before) || shadowShows(before),
        };
    });
