"use client";

/** Row actions the speed bar and the row menu both drive. */

import { commands } from "@/lib/backend";
import { notify } from "@/features/notifications";
import type { PrItem } from "./mapping";
import { applyPrOverride, clearPrOverride } from "./overrides";

export type PrAction = "close" | "merge" | "reopen" | "ready";

export const PR_ACTION_LABEL: Record<PrAction, string> = {
    close: "Close",
    merge: "Merge",
    reopen: "Reopen",
    ready: "Ready for review",
};

/** Which actions apply to a row: nothing for merged, reopen for closed, close+ready for draft. */
export function prActionsFor(item: PrItem): PrAction[] {
    if (item.status === "merged") return [];
    if (item.status === "closed") return ["reopen"];
    if (item.draft) return ["close", "ready"];
    return ["close", "merge"];
}

type PrActionRequest = {
    method: string;
    path: string;
    body?: string;
    optimistic: { status?: string; draft?: boolean };
};

function actionRequest(action: PrAction, item: PrItem, repo: string): PrActionRequest {
    const base = `/repos/${repo}/pulls/${item.number}`;
    switch (action) {
        case "close":
            return {
                method: "PATCH",
                path: base,
                body: JSON.stringify({ state: "closed" }),
                optimistic: { status: "closed" },
            };
        case "reopen":
            return {
                method: "PATCH",
                path: base,
                body: JSON.stringify({ state: "open" }),
                optimistic: { status: "open" },
            };
        case "ready":
            return {
                method: "PATCH",
                path: base,
                body: JSON.stringify({ draft: false }),
                optimistic: { draft: false },
            };
        case "merge":
            return {
                method: "PUT",
                path: `${base}/merge`,
                body: JSON.stringify({ merge_method: "merge" }),
                optimistic: { status: "merged" },
            };
    }
}

export async function runPrAction(
    item: PrItem,
    action: PrAction,
    repo: string,
): Promise<boolean> {
    const request = actionRequest(action, item, repo);
    applyPrOverride(item.id, request.optimistic);
    try {
        await commands.githubApiRequest(request.method, request.path, request.body);
        notify.success(`${PR_ACTION_LABEL[action]} ${item.title}`);
        return true;
    } catch (error) {
        clearPrOverride(item.id);
        notify.error(error instanceof Error ? error.message : `${PR_ACTION_LABEL[action]} failed`);
        return false;
    }
}