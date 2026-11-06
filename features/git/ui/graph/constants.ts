import { GraphNode } from "@/lib/backend";

/** Grid / stroke — tuned toward vscode-git-graph proportions. */
export const LANE_WIDTH = 16;
export const ROW_HEIGHT = 26;
export const DOT_RADIUS = 3.5;
export const MERGE_DOT_RADIUS = 5.5;
export const STROKE = 2;
/** Background outline under lines (vscode-git-graph `path.shadow`). */
export const SHADOW_STROKE = 4;
export const SHADOW_OPACITY = 0.55;

export const EMPTY_ARRAY: never[] = [];
export const EMPTY_NODE: GraphNode = { lane: 0, color: "var(--color-accent)", paths: [], isMerge: false };

const extractArrowTarget = (rest: string): string | null => {
    if (!rest.startsWith("->")) return null;
    const target = rest.slice(2).trim();
    return target || null;
};

/**
 * Parses a single `git log %D` ref token when it represents the checked-out `HEAD` tip.
 * Returns `""` for detached `HEAD`, the target branch name for `HEAD -> <branch>`,
 * or `null` for non-HEAD decorations (`origin/HEAD`, `feat/header`, etc.).
 */
export function parseHeadRefTarget(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed.toLowerCase().startsWith("head")) return null;
    const rest = trimmed.slice(4).trimStart();
    return rest ? extractArrowTarget(rest) : "";
}

/** True when this commit is checked out (HEAD tip). */
export function commitIsHead(refs: string[] | null | undefined): boolean {
    return Boolean(refs?.some((ref) => parseHeadRefTarget(ref) !== null));
}
