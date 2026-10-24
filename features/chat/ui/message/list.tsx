"use client";

import React, { type RefObject, type ReactNode } from "react";
import { History20Regular } from "@fluentui/react-icons/headless/svg/history";
import { ChatMessageItem } from "./item";
import type { ChatMessage } from "@/lib/backend";
import { Icon } from "@/components/ui/icon";
import { isCssHighlightsSupported } from "@/lib/chat/dom-highlights";
import { cn } from "@/lib/utils";

/**
 * Isolate settled historical turns with layout + style containment (never
 * `content-visibility: auto`, which introduces placeholder height-estimation
 * scroll jumps on variable-height assistant turns).
 */
const SETTLED_TURN_STYLE = { contain: "layout style" } as const;

function ChatMessageListInner({
    messageGroups,
    messages,
    isLoading,
    activityLabel,
    messagesEndRef,
    onRedo,
    onRestore,
    onFork,
    isFileEditResolved,
    emptyState,
    contextSummarized,
    fullWidthBubbles,
    highlightedMessageIndex,
}: {
    messageGroups: { msg: ChatMessage; msgIdx: number }[][];
    messages: ChatMessage[];
    isLoading: boolean;
    activityLabel: string | null;
    messagesEndRef: RefObject<HTMLDivElement | null>;
    onRedo: (msgIdx: number) => void;
    onRestore: (msgIdx: number) => void;
    onFork?: (msgIdx: number) => void;
    isFileEditResolved: (file: string, replacement?: string) => boolean;
    emptyState?: ReactNode;
    /** True once older turns of this chat were folded into a summary. */
    contextSummarized?: boolean;
    activeChatTabId?: string;
    /** @deprecated sticky removed */
    stickyTurnIndex?: number;
    fullWidthBubbles?: boolean;
    highlightedMessageIndex?: number | null;
}) {
    const lastGroupIdx = messageGroups.length - 1;
    return (
        <>
            {messages.length === 0 ? (
                <div className="flex min-h-full w-full flex-col">
                    {emptyState ?? null}
                </div>
            ) : (
                messageGroups.map((group, groupIdx) => {
                    const isLiveTurn = isLoading && groupIdx === lastGroupIdx;
                    return (
                        <div
                            key={`turn-${group[0]?.msg.timestamp ?? groupIdx}`}
                            data-chat-turn={groupIdx}
                            style={isLiveTurn ? undefined : SETTLED_TURN_STYLE}
                            className="relative mb-3 flex flex-col gap-2 first:mt-2 last:mb-10 scroll-mt-4"
                        >
                            {group.map(({ msg, msgIdx }) => {
                                const isGen =
                                    isLoading
                                    && msg.role === "assistant"
                                    && msgIdx === messages.length - 1;
                                const isFindTarget = highlightedMessageIndex === msgIdx;
                                const showFallbackBoxHighlight =
                                    isFindTarget && !isCssHighlightsSupported();
                                return (
                                    <div
                                        key={`${msg.role}-${msg.timestamp}-${msgIdx}`}
                                        data-chat-message-index={msgIdx}
                                        data-chat-find-active={isFindTarget ? "true" : undefined}
                                        className={cn(
                                            "rounded-lg transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                                            showFallbackBoxHighlight &&
                                                "bg-surface-3 px-1.5 -mx-1.5 ring-1 ring-border-secondary",
                                        )}
                                    >
                                        <ChatMessageItem
                                            role={msg.role}
                                            content={msg.content}
                                            timestamp={msg.timestamp}
                                            stats={msg.stats}
                                            model={msg.model}
                                            isGenerating={isGen}
                                            activityLabel={isGen ? activityLabel : null}
                                            index={msgIdx}
                                            onRedo={onRedo}
                                            onRestore={onRestore}
                                            onFork={onFork}
                                            isFileEditResolved={isFileEditResolved}
                                            fullWidthBubbles={fullWidthBubbles}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    );
                })
            )}
            {contextSummarized ? (
                <div className="mx-auto mt-1 flex w-full max-w-xl items-center justify-center gap-1.5 px-1 pb-1 text-[11px] leading-4 text-text-muted">
                    <Icon icon={History20Regular} className="size-3.5 shrink-0" />
                    <span>Earlier turns are summarized for the model. The full transcript is still above.</span>
                </div>
            ) : null}
            <div ref={messagesEndRef} className="h-4 shrink-0" aria-hidden />
        </>
    );
}

export const ChatMessageList = React.memo(ChatMessageListInner);
