"use client";

import { Button } from "@/components/ui/button";
import { FileIcon } from "@/components/ui/file-icon";
import { ThreadMessage } from "@/features/git/ui/github/detail/widgets";
import { GitMarkdown } from "@/features/git/ui/github/markdown";
import { commands } from "@/lib/backend";
import { formatRelative, type PrItem } from "./mapping";
import { mapPrTimeline } from "./timeline";
import { usePagedPrResource } from "./use-paged-resource";

function ResourceStatus({ resource, noun }: { resource: ReturnType<typeof usePagedPrResource>; noun: string }) {
    return <>
        {resource.error ? (
            <div role="status" className="mb-2 flex items-center gap-2 text-sm text-text-muted">
                <span>Could not load {noun}: {resource.error}{resource.rows.length > 0 ? " Showing previously loaded data." : ""}</span>
                <Button variant="secondary" size="xs" disabled={resource.loading} onClick={resource.retry}>Retry</Button>
            </div>
        ) : null}
        {resource.loading ? <p role="status" className="text-sm text-text-muted">Loading {noun}…</p> : null}
        {resource.hasMore ? <Button variant="secondary" size="sm" className="my-2" disabled={resource.loading} onClick={resource.loadMore}>Load more {noun}</Button> : null}
    </>;
}

export function PrFilesTab({ item, revision }: { item: PrItem; revision: number }) {
    // GitHub's files API exposes at most 3,000 files, even when the PR is larger.
    const resource = usePagedPrResource(`/repos/${item.repo}/pulls/${item.number}/files`, `${revision}:${item.headSha ?? ""}`, 3000);
    return <>
        <ResourceStatus resource={resource} noun="files" />
        {!resource.loading && !resource.error && resource.rows.length === 0 ? <p className="text-sm text-text-muted">No files listed</p> : null}
        {resource.atLimit ? <p role="status" className="mb-2 text-xs text-text-muted">Showing GitHub’s maximum of 3,000 files. Open the pull request on GitHub for the full diff.</p> : null}
        <ul className="flex flex-col gap-0.5">
            {resource.rows.map((file) => {
                const filename = String(file.filename ?? "");
                return <li key={filename} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm">
                    <FileIcon name={filename} className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-text-primary" title={filename}>{filename}</span>
                    <span className="shrink-0 text-xs text-text-muted">{String(file.status ?? "")}</span>
                    <span className="shrink-0 text-xs text-success">+{Number(file.additions ?? 0)}</span>
                    <span className="shrink-0 text-xs text-error">−{Number(file.deletions ?? 0)}</span>
                </li>;
            })}
        </ul>
    </>;
}

export function PrTimelineTab({ item, revision }: { item: PrItem; revision: number }) {
    const resource = usePagedPrResource(`/repos/${item.repo}/issues/${item.number}/timeline`, `${revision}:${item.updatedAt ?? ""}:${item.headSha ?? ""}`);
    const entries = mapPrTimeline(resource.rows);
    return <>
        <p className="mb-3 text-xs text-text-muted">Comments, reviews, commits, and pull request events. Inline review conversations are available on GitHub.</p>
        <ThreadMessage person={item.author ? { login: item.author, avatar_url: item.avatar } : undefined} when={formatRelative(item.createdAt)} isLast={entries.length === 0}>
            <p className="text-sm text-text-muted">opened this pull request</p>
        </ThreadMessage>
        {entries.map((entry, index) => (
            <ThreadMessage key={entry.id} person={entry.actor} when={formatRelative(entry.date)} isLast={index === entries.length - 1}>
                <p className="mb-1 text-sm text-text-muted">{entry.description}</p>
                {entry.body ? <GitMarkdown content={entry.body} /> : null}
                {entry.url ? <Button variant="ghost" size="xs" onClick={() => void commands.openUrlExternal(entry.url!)}>Open on GitHub</Button> : null}
            </ThreadMessage>
        ))}
        <ResourceStatus resource={resource} noun="events" />
    </>;
}

export function PrReviewers({ item, requested, revision }: { item: PrItem; requested: string[]; revision: number }) {
    const resource = usePagedPrResource(`/repos/${item.repo}/pulls/${item.number}/reviews`, `${revision}:${item.updatedAt ?? ""}:${item.headSha ?? ""}`);
    const completed = [...new Set(resource.rows.flatMap((row) => {
        const user = row.user as { login?: string } | null;
        return user?.login ? [user.login] : [];
    }))];
    return <>
        {requested.length > 0 ? <p>Requested: {requested.join(", ")}</p> : null}
        {completed.length > 0 ? <p>Reviewed: {completed.join(", ")}</p> : null}
        {!resource.loading && !resource.error && requested.length === 0 && completed.length === 0 ? "None" : null}
        <ResourceStatus resource={resource} noun="reviews" />
    </>;
}
