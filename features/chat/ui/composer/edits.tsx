"use client";

import { Checkmark20Regular } from "@fluentui/react-icons/headless/svg/checkmark";
import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";


import React, { useMemo } from "react";
import { Icon } from "@/components/ui/icon";
import { FileIcon } from "@/components/ui/file-icon";
import { countChangedLines } from "@/lib/ui/diff-count";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { openProjectFile } from "@/lib/window/open-project-file";
import { resolveProjectFilePath } from "@/lib/path/utils";
import { getProjectPath } from "@/lib/backend";
import { Tooltip } from "@/components/ui/tooltip";

/** Counts added and removed lines between `original` and `replacement`. */
const countDiff = (original: string, replacement: string): { add: number; del: number } =>
    countChangedLines(original, replacement);

/** Splits a file path into its basename and ancestor directory segments. */
const splitPathSegments = (file: string): { fileName: string; parents: string[] } => {
    const parts = file.split(/[\\/]/).filter(Boolean);
    const last = parts.at(-1);
    return {
        fileName: last ? last : file,
        parents: parts.slice(0, -1),
    };
};

/** Computes the shortest trailing parent suffix that distinguishes `parents` among peers. */
const shortestUniqueParentHint = (parents: string[], peerParents: string[][]): string => {
    if (peerParents.length === 0 || parents.length === 0) return "";
    for (let depth = 1; depth <= parents.length; depth++) {
        const candidate = parents.slice(-depth).join("/");
        const collides = peerParents.some((other) => other.slice(-depth).join("/") === candidate);
        if (!collides) return candidate;
    }
    return parents.join("/");
};

/** Renders the PendingEditsPanel UI component. */
export const PendingEditsPanel = ({
    edits,
    onAcceptAll,
    onRejectAll,
    onAccept,
    onReject,
}: {
    edits: { id: string; file: string; original: string; replacement: string; baseline?: string }[];
    onAcceptAll: () => void;
    onRejectAll: () => void;
    onAccept?: (id: string) => void;
    onReject?: (id: string) => void;
    embedded?: boolean;
}) => {
    const withStats = useMemo(() => {
        const parsed = edits.map((edit) => ({
            edit,
            normPath: edit.file.replace(/\\/g, "/"),
            ...splitPathSegments(edit.file),
        }));
        return parsed.map((entry) => {
            const peerParents = parsed
                .filter((p) => p.fileName === entry.fileName && p.normPath !== entry.normPath)
                .map((p) => p.parents);
            return {
                ...entry.edit,
                fileName: entry.fileName,
                parentHint: shortestUniqueParentHint(entry.parents, peerParents),
                ...countDiff(entry.edit.original, entry.edit.replacement),
            };
        });
    }, [edits]);

    if (edits.length === 0) return null;

    const pillClass =
        "inline-flex h-6.5 shrink-0 items-center gap-1.5 squircle-lg border border-border-subtle bg-surface-3/90 px-2.5 text-xs font-medium text-text-secondary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary data-[state=open]:bg-[var(--btn-open)] data-[state=open]:hover:bg-[var(--btn-open-hover)] data-[state=open]:text-text-primary";

    const addTotal = withStats.reduce((s, e) => s + e.add, 0);
    const delTotal = withStats.reduce((s, e) => s + e.del, 0);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button type="button" className={pillClass}>
                    <span>Changes</span>
                    {addTotal > 0 || delTotal > 0 ? (
                        <span className="inline-flex items-center gap-1 tabular-nums">
                            {addTotal > 0 ? <span className="text-success">+{addTotal}</span> : null}
                            {delTotal > 0 ? <span className="text-error">-{delTotal}</span> : null}
                        </span>
                    ) : (
                        <span className="tabular-nums text-text-muted">{edits.length}</span>
                    )}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-76 p-1">
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <span className="text-xs font-medium tabular-nums text-text-muted">
                        {edits.length} file{edits.length === 1 ? "" : "s"}
                    </span>
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="xs" onClick={onRejectAll}>
                            Undo
                        </Button>
                        <Button variant="ghost" size="xs" onClick={onAcceptAll}>
                            Keep
                        </Button>
                    </div>
                </div>
                {withStats.map((edit) => (
                    <div
                        key={edit.id}
                        className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)]"
                    >
                        <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            onClick={() => {
                                const resolved = resolveProjectFilePath(edit.file, getProjectPath());
                                openProjectFile(edit.file, edit.fileName)
                                    .then((ok) => {
                                        if (!ok) return;
                                        window.dispatchEvent(
                                            new CustomEvent("bettershape-layout-toggle", {
                                                detail: { id: "agent-workspace", value: true },
                                            }),
                                        );
                                        requestAnimationFrame(() => {
                                            window.dispatchEvent(
                                                new CustomEvent("bettershape-editor-preview-diff", {
                                                    detail: {
                                                        path: resolved,
                                                        original: edit.original,
                                                        replacement: edit.replacement,
                                                    },
                                                }),
                                            );
                                        });
                                    })
                                    .catch(() => {
                                        /* ignore */
                                    });
                            }}
                        >
                            <FileIcon name={edit.fileName} className="size-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate text-text-primary">
                                {edit.fileName}
                                {edit.parentHint ? (
                                    <span className="ml-1.5 text-xs text-text-muted">
                                        {edit.parentHint}
                                    </span>
                                ) : null}
                            </span>
                            <span className="shrink-0 tabular-nums text-xs">
                                {edit.add > 0 ? <span className="text-success">+{edit.add}</span> : null}
                                {edit.add > 0 && edit.del > 0 ? " " : null}
                                {edit.del > 0 ? <span className="text-error">-{edit.del}</span> : null}
                            </span>
                        </button>
                        {onAccept ? (
                            <Tooltip content="Keep">
                                <button
                                    type="button"
                                    aria-label="Keep this edit"
                                    className="flex size-[24px] shrink-0 items-center justify-center rounded-md text-text-muted transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-success active:scale-[0.94]"
                                    onClick={() => onAccept(edit.id)}
                                >
                                    <Icon icon={Checkmark20Regular} className="size-3.5" />
                                </button>
                            </Tooltip>
                        ) : null}
                        {onReject ? (
                            <Tooltip content="Undo">
                                <button
                                    type="button"
                                    aria-label="Undo this edit"
                                    className="flex size-[24px] shrink-0 items-center justify-center rounded-md text-text-muted transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-error active:scale-[0.94]"
                                    onClick={() => onReject(edit.id)}
                                >
                                    <Icon icon={Dismiss20Regular} className="size-3.5" />
                                </button>
                            </Tooltip>
                        ) : null}
                    </div>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
