"use client";

/** Row actions the speed bar and the row menu both drive. */

import { commands } from "@/lib/backend";
import { notify } from "@/features/notifications";
import { parseJson, type PrItem } from "./mapping";
import { applyPrOverride, clearPrOverride, readPrOverride } from "./overrides";

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
            if (!item.nodeId) throw new Error("Refresh this pull request before marking it ready for review.");
            return {
                method: "POST",
                path: "/graphql",
                body: JSON.stringify({
                    query: "mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { pullRequest { isDraft } } }",
                    variables: { id: item.nodeId },
                }),
                optimistic: { draft: false },
            };
        case "merge":
            if (!item.headSha) throw new Error("Refresh this pull request before merging.");
            return {
                method: "PUT",
                path: `${base}/merge`,
                body: JSON.stringify({ merge_method: "merge", sha: item.headSha }),
                optimistic: { status: "merged" },
            };
    }
}

const pending = new Set<string>();

/** Serialize mutations per repository/PR, verify the GitHub acknowledgement, and roll back optimistic state on failure. */
export async function runPrAction(
    item: PrItem,
    action: PrAction,
    repo: string,
): Promise<boolean> {
    const key = `${repo}#${item.number}`;
    if (pending.has(key)) return false;
    pending.add(key);
    const previous = readPrOverride(item.id);
    let applied = false;
    try {
        const effective = { ...item, status: previous?.status ?? item.status, draft: previous?.draft ?? item.draft };
        if (item.repo !== repo || !prActionsFor(effective).includes(action)) {
            throw new Error("This action is no longer available. Refresh the pull request.");
        }
        const request = actionRequest(action, item, repo);
        applyPrOverride(item.id, request.optimistic);
        applied = true;
        const response = parseJson(await commands.githubApiRequest(request.method, request.path, request.body)) as {
            state?: string;
            merged?: boolean;
            message?: string;
            errors?: { message: string }[];
            data?: { markPullRequestReadyForReview?: { pullRequest?: { isDraft?: boolean } } };
        } | null;
        if (action === "merge" && response?.merged !== true) {
            throw new Error(response?.message || "GitHub did not merge this pull request.");
        }
        if (action === "ready" && (response?.errors?.length || response?.data?.markPullRequestReadyForReview?.pullRequest?.isDraft !== false)) {
            throw new Error(response?.errors?.map((error) => error.message).join("; ") || "GitHub did not mark this pull request ready for review.");
        }
        if ((action === "close" || action === "reopen") && response?.state !== (action === "close" ? "closed" : "open")) {
            throw new Error(response?.message || "GitHub did not confirm the pull request state change.");
        }
        // Start the trust window at confirmation, not at the beginning of a slow request.
        applyPrOverride(item.id, request.optimistic);
        notify.success(`${PR_ACTION_LABEL[action]} ${item.title}`);
        return true;
    } catch (error) {
        if (applied) {
            if (previous) applyPrOverride(item.id, previous);
            else clearPrOverride(item.id);
        }
        notify.error(error instanceof Error ? error.message : `${PR_ACTION_LABEL[action]} failed`);
        return false;
    } finally {
        pending.delete(key);
    }
}