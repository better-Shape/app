/** Pure mapping from GitHub REST payloads to the row shape the panel renders. */

export type PrLabel = { name: string; color: string };

export type PrCi = "success" | "pending" | "failure" | "unknown";

export type PrMergeable = "mergeable" | "conflicting" | "unknown";

export type PrItem = {
    id: string;
    number: number;
    title: string;
    url?: string;
    /** `open` | `closed` | `merged` — merged is derived, GitHub reports it as a closed PR. */
    status: string;
    draft?: boolean;
    author?: string;
    avatar?: string;
    repo: string;
    /** Pre-formatted for display; use `updatedAt` for ordering. */
    updated: string;
    updatedAt?: string;
    createdAt?: string;
    body?: string;
    labels: PrLabel[];
    /** Absent means "not fetched yet", which is different from zero. */
    additions?: number;
    deletions?: number;
    headRef?: string;
    baseRef?: string;
    headSha?: string;
    comments?: number;
    ci?: PrCi;
    mergeable?: PrMergeable;
};

export function parseJson(raw: unknown): unknown {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
}

export function formatRelative(iso: unknown): string {
    if (typeof iso !== "string" || !iso) return "";
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "";
    const mins = Math.round((Date.now() - t) / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
}

export function ciFromStatus(state: unknown): PrCi {
    if (state === "success") return "success";
    if (state === "pending") return "pending";
    if (state === "error" || state === "failure") return "failure";
    return "unknown";
}

/**
 * The list endpoint leaves `mergeable` null — GitHub computes it lazily and only
 * answers it on the single-PR route — so most rows land on `unknown`.
 */
export function mergeableFrom(row: { mergeable?: unknown; mergeable_state?: unknown }): PrMergeable {
    if (row.mergeable === false || row.mergeable_state === "dirty") return "conflicting";
    if (row.mergeable === true) return "mergeable";
    return "unknown";
}

function mapLabels(raw: unknown): PrLabel[] {
    if (!Array.isArray(raw)) return [];
    const labels: PrLabel[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const label = entry as { name?: string; color?: string };
        if (!label.name) continue;
        labels.push({ name: label.name, color: label.color || "666666" });
    }
    return labels;
}

export function mapPullRow(raw: unknown, repo: string): PrItem {
    const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const user = row.user as { login?: string; avatar_url?: string } | undefined;
    const head = row.head as { ref?: string; sha?: string } | undefined;
    const base = row.base as { ref?: string } | undefined;
    const number = typeof row.number === "number" ? row.number : Number(row.number ?? 0);
    const mergedAt = typeof row.merged_at === "string" ? row.merged_at : undefined;
    const closed = row.state === "closed";

    return {
        id: String(row.id ?? row.number),
        number: Number.isFinite(number) ? number : 0,
        title: String(row.title ?? `#${row.number ?? ""}`),
        url: typeof row.html_url === "string" ? row.html_url : undefined,
        status: mergedAt ? "merged" : closed ? "closed" : String(row.state ?? "open"),
        draft: Boolean(row.draft),
        author: user?.login,
        avatar: user?.avatar_url,
        repo,
        updated: formatRelative(row.updated_at ?? row.created_at),
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
        createdAt: typeof row.created_at === "string" ? row.created_at : undefined,
        body: typeof row.body === "string" ? row.body : undefined,
        labels: mapLabels(row.labels),
        comments: typeof row.comments === "number" ? row.comments : undefined,
        headRef: head?.ref,
        baseRef: base?.ref,
        headSha: head?.sha,
        mergeable: mergeableFrom(row),
    };
}

export function mapPullRows(list: unknown, repo: string): PrItem[] {
    return Array.isArray(list) ? list.map((row) => mapPullRow(row, repo)) : [];
}