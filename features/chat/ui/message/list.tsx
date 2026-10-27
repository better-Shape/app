"use client";

import React, { type RefObject, type ReactNode } from "react";
import { History20Regular } from "@fluentui/react-icons/headless/svg/history";
import { ChatMessageItem } from "./item";
import type { ChatMessage } from "@/lib/backend";
import type { ChatMessageGroup } from "@/features/chat/lib/chat-session-utils";
import { Icon } from "@/components/ui/icon";
import { isCssHighlightsSupported } from "@/lib/chat/dom-highlights";
import { usePerfRenderCount } from "@/lib/dev/perf-hud-hooks";
import { cn } from "@/lib/utils";

type ChatTurnProps = {
    group: ChatMessageGroup;
    groupIdx: number;
    /** True while this turn holds the message being streamed into. */
    isGenerating: boolean;
    activityLabel: string | null;
    /** Index of the newest message; only the matching item can be "live". */
    lastMessageIndex: number;
    messagesRef?: RefObject<ChatMessage[]>;
    onRedo: (msgIdx: number) => void;
    onRestore: (msgIdx: number) => void;
    onFork?: (msgIdx: number) => void;
    isFileEditResolved: (file: string, replacement?: string) => boolean;
    fullWidthBubbles?: boolean;
    highlightedMessageIndex?: number | null;
    /** Settled turns get layout/style containment but stay mounted and visible to browser find. */
    settled: boolean;
};

/**
 * One turn. Memoized on a group array that `groupChatMessages` keeps stable
 * while its messages are unchanged, so streaming into the last turn no longer
 * re-renders every earlier turn in the transcript.
 *
 * The node stays mounted either way — browser find, Ctrl+A and scroll anchoring
 * keep working, unlike a windowed list.
 */
const ChatTurn = React.memo(function ChatTurn({
    group,
    groupIdx,
    isGenerating,
    activityLabel,
    lastMessageIndex,
    messagesRef,
    onRedo,
    onRestore,
    onFork,
    isFileEditResolved,
    fullWidthBubbles,
    highlightedMessageIndex,
    settled,
}: ChatTurnProps) {
    return (
        <div
            data-chat-turn={groupIdx}
            className="relative mb-3 flex flex-col gap-2 first:mt-2 last:mb-10 scroll-mt-4"
            style={settled ? SETTLED_TURN_STYLE : undefined}
        >
            {group.map(({ msg, msgIdx }) => {
                const isGen =
                    isGenerating
                    && msg.role === "assistant"
                    && msgIdx === lastMessageIndex;
                const isFindTarget = highlightedMessageIndex === msgIdx;
                const showFallbackBoxHighlight = isFindTarget && !isCssHighlightsSupported();
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
                            messagesRef={messagesRef}
                        />
                    </div>
                );
            })}
        </div>
    );
});
ChatTurn.displayName = "ChatTurn";

/**
 * Isolate settled historical turns with layout + style containment (never
 * `content-visibility: auto`, which introduces placeholder height-estimation
 * scroll jumps on variable-height assistant turns).
 */
const SETTLED_TURN_STYLE = { contain: "layout style" } as const;

/** Renders the ChatMessageListInner UI component. */
const ChatMessageListInner = ({
    messageGroups,
    messages,
    isLoading,
    activityLabel,
    messagesEndRef,
    messagesRef,
    onRedo,
    onRestore,
    onFork,
    isFileEditResolved,
    emptyState,
    contextSummarized,
    fullWidthBubbles,
    highlightedMessageIndex,
}: {
    messageGroups: ChatMessageGroup[];
    messages: ChatMessage[];
    isLoading: boolean;
    activityLabel: string | null;
    messagesEndRef: RefObject<HTMLDivElement | null>;
    /** Live transcript, read on demand by message menus so items stay memoized. */
    messagesRef?: RefObject<ChatMessage[]>;
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
}) => {
    usePerfRenderCount("chat.list");
    const lastGroupIdx = messageGroups.length - 1;
    const lastMessageIndex = messages.length - 1;
    return (
        <>
            {messages.length === 0 ? (
                <div className="flex min-h-full w-full flex-col">
                    {emptyState ?? null}
                </div>
            ) : (
                messageGroups.map((group, groupIdx) => {
                    const holdsLast = group.some((entry) => entry.msgIdx === lastMessageIndex);
                    const generating = isLoading && holdsLast;
                    const isLiveTurn = isLoading && groupIdx === lastGroupIdx;
                    return (
                        <ChatTurn
                            // msgIdx is unique per message; two turns can share a
                            // timestamp and React would reuse state across them.
                            key={`turn-${group[0]?.msgIdx ?? groupIdx}`}
                            group={group}
                            groupIdx={groupIdx}
                            isGenerating={generating}
                            activityLabel={generating ? activityLabel : null}
                            lastMessageIndex={lastMessageIndex}
                            messagesRef={messagesRef}
                            onRedo={onRedo}
                            onRestore={onRestore}
                            onFork={onFork}
                            isFileEditResolved={isFileEditResolved}
                            fullWidthBubbles={fullWidthBubbles}
                            highlightedMessageIndex={highlightedMessageIndex}
                            settled={!isLiveTurn}
                        />
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
};

/** Renders the ChatMessageList UI component. */
export const ChatMessageList = React.memo(ChatMessageListInner);
