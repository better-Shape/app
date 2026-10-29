"use client";

import { useMemo } from "react";
import { cn, createOccurrenceKeyer } from "@/lib/utils";
import {
    parseUnifiedDiffBody,
    unifiedDiffRows,
    type UnifiedDiffRow,
} from "@/lib/ui/diff-count";

type RenderableDiffRowType = Exclude<UnifiedDiffRow["type"], "hunk">;

const DIFF_ROW_STYLES: Record<
    RenderableDiffRowType,
    {
        marker: string;
        srPrefix: string;
        rowClass: string;
        markerClass: string;
    }
> = {
    add: {
        marker: "+",
        srPrefix: "Added line ",
        rowClass: "bg-success/10 text-success",
        markerClass: "text-success/80",
    },
    remove: {
        marker: "-",
        srPrefix: "Removed line ",
        rowClass: "bg-error/10 text-error",
        markerClass: "text-error/80",
    },
    context: {
        marker: " ",
        srPrefix: "",
        rowClass: "text-text-secondary",
        markerClass: "text-text-disabled",
    },
};

/** Resolves the displayed line number for a renderable diff row. */
const resolveDiffLineNumber = (row: UnifiedDiffRow): number | undefined =>
    row.type === "remove" ? row.oldNum : row.newNum ?? row.oldNum;

/** Renders a single unified diff line with visual marker and screen-reader change label. */
const DiffLineRow = ({
    row,
    rowType,
}: {
    row: UnifiedDiffRow;
    rowType: RenderableDiffRowType;
}) => {
    const style = DIFF_ROW_STYLES[rowType];
    const lineNum = resolveDiffLineNumber(row);
    return (
        <div className={cn("flex min-w-full", style.rowClass)}>
            <span className="w-8 shrink-0 select-none px-1.5 text-right tabular-nums text-text-disabled">
                {lineNum ?? ""}
            </span>
            {style.srPrefix ? (
                <span className="sr-only" data-quote-skip>
                    {style.srPrefix}
                </span>
            ) : null}
            <span
                aria-hidden
                className={cn(
                    "w-4 shrink-0 select-none text-center",
                    style.markerClass,
                )}
            >
                {style.marker}
            </span>
            <span className="whitespace-pre pr-3">{row.line || " "}</span>
        </div>
    );
};

/** Renders a unified diff hunk or patch file header line (`@@ ... @@`, `---`, `+++`, `diff`). */
const DiffHunkHeaderRow = ({ line }: { line: string }) => (
    <div
        data-quote-skip
        className="flex min-w-full select-none bg-surface-3/40 px-2 py-0.5 text-2xs text-text-muted"
    >
        <span className="whitespace-pre">{line}</span>
    </div>
);

/** Renders the DiffRows UI component. */
const DiffRows = ({ rows }: { rows: UnifiedDiffRow[] }) => {
    if (rows.length === 0) return null;
    const keyFor = createOccurrenceKeyer();
    return (
        <div className="custom-scrollbar relative mt-1 mb-1 max-h-56 w-full overflow-auto squircle-xl border border-border-subtle bg-surface-2/60 py-1.5 font-mono text-xs leading-5">
            <div className="min-w-full w-max">
                {rows.map((row) =>
                    row.type === "hunk" ? (
                        <DiffHunkHeaderRow
                            key={keyFor(`hunk:${row.line}`)}
                            line={row.line}
                        />
                    ) : (
                        <DiffLineRow
                            key={keyFor(
                                `${row.type}:${row.oldNum ?? ""}:${row.newNum ?? ""}`,
                            )}
                            row={row}
                            rowType={row.type}
                        />
                    ),
                )}
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
