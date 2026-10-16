"use client";

import { Add20Regular } from "@fluentui/react-icons/headless/svg/add";
import { ArrowSync20Regular } from "@fluentui/react-icons/headless/svg/arrow-sync";
import { ArrowUpload20Regular } from "@fluentui/react-icons/headless/svg/arrow-upload";
import { Branch20Regular } from "@fluentui/react-icons/headless/svg/branch";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";
import { Cloud20Regular } from "@fluentui/react-icons/headless/svg/cloud";
import { CloudOff20Regular } from "@fluentui/react-icons/headless/svg/cloud-off";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { GitChromeActions } from "@/features/git/ui/manager/chrome";
import { resolveGithubAvatarUrl } from "@/lib/git/github-avatar";
import { cn } from "@/lib/utils";
import type { BranchActions } from "./actions";
import type { BranchItem, RemoteSlice } from "./data";

/**
 * The author's avatar, or nothing when the email is not one GitHub can resolve.
 *
 * Decorative by design: the author's name is written beside it, so an empty alt is correct
 * and a broken URL leaves a gap rather than a broken-image glyph.
 */
export const Avatar = ({
    name,
    email,
    size = 22,
}: {
    name?: string;
    email?: string;
    size?: number;
}) => {
    const url = resolveGithubAvatarUrl(email, name, size * 2);
    if (!url) return null;
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={url}
            alt=""
            width={size}
            height={size}
            className="shrink-0 rounded-full"
            draggable={false}
        />
    );
};

/** One direction a branch can be away from its upstream. */
type SyncLeg = { key: string; count: number; glyph: string; tone: string };

/**
 * The legs worth showing: only the directions with something in them.
 *
 * Both directions are built the same way so the pill order is fixed by this list rather than
 * by which count happens to be non-zero, which is what keeps the two pills from swapping
 * places as a branch moves.
 */
const syncLegs = (ahead?: number | null, behind?: number | null): SyncLeg[] => {
    const legs: SyncLeg[] = [
        { key: "ahead", count: ahead ?? 0, glyph: "↑", tone: "text-git-added" },
        { key: "behind", count: behind ?? 0, glyph: "↓", tone: "text-git-deleted" },
    ];
    return legs.filter((leg) => leg.count > 0);
};

/** The distance to the upstream, or `synced` when there is nothing to catch up on. */
export const SyncPills = ({ ahead, behind }: { ahead?: number | null; behind?: number | null }) => {
    if (ahead == null && behind == null) return null;
    const legs = syncLegs(ahead, behind);
    if (legs.length === 0) {
        return <span className="text-[11px] text-text-muted tabular-nums">synced</span>;
    }
    return (
        <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-text-muted">
            {legs.map((leg) => (
                <span key={leg.key} className={leg.tone}>
                    {leg.glyph}
                    {leg.count}
                </span>
            ))}
        </span>
    );
};

/** The second line of a row: what is known about the tip, or nothing when nothing is. */
const rowMeta = (item: BranchItem) =>
    [item.author, item.date].filter(Boolean).join(" · ");

/**
 * The row's own fill, in ladder order: selected, then the branch that is checked out.
 *
 * A checked-out row that is also selected keeps the selected fill, because the selection is
 * what the menus below act on and the checked-out mark is already written beside the name.
 */
const rowFill = ({ selected, isCurrent }: { selected: boolean; isCurrent: boolean }) =>
    cn(
        "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
        selected
            ? "bg-[var(--row-selected)] hover:bg-[var(--row-selected-hover)] text-text-primary"
            : "text-text-secondary hover:bg-[var(--row-hover)] hover:text-text-primary",
        isCurrent && !selected && "bg-accent/10 text-text-primary",
    );

/** The icon a row carries: the cloud for a remote ref, a branch otherwise. */
const rowIcon = (item: BranchItem) =>
    item.kind === "remote" ? Cloud20Regular : Branch20Regular;

