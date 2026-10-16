"use client";

import { useEffect } from "react";

/**
 * Strip native `title` tooltips app-wide. Custom BetterShape tooltips stay; bare `title=`
 * attributes otherwise show the browser bubble. The original text is kept on
 * `data-native-title` in case something needs it later.
 *
 * The strip runs when the pointer or the focus arrives, which is the moment the bubble
 * could appear, and not ahead of time. Sweeping the whole tree from an effect rewrote
 * attributes React had not hydrated yet, and the hydration mismatch was then reported
 * against whichever control the sweep happened to touch.
 */
export const SuppressNativeTooltips = () => {
    useEffect(() => {
        // The text moves to `data-native-title` instead of going away, because a
        // second sweep over an element this already touched finds no `title` to read
        // and would otherwise drop the wording the app wrote.
        const stripEl = (el: Element) => {
            const value = el.getAttribute("title");
            if (value == null) return;
            el.setAttribute("data-native-title", value);
            el.removeAttribute("title");
        };

        // Takes the subtree it is handed rather than the document, so the sweep below
        // can start at `body` while a future caller can narrow it to one panel.
        const stripTree = (root: ParentNode) => {
            if (root instanceof Element) stripEl(root);
            root.querySelectorAll?.("[title]").forEach(stripEl);
        };

        // A `mouseover` targets the deepest element, which for a title set on a
        // wrapper is a text node's parent, so both cases resolve to an element.
        const onEnter = (e: Event) => {
            const target = e.target;
            if (target instanceof Element) stripEl(target);
            else if (target instanceof Text) {
                const parent = target.parentElement;
                if (parent) stripEl(parent);
            }
        };
        document.addEventListener("mouseover", onEnter, true);
        document.addEventListener("focusin", onEnter, true);

        // A pointer that came to rest before the page loaded never fires a boundary event,
        // so the first movement sweeps what is on screen, once. This waits for the user
        // rather than running on mount, which is what rewrote un-hydrated attributes.
        const onFirstMove = () => stripTree(document.body);
        document.addEventListener("pointermove", onFirstMove, { capture: true, once: true });
        document.addEventListener("pointerdown", onFirstMove, { capture: true, once: true });

        return () => {
            document.removeEventListener("mouseover", onEnter, true);
            document.removeEventListener("focusin", onEnter, true);
            document.removeEventListener("pointermove", onFirstMove, true);
            document.removeEventListener("pointerdown", onFirstMove, true);
        };
    }, []);

    return null;
};
