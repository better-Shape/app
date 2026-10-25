import { cn } from "@/lib/utils";

export type IndexProgressStatus = {
    filesIndexed: number;
    totalFiles: number;
    chunks: number;
} | null;

/** Keeps indexing indeterminate while scanning or saving, never announcing 100% early. */
export function IndexingProgressBar({
    indexing,
    phase,
    percent,
    status,
}: {
    indexing: boolean;
    phase?: string;
    percent: number;
    status: IndexProgressStatus;
}) {
    const scanning = indexing && phase === "scanning";
    const persisting = indexing && phase === "persisting";
    const indeterminate = scanning || persisting;
    const safePercent = Number.isFinite(percent) ? Math.min(Math.max(Math.round(percent), 0), 99) : 0;
    const valueNow = indeterminate
        ? undefined
        : indexing
          ? safePercent
          : status?.filesIndexed
            ? 100
            : 0;
    const valueText = indexing
        ? scanning
            ? "Scanning files"
            : persisting
              ? "Saving index"
              : `Indexing ${safePercent}%`
        : status
          ? "Indexed"
          : "Not indexed yet";
    const width = indeterminate
        ? undefined
        : indexing
          ? Math.max(safePercent, 4)
          : status
            ? Math.max(percent, status.filesIndexed ? 100 : 0)
            : 0;

    return (
        <div
            className="mt-3 h-0.5 w-full overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-label="Project indexing"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={valueNow}
            aria-valuetext={valueText}
        >
            <div
                className={cn(
                    "h-full rounded-full bg-success",
                    indeterminate && "bettershape-loading-progress",
                )}
                style={width === undefined ? undefined : { width: `${width}%` }}
            />
        </div>
    );
}
