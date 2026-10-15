import type { Person } from "@/features/git/ui/github/detail/types";

export type PrTimelineEntry = {
    id: string;
    actor?: Person;
    date?: string;
    description: string;
    body?: string;
    url?: string;
};

function text(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function person(value: unknown): Person | undefined {
    const row = object(value);
    return typeof row.login === "string" ? { login: row.login, avatar_url: text(row.avatar_url) } : undefined;
}

/** REST issue timeline supplies both review submissions and issue comments, not inline review threads. */
export function mapPrTimeline(rows: Record<string, unknown>[]): PrTimelineEntry[] {
    return rows.flatMap((row, index) => {
        const event = text(row.event);
        if (!event) return [];
        const commitAuthor = object(row.author);
        const actor = person(row.actor) ?? person(row.user) ?? person(row.author);
        let description: string;
        switch (event) {
            case "commented": description = "commented"; break;
            case "reviewed": {
                const state = text(row.state)?.toLowerCase();
                description = state === "approved" ? "approved these changes"
                    : state === "changes_requested" ? "requested changes"
                    : state === "dismissed" ? "had a review dismissed" : "reviewed these changes";
                break;
            }
            case "committed": description = `committed ${text(row.sha)?.slice(0, 7) ?? "a change"}`; break;
            case "labeled": case "unlabeled":
                description = `${event === "labeled" ? "added" : "removed"} label ${text(object(row.label).name) ?? ""}`.trim(); break;
            case "review_requested":
                description = `requested a review from ${text(object(row.requested_reviewer).login) ?? text(object(row.requested_team).name) ?? "a reviewer"}`; break;
            case "renamed":
                description = `renamed this pull request to ${text(object(row.rename).to) ?? "a new title"}`; break;
            default: description = event.replaceAll("_", " ");
        }
        return [{
            id: `${event}:${String(row.id ?? row.sha ?? index)}`,
            actor,
            date: text(row.submitted_at) ?? text(row.created_at) ?? text(commitAuthor.date),
            description,
            body: text(row.body) ?? (event === "committed" ? text(row.message) : undefined),
            url: text(row.html_url),
        }];
    }).sort((a, b) => {
        const time = (date?: string) => { const parsed = Date.parse(date ?? ""); return Number.isNaN(parsed) ? Infinity : parsed; };
        return time(a.date) - time(b.date) || a.id.localeCompare(b.id);
    });
}
