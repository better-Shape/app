"use client";

import { useMemo } from "react";
import { cn, createOccurrenceKeyer } from "@/lib/utils";
import {
    parseUnifiedDiffBody,
    unifiedDiffRows,
    type UnifiedDiffRow,
} from "@/lib/ui/diff-count";

/** Renders the DiffRows UI component. */
const DiffRows = ({ rows }: { rows: UnifiedDiffRow[] }) => {
    if (rows.length === 0) return null;
    const keyFor = createOccurrenceKeyer();
    return (
        <div className="custom-scrollbar relative mt-1 mb-1 max-h-56 w-full overflow-auto squircle-xl border border-border-subtle bg-surface-2/60 py-1.5 font-mono text-xs leading-5">
            <div className="min-w-full w-max">
                {rows.map((row) => {
                    if (row.type === "hunk") return null;
                    const num = row.type === "remove" ? row.oldNum : row.newNum ?? row.oldNum;
                    const marker = row.type === "add" ? "+" : row.type === "remove" ? "-" : " ";
                    return (
                        <div
                            key={keyFor(`${row.type}:${row.oldNum ?? ""}:${row.newNum ?? ""}`)}
                            className={cn(
                                "flex min-w-full",
                                row.type === "add" && "bg-success/10 text-success",
                                row.type === "remove" && "bg-error/10 text-error",
                                row.type === "context" && "text-text-secondary",
                            )}
                        >
                            <span className="w-8 shrink-0 select-none px-1.5 text-right tabular-nums text-text-disabled">
                                {num ?? ""}
                            </span>
                            <span
                                aria-hidden
                                className={cn(
                                    "w-4 shrink-0 select-none text-center",
                                    row.type === "add" && "text-success/80",
                                    row.type === "remove" && "text-error/80",
                                    row.type === "context" && "text-text-disabled",
                                )}
                            >
                                {marker}
                            </span>
                            <span className="whitespace-pre pr-3">{row.line || " "}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

/** Unified edit preview from before/after content. */
export function ChatEditDiff({
    original,
    replacement,
}: {
    original: string;
    replacement: string;
}) {
    const rows = useMemo(
        () => unifiedDiffRows(original || "", replacement || "", 4),
        [original, replacement],
    );
    return <DiffRows rows={rows} />;
}

/** Unified preview for a git/patch body string. */
export function ChatPatchDiff({ body }: { body: string }) {
    const rows = useMemo(() => parseUnifiedDiffBody(body || ""), [body]);
    if (!body.trim()) {
        return <span className="px-1 text-sm text-text-muted">No diff output</span>;
    }
    return <DiffRows rows={rows} />;
}
