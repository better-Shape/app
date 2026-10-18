import { Branch20Regular } from "@fluentui/react-icons/headless/svg/branch";
import { Circle20Filled } from "@fluentui/react-icons/headless/svg/circle";
import { Tag20Regular } from "@fluentui/react-icons/headless/svg/tag";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

export type RefInfo = {
    label: string;
    isRemote: boolean;
    isHead: boolean;
    isTag: boolean;
};

/** Ref chips styled after vscode-git-graph's colored icon strip and name. */
function RefPillVisual({
    refInfo,
    color,
    emphasized,
    className,
}: {
    refInfo: RefInfo;
    color: string;
    emphasized?: boolean;
    className?: string;
}) {
    const raw = refInfo.label.replace(/^tag:\s*/i, "");
    const icon = refInfo.isTag ? Tag20Regular : refInfo.isHead ? Circle20Filled : Branch20Regular;
    return (
        <span
            className={cn(
                "inline-flex h-[18px] max-w-[190px] shrink-0 items-center overflow-hidden rounded-[5px] text-text-primary",
                "bg-black/10 dark:bg-white/10",
                className,
            )}
            style={{
                border: `1px solid ${emphasized ? color : "color-mix(in srgb, var(--color-border) 80%, transparent)"}`,
            }}
        >
            <span
                className="flex h-full w-[16px] shrink-0 items-center justify-center"
                style={{ backgroundColor: color }}
            >
                <Icon icon={icon} className="text-[var(--graph-surface,var(--color-panel))]" />
            </span>
            <span
                className={cn(
                    "truncate px-1.5 text-[12px] leading-[18px]",
                    emphasized ? "font-semibold" : "font-medium",
                    refInfo.isRemote && "italic opacity-90",
                )}
            >
                {raw}
            </span>
        </span>
    );
}

export function RefPill({
    refInfo,
    color,
    emphasized,
    /** Manager graph: keep hover styling, skip the tooltip overlay. */
    hoverOnly = false,
    onActivate,
}: {
    refInfo: RefInfo;
    color: string;
    emphasized?: boolean;
    hoverOnly?: boolean;
    /** Click / activate — e.g. filter graph to this branch. */
    onActivate?: (ref: RefInfo) => void;
}) {
    const raw = refInfo.label.replace(/^tag:\s*/i, "");
    const kind = refInfo.isTag ? "Tag" : refInfo.isRemote ? "Remote branch" : refInfo.isHead ? "HEAD" : "Branch";
    const visual = <RefPillVisual refInfo={refInfo} color={color} emphasized={emphasized} />;

    if (onActivate) {
        return (
            <button
                type="button"
                aria-label={`Filter graph to ${kind}: ${raw}`}
                title={`${kind}: ${raw}`}
                className="inline-flex shrink-0 cursor-pointer rounded-sm transition-[filter,transform] duration-[var(--transition-fast)] ease-[var(--ease-out)] hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
                onClick={(event) => {
                    event.stopPropagation();
                    onActivate(refInfo);
                }}
                onPointerDown={(event) => event.stopPropagation()}
            >
                {visual}
            </button>
        );
    }

    const pill = (
        <span
            className={cn(
                "inline-flex shrink-0",
                hoverOnly && "transition-[filter,transform] duration-[var(--transition-fast)] ease-[var(--ease-out)] hover:brightness-110",
            )}
            title={hoverOnly ? `${kind}: ${raw}` : undefined}
        >
            {visual}
        </span>
    );

    if (hoverOnly) return pill;

    return (
        <Tooltip
            side="top"
            align="center"
            delayDuration={250}
            sideOffset={6}
            content={
                <div className="flex max-w-[280px] flex-col gap-1.5 px-0.5 py-0.5">
                    <RefPillVisual
                        refInfo={refInfo}
                        color={color}
                        emphasized={emphasized}
                        className="h-5 max-w-none"
                    />
                    <div className="flex flex-col gap-0.5 px-0.5">
                        <span className="text-xs text-text-muted">{kind}</span>
                        <span className="break-all text-sm text-text-primary">{raw}</span>
                    </div>
                </div>
            }
        >
            {pill}
        </Tooltip>
    );
}
