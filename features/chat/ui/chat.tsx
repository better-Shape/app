"use client";

import { ArrowDown20Regular } from "@fluentui/react-icons/headless/svg/arrow-down";
import { Eclipse } from "loading-dev";
import React, { useMemo } from "react";
import { createPortal } from "react-dom";
import { useElementById } from "@/lib/ui/use-element-by-id";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useChatSession } from "../lib/use-chat-session";
import { ChatTitlebar, resolveChatCrumbTitle } from "./shell/titlebar";
import { ChatInput } from "./composer/input";
import { ChatMessageList } from "./message/list";
import { ChatErrorDialog } from "./blocks/error";
import { Collapse } from "@/components/ui/collapse";
import { ChatEmptyState } from "./shell/empty";
import { ChatSelectionQuoteToolbar } from "./quote-selection";
import { parseMessageContent } from "./md/renderer";
import type { ChatMessage } from "@/lib/backend";
import type { ComposerTaskItem } from "./composer/activity";
import { AGENT_TABS_SLOT } from "@/features/agent/chrome";
import { ChatHistoryStepper, useChatTurnActive } from "./shell/history-stepper";
import {
    CHAT_COPY_MARKDOWN_EVENT,
    CHAT_EXPAND_FOR_FIND_EVENT,
    CHAT_EXPORT_MARKDOWN_EVENT,
    CHAT_FIND_OPEN_EVENT,
    ChatFindBar,
    registerMountedChatSurface,
} from "./shell/find-bar";
import { findTranscriptMatches } from "@/lib/chat/transcript-search";
import { clearChatDomHighlights, syncChatDomHighlights } from "@/lib/chat/dom-highlights";
import { extractCleanUserPrompts } from "@/lib/chat/prompt-history";
import { formatTranscriptAsMarkdown, slugifyTranscriptFilename } from "@/lib/chat/export-markdown";
import { notify } from "@/features/notifications";
import { useSyncChatGenerating } from "../lib/generating-chats";
import { SubagentChatView } from "@/features/agent/subagents/view";
import {
    closeSubagent,
    extractSubagentsFromText,
    getActiveSubagent,
    getSubagents,
    openSubagent,
    setSubagentParentConversation,
    subscribeSubagents,
    upsertSubagent,
} from "@/features/agent/subagents/store";

/**
 * Subagent tags are scanned out of every message on each stream tick. Message
 * objects stay stable while their text does, so each one is scanned once.
 */
const subagentScanCache = new WeakMap<
    ChatMessage,
    {
        content: string;
        parentId: string | undefined;
        items: ReturnType<typeof extractSubagentsFromText>;
    }
>();

function scannedSubagents(message: ChatMessage, parentId: string | undefined) {
    const content = message.content || "";
    const cached = subagentScanCache.get(message);
    // `parentId` is not used by the extractor today, but keying on it keeps the
    // cache honest if a tag ever starts carrying it.
    if (cached && cached.content === content && cached.parentId === parentId) return cached.items;
    const items = extractSubagentsFromText(content, parentId);
    subagentScanCache.set(message, { content, parentId, items });
    return items;
}

/** Sticky prompt text. */
const stickyPromptText = (content: string): string => {
    const cleaned = content
        .replace(/<attached_(?:image|file|asset)\b[^>]*>[\s\S]*?<\/attached_(?:image|file|asset)>\n*/g, "")
        .trim()
        .replace(/\s+/g, " ");
    if (cleaned.length <= 120) return cleaned;
    return `${cleaned.slice(0, 117)}...`;
};

/** True when an ancestor inside `boundary` is vertically scrollable and still has room to scroll up. */
const canNestedAncestorScrollUp = (
    target: EventTarget | null,
    boundary: HTMLElement,
): boolean => {
    let cur = target instanceof HTMLElement ? target : null;
    while (cur && cur !== boundary) {
        if (cur.scrollHeight > cur.clientHeight + 1 && cur.scrollTop > 0) {
            const overflowY = window.getComputedStyle(cur).overflowY;
            if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
                return true;
            }
        }
        cur = cur.parentElement;
    }
    return false;
};

/** Detects pending human-in-the-loop approval or question blocks in the transcript. */
export const detectPendingHitl = (
    messages: readonly { role?: string; content?: string }[],
    isLoading: boolean,
): { kind: "approval" | "question"; count: number } | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages.at(i);
        if (!msg || msg.role !== "assistant") continue;
        const raw = msg.content || "";
        if (
            raw.includes("<terminal_command") ||
            raw.includes("<edit_pending") ||
            raw.includes("<plugin_call") ||
            raw.includes("<design_previews") ||
            raw.includes("<question")
        ) {
            const chunks = parseMessageContent(raw);
            let approvalCount = 0;
            let questionCount = 0;
            for (const c of chunks) {
                if (
                    isLoading &&
                    (c.type === "terminal_command" ||
                        c.type === "edit_pending" ||
                        c.type === "plugin_call") &&
                    c.commandStatus === "pending"
                ) {
                    approvalCount += 1;
                }
                if (
                    c.type === "design_previews" &&
                    c.commandStatus === "pending" &&
                    c.commandId &&
                    (c.designPreviews?.length ?? 0) > 0
                ) {
                    approvalCount += 1;
                }
                if (c.type === "question" && c.commandStatus === "pending" && c.commandId) {
                    questionCount += 1;
                }
            }
            if (approvalCount > 0) return { kind: "approval", count: approvalCount };
            if (questionCount > 0) return { kind: "question", count: questionCount };
        }
        break;
    }
    return null;
};

