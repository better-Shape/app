export * from "@/core/utils";

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
