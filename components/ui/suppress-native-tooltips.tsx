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
export function SuppressNativeTooltips() {
    useEffect(() => {
        const stripEl = (el: Element) => {
            const value = el.getAttribute("title");
            if (value == null) return;
            el.setAttribute("data-native-title", value);
            el.removeAttribute("title");
        };

        const stripTree = (root: ParentNode) => {
            if (root instanceof Element) stripEl(root);
            root.querySelectorAll?.("[title]").forEach(stripEl);
        };

        const onEnter = (e: Event) => {
            const t = e.target;
            if (t instanceof Element) stripEl(t);
            else if (t instanceof Text) {
                const p = t.parentElement;
                if (p) stripEl(p);
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
}
