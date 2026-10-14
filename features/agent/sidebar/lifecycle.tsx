"use client";

/**
 * The one place that decides what a chat's menu says.
 *
 * The row menu and the sidebar's selection menu both call
 * `buildChatLifecycleActions`, so an action can never exist in one and be missing
 * from the other. Anything the backend cannot do is left out rather than shown
 * greyed out: a menu item that lies about what it will do is worse than a shorter
 * menu.
 */

import { Fragment, type ReactNode } from "react";
import { Copy20Regular } from "@fluentui/react-icons/headless/svg/copy";
import { Delete20Filled } from "@fluentui/react-icons/headless/svg/delete";
import { Edit20Regular } from "@fluentui/react-icons/headless/svg/edit";
import { FolderOpen20Regular } from "@fluentui/react-icons/headless/svg/folder-open";
import { Mail20Regular } from "@fluentui/react-icons/headless/svg/mail";
import { MailInbox20Regular } from "@fluentui/react-icons/headless/svg/mail-inbox";
import { Open20Regular } from "@fluentui/react-icons/headless/svg/open";
import { Pin20Regular } from "@fluentui/react-icons/headless/svg/pin";
import { Icon, type IconGlyph } from "@/components/ui/icon";

export interface ChatLifecycleTarget {
    id: string;
    title: string;
    /** Project folder, used by Reveal Folder. Empty when the chat has none. */
    path: string;
    pinned: boolean;
}

export interface ChatLifecycleHandlers {
    open(id: string): void;
    setPinned(ids: readonly string[], pinned: boolean): void;
    /**
     * Optional. A row supplies its own so the input is guaranteed to be on screen
     * when the menu item fires; a surface that cannot reach a row omits it and
     * gets no Rename item rather than one that quietly does nothing.
     */
    startRename?(id: string): void;
    markUnread(id: string): void;
    copyTitle(title: string): void;
    revealFolder(path: string): void;
    archive(ids: readonly string[]): void;
    remove(ids: readonly string[]): void;
    addToCollection(ids: readonly string[]): void;
}

export interface ChatLifecycleAction {
    key: string;
    label: string;
    icon: IconGlyph;
    run: () => void;
    danger?: boolean;
    /** Render a separator before this item. */
    sep?: boolean;
}

function plural(label: string, count: number): string {
    return count > 1 ? `${label} ${count} sessions` : label;
}

/**
 * Actions for `targets`, in the order given.
 *
 * Single-chat-only items (open, rename, mark unread, copy title, reveal folder)
 * disappear when more than one chat is selected, because the backend has no batch
 * form of them. Rename also disappears without a `startRename` handler. Pin and
 * unpin survive a multi-selection only while the selection agrees — a mixed
 * selection is not something either one-word label would describe.
 */
export function buildChatLifecycleActions(
    targets: readonly ChatLifecycleTarget[],
    handlers: ChatLifecycleHandlers,
): ChatLifecycleAction[] {
    if (targets.length === 0) return [];

    const ids = targets.map((target) => target.id);
    const single = targets.length === 1 ? targets[0] : null;
    const everyPinned = targets.every((target) => target.pinned);
    const somePinned = targets.some((target) => target.pinned);

    const actions: ChatLifecycleAction[] = [];

    if (single) {
        actions.push({
            key: "open",
            label: "Open",
            icon: Open20Regular,
            run: () => handlers.open(single.id),
        });
    }

    if (everyPinned || !somePinned) {
        actions.push({
            key: "pin",
            label: everyPinned ? plural("Unpin", ids.length) : plural("Pin", ids.length),
            icon: Pin20Regular,
            run: () => handlers.setPinned(ids, !everyPinned),
        });
    }

    if (single && handlers.startRename) {
        actions.push({
            key: "rename",
            label: "Rename",
            icon: Edit20Regular,
            run: () => handlers.startRename?.(single.id),
        });
    }

    if (single) {
        actions.push({
            key: "unread",
            label: "Mark unread",
            icon: Mail20Regular,
            run: () => handlers.markUnread(single.id),
        });
        actions.push({
            key: "copy",
            label: "Copy Title",
            icon: Copy20Regular,
            sep: true,
            run: () => handlers.copyTitle(single.title),
        });
        if (single.path) {
            actions.push({
                key: "reveal",
                label: "Reveal Folder",
                icon: FolderOpen20Regular,
                run: () => handlers.revealFolder(single.path),
            });
        }
    }

    actions.push({
        key: "archive",
        label: plural("Archive", ids.length),
        icon: MailInbox20Regular,
        sep: true,
        run: () => handlers.archive(ids),
    });
    actions.push({
        key: "delete",
        label: plural("Delete", ids.length),
        icon: Delete20Filled,
        danger: true,
        run: () => handlers.remove(ids),
    });

    return actions;
}

/** Item/separator pair, so the same list renders into dropdown and context menus. */
export interface LifecycleMenuPrimitives {
    Item: (props: {
        onClick?: () => void;
        className?: string;
        children?: ReactNode;
    }) => ReactNode;
    Separator: () => ReactNode;
}

export function renderLifecycleActions(
    actions: readonly ChatLifecycleAction[],
    { Item, Separator }: LifecycleMenuPrimitives,
): ReactNode {
    return actions.map((action) => (
        <Fragment key={action.key}>
            {action.sep ? Separator() : null}
            <Item onClick={action.run} className={action.danger ? "text-error" : undefined}>
                <Icon icon={action.icon} />
                {action.label}
            </Item>
        </Fragment>
    ));
}