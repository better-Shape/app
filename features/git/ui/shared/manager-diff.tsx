"use client";

import dynamic from "next/dynamic";

/**
 * The diff editor pulls in CodeMirror (~330 KB). It only appears after the user
 * selects a file or commit inside a Git panel, so it is split out of the
 * first-load bundle; the panel it lives in already provides the background.
 */
const DiffView = dynamic(
    () => import("@/features/editor/ui/diff/diff-view").then((m) => m.DiffView),
    { ssr: false, loading: () => <div className="h-full w-full" aria-hidden /> },
);

/** Lightweight unified diff for Git manager panels. */
export function ManagerDiffEditor({
    original,
    modified,
    path,
    active = true,
}: {
    original: string;
    modified: string;
    path: string;
    sideBySide?: boolean;
    active?: boolean;
}) {
    if (!active) return null;
    return (
        <DiffView
            path={path}
            originalContent={original}
            content={modified}
        />
    );
}
