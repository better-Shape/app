import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * BetterShape defines custom size utilities (`h-chrome`, `px-sm`, …) outside Tailwind's
 * default scale. Without registering them here, `cn("h-chrome", "h-6")` keeps
 * BOTH classes and whichever rule wins in CSS is non-deterministic — which is
 * why design-panel fields kept the 30px chrome height under a 24px label slot.
 */
const twMerge = extendTailwindMerge({
    extend: {
        classGroups: {
            h: ["h-chrome", "h-titlebar", "h-statusbar"],
            w: ["w-chrome"],
            "min-h": ["min-h-chrome"],
            "min-w": ["min-w-chrome"],
            p: ["p-xs", "p-sm", "p-md", "p-lg"],
            px: ["px-xs", "px-sm", "px-md", "px-lg"],
            py: ["py-xs", "py-sm", "py-md"],
            pl: ["pl-sm", "pl-md"],
            pr: ["pr-sm", "pr-md"],
            pt: ["pt-sm", "pt-md"],
            pb: ["pb-sm", "pb-md"],
            gap: ["gap-sm", "gap-md"],
        },
        conflictingClassGroups: {
            // `size-*` sets both axes; a later `h-*` / `w-*` must replace it.
            size: ["h", "w", "min-h", "min-w"],
            h: ["size"],
            w: ["size"],
            "min-h": ["size"],
            "min-w": ["size"],
        },
    },
});

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function getGitStatusColor(status: string): string {
    if (status === "M") return "var(--git-modified)";
    if (status === "A" || status === "U") return "var(--git-added)";
    if (status === "D") return "var(--git-deleted)";
    return "var(--git-added)";
}

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * A short base36 id suffix for DOM keys and ephemeral element ids. Draws from
 * `crypto.getRandomValues` rather than `Math.random` so the generator is sound
 * wherever it is reused, and uniqueness within a render tree is enough.
 */
export function randomSuffix(length = 8): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    let out = "";
    for (let i = 0; i < length; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
    return out;
}

/** A uniformly random integer in `[min, max]`, drawn from `crypto.getRandomValues`. */
export function randomInt(min: number, max: number): number {
    const span = max - min + 1;
    const [value] = crypto.getRandomValues(new Uint32Array(1));
    return min + (value % span);
}
