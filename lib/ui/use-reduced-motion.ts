"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "./motion";

/** Subscribe to both the OS preference and BetterShape's live motion setting. */
export function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState(() => prefersReducedMotion());

    useEffect(() => {
        const root = document.documentElement;
        const query = window.matchMedia("(prefers-reduced-motion: reduce)");
        const update = () => setReduced(prefersReducedMotion(root));
        const observer = new MutationObserver(update);

        query.addEventListener("change", update);
        observer.observe(root, {
            attributes: true,
            attributeFilter: ["data-motion-preference"],
        });
        update();

        return () => {
            query.removeEventListener("change", update);
            observer.disconnect();
        };
    }, []);

    return reduced;
}