/** A menu entry that only exists when the row offers the action. */
const OptionalItem = ({
    onClick,
    danger,
    children,
}: {
    onClick?: () => void;
    danger?: boolean;
    children: ReactNode;
}) => {
    if (!onClick) return null;
    return (
        <ContextMenuItem onClick={onClick} className={danger ? "text-error" : undefined}>
            {children}
        </ContextMenuItem>
    );
};

/** The separator in front of Delete, which is only there when Delete is. */
const OptionalSeparator = ({ shown }: { shown: boolean }) => (shown ? <ContextMenuSeparator /> : null);

/**
 * The row's two lines: the ref name with its HEAD mark, and what is known about the tip.
 *
 * It is its own component because the row is already three elements deep at this point, and a
 * deeper tree here would hide the row's structure from a reader and from the JSX depth rule.
 */
const RowLabel = ({
    item,
    isCurrent,
    meta,
}: {
    item: BranchItem;
    isCurrent: boolean;
    meta: string;
}) => (
    <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm">{item.displayName}</span>
            {isCurrent ? (
                <span className="shrink-0 rounded-md bg-accent/20 px-1 py-px text-[10px] font-medium text-accent">
                    HEAD
                </span>
            ) : null}
        </div>
        {meta ? <div className="truncate text-[11px] text-text-muted">{meta}</div> : null}
    </div>
);

export type BranchRowProps = {
    item: BranchItem;
    isCurrent: boolean;
    selected: boolean;
    onSelect: () => void;
    onCheckout: () => void;
    onCopy: () => void;
    onCompare?: () => void;
    onRename?: () => void;
    onSetUpstream?: () => void;
    onDelete?: () => void;
};

/**
 * One branch row, with the actions for it behind a right-click.
 *
 * A double click checks the branch out, which is the shortcut the detail pane's button spells
 * out; the menus carry everything else, so the row itself stays two lines and a pill.
 */
export const BranchRow = (props: BranchRowProps) => {
    const { item, isCurrent, selected, onSelect, onCheckout } = props;
    const meta = rowMeta(item);

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <button
                    type="button"
                    onClick={onSelect}
                    onDoubleClick={onCheckout}
                    className={rowFill({ selected, isCurrent })}
                >
                    <Icon
                        icon={rowIcon(item)}
                        className={cn("shrink-0", isCurrent ? "text-accent" : "text-text-muted")}
                    />
                    <RowLabel item={item} isCurrent={isCurrent} meta={meta} />
                    <SyncPills ahead={item.ahead} behind={item.behind} />
                </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onClick={onCheckout}>Checkout</ContextMenuItem>
                <ContextMenuItem onClick={props.onCopy}>Copy name</ContextMenuItem>
                <OptionalItem onClick={props.onCompare}>Compare with current</OptionalItem>
                <OptionalItem onClick={props.onRename}>Rename…</OptionalItem>
                <OptionalItem onClick={props.onSetUpstream}>Set upstream…</OptionalItem>
                <OptionalSeparator shown={Boolean(props.onDelete)} />
                <OptionalItem onClick={props.onDelete} danger>
                    Delete
                </OptionalItem>
            </ContextMenuContent>
        </ContextMenu>
    );
};

/** A section's disclosure header: the count and the chevron both move on one state. */
export const SectionHeader = ({
    label,
    count,
    open,
    onToggle,
}: {
    label: string;
    count: number;
    open: boolean;
    onToggle: () => void;
}) => (
    <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)] hover:text-text-secondary"
    >
        <Icon
            icon={ChevronRight20Regular}
            className={cn(
                "shrink-0 transition-transform duration-[var(--spring-flick-dur)] ease-[var(--spring-flick)]",
                open && "rotate-90",
            )}
        />
        <span className="flex-1">{label}</span>
        <span className="tabular-nums opacity-80">{count}</span>
    </button>
);

