"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "./motion";

/**
 * Subscribe to the OS preference and BetterShape's live motion setting.
 * The initial value is hydration-stable; CSS applies reduced-motion styling
 * through the root preference/media query, and the effect synchronizes
 * JavaScript-driven motion after mount.
 */
export function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false);

    useEffect(() => {
        const root = document.documentElement;
        const update = () => setReduced(prefersReducedMotion(root));
        let query: MediaQueryList | undefined;
        try {
            if (typeof window.matchMedia === "function") {
                query = window.matchMedia("(prefers-reduced-motion: reduce)");
            }
        } catch {
            // Some embedded and test webviews do not provide a usable media query.
        }

        const Observer = root.ownerDocument.defaultView?.MutationObserver;
        const observer = Observer ? new Observer(update) : undefined;
        if (query?.addEventListener) {
            query.addEventListener("change", update);
        } else {
            query?.addListener?.(update);
        }
        observer?.observe(root, {
            attributes: true,
            attributeFilter: ["data-motion-preference"],
        });
        update();

        return () => {
            if (query?.removeEventListener) {
                query.removeEventListener("change", update);
            } else {
                query?.removeListener?.(update);
            }
            observer?.disconnect();
        };
    }, []);

    return reduced;
}
