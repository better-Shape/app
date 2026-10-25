export * from "@/core/utils";

/**
 * Focuses an input or element once when mounted, avoiding JSX `autoFocus`
 * while preserving popover search focus behavior.
 */
export const focusOnMount = (node: HTMLElement | null) => {
    if (!node || node.dataset.autofocused === "1") return;
    node.dataset.autofocused = "1";
    node.focus();
};


/**
 * Produces deterministic React keys (`"<seed>#1"`, `"<seed>#2"`, ...) so repeated
 * items stay uniquely keyed without referencing `.map()` array indices.
 */
export const createOccurrenceKeyer = () => {
    const counts = new Map<string, number>();
    return (seed: string): string => {
        const next = (counts.get(seed) ?? 0) + 1;
        counts.set(seed, next);
        return `${seed}#${next}`;
    };
};

