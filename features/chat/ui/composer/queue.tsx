"use client";

import { ArrowUp20Regular } from "@fluentui/react-icons/headless/svg/arrow-up";
import { Clock20Regular } from "@fluentui/react-icons/headless/svg/clock";
import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import { Edit20Regular } from "@fluentui/react-icons/headless/svg/edit";

import React from "react";
import { Icon } from "@/components/ui/icon";
import { Tooltip } from "@/components/ui/tooltip";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";

export type QueuedMessage = {
    id: string;
    content: string;
};

/** Preview text. */
const previewText = (text: string, max = 120) => {
    const one = text.replace(/\s+/g, " ").trim();
    if (one.length <= max) return one;
    return `${one.slice(0, max - 3)}...`;
};

/** Renders the QueuedMessagesPanel UI component. */
export const QueuedMessagesPanel = ({
    items,
    onEdit,
    onRemove,
    onSendNow,
}: {
    items: QueuedMessage[];
    onEdit: (id: string) => void;
    onRemove: (id: string) => void;
    onSendNow?: (id: string) => void;
}) => {
    if (items.length === 0) return null;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className="inline-flex h-6.5 shrink-0 items-center gap-1.5 rounded-full border border-border-subtle bg-surface-3/90 px-2.5 text-xs font-medium text-text-secondary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary data-[state=open]:bg-[var(--btn-open)] data-[state=open]:hover:bg-[var(--btn-open-hover)] data-[state=open]:text-text-primary"
                    aria-label="Queued messages"
                >
                    <Icon icon={Clock20Regular} className="size-3.5 shrink-0 text-text-muted" />
                    <span>Queued</span>
                    <span className="tabular-nums text-text-muted">{items.length}</span>
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 p-1">
                {items.map((item) => (
                    <div
                        key={item.id}
                        className="flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)]"
                    >
                        <p className="min-w-0 flex-1 line-clamp-3 text-sm leading-snug text-text-primary">
                            {previewText(item.content, 160)}
                        </p>
                        <div className="flex shrink-0 items-center gap-1">
                            {onSendNow ? (
                                <Tooltip content="Send now">
                                    <button
                                        type="button"
                                        aria-label="Send queued message now"
                                        className="flex size-[24px] items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary"
                                        onClick={() => onSendNow(item.id)}
                                    >
                                        <Icon icon={ArrowUp20Regular} className="size-3.5" />
                                    </button>
                                </Tooltip>
                            ) : null}
                            <Tooltip content="Edit">
                                <button
                                    type="button"
                                    aria-label="Edit queued message"
                                    className="flex size-[24px] items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary"
                                        onClick={() => onEdit(item.id)}
                                >
                                    <Icon icon={Edit20Regular} className="size-3.5" />
                                </button>
                            </Tooltip>
                            <Tooltip content="Remove">
                                <button
                                    type="button"
                                    aria-label="Remove queued message"
                                    className="flex size-[24px] items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-error"
                                    onClick={() => onRemove(item.id)}
                                >
                                    <Icon icon={Dismiss20Regular} className="size-3.5" />
                                </button>
                            </Tooltip>
                        </div>
                    </div>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