/** The toolbar's three remote actions, plus the read that shows their effect. */
const BranchToolbar = ({
    loading,
    actions,
}: {
    loading: boolean;
    actions: BranchActions;
}) => (
    <GitChromeActions>
        <Tooltip content="Fetch">
            <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={actions.fetch}
                disabled={loading}
                aria-label="Fetch"
            >
                <Icon icon={ArrowSync20Regular} />
            </Button>
        </Tooltip>
        <Tooltip content="Pull">
            <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={actions.pull}
                disabled={loading}
                aria-label="Pull"
            >
                <Icon icon={CloudOff20Regular} />
            </Button>
        </Tooltip>
        <Tooltip content="Push">
            <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={actions.push}
                disabled={loading}
                aria-label="Push"
            >
                <Icon icon={ArrowUpload20Regular} />
            </Button>
        </Tooltip>
    </GitChromeActions>
);

/** The new-branch field: Enter creates, the same as the button beside it. */
const NewBranchField = ({
    value,
    onChange,
    onCreate,
}: {
    value: string;
    onChange: (value: string) => void;
    onCreate: () => void;
}) => (
    <div className="shrink-0 px-2.5 py-2">
        <div className="flex items-center gap-2">
            <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5">
                <Icon icon={Add20Regular} className="shrink-0 text-text-muted" />
                <Input
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder="New branch from HEAD…"
                    className="h-auto! bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                    onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        onCreate();
                    }}
                />
            </div>
            <Button
                size="sm"
                className="h-8 shrink-0"
                disabled={!value.trim()}
                onClick={onCreate}
            >
                Create
            </Button>
        </div>
    </div>
);

/** The sentence under a cut-down list, which names the filter as the way past the cap. */
const TruncationNote = ({ visible, total, noun }: { visible: number; total: number; noun: string }) => (
    <div className="px-2 py-1.5 text-xs text-text-muted">
        Showing {visible} of {total} {noun}. Type to search the rest.
    </div>
);

/** The empty state under a section that has nothing to show. */
const SectionEmpty = ({ text }: { text: string }) => (
    <div className="px-2 py-2 text-sm text-text-muted">{text}</div>
);

export type BranchListView = {
    active: boolean;
    loading: boolean;
    local: { items: BranchItem[]; visible: BranchItem[]; truncated: number; open: boolean };
    remote: {
        slices: RemoteSlice[];
        total: number;
        visible: number;
        truncated: number;
        open: boolean;
    };
    currentBranch: string;
    selectedName: string | null;
    newBranchName: string;
    collapsedRemotes: ReadonlySet<string>;
    actions: BranchActions;
    onNameChange: (value: string) => void;
    onCreate: () => void;
    onToggleLocal: () => void;
    onToggleRemote: () => void;
    onToggleRemoteGroup: (remote: string) => void;
    onSelectItem: (item: BranchItem) => void;
    onCheckoutItem: (item: BranchItem) => void;
    onCopyItem: (item: BranchItem) => void;
    onCompareItem: (item: BranchItem) => void;
    onRenameItem: (item: BranchItem) => void;
    onUpstreamItem: (item: BranchItem) => void;
    onDeleteItem: (item: BranchItem) => void;
};

/** Delete is offered on every local row except the one that is checked out. */
const deleteHandler = (item: BranchItem, current: string, onDelete: (item: BranchItem) => void) =>
    item.name === current ? undefined : () => onDelete(item);

/** The handlers one local row takes, with the row's own name already bound. */
const localRowHandlers = (view: BranchListView, item: BranchItem) => ({
    onSelect: () => view.onSelectItem(item),
    onCheckout: () => view.onCheckoutItem(item),
    onCopy: () => view.onCopyItem(item),
    onCompare: () => view.onCompareItem(item),
    onRename: () => view.onRenameItem(item),
    onSetUpstream: () => view.onUpstreamItem(item),
    onDelete: deleteHandler(item, view.currentBranch, view.onDeleteItem),
});

/** The handlers one remote row takes: a remote ref cannot be renamed or deleted here. */
const remoteRowHandlers = (view: BranchListView, item: BranchItem) => ({
    onSelect: () => view.onSelectItem(item),
    onCheckout: () => view.onCheckoutItem(item),
    onCopy: () => view.onCopyItem(item),
    onCompare: () => view.onCompareItem(item),
});

