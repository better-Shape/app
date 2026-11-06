"use client";

import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

/**
 * Whether the element's content is wider than the element, kept current as the element, its
 * parent or its first child resize, and whenever `content` changes. One pixel of slack keeps
 * subpixel rounding from flickering the result.
 */
export const useHorizontalOverflow = (ref: RefObject<HTMLElement | null>, content: unknown): boolean => {
    const [overflowing, setOverflowing] = useState(false);

    const measure = useCallback(() => {
        const element = ref.current;
        if (element) setOverflowing(element.scrollWidth > element.clientWidth + 1);
    }, [ref]);

    useLayoutEffect(() => {
        measure();
        const element = ref.current;
        if (!element || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        for (const watched of [element, element.parentElement, element.firstElementChild]) {
            if (watched) observer.observe(watched);
        }
        return () => observer.disconnect();
    }, [measure, ref, content]);

    return overflowing;
};
