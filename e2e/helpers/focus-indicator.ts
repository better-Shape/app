import type { Page } from "@playwright/test";

/** What a focus walk records about the element that has focus. */
export interface FocusStop {
    key: string;
    name: string;
    isButton: boolean;
    inEditor: boolean;
    /** The element's opacity multiplied through its ancestors. */
    opacity: number;
    visible: boolean;
}

/**
 * Reads the focused element and whether it shows a focus indicator: an outline, or a ring drawn
 * as a box shadow on the element or on its `::before` layer, as the commit rows draw theirs. An
 * indicator inside a fully transparent ancestor does not count.
 */
export const readFocusStop = (page: Page): Promise<FocusStop | null> =>
    page.evaluate(() => {
        /** A stable number per element, so a walk can tell when focus comes back around. */
        const stopKey = (element: Element): string => {
            const store = window as unknown as { __focusStopIds?: WeakMap<Element, number>; __focusStopNext?: number };
            store.__focusStopIds ??= new WeakMap();
            if (!store.__focusStopIds.has(element)) {
                store.__focusStopNext = (store.__focusStopNext ?? 0) + 1;
                store.__focusStopIds.set(element, store.__focusStopNext);
            }
            return String(store.__focusStopIds.get(element));
        };
        /** Whether a computed colour is fully transparent. */
        const isTransparent = (color: string) => color === "transparent" || /,\s*0\)$/.test(color);
        /** Whether a computed style draws an outline. */
        const outlineShows = (style: CSSStyleDeclaration) =>
            style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 1 && !isTransparent(style.outlineColor);
        /** The colour of one box-shadow layer, or "" when it has none. */
        const layerColor = (layer: string) => /rgba?\([^)]*\)/.exec(layer)?.[0] ?? "";
        /** The spread of one box-shadow layer, its fourth length. */
        const layerSpread = (layer: string) =>
            Number.parseFloat(layer.replace(/rgba?\([^)]*\)/, "").match(/-?\d+(\.\d+)?px/g)?.[3] ?? "0");
        /** Whether one box-shadow layer is a ring: a visible colour with a positive spread. */
        const layerIsRing = (layer: string) => {
            const color = layerColor(layer);
            return color !== "" && !isTransparent(color) && layerSpread(layer) > 0;
        };
        /** Whether a computed style draws a ring as a box shadow. */
        const shadowShows = (style: CSSStyleDeclaration) =>
            style.boxShadow !== "none" && style.boxShadow.split(/,(?![^(]*\))/).some(layerIsRing);
        /** Whether the element or its `::before` layer draws an outline or a ring. */
        const drawsIndicator = (element: Element) =>
            [getComputedStyle(element), getComputedStyle(element, "::before")].some(
                (style) => outlineShows(style) || shadowShows(style),
            );
        /** The element's opacity multiplied through its ancestors: 0 when any of them hides it. */
        const effectiveOpacity = (element: Element) => {
            let opacity = 1;
            for (let node: Element | null = element; node; node = node.parentElement) {
                opacity *= Number.parseFloat(getComputedStyle(node).opacity);
            }
            return opacity;
        };
        /** The element's label, else its text, else its markup. */
        const stopName = (element: HTMLElement) =>
            element.getAttribute("aria-label") ??
            (element.textContent?.trim().replaceAll(/\s+/g, " ").slice(0, 60) || element.outerHTML.slice(0, 120));

        const el = document.activeElement;
        if (!(el instanceof HTMLElement) || el === document.body) return null;
        const opacity = effectiveOpacity(el);
        return {
            key: stopKey(el),
            name: stopName(el),
            isButton: el.matches('button, [role="button"]'),
            inEditor: el.matches(".cm-content"),
            opacity,
            visible: opacity > 0 && drawsIndicator(el),
        };
    });

/** Waits for running CSS transitions, such as a fade that reveals a focused control, to finish. */
const settleTransitions = (page: Page) =>
    page.evaluate(() =>
        Promise.all(
            document
                .getAnimations()
                .filter((animation) => animation instanceof CSSTransition)
                .map((animation) => animation.finished.catch(() => undefined)),
        ),
    );

/**
 * Reads the focused element as `readFocusStop` does, reading again once transitions finish when
 * something above it is still fading in.
 */
export const readSettledFocusStop = async (page: Page): Promise<FocusStop | null> => {
    const stop = await readFocusStop(page);
    if (!stop || stop.opacity >= 1) return stop;
    await settleTransitions(page);
    return readFocusStop(page);
};