/** The local half: the disclosure, the rows and the truncation note. */
const LocalSection = ({ view }: { view: BranchListView }) => (
    <>
        <SectionHeader
            label="Local"
            count={view.local.items.length}
            open={view.local.open}
            onToggle={view.onToggleLocal}
        />
        <Collapse open={view.local.open}>
            <div className="mb-3 space-y-0.5">
                {view.local.items.length === 0 ? (
                    <SectionEmpty text="No local branches" />
                ) : (
                    <>
                        {view.local.visible.map((item) => (
                            <BranchRow
                                key={item.name}
                                item={item}
                                isCurrent={item.name === view.currentBranch}
                                selected={view.selectedName === item.name}
                                {...localRowHandlers(view, item)}
                            />
                        ))}
                        {view.local.truncated > 0 ? (
                            <TruncationNote
                                visible={view.local.visible.length}
                                total={view.local.items.length}
                                noun="branches"
                            />
                        ) : null}
                    </>
                )}
            </div>
        </Collapse>
    </>
);

/** One remote's group: its own disclosure, its rows, and its total. */
const RemoteGroup = ({ view, slice }: { view: BranchListView; slice: RemoteSlice }) => {
    const open = !view.collapsedRemotes.has(slice.remote);

    return (
        <div>
            <button
                type="button"
                onClick={() => view.onToggleRemoteGroup(slice.remote)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)] hover:text-text-secondary"
            >
                <Icon
                    icon={ChevronRight20Regular}
                    className={cn(
                        "transition-transform duration-[var(--spring-flick-dur)] ease-[var(--spring-flick)]",
                        open && "rotate-90",
                    )}
                />
                <Icon icon={Cloud20Regular} />
                <span className="flex-1 truncate font-medium">{slice.remote}</span>
                <span className="text-xs tabular-nums">{slice.total}</span>
            </button>
            <Collapse open={open}>
                <div className="ml-2 space-y-0.5 border-l border-border-subtle/50 pl-1">
                    {slice.items.map((item) => (
                        <BranchRow
                            key={item.name}
                            item={item}
                            isCurrent={item.displayName === view.currentBranch}
                            selected={view.selectedName === item.name}
                            {...remoteRowHandlers(view, item)}
                        />
                    ))}
                </div>
            </Collapse>
        </div>
    );
};

/** The remote half: the disclosure, one group per remote, and the truncation note. */
const RemoteSection = ({ view }: { view: BranchListView }) => (
    <>
        <SectionHeader
            label="Remote"
            count={view.remote.total}
            open={view.remote.open}
            onToggle={view.onToggleRemote}
        />
        <Collapse open={view.remote.open}>
            <div className="space-y-2">
                {view.remote.slices.length === 0 ? (
                    <SectionEmpty text="No remote branches" />
                ) : (
                    <>
                        {view.remote.slices.map((slice) => (
                            <RemoteGroup key={slice.remote} view={view} slice={slice} />
                        ))}
                        {view.remote.truncated > 0 ? (
                            <TruncationNote
                                visible={view.remote.visible}
                                total={view.remote.total}
                                noun="remote branches"
                            />
                        ) : null}
                    </>
                )}
            </div>
        </Collapse>
    </>
);

/**
 * The branch list: the remote toolbar, the new-branch field, then local and remote sections.
 *
 * The toolbar only renders while this pane is the active section, because it acts on the
 * repository rather than on the list and the manager already draws the chrome for whichever
 * section is on screen.
 */
export const BranchListPane = ({ view }: { view: BranchListView }) => (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        {view.active ? <BranchToolbar loading={view.loading} actions={view.actions} /> : null}
        <NewBranchField
            value={view.newBranchName}
            onChange={view.onNameChange}
            onCreate={view.onCreate}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <LocalSection view={view} />
            <RemoteSection view={view} />
        </div>
    </div>
);