const EMPTY_TASK_ITEMS: ComposerTaskItem[] = [];
const EMPTY_SUBAGENTS: ReturnType<typeof getSubagents> = [];

/** Renders the Chat UI component. */
const Chat = ({
    className,
    embedded,
}: {
    className?: string;
    embedded?: boolean;
    /** @deprecated unused in shell */
    onClose?: () => void;
    sidebarSide?: "left" | "right";
    embedWindowControls?: React.ReactNode;
}) => {
    const messagesEndRef = React.useRef<HTMLDivElement>(null);
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);
    const transcriptContentRef = React.useRef<HTMLDivElement>(null);
    const chatShellRef = React.useRef<HTMLDivElement>(null);
    const findReturnFocusRef = React.useRef<HTMLElement | null>(null);
    const [findOpen, setFindOpen] = React.useState(false);
    const [findQuery, setFindQuery] = React.useState("");
    const [findMatchCase, setFindMatchCase] = React.useState(false);
    const [findMatchIndex, setFindMatchIndex] = React.useState(0);
    const session = useChatSession(messagesEndRef, scrollContainerRef);
    const activeSubagent = React.useSyncExternalStore(subscribeSubagents, getActiveSubagent, getActiveSubagent);

    React.useEffect(() => {
        setSubagentParentConversation(session.conversationId);
        return () => setSubagentParentConversation(null);
    }, [session.conversationId]);

    // Listeners read the latest session through a ref, so they are registered once.
    const sessionRef = React.useRef(session);
    React.useLayoutEffect(() => {
        sessionRef.current = session;
    });

    const hasMessages = session.messages.length > 0;
    const hasSubagent = Boolean(activeSubagent);

    React.useEffect(() => {
        const contentEl = transcriptContentRef.current;
        if (!contentEl || typeof ResizeObserver === "undefined") return undefined;
        const observer = new ResizeObserver(() => {
            sessionRef.current.handleTranscriptResize();
        });
        observer.observe(contentEl);
        return () => observer.disconnect();
    }, [hasMessages, hasSubagent]);

    React.useEffect(() => {
        const onOpen = (e: Event) => {
            const detail = (e as CustomEvent<{ id?: string; parentId?: string }>).detail;
            if (detail?.parentId && detail.parentId !== sessionRef.current.conversationId) {
                sessionRef.current.handleSelectChatTab(detail.parentId).catch(() => undefined);
            }
            if (detail?.id) openSubagent(detail.id);
        };
        const onOpenForParent = (e: Event) => {
            const parentId = (e as CustomEvent<{ parentId?: string }>).detail?.parentId;
            if (parentId && parentId !== sessionRef.current.conversationId && parentId !== sessionRef.current.activeChatTabId) {
                sessionRef.current.handleSelectChatTab(parentId).catch(() => undefined);
            }
            const fromMessages = sessionRef.current.messages
                .map((m) => extractSubagentsFromText(m.content || "", parentId))
                .flat();
            const first = fromMessages[0];
            if (first) {
                upsertSubagent({
                    id: first.id,
                    title: first.title,
                    task: first.task,
                    model: first.model,
                    transcript: first.transcript,
                    activity: first.task || "Working…",
                    status: first.status,
                    parentId,
                });
                openSubagent(first.id);
                return;
            }
            const liveFirst = parentId
                ? getSubagents().find((c) => c.parentId === parentId)
                : getSubagents()[0];
            if (liveFirst) openSubagent(liveFirst.id);
        };
        // Sidebar delete/archive closes the matching tab here; the shell owns tabs.
        const onCloseTab = (e: Event) => {
            const id = (e as CustomEvent<{ id?: string }>).detail?.id;
            if (!id) return;
            if (!sessionRef.current.openChatTabs.some((tab) => tab.id === id)) return;
            sessionRef.current.handleCloseChatTab(id).catch(() => undefined);
        };
        window.addEventListener("bettershape-open-subagent", onOpen as EventListener);
        window.addEventListener("bettershape-open-subagents-for", onOpenForParent as EventListener);
        window.addEventListener("bettershape-chat-close-tab", onCloseTab as EventListener);
        return () => {
            window.removeEventListener("bettershape-open-subagent", onOpen as EventListener);
            window.removeEventListener("bettershape-open-subagents-for", onOpenForParent as EventListener);
            window.removeEventListener("bettershape-chat-close-tab", onCloseTab as EventListener);
        };
    }, []);

    useSyncChatGenerating(session.conversationId ?? session.activeChatTabId, session.isLoading);
    const tabsSlot = useElementById(AGENT_TABS_SLOT);

    const taskItems = useMemo((): ComposerTaskItem[] => {
        let lastAssistantContent: string | null = null;
        for (let i = session.messages.length - 1; i >= 0; i--) {
            const msg = session.messages[i];
            if (msg?.role === "assistant") {
                lastAssistantContent = msg.content;
                break;
            }
        }
        if (!lastAssistantContent || !lastAssistantContent.includes("<todos")) {
            return EMPTY_TASK_ITEMS;
        }

        const todos = parseMessageContent(lastAssistantContent).find((c) => c.type === "todos");
        if (!todos?.todos?.length) return EMPTY_TASK_ITEMS;

        const items: ComposerTaskItem[] = [];
        for (const t of todos.todos) {
            if (t.status === "done" || t.status === "cancelled") continue;
            items.push({
                id: t.id || t.label,
                label: t.label,
                status:
                    t.status === "active" && session.isLoading ? "running" : "pending",
            });
        }
        return items.length > 0 ? items : EMPTY_TASK_ITEMS;
    }, [session.messages, session.isLoading]);

    const newChatRef = React.useRef(session.handleNewChat);
    const restoreRef = React.useRef(session.handleRestore);
    // Refs are updated after commit (layout phase), not during render.
    React.useLayoutEffect(() => {
        newChatRef.current = session.handleNewChat;
        restoreRef.current = session.handleRestore;
    });

    React.useEffect(() => {
        /** Menu command: start a new chat in this window. */
        const onNewChat = () => {
            newChatRef.current().catch(() => undefined);
        };
        const onRestoreLast = () => {
            // Read the live transcript on demand: keeping `session.messages` in the
            // dep list re-subscribed both listeners on every streamed token.
            const msgs = session.messagesRef.current;
            for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i]?.role === "user") {
                    restoreRef.current(i).catch(() => undefined);
                    return;
                }
            }
        };
        window.addEventListener("bettershape-chat-new", onNewChat);
        window.addEventListener("bettershape-chat-restore-last", onRestoreLast);
        return () => {
            window.removeEventListener("bettershape-chat-new", onNewChat);
            window.removeEventListener("bettershape-chat-restore-last", onRestoreLast);
        };
    }, [session.messagesRef]);

    const extractedSubagents = useMemo(() => {
        const parentId = session.conversationId ?? session.activeChatTabId ?? undefined;
        // A subagent is stamped with the time of the message that mentions it (no clock read in render).
        const seen = new Map<string, ReturnType<typeof extractSubagentsFromText>[number] & { updatedAt: number }>();
        for (const m of session.messages) {
            const raw = m.content || "";
            if (!raw.includes("<subagent")) continue;
            for (const item of scannedSubagents(m, parentId)) {
                seen.set(item.id, { ...item, updatedAt: m.timestamp });
            }
        }
        if (seen.size === 0) return EMPTY_SUBAGENTS;
        return [...seen.values()].map((item) => ({
            id: item.id,
            title: item.title,
            activity: item.task || "Working…",
            task: item.task,
            model: item.model,
            transcript: item.transcript,
            status: item.status,
            parentId,
            updatedAt: item.updatedAt,
        }));
    }, [session.messages, session.conversationId, session.activeChatTabId]);

    const activeTab = useMemo(
        () => session.openChatTabs.find((tab) => tab.id === session.activeChatTabId),
        [session.openChatTabs, session.activeChatTabId],
    );
    const conv = useMemo(
        () =>
            session.recentConvs.find(
                (item) => item.id === (session.conversationId ?? session.activeChatTabId),
            ),
        [session.recentConvs, session.conversationId, session.activeChatTabId],
    );
    const crumbTitle = useMemo(
        () =>
            resolveChatCrumbTitle({
                chatTitle: session.chatTitle,
                tabTitle: activeTab?.title,
                convTitle: conv?.title,
                messages: session.messages,
            }),
        [session.chatTitle, activeTab?.title, conv?.title, session.messages],
    );
    const handleCloseSubagent = React.useCallback(() => {
        closeSubagent();
    }, []);
    const setSelectedModeRef = React.useRef(session.setSelectedMode);
    React.useLayoutEffect(() => {
        setSelectedModeRef.current = session.setSelectedMode;
    });
    const handleEmptySelectMode = React.useCallback((mode: string) => {
        setSelectedModeRef.current(mode);
        window.dispatchEvent(new CustomEvent("bettershape-chat-focus-input"));
    }, []);
    const handleComposerKeyDown = React.useCallback((e: React.KeyboardEvent) => {
        sessionRef.current.handleKeyDown(e);
    }, []);
    const handleComposerSend = React.useCallback(() => {
        sessionRef.current.handleSendMessage().catch(() => undefined);
    }, []);
    const handleComposerStop = React.useCallback(() => {
        sessionRef.current.handleStopMessage().catch(() => undefined);
    }, []);
    const handleComposerAcceptAll = React.useCallback(() => {
        sessionRef.current.handleAcceptAll().catch(() => undefined);
    }, []);
    const handleComposerRejectAll = React.useCallback(() => {
        sessionRef.current.handleRejectAll().catch(() => undefined);
    }, []);
    const handleComposerAcceptEdit = React.useCallback((id: string) => {
        sessionRef.current.handleAcceptEdit(id).catch(() => undefined);
    }, []);
    const handleComposerRejectEdit = React.useCallback((id: string) => {
        sessionRef.current.handleRejectEdit(id).catch(() => undefined);
    }, []);
    const handleComposerSendQueuedNow = React.useCallback((id: string) => {
        sessionRef.current.handleSendQueuedNow(id).catch(() => undefined);
    }, []);
    const handleComposerNewChat = React.useCallback(() => {
        sessionRef.current.handleNewChat().catch(() => undefined);
    }, []);
    const activeHitlKindRef = React.useRef<"approval" | "question" | null>(null);
    const handleJumpToBottom = React.useCallback(() => {
        const container = scrollContainerRef.current;
        if (activeHitlKindRef.current && container) {
            const pendingCards = Array.from(
                container.querySelectorAll<HTMLElement>("[data-pending-approval='true']"),
            );
            const scrollerRect = container.getBoundingClientRect();
            const offscreenCard = pendingCards.find((card) => {
                const rect = card.getBoundingClientRect();
                if (rect.height <= 0 || scrollerRect.height <= 0) return false;
                const visible =
                    Math.min(rect.bottom, scrollerRect.bottom) -
                    Math.max(rect.top, scrollerRect.top);
                return visible < Math.min(56, rect.height * 0.55);
            });
            const targetCard = offscreenCard ?? pendingCards.at(0);
            if (targetCard) {
                const reduced =
                    typeof window !== "undefined" &&
                    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
                targetCard.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
                return;
            }
        }
        sessionRef.current.scrollToBottom("smooth");
    }, []);
    const handleDismissSendError = React.useCallback(() => {
        sessionRef.current.setSendError(null);
    }, []);
    const handleRetrySendError = React.useCallback(() => {
        const current = sessionRef.current;
        current.setSendError(null);
        const hasComposerPayload =
            current.inputValue.trim().length > 0 ||
            current.uploadedFiles.length > 0 ||
            current.quotedExcerpts.length > 0;
        if (hasComposerPayload) {
            current.handleSendMessage().catch(() => undefined);
            return;
        }
        if (current.messages.length > 0) {
            current.handleRedo(current.messages.length - 1).catch(() => undefined);
        }
    }, []);

    const titlebar = (
        <ChatTitlebar
            title={crumbTitle}
            conversationId={session.conversationId ?? session.activeChatTabId}
            subagentTitle={activeSubagent?.title ?? null}
            subagentModel={activeSubagent?.model ?? null}
            extractedSubagents={extractedSubagents}
            onCloseSubagent={handleCloseSubagent}
        />
    );

    const turnCount = session.messageGroups.length;
    const [activeTurn, selectTurn] = useChatTurnActive(
        scrollContainerRef,
        turnCount,
        { streaming: session.isLoading, rootKey: activeSubagent?.id ?? null },
    );
    const selectTurnRef = React.useRef(selectTurn);
    React.useLayoutEffect(() => {
        selectTurnRef.current = selectTurn;
    });
    const handleSelectTurn = React.useCallback((idx: number) => {
        selectTurnRef.current(idx);
    }, []);

    const isEmpty = session.messages.length === 0;
    const emptyStage = isEmpty && !embedded;

    const crumbTitleRef = React.useRef(crumbTitle);
    React.useLayoutEffect(() => {
        crumbTitleRef.current = crumbTitle;
    });

    const promptHistory = useMemo(
        () => extractCleanUserPrompts(session.messages),
        [session.messages],
    );

    const findMatches = useMemo(
        () =>
            findOpen && findQuery.trim()
                ? findTranscriptMatches(session.messages, findQuery, {
                      caseSensitive: findMatchCase,
                  })
                : [],
        [findOpen, findQuery, findMatchCase, session.messages],
    );
    const activeFindIndex = findMatches.length > 0 ? findMatchIndex % findMatches.length : 0;
    const activeFindMatch = findMatches.at(activeFindIndex) ?? null;

    const pendingHitlInfo = useMemo(
        () => detectPendingHitl(session.messages, session.isLoading),
        [session.messages, session.isLoading],
    );
    const pendingHitlKind = pendingHitlInfo?.kind ?? null;
    const pendingHitlCount = pendingHitlInfo?.count ?? 0;

    const [pendingHitlDirection, setPendingHitlDirection] = React.useState<"up" | "down" | null>(
        null,
    );

    React.useEffect(() => {
        if (!pendingHitlKind) return undefined;
        const scroller = scrollContainerRef.current;
        if (!scroller) return undefined;

        let rafId = 0;
        const measure = () => {
            const pendingEls = Array.from(
                scroller.querySelectorAll<HTMLElement>("[data-pending-approval='true']"),
            );
            const scrollerRect = scroller.getBoundingClientRect();
            if (pendingEls.length === 0 || scrollerRect.height <= 0) {
                setPendingHitlDirection(null);
                return;
            }
            for (const pendingEl of pendingEls) {
                const elRect = pendingEl.getBoundingClientRect();
                if (elRect.height <= 0) continue;
                const visibleTop = Math.max(elRect.top, scrollerRect.top);
                const visibleBottom = Math.min(elRect.bottom, scrollerRect.bottom);
                const visibleHeight = Math.max(0, visibleBottom - visibleTop);
                const minVisible = Math.min(56, elRect.height * 0.55);
                if (visibleHeight < minVisible) {
                    setPendingHitlDirection(elRect.top < scrollerRect.top ? "up" : "down");
                    return;
                }
            }
            setPendingHitlDirection(null);
        };

        const scheduleMeasure = () => {
            if (rafId) return;
            rafId = window.requestAnimationFrame(() => {
                rafId = 0;
                measure();
            });
        };

        scheduleMeasure();
        scroller.addEventListener("scroll", scheduleMeasure, { passive: true });
        const ro =
            typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
        ro?.observe(scroller);
        if (transcriptContentRef.current) ro?.observe(transcriptContentRef.current);

        return () => {
            if (rafId) window.cancelAnimationFrame(rafId);
            scroller.removeEventListener("scroll", scheduleMeasure);
            ro?.disconnect();
        };
    }, [pendingHitlKind, session.messages]);

    const handleCloseFind = React.useCallback(() => {
        clearChatDomHighlights();
        setFindOpen(false);
        const prev = findReturnFocusRef.current;
        findReturnFocusRef.current = null;
        if (prev && prev.isConnected) {
            requestAnimationFrame(() => prev.focus());
        } else {
            window.dispatchEvent(new CustomEvent("bettershape-chat-focus-input"));
        }
    }, []);

    const handleFindQueryChange = React.useCallback((next: string) => {
        setFindQuery(next);
        setFindMatchIndex(0);
    }, []);

    const handleFindMatchCaseChange = React.useCallback((next: boolean) => {
        setFindMatchCase(next);
        setFindMatchIndex(0);
    }, []);

    const handleFindNext = React.useCallback(() => {
        setFindMatchIndex((prev) => (findMatches.length > 0 ? (prev + 1) % findMatches.length : 0));
    }, [findMatches.length]);

    const handleFindPrev = React.useCallback(() => {
        setFindMatchIndex((prev) =>
            findMatches.length > 0 ? (prev - 1 + findMatches.length) % findMatches.length : 0,
        );
    }, [findMatches.length]);

    React.useEffect(() => {
        return () => {
            clearChatDomHighlights();
        };
    }, []);

    React.useEffect(() => {
        const container = scrollContainerRef.current;
        if (!findOpen || !findQuery.trim() || !container) {
            clearChatDomHighlights();
            return undefined;
        }
        if (activeFindMatch) {
            window.dispatchEvent(
                new CustomEvent(CHAT_EXPAND_FOR_FIND_EVENT, {
                    detail: {
                        messageIndex: activeFindMatch.messageIndex,
                        query: findQuery,
                        caseSensitive: findMatchCase,
                    },
                }),
            );
        }

        const rafId = window.requestAnimationFrame(() => {
            const root = scrollContainerRef.current;
            if (!root) return;
            const { activeRange } = syncChatDomHighlights(root, findQuery, {
                caseSensitive: findMatchCase,
                activeIndex: activeFindIndex,
                targetMessageIndex: activeFindMatch?.messageIndex ?? null,
                targetOccurrenceInMessage: activeFindMatch?.occurrenceInMessage ?? null,
            });
            if (!activeFindMatch) return;
            sessionRef.current.notifyUserScrollUp();
            const reduced = Boolean(
                window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
            );

            if (activeRange) {
                const rect = activeRange.getBoundingClientRect();
                const rootRect = root.getBoundingClientRect();
                if (rect.height > 0 && rootRect.height > 0) {
                    const targetTop =
                        root.scrollTop +
                        (rect.top - rootRect.top) -
                        rootRect.height / 2 +
                        rect.height / 2;
                    root.scrollTo({
                        top: Math.max(0, targetTop),
                        behavior: reduced ? "auto" : "smooth",
                    });
                    return;
                }
            }

            const row = root.querySelector<HTMLElement>(
                `[data-chat-message-index="${activeFindMatch.messageIndex}"]`,
            );
            row?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
        });

        return () => window.cancelAnimationFrame(rafId);
    }, [findOpen, findQuery, findMatchCase, activeFindIndex, activeFindMatch, session.messages]);

    React.useEffect(() => {
        const openFindWithSelection = (seed?: string) => {
            if (sessionRef.current.messages.length === 0) {
                notify.info("Find in chat", "Start a conversation first to search messages.");
                return;
            }
            if (getActiveSubagent()) {
                closeSubagent();
            }
            if (document.activeElement instanceof HTMLElement) {
                findReturnFocusRef.current = document.activeElement;
            }
            const selected = window.getSelection()?.toString().trim() ?? "";
            const initial = (seed ?? selected).slice(0, 120);
            if (initial && !initial.includes("\n")) {
                setFindQuery(initial);
                setFindMatchIndex(0);
            }
            setFindOpen(true);
        };

        const onOpenFind = (e: Event) => {
            const q = (e as CustomEvent<{ query?: string }>).detail?.query;
            openFindWithSelection(q);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "f") {
                return;
            }
            const target = e.target instanceof HTMLElement ? e.target : null;
            if (target?.closest(".cm-editor, .xterm, [role='dialog']")) return;
            const shell = chatShellRef.current;
            if (!shell || (target && !shell.contains(target))) return;
            if (sessionRef.current.messages.length === 0) return;
            e.preventDefault();
            openFindWithSelection();
        };

        const onCopyMarkdown = () => {
            const msgs = sessionRef.current.messages;
            if (msgs.length === 0) {
                notify.info("Nothing to copy", "Send a message first to copy the transcript.");
                return;
            }
            const md = formatTranscriptAsMarkdown(crumbTitleRef.current, msgs);
            if (!("clipboard" in navigator)) {
                notify.error("Copy failed", "Clipboard API is unavailable in this window.");
                return;
            }
            navigator.clipboard
                .writeText(md)
                .then(() => notify.success("Copied as Markdown", `${msgs.length} messages copied to clipboard.`))
                .catch(() => notify.error("Copy failed", "Could not write transcript to clipboard."));
        };

        const onExportMarkdown = () => {
            const msgs = sessionRef.current.messages;
            if (msgs.length === 0) {
                notify.info("Nothing to export", "Send a message first to export the transcript.");
                return;
            }
            const md = formatTranscriptAsMarkdown(crumbTitleRef.current, msgs);
            const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = slugifyTranscriptFilename(crumbTitleRef.current);
            anchor.click();
            URL.revokeObjectURL(url);
            notify.success("Chat exported", `Saved ${anchor.download}.`);
        };

        window.addEventListener(CHAT_FIND_OPEN_EVENT, onOpenFind as EventListener);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener(CHAT_COPY_MARKDOWN_EVENT, onCopyMarkdown);
        window.addEventListener(CHAT_EXPORT_MARKDOWN_EVENT, onExportMarkdown);
        const unregisterSurface = registerMountedChatSurface();
        return () => {
            unregisterSurface();
            window.removeEventListener(CHAT_FIND_OPEN_EVENT, onOpenFind as EventListener);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener(CHAT_COPY_MARKDOWN_EVENT, onCopyMarkdown);
            window.removeEventListener(CHAT_EXPORT_MARKDOWN_EVENT, onExportMarkdown);
        };
    }, []);

    const turnLabels = useMemo(
        () =>
            session.messageGroups.map((group) => {
                const user = group.find((g) => g.msg.role === "user")?.msg;
                return user ? stickyPromptText(user.content) : "Turn";
            }),
        [session.messageGroups],
    );

    const insetX = embedded ? "px-2" : "px-3.5 @[480px]/chat:px-5 @[768px]/chat:px-6";
    const columnWidth = embedded ? "max-w-none" : "max-w-4xl";
    const showTopVeil = !emptyStage && session.scrolledFromTop;
    const effectiveHitlDirection = pendingHitlKind ? pendingHitlDirection : null;
    const activeHitlKind = effectiveHitlDirection ? pendingHitlKind : null;
    React.useLayoutEffect(() => {
        activeHitlKindRef.current = activeHitlKind;
    }, [activeHitlKind]);
    const showBottomVeil = !emptyStage && session.scrolledFromBottom;
    const showFloatingPill = !emptyStage && (session.scrolledFromBottom || Boolean(activeHitlKind));

    const composerDockRef = React.useRef<HTMLDivElement>(null);
    const prevEmptyStageRef = React.useRef(emptyStage);
    const prevTabForFlipRef = React.useRef(session.activeChatTabId);
    const emptyComposerTopRef = React.useRef<number | null>(null);

    React.useLayoutEffect(() => {
        const el = composerDockRef.current;
        const sameTab = prevTabForFlipRef.current === session.activeChatTabId;
        prevTabForFlipRef.current = session.activeChatTabId;

        if (emptyStage && el) {
            emptyComposerTopRef.current = el.getBoundingClientRect().top;
            const ro =
                typeof ResizeObserver !== "undefined"
                    ? new ResizeObserver(() => {
                          if (composerDockRef.current) {
                              emptyComposerTopRef.current =
                                  composerDockRef.current.getBoundingClientRect().top;
                          }
                      })
                    : null;
            if (el.parentElement) ro?.observe(el.parentElement);
            ro?.observe(el);
            prevEmptyStageRef.current = true;
            return () => ro?.disconnect();
        }

        if (prevEmptyStageRef.current && !emptyStage && sameTab && el) {
            const fromTop = emptyComposerTopRef.current;
            prevEmptyStageRef.current = false;
            emptyComposerTopRef.current = null;
            const reduceMotion = Boolean(
                window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
            );
            if (!reduceMotion && fromTop !== null) {
                const toTop = el.getBoundingClientRect().top;
                const dy = fromTop - toTop;
                if (Math.abs(dy) > 4) {
                    el.style.transition = "none";
                    el.style.transform = `translate3d(0, ${Math.round(dy)}px, 0)`;
                    const frame = window.requestAnimationFrame(() => {
                        el.style.transition =
                            "transform var(--spring-panel-dur) var(--spring-panel)";
                        el.style.transform = "translate3d(0, 0, 0)";
                    });
                    const clear = () => {
                        el.style.transition = "";
                        el.style.transform = "";
                    };
                    const timer = window.setTimeout(clear, 280);
                    return () => {
                        window.cancelAnimationFrame(frame);
                        window.clearTimeout(timer);
                        clear();
                    };
                }
            }
        }

        prevEmptyStageRef.current = emptyStage;
        emptyComposerTopRef.current = null;
        return undefined;
    }, [emptyStage, session.activeChatTabId]);

    const chatColumn = activeSubagent ? (
        <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0 z-0 overflow-y-auto px-5 no-scrollbar select-text md:px-6">
                <SubagentChatView />
            </div>
        </div>
    ) : (
        <>
            <Collapse open={!emptyStage && findOpen} className="shrink-0">
                <div className={cn("flex justify-end pt-2 pb-1", insetX)}>
                    <div className={cn("mx-auto flex w-full justify-end", columnWidth)}>
                        <ChatFindBar
                            open={findOpen}
                            query={findQuery}
                            matchCount={findMatches.length}
                            activeMatchIndex={activeFindIndex}
                            matchCase={findMatchCase}
                            onMatchCaseChange={handleFindMatchCaseChange}
                            onQueryChange={handleFindQueryChange}
                            onNext={handleFindNext}
                            onPrev={handleFindPrev}
                            onClose={handleCloseFind}
                        />
                    </div>
                </div>
            </Collapse>

            <div
                className={cn(
                    "relative min-h-0",
                    emptyStage ? "flex-[1_1_72px]" : "flex-1",
                )}
            >
                <div
                    aria-hidden={!emptyStage || undefined}
                    className={cn(
                        "absolute inset-0 z-10 flex flex-col items-center justify-end overflow-hidden pb-5 transition-[opacity,transform] duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)] motion-reduce:transform-none motion-reduce:transition-none",
                        insetX,
                        emptyStage
                            ? "translate-y-0 scale-100 opacity-100"
                            : "pointer-events-none -translate-y-2 scale-[0.98] opacity-0",
                    )}
                >
                    <div className={cn("flex w-full flex-col items-center", columnWidth)}>
                        <ChatEmptyState onSelectMode={handleEmptySelectMode} />
                    </div>
                </div>

                <div
                    ref={scrollContainerRef}
                    role="presentation"
                    aria-hidden={emptyStage || undefined}
                    onScroll={session.handleScroll}
                    onWheel={(e) => {
                        if (e.deltaY < -2 && !canNestedAncestorScrollUp(e.target, e.currentTarget)) {
                            session.notifyUserScrollUp();
                        }
                    }}
                    onKeyDown={(e) => {
                        const target = e.target as HTMLElement | null;
                        const inField = Boolean(target?.closest("textarea, input, [contenteditable='true']"));
                        const inInteractiveControl = Boolean(
                            target?.closest("button, [role='button'], [data-chat-find-bar]"),
                        );
                        if (
                            !inField &&
                            !inInteractiveControl &&
                            (e.key === "PageUp" || e.key === "ArrowUp" || e.key === "Home")
                        ) {
                            session.notifyUserScrollUp();
                        }
                        if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "a" || inField) return;
                        e.preventDefault();
                        const root = e.currentTarget;
                        const range = document.createRange();
                        range.selectNodeContents(root);
                        const sel = window.getSelection();
                        sel?.removeAllRanges();
                        sel?.addRange(range);
                    }}
                    className={cn(
                        "absolute inset-0 z-0 flex flex-col overflow-y-auto no-scrollbar select-text transition-opacity duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
                        insetX,
                        emptyStage ? "pointer-events-none opacity-0" : "opacity-100",
                    )}
                >
                    <div
                        ref={transcriptContentRef}
                        className={cn(
                            "mx-auto flex w-full min-w-0 flex-col",
                            columnWidth,
                            embedded ? "pb-4 pt-4" : "pb-6 pt-6",
                        )}
                    >
                        {!isEmpty ? (
                            <ChatMessageList
                                messageGroups={session.messageGroups}
                                messages={session.messages}
                                isLoading={session.isLoading}
                                activityLabel={session.activityLabel}
                                messagesEndRef={messagesEndRef}
                                messagesRef={session.messagesRef}
                                onRedo={session.handleRedo}
                                onRestore={session.handleRestore}
                                onFork={session.handleFork}
                                isFileEditResolved={session.isEditResolved}
                                activeChatTabId={session.activeChatTabId}
                                contextSummarized={session.contextSummarized}
                                fullWidthBubbles={false}
                                highlightedMessageIndex={
                                    findOpen && activeFindMatch ? activeFindMatch.messageIndex : null
                                }
                            />
                        ) : null}
                    </div>
                </div>

                <div
                    className={cn(
                        "pointer-events-none absolute inset-x-0 top-0 z-20 h-14 bg-linear-to-b from-panel via-panel/75 to-transparent transition-opacity duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
                        showTopVeil ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                />

                {turnCount >= 2 && !embedded && !emptyStage ? (
                    <div className="pointer-events-none absolute inset-y-0 right-1 z-10 hidden w-9 py-6 @[640px]/chat:flex @[900px]/chat:right-3">
                        <div className="pointer-events-auto flex h-full w-full items-stretch justify-end">
                            <ChatHistoryStepper
                                className="h-full"
                                turnCount={turnCount}
                                activeIndex={activeTurn}
                                onSelect={handleSelectTurn}
                                turnLabels={turnLabels}
                            />
                        </div>
                    </div>
                ) : null}

                <ChatSelectionQuoteToolbar containerRef={scrollContainerRef} />
            </div>

            <div
                ref={composerDockRef}
                className={cn("relative z-20 w-full shrink-0 overflow-visible", insetX)}
            >
                <div className={cn("relative mx-auto w-full overflow-visible", columnWidth)}>
                    <div
                        className={cn(
                            "pointer-events-none absolute inset-x-0 bottom-full h-12 bg-linear-to-t from-panel via-panel/75 to-transparent transition-opacity duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
                            showBottomVeil ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden
                    />
                    <div
                        className={cn(
                            "pointer-events-none absolute inset-x-0 bottom-full z-30 mb-3 flex justify-center transition-[opacity,transform,visibility] duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)] motion-reduce:transform-none motion-reduce:transition-none",
                            showFloatingPill
                                ? "visible translate-y-0 scale-100 opacity-100"
                                : "invisible translate-y-2 scale-95 opacity-0",
                        )}
                    >
                        <button
                            type="button"
                            tabIndex={showFloatingPill ? 0 : -1}
                            aria-hidden={!showFloatingPill || undefined}
                            aria-label={
                                activeHitlKind === "approval"
                                    ? "Jump to pending approval"
                                    : activeHitlKind === "question"
                                      ? "Jump to pending question"
                                      : "Jump to bottom"
                            }
                            onClick={handleJumpToBottom}
                            className={cn(
                                "inline-flex h-7 items-center gap-1.5 rounded-full border border-border-secondary bg-surface-3 px-3 text-xs font-medium shadow-md",
                                "transition-[background-color,border-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:transform-none motion-reduce:transition-none",
                                "active:scale-[0.96] hover:bg-[var(--btn-hover)]",
                                activeHitlKind
                                    ? "text-text-primary"
                                    : "text-text-secondary hover:text-text-primary",
                                showFloatingPill ? "pointer-events-auto" : "pointer-events-none",
                            )}
                        >
                            {activeHitlKind ? (
                                <span
                                    aria-hidden
                                    className="size-1.5 shrink-0 rounded-full bg-warning"
                                />
                            ) : session.isLoading ? (
                                <Eclipse size={12} className="shrink-0 text-text-secondary" />
                            ) : (
                                <Icon icon={ArrowDown20Regular} className="size-3.5" />
                            )}
                            <span className="tabular-nums">
                                {activeHitlKind === "approval"
                                    ? pendingHitlCount > 1
                                        ? `${pendingHitlCount} approvals waiting · Review`
                                        : "Approval waiting · Review"
                                    : activeHitlKind === "question"
                                      ? pendingHitlCount > 1
                                          ? `${pendingHitlCount} questions waiting · Answer`
                                          : "Question waiting · Answer"
                                      : "Jump to bottom"}
                            </span>
                            {activeHitlKind ? (
                                <Icon
                                    icon={ArrowDown20Regular}
                                    className={cn(
                                        "size-3.5 text-text-muted transition-transform duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                                        effectiveHitlDirection === "up" && "rotate-180",
                                    )}
                                />
                            ) : null}
                        </button>
                    </div>
                    <ChatInput
                        inputValue={session.inputValue}
                        isLoading={session.isLoading}
                        isPreparing={session.isPreparing}
                        uploadedFiles={session.uploadedFiles}
                        onInputChange={session.handleInputChange}
                        onKeyDown={handleComposerKeyDown}
                        onSendMessage={handleComposerSend}
                        onStopMessage={handleComposerStop}
                        setUploadedFiles={session.setUploadedFiles}
                        addUploadedFiles={session.addUploadedFiles}
                        selectedModel={session.selectedModel}
                        setSelectedModel={session.setSelectedModel}
                        selectedWorkerModels={session.selectedWorkerModels}
                        setSelectedWorkerModels={session.setSelectedWorkerModels}
                        hideModeSelect={false}
                        selectedMode={session.selectedMode}
                        setSelectedMode={session.setSelectedMode}
                        reasoningEffort={session.reasoningEffort}
                        setReasoningEffort={session.setReasoningEffort}
                        pendingEdits={session.pendingEdits}
                        onAcceptAllEdits={handleComposerAcceptAll}
                        onRejectAllEdits={handleComposerRejectAll}
                        onAcceptEdit={handleComposerAcceptEdit}
                        onRejectEdit={handleComposerRejectEdit}
                        taskItems={isEmpty ? EMPTY_TASK_ITEMS : taskItems}
                        queuedMessages={session.messageQueue}
                        onEditQueuedMessage={session.handleEditQueuedMessage}
                        onRemoveQueuedMessage={session.handleRemoveQueuedMessage}
                        onSendQueuedNow={handleComposerSendQueuedNow}
                        projectRuleFiles={session.projectRuleFiles}
                        quotedExcerpts={session.quotedExcerpts}
                        onRemoveQuote={session.removeQuotedExcerpt}
                        promptHistory={promptHistory}
                        onNewChat={handleComposerNewChat}
                        variant={embedded || !isEmpty ? "default" : "empty"}
                    />
                </div>
            </div>

            <div
                aria-hidden="true"
                className={cn(
                    "pointer-events-none w-full min-h-0",
                    emptyStage ? "flex-[1_1_0px]" : "h-0 flex-none",
                )}
            />
        </>
    );

    return (
        <div
            ref={chatShellRef}
            className={cn("flex h-full w-full flex-col overflow-hidden font-sans", className)}
        >
            {!embedded && tabsSlot ? createPortal(titlebar, tabsSlot) : null}

            <div
                data-chat-stage
                className="@container/chat relative flex min-h-0 flex-1 flex-col overflow-hidden"
            >
                {chatColumn}
            </div>
            {session.sendError ? (
                <ChatErrorDialog
                    message={session.sendError}
                    onDismiss={handleDismissSendError}
                    onRetry={handleRetrySendError}
                />
            ) : null}
        </div>
    );
};
export default Chat;
