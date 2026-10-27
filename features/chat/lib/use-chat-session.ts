"use client";

import { waitForAiConfiguration } from "@/lib/ai/bootstrap";
import { createChatRequestId } from "@/lib/chat/request-ownership";
import React from "react";
import { useIsMounted } from "@/lib/ui/use-mounted";
import { useScopedState } from "@/lib/ui/use-scoped-state";
import { randomSuffix } from "@/lib/utils";
import { listen } from "@tauri-apps/api/event";
import { commands, Conversation, useProjectState } from "@/lib/backend";
import { useChatStream } from "./chat-stream-store";
import { useSendPreparations } from "./use-send-preparations";
import { isChatGenerating } from "./generating-chats";
import { type ReasoningEffort } from "../ui/composer/reasoning-effort";
import type { ChatMessage } from "@/lib/backend/types";
import { NEW_CHAT_TAB_ID, isEphemeralChatTabId, type ChatTab } from "../ui/shell/tabs";
import { openChatHistoryMenu } from "../ui/shell/history";
import type { Chunk } from "../ui/md/renderer";
import {
    setProposedEdit,
    getProposedEdit,
    clearProposedEdit,
    clearAllProposedEdits,
    setCurrentConversationId,
    markFileResolved,
    isFileResolved,
    getResolvedFiles,
    getResolvedContentHash,
    editContentHash,
    pathsEqual,
} from "./proposed-edits";
import {
    resolveChatFilePath,
    syncProposedEditsFromMessages,
    groupChatMessages,
    chunksForMessage,
} from "./chat-session-utils";
import { getSettings } from "@/lib/settings";
import { getVisibleModels, resolveChatModels, sanitizeEnabledModels, subagentModelsForSend } from "@/lib/settings/models";
import { getCatalogDefaultEnabledIds, getCatalogModels, useBetterShapeCatalog } from "@/lib/catalog/store";
import { assertSendAttachmentsUnchanged, messageWithAttachments, waitForSendAttachments } from "./send-attachments";
import { formatQuotesPrefix, type QuotedExcerpt } from "../ui/quote-selection";
import { hasAnyUsableProvider as hasUsableProvider } from "@/lib/ai/providers";
import { readComposerPrefs, writeComposerPrefs } from "@/lib/chat/composer-prefs";
import { matchSlashCommand } from "@/lib/chat/workflows";
import { notify } from "@/features/notifications";
import {
    isIncognitoChat,
    purgeIncognitoConversation,
    setIncognitoChat,
    syncIncognitoFromBackend,
} from "@/lib/chat/incognito";
import { buildMessageWithMentions, type SelectionSnapshot } from "@/lib/chat/mentions";
import { buildPlanBuildMessage } from "@/lib/chat/continue-action";
import { listProjectRuleFiles, loadProjectRules } from "@/lib/workspace/rules";
import { isWorkspaceTrusted } from "@/lib/workspace/trust";
import { clearAllDesignPreviewSessions } from "@/lib/agent-preview/store";
import {
    createPendingAttachment,
    processAttachment,
    type ComposerAttachment,
} from "@/features/chat/ui/composer/attachments";
import {
    adoptDraftQueuedMessages,
    canDrainQueue,
    needsBackendPin,
    queueForConversation,
    takeNextQueuedMessage,
    type QueuedChatMessage,
} from "./message-queue";

function chatTabsStorageKey(projectPath: string | null | undefined) {
    const norm = (projectPath || "").replace(/\\/g, "/").toLowerCase();
    return `bettershape-chat-open-tabs:${norm || "__none__"}`;
}

function readPersistedChatTabs(projectPath: string | null | undefined): {
    tabs: ChatTab[];
    activeId: string;
} | null {
    try {
        const raw = localStorage.getItem(chatTabsStorageKey(projectPath));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { tabs?: ChatTab[]; activeId?: string };
        if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
        const tabs = parsed.tabs.filter(
            (t) => t && typeof t.id === "string" && typeof t.title === "string",
        );
        const firstTab = tabs.at(0);
        if (!firstTab) return null;
        const activeId =
            typeof parsed.activeId === "string"
            && tabs.some((t) => t.id === parsed.activeId)
                ? parsed.activeId
                : firstTab.id;
        return { tabs, activeId };
    } catch {
        return null;
    }
}

function writePersistedChatTabs(
    projectPath: string | null | undefined,
    tabs: ChatTab[],
    activeId: string,
) {
    try {
        const persistable = tabs.filter(
            (t) => !isEphemeralChatTabId(t.id) || t.id === NEW_CHAT_TAB_ID,
        );
        const nextActive = persistable.some((tab) => tab.id === activeId)
            ? activeId
            : (persistable[0]?.id ?? NEW_CHAT_TAB_ID);
        localStorage.setItem(
            chatTabsStorageKey(projectPath),
            JSON.stringify({ tabs: persistable, activeId: nextActive }),
        );
    } catch {
        /* ignore */
    }
}

/**
 * Wait until native reports no turn for `conversationId`, up to ~2s (the budget Redo uses
 * before resending into a cancelled turn). Stop only *asks* the backend to cancel: the
 * stopped turn keeps the chat's lane until it unwinds, and a send into that lane is
 * rejected as "already generating". A probe that cannot be read resolves immediately —
 * never delay a send on native state we could not observe.
 */
async function waitForChatLaneFree(conversationId: string | null) {
    if (!conversationId) return;
    for (let attempt = 0; attempt < 40; attempt++) {
        let generating: boolean;
        try {
            generating = Boolean((await commands.getChatGenerationState(conversationId))?.isGenerating);
        } catch {
            return;
        }
        if (!generating) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

/**
 * Put the attachments a rejected send consumed back into the composer, but only into the
 * chat they were submitted for. One composer is shared by every open chat, so an unscoped
 * restore hands chat A's files to whichever chat the user switched to mid-send.
 */
export function restoreRejectedAttachments(
    consumed: ComposerAttachment[],
    current: ComposerAttachment[],
    sendTarget: string | null,
    viewedConversationId: string | null,
): ComposerAttachment[] {
    if (viewedConversationId !== sendTarget) return current;
    const present = new Set(current.map((file) => file.id));
    const missing = consumed.filter((file) => !present.has(file.id));
    return missing.length > 0 ? [...missing, ...current] : current;
}

type PendingEditItem = {
    id: string;
    file: string;
    baseline: string;
    original: string;
    replacement: string;
};

const EMPTY_PENDING_EDITS: PendingEditItem[] = [];
const EMPTY_QUEUED_MESSAGES: QueuedChatMessage[] = [];

type InsertPromptDetail = {
    prompt?: string;
    send?: boolean;
    openWorkspace?: boolean;
    append?: boolean;
};

/** Writes the latest composer draft into `localStorage` without throwing in restricted contexts. */
const persistComposerDraft = (value: string): void => {
    try {
        localStorage.setItem("bettershape-chat-input", value);
    } catch {
        /* ignore */
    }
};

/** Merges an inserted token onto an existing draft when `append` is enabled. */
const mergeInsertedPrompt = (existing: string, incoming: string, append?: boolean): string => {
    if (!append) return incoming;
    const trimmedEnd = existing.trimEnd();
    return trimmedEnd ? `${trimmedEnd} ${incoming}` : incoming;
};

/** True when an inserted prompt auto-executes a built-in slash command such as `/compact`. */
const isAutoBuiltinInsert = (detail: InsertPromptDetail): boolean => {
    if (!detail.send) return false;
    return matchSlashCommand(detail.prompt ?? "")?.command.token === "/compact";
};

/** Switches center focus to Chat and optionally opens the workspace sidebar. */
const focusInsertedChatSurface = (openWorkspace?: boolean): void => {
    window.dispatchEvent(new CustomEvent("bettershape-center-view", { detail: "chat" }));
    if (!openWorkspace) return;
    window.dispatchEvent(
        new CustomEvent("bettershape-layout-toggle", {
            detail: { id: "secondary-sidebar", value: true },
        }),
    );
};

/** True when the chat session is mid-stream or already admitting a send. */
const isChatSendBusy = (isLoading: boolean, sendsInFlight: number): boolean =>
    isLoading || sendsInFlight > 0;

/** Restores a failed auto-submitted prompt into an empty composer draft. */
const restoreFailedAutoSendDraft = (
    prompt: string,
    setInputValue: React.Dispatch<React.SetStateAction<string>>,
): void => {
    setInputValue((prev) => {
        if (prev) return prev;
        persistComposerDraft(prompt);
        return prompt;
    });
};

/** Sends or enqueues an auto-submitted prompt insertion depending on turn state. */
const dispatchInsertedSend = (
    prompt: string,
    isBusy: boolean,
    isBuiltin: boolean,
    enqueue: (text: string) => void,
    sendNow: (text: string) => Promise<boolean>,
    onSendRejected: () => void,
): void => {
    const shouldQueue = isBusy ? !isBuiltin : false;
    if (shouldQueue) {
        enqueue(prompt);
        return;
    }
    sendNow(prompt)
        .then((sent) => {
            if (!sent && !isBuiltin) onSendRejected();
        })
        .catch(() => {
            if (!isBuiltin) onSendRejected();
        });
};

/** Coordinates draft staging, surface focus, and optional dispatch for `bettershape-chat-insert-prompt`. */
export const applyInsertedPromptEvent = (
    detail: InsertPromptDetail | null | undefined,
    deps: {
        isBusy: boolean;
        setInputValue: React.Dispatch<React.SetStateAction<string>>;
        enqueue: (text: string) => void;
        sendNow: (text: string) => Promise<boolean>;
    },
): void => {
    if (!detail?.prompt) return;
    const prompt = detail.prompt;
    if (!detail.send) {
        deps.setInputValue((prev) => {
            const next = mergeInsertedPrompt(prev, prompt, detail.append);
            persistComposerDraft(next);
            return next;
        });
    }
    focusInsertedChatSurface(detail.openWorkspace);
    if (!detail.send) return;
    dispatchInsertedSend(
        prompt,
        deps.isBusy,
        isAutoBuiltinInsert(detail),
        deps.enqueue,
        deps.sendNow,
        () => restoreFailedAutoSendDraft(prompt, deps.setInputValue),
    );
};

/**
 * The scroll refs are created by the caller, not returned from this hook. Keeping refs out of the
 * returned session object lets components read session values during render.
 */
export const useChatSession = (
    messagesEndRef: React.RefObject<HTMLDivElement | null>,
    scrollContainerRef: React.RefObject<HTMLDivElement | null>,
) => {
    const [uploadedFiles, setUploadedFiles] = React.useState<ComposerAttachment[]>([]);

    const addUploadedFiles = React.useCallback((files: File[], peaks?: number[][]) => {
        if (files.length === 0) return;
        const pending = files.map((file, index) => createPendingAttachment(file, peaks?.[index]));
        setUploadedFiles((prev) => [...prev, ...pending]);
        for (const att of pending) {
            processAttachment(att).then((ready) => {
                setUploadedFiles((prev) => prev.map((a) => (a.id === ready.id ? ready : a)));
            }).catch(() => undefined);
        }
    }, []);
    const uploadedFilesRef = React.useRef(uploadedFiles);
    React.useLayoutEffect(() => { uploadedFilesRef.current = uploadedFiles; }, [uploadedFiles]);
    const composerRevisionRef = React.useRef(0);
    const draftPersistTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [inputValue, updateInputValue] = React.useState(() => {
        try {
            return localStorage.getItem("bettershape-chat-input") || "";
        } catch {
            return "";
        }
    });
    const inputValueRef = React.useRef(inputValue);
    const setInputValue = React.useCallback((value: React.SetStateAction<string>) => {
        composerRevisionRef.current += 1;
        if (draftPersistTimerRef.current !== null) {
            clearTimeout(draftPersistTimerRef.current);
            draftPersistTimerRef.current = null;
        }
        updateInputValue((prev) => {
            const next = typeof value === "function" ? value(prev) : value;
            inputValueRef.current = next;
            return next;
        });
    }, []);
    /** Every queued follow-up, across chats. Each one is bound to its `conversationId`. */
    const [messageQueue, setMessageQueue] = React.useState<QueuedChatMessage[]>([]);
    const messageQueueRef = React.useRef(messageQueue);
    React.useLayoutEffect(() => { messageQueueRef.current = messageQueue; }, [messageQueue]);
    /** Bumped when a send is delivered so the queue drains the next message for this chat. */
    const [queueDrainTick, setQueueDrainTick] = React.useState(0);
    const [projectRuleFiles, setProjectRuleFiles] = React.useState<string[]>([]);
    const [quotedExcerpts, setQuotedExcerpts] = React.useState<QuotedExcerpt[]>([]);
    const quotedExcerptsRef = React.useRef<QuotedExcerpt[]>([]);
    React.useLayoutEffect(() => {
        quotedExcerptsRef.current = quotedExcerpts;
    }, [quotedExcerpts]);
    const removeQuotedExcerpt = React.useCallback((id: string) => {
        setQuotedExcerpts((prev) => prev.filter((q) => q.id !== id));
    }, []);
    const editingQueueIdRef = React.useRef<string | null>(null);
    const {
        messages,
        setMessages,
        isLoading,
        activityLabel,
        sendError,
        setSendError,
        contextSummarized,
        setContextSummarized,
        viewedConversationId,
        showConversation,
        isCurrentView,
        reloadViewedMessages,
        setDraftAdopter,
        getViewedConversationId,
        appendUserOptimistic,
        stopLiveTurn,
        prepareStop,
        startDraftChat,
        hasLiveTurn,
        getRequestOwner,
    } = useChatStream();
    const refreshMetadataRef = React.useRef<() => Promise<void>>(() => Promise.resolve());
    const [recentConvs, setRecentConvs] = React.useState<Conversation[]>([]);
    const [chatTitle, setChatTitle] = React.useState<string>("New Chat");
    const [openChatTabs, setOpenChatTabs] = React.useState<ChatTab[]>([
        { id: NEW_CHAT_TAB_ID, title: "New Chat" },
    ]);
    const [activeChatTabId, setActiveChatTabId] = React.useState<string>(NEW_CHAT_TAB_ID);
    const [selectedModel, setSelectedModel] = React.useState(
        () => readComposerPrefs().model || "auto",
    );
    const [selectedWorkerModels, setSelectedWorkerModels] = React.useState<string[]>([]);
    const selectedModelRef = React.useRef(selectedModel);
    React.useLayoutEffect(() => { selectedModelRef.current = selectedModel; }, [selectedModel]);
    const [selectedMode, setSelectedMode] = React.useState("Code");
    const selectedModeRef = React.useRef(selectedMode);
    React.useLayoutEffect(() => { selectedModeRef.current = selectedMode; }, [selectedMode]);
    const [reasoningEffort, setReasoningEffort] = React.useState<ReasoningEffort>(
        () => readComposerPrefs().effort || "low",
    );
    const [fastMode, setFastMode] = React.useState(() => readComposerPrefs().fast ?? true);
    const tabsHydratedForRef = React.useRef<string | null>(null);

    // The chat on screen. It follows the user's choice only, never the backend pointer.
    const conversationId = viewedConversationId;

    /** Keep the tab strip in step. Does not move the view (see the view effect below). */
    const syncOpenTabs = React.useCallback((convId: string | null, title?: string) => {
        if (!convId) {
            setOpenChatTabs((prev) => {
                const hasDraft = prev.some((tab) => tab.id === NEW_CHAT_TAB_ID);
                if (hasDraft) {
                    return prev.map((tab) =>
                        tab.id === NEW_CHAT_TAB_ID && title ? { ...tab, title } : tab,
                    );
                }
                return [{ id: NEW_CHAT_TAB_ID, title: title || "New Chat" }, ...prev];
            });
            return;
        }
        setOpenChatTabs((prev) => {
            const withoutDraft = prev.filter((tab) => tab.id !== NEW_CHAT_TAB_ID);
            const existing = withoutDraft.find((tab) => tab.id === convId);
            if (existing) {
                return withoutDraft.map((tab) =>
                    tab.id === convId && title ? { ...tab, title } : tab,
                );
            }
            return [...withoutDraft, { id: convId, title: title || "Chat" }];
        });
    }, []);

    const [resolvedFiles, setResolvedFiles] = React.useState<Set<string>>(() => new Set());
    /** Bumped on every Keep/Undo so pendingEdits recomputes after localStorage resolve. */
    const [resolveRevision, setResolveRevision] = React.useState(0);

    /** Side data derived from a transcript of the chat on screen. */
    const hydrateViewedExtras = React.useCallback(
        (id: string | null, msgs: ChatMessage[] | null) => {
            if (!id || !msgs) return;
            syncProposedEditsFromMessages(msgs, id);
            const persisted = getResolvedFiles(id);
            setResolvedFiles(new Set(Object.keys(persisted)));
        },
        [],
    );

    const { project_path } = useProjectState();
    const { catalog } = useBetterShapeCatalog();
    const hydrated = useIsMounted();
    const [restoration, setRestoration] = React.useState<{
        project: typeof project_path;
        persisted: boolean;
        activeId: string;
        switchedProject: boolean;
    } | null>(null);
    if (hydrated && (restoration === null || restoration.project !== project_path)) {
        const persisted = readPersistedChatTabs(project_path);
        const tabs = persisted?.tabs.filter(tab => tab.id !== "__demo_chat__") ?? [];
        if (!tabs.some(tab => tab.id === NEW_CHAT_TAB_ID)) tabs.unshift({ id: NEW_CHAT_TAB_ID, title: "New Chat" });
        const activeId = persisted && persisted.activeId !== "__demo_chat__" ? persisted.activeId : NEW_CHAT_TAB_ID;
        setRestoration({ project: project_path, persisted: persisted !== null, activeId, switchedProject: restoration !== null });
        setOpenChatTabs(tabs);
        setActiveChatTabId(activeId);
    }
    const [tabsLoaded, setTabsLoaded] = useScopedState([restoration], () => false);
    const needsConversation = restoration?.persisted && restoration.activeId !== NEW_CHAT_TAB_ID
        && !isEphemeralChatTabId(restoration.activeId);
    const needsDraftView = restoration?.persisted
        ? restoration.activeId === NEW_CHAT_TAB_ID
        : restoration?.switchedProject;
    const tabsReady = restoration !== null && (needsConversation ? tabsLoaded : !needsDraftView || viewedConversationId === null);

    React.useEffect(() => {
        if (!restoration) return undefined;
        tabsHydratedForRef.current = chatTabsStorageKey(restoration.project);
        if (!restoration.persisted) {
            // Preserve the backend's existing view on first mount, but not across projects.
            if (restoration.switchedProject) showConversation(null);
            return undefined;
        }
        const activeId = restoration.activeId;
        if (activeId === NEW_CHAT_TAB_ID) { showConversation(null); return undefined; }
        if (isEphemeralChatTabId(activeId)) return undefined;
        let cancelled = false;
        const seq = showConversation(activeId);
        commands.loadConversation(activeId, restoration.project ?? undefined).then(async () => {
            if (cancelled || !isCurrentView(seq)) return false;
            clearAllDesignPreviewSessions();
            setContextSummarized(false);
            const messages = await reloadViewedMessages(seq);
            if (cancelled || !isCurrentView(seq)) return false;
            hydrateViewedExtras(activeId, messages);
            return true;
        }).catch(err => {
            if (cancelled || !isCurrentView(seq)) return false;
            if (String(err).includes("Conversation not found")) {
                setOpenChatTabs([{ id: NEW_CHAT_TAB_ID, title: "New Chat" }]);
            } else {
                console.error("Could not restore conversation", activeId, err);
            }
            setActiveChatTabId(NEW_CHAT_TAB_ID);
            showConversation(null);
            return true;
        }).then(complete => {
            if (complete && !cancelled) setTabsLoaded(true);
        }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [restoration, setTabsLoaded, setContextSummarized, showConversation, reloadViewedMessages, hydrateViewedExtras, isCurrentView]);

    const [rulesInputs, setRulesInputs] = React.useState<readonly unknown[] | null>(null);
    if (rulesInputs === null || !Object.is(rulesInputs[0], project_path)) {
        setRulesInputs([project_path]);
        setProjectRuleFiles([]);
    }

    React.useEffect(() => {
        let cancelled = false;
        if (!project_path || !isWorkspaceTrusted(project_path)) return undefined;
        listProjectRuleFiles(project_path).then((names) => {
            if (!cancelled) setProjectRuleFiles(names);
        }).catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [project_path]);

    React.useEffect(() => {
        if (!tabsReady) return;
        writePersistedChatTabs(project_path, openChatTabs, activeChatTabId);
    }, [tabsReady, project_path, openChatTabs, activeChatTabId]);

    React.useEffect(() => {
        window.dispatchEvent(
            new CustomEvent("bettershape-chat-active", { detail: { id: activeChatTabId } }),
        );
    }, [activeChatTabId]);

    const [modelInputs, setModelInputs] = React.useState<readonly unknown[] | null>(null);
    if (modelInputs === null || !Object.is(modelInputs[0], messages) || !Object.is(modelInputs[1], activeChatTabId)) {
        setModelInputs([messages, activeChatTabId]);
        const models = [
            ...new Set(
                messages
                    .filter((m) => m.role === "assistant" && m.model)
                    .map((m) => m.model as string)
                    .slice(-4),
            ),
        ];
        // Return `prev` unchanged when nothing moved: a fresh array here would
        // queue an extra render on every streamed token.
        setOpenChatTabs((prev) => {
            let changed = false;
            const next = prev.map((tab) => {
                if (tab.id !== activeChatTabId) return tab;
                const same =
                    (tab.models?.length ?? 0) === models.length
                    && (tab.models ?? []).every((m, i) => m === models[i]);
                if (same) return tab;
                changed = true;
                return { ...tab, models };
            });
            return changed ? next : prev;
        });
    }

    // Latest editor selection, kept live by editor-view.tsx so an `@selection`
    // mention in the message always resolves against what's selected right now.
    const selectionContextRef = React.useRef<SelectionSnapshot | null>(null);
    React.useEffect(() => {
        const handleSelection = (e: Event) => {
            const detail = (e as CustomEvent<SelectionSnapshot | null>).detail;
            selectionContextRef.current = detail ?? null;
        };
        window.addEventListener("bettershape-editor-selection", handleSelection as EventListener);
        return () => window.removeEventListener("bettershape-editor-selection", handleSelection as EventListener);
    }, []);

    const isEditResolved = React.useCallback(
        (editFile: string, replacement?: string) => {
            if (conversationId) {
                return isFileResolved(conversationId, editFile, replacement);
            }
            // Before a conversation id exists, fall back to the session Set.
            if (replacement !== undefined) return false;
            for (const r of resolvedFiles) {
                if (pathsEqual(r, editFile)) return true;
            }
            return false;
        },
        [resolvedFiles, conversationId],
    );

    const markEditResolved = React.useCallback(
        (file: string, status: "applied" | "rejected", replacement?: string): Promise<void> => {
            const n = file.replace(/\\/g, "/").toLowerCase();
            setResolvedFiles((prev) => {
                const s = new Set(prev);
                s.add(n);
                return s;
            });
            const convId = conversationId;
            if (convId) {
                markFileResolved(convId, file, status, replacement);
            }
            setResolveRevision((v) => v + 1);
            return Promise.resolve();
        },
        [conversationId],
    );

    const pendingEdits = React.useMemo((): PendingEditItem[] => {
        type Step = { id: string; file: string; original: string; replacement: string };
        const stepsByFile = new Map<string, Step[]>();

        const isReviewableEdit = (c: Chunk): c is Chunk & { file: string } => {
            if (!c.file) return false;
            if (c.type === "edit") return true;
            // Applied edits under require-edit-approval land as edit_pending status=applied.
            return (
                c.type === "edit_pending"
                && (c.commandStatus === "applied" || c.commandStatus === "approved")
            );
        };

        messages.forEach((m, msgIdx) => {
            if (m.role !== "assistant" || !m.content || !m.content.includes("<edit")) return;
            const chunks = chunksForMessage(m);
            const editsInMsg = chunks.filter(isReviewableEdit);

            editsInMsg.forEach((e, editIdx) => {
                const list = stepsByFile.get(e.file) || [];
                list.push({
                    id: `msg-${msgIdx}-${editIdx}-${e.file}`,
                    file: e.file,
                    original: e.original || "",
                    replacement: e.replacement || "",
                });
                stepsByFile.set(e.file, list);
            });
        });

        if (stepsByFile.size === 0) {
            return EMPTY_PENDING_EDITS;
        }

        const edits: PendingEditItem[] = [];
        stepsByFile.forEach((steps, file) => {
            // Session Set covers the no-conversationId fallback and immediate Keep/Undo.
            if (!conversationId) {
                const n = file.replace(/\\/g, "/").toLowerCase();
                if ([...resolvedFiles].some((r) => pathsEqual(r, n))) return;
            }

            const resolvedHash = getResolvedContentHash(conversationId, file);
            let startIdx = 0;
            if (resolvedHash) {
                let lastResolved = -1;
                for (let i = 0; i < steps.length; i++) {
                    if (editContentHash(steps[i].replacement) === resolvedHash) {
                        lastResolved = i;
                    }
                }
                if (lastResolved >= 0) {
                    if (lastResolved === steps.length - 1) return;
                    startIdx = lastResolved + 1;
                } else if (isFileResolved(conversationId, file, steps[steps.length - 1]?.replacement)) {
                    return;
                } else if (isFileResolved(conversationId, file)) {
                    startIdx = Math.max(0, steps.length - 1);
                }
            } else if (isFileResolved(conversationId, file, steps[steps.length - 1]?.replacement)) {
                return;
            } else if (isFileResolved(conversationId, file)) {
                return;
            }

            const chain = steps.slice(startIdx);
            if (chain.length === 0) return;
            const latest = chain[chain.length - 1];
            edits.push({
                id: latest.id,
                file,
                baseline: chain[0].original,
                original: latest.original,
                replacement: latest.replacement,
            });
        });

        if (edits.length === 0) return EMPTY_PENDING_EDITS;
        return edits;
        // resolveRevision forces recompute after Keep/Undo writes localStorage.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, conversationId, resolvedFiles, resolveRevision]);

    React.useEffect(() => {
        pendingEdits.forEach((edit) => {
            if (conversationId && isFileResolved(conversationId, edit.file, edit.replacement)) {
                clearProposedEdit(edit.file);
                return;
            }
            if (!conversationId && [...resolvedFiles].some((r) => pathsEqual(r, edit.file))) {
                clearProposedEdit(edit.file);
                return;
            }
            const existing = getProposedEdit(edit.file);
            if (
                !existing
                || existing.original !== edit.original
                || existing.replacement !== edit.replacement
                || existing.baseline !== edit.baseline
            ) {
                setProposedEdit(edit.file, {
                    original: edit.original,
                    replacement: edit.replacement,
                    baseline: edit.baseline,
                    id: edit.id,
                });
            }
        });
    }, [pendingEdits, conversationId, resolvedFiles]);

    const isLoadingRef = React.useRef(false);
    React.useEffect(() => {
        isLoadingRef.current = isLoading;
    }, [isLoading]);

    const conversationIdRef = React.useRef(conversationId);
    React.useEffect(() => {
        conversationIdRef.current = conversationId;
    }, [conversationId]);

    const handleSendMessageRef = React.useRef<(overrideContent?: string) => Promise<boolean>>(
        () => Promise.resolve(false),
    );

    const handleAcceptAll = async () => {
        for (const edit of pendingEdits) {
            await markEditResolved(edit.file, "applied", edit.replacement);
            const resolved = resolveChatFilePath(edit.file, project_path);
            window.dispatchEvent(
                new CustomEvent("bettershape-dismiss-diff", {
                    detail: { path: resolved, rawPath: edit.file },
                }),
            );
        }
    };

    const revertPendingEditBatch = async (batch: PendingEditItem[]) => {
        const failures: string[] = [];
        for (const edit of batch) {
            const resolved = resolveChatFilePath(edit.file, project_path);
            try {
                await commands.applyFileEdit(resolved, "", edit.baseline);
            } catch (e) {
                console.error("Failed to revert edit for", edit.file, e);
                failures.push(edit.file.split(/[\\/]/).pop() || edit.file);
            }
            await markEditResolved(edit.file, "rejected", edit.replacement);
            window.dispatchEvent(
                new CustomEvent("bettershape-dismiss-diff", {
                    detail: { path: resolved, rawPath: edit.file },
                }),
            );
        }
        if (failures.length > 0) {
            notify.error(
                "Undo failed",
                `Could not restore ${failures.length === 1 ? failures[0] : `${failures.length} files`}.`,
            );
        }
    };

    const handleRejectAll = async () => {
        await revertPendingEditBatch(pendingEdits);
    };

    const handleAcceptEdit = React.useCallback(async (editId: string) => {
        const edit = pendingEdits.find((e) => e.id === editId);
        if (!edit) return;
        await markEditResolved(edit.file, "applied", edit.replacement);
        const resolved = resolveChatFilePath(edit.file, project_path);
        window.dispatchEvent(
            new CustomEvent("bettershape-dismiss-diff", {
                detail: { path: resolved, rawPath: edit.file },
            }),
        );
    }, [pendingEdits, markEditResolved, project_path]);

    const handleRejectEdit = async (editId: string) => {
        const idx = pendingEdits.findIndex((e) => e.id === editId);
        if (idx < 0) return;
        const batch = pendingEdits.slice(idx);
        const first = batch[0];
        if (!first) return;
        await revertPendingEditBatch(batch);
        const later = batch.length - 1;
        const notice =
            later > 0
                ? `The user rejected the pending edit to \`${first.file}\` and dropped ${later} later pending edit${later === 1 ? "" : "s"} in this batch. Redo from that file.`
                : `The user rejected the pending edit to \`${first.file}\`. Redo that change if it is still needed.`;
        if (isLoadingRef.current) {
            setMessageQueue((prev) => [
                {
                    id: `q-reject-${Date.now()}`,
                    content: notice,
                    conversationId: conversationIdRef.current,
                },
                ...prev,
            ]);
        } else {
            handleSendMessageRef.current(notice).catch(() => undefined);
        }
    };

    const prevPendingCountRef = React.useRef(0);
    React.useEffect(() => {
        if (!getSettings().ai.autoApplyEdits) {
            prevPendingCountRef.current = pendingEdits.length;
            return;
        }
        if (pendingEdits.length > prevPendingCountRef.current) {
            const newEdits = pendingEdits.slice(prevPendingCountRef.current);
            for (const edit of newEdits) {
                handleAcceptEdit(edit.id).catch(() => undefined);
            }
        }
        prevPendingCountRef.current = pendingEdits.length;
    }, [pendingEdits, handleAcceptEdit]);

    const activeChatTabIdRef = React.useRef(activeChatTabId);
    React.useEffect(() => {
        activeChatTabIdRef.current = activeChatTabId;
    }, [activeChatTabId]);

    // The workspace a read belongs to. A response for the previous project must never
    // replace the list the new project is showing.
    const historyProjectRef = React.useRef(project_path);
    React.useEffect(() => {
        historyProjectRef.current = project_path;
    }, [project_path]);

    const refreshMetadata = React.useCallback(async () => {
        const requestedProject = project_path;
        try {
            const convs = await commands.getConversations(requestedProject ?? undefined);
            if (historyProjectRef.current !== requestedProject) return;
            setRecentConvs(convs);
            const viewed = getViewedConversationId();
            // The backend's current chat supplies the title only when it is the chat on screen.
            const backendId = await commands.getCurrentConversationId();
            if (backendId === viewed) {
                const title = await commands.getChatTitle();
                setChatTitle(title);
                syncOpenTabs(viewed, title);
            }
        } catch (err) {
            console.error("Failed to refresh chat metadata:", err);
        }
    }, [project_path, syncOpenTabs, getViewedConversationId]);

    React.useLayoutEffect(() => { refreshMetadataRef.current = refreshMetadata; }, [refreshMetadata]);

    const refreshHistory = React.useCallback(
        () => commands.getConversations(project_path ?? undefined).then(async convs => {
            if (historyProjectRef.current !== project_path) return;
            setRecentConvs(convs);
            await refreshMetadata();
            const viewed = getViewedConversationId();
            const msgs = await reloadViewedMessages();
            hydrateViewedExtras(viewed, msgs);
        }).catch(err => {
            console.error("Failed to load chat history:", err);
        }),
        [
            project_path,
            refreshMetadata,
            reloadViewedMessages,
            hydrateViewedExtras,
            getViewedConversationId,
        ],
    );

    React.useEffect(() => {
        if (!tabsReady) return;
        refreshHistory().catch(() => undefined);
    }, [tabsReady, refreshHistory]);

    // Mirror the view into the backend-facing store and the tab strip.
    React.useEffect(() => {
        setCurrentConversationId(viewedConversationId);
    }, [viewedConversationId]);

    const [viewInputs, setViewInputs] = React.useState<readonly unknown[] | null>(null);
    if (viewInputs === null
        || !Object.is(viewInputs[0], viewedConversationId)
        || !Object.is(viewInputs[1], tabsReady)
        || !Object.is(viewInputs[2], recentConvs)
        || !Object.is(viewInputs[3], syncOpenTabs)) {
        setViewInputs([viewedConversationId, tabsReady, recentConvs, syncOpenTabs]);
        if (tabsReady) {
        setActiveChatTabId(viewedConversationId ?? NEW_CHAT_TAB_ID);
        const conv = viewedConversationId
            ? recentConvs.find((c) => c.id === viewedConversationId)
            : undefined;
        syncOpenTabs(viewedConversationId, conv?.title);
        }
    }

    // A draft's turn just got its real id: its queued follow-ups now belong to that chat.
    React.useEffect(() => {
        setDraftAdopter((convId) => {
            setMessageQueue((prev) => adoptDraftQueuedMessages(prev, convId));
            window.dispatchEvent(new CustomEvent("bettershape-chats-changed"));
        });
        return () => setDraftAdopter(null);
    }, [setDraftAdopter]);

    React.useEffect(() => {
        const handleRefresh = () => refreshHistory();
        window.addEventListener("bettershape-chat-refresh", handleRefresh);
        return () => window.removeEventListener("bettershape-chat-refresh", handleRefresh);
    }, [refreshHistory]);

    // Incognito lives on the backend; adopt it so a reopened window agrees
    // with the chat that is actually being recorded.
    React.useEffect(() => {
        syncIncognitoFromBackend().catch(() => undefined);
    }, []);

    React.useEffect(() => {
        const handleEditorEditAction = (e: Event) => {
            const custom = e as CustomEvent<{
                path: string;
                action: "applied" | "rejected";
                replacement?: string;
            }>;
            if (!custom.detail) return;
            const { path, action } = custom.detail;
            const proposed = getProposedEdit(path);
            const replacement = custom.detail.replacement ?? proposed?.replacement;
            const n = path.replace(/\\/g, "/").toLowerCase();
            setResolvedFiles((prev) => {
                const s = new Set(prev);
                s.add(n);
                return s;
            });
            const convId = conversationIdRef.current;
            if (convId) {
                markFileResolved(convId, path, action, replacement);
            }
            clearProposedEdit(path);
        };
        window.addEventListener("bettershape-editor-edit-action", handleEditorEditAction as EventListener);
        return () =>
            window.removeEventListener("bettershape-editor-edit-action", handleEditorEditAction as EventListener);
    }, []);

    React.useEffect(() => {
        inputValueRef.current = inputValue;
    }, [inputValue]);

    React.useEffect(() => {
        const persist = () => {
            if (draftPersistTimerRef.current !== null) {
                clearTimeout(draftPersistTimerRef.current);
                draftPersistTimerRef.current = null;
            }
            try {
                if (inputValueRef.current) {
                    localStorage.setItem("bettershape-chat-input", inputValueRef.current);
                } else {
                    localStorage.removeItem("bettershape-chat-input");
                }
            } catch {
                /* ignore */
            }
        };
        // Keep draft durable across blur / close even if last keystroke is still debounced.
        window.addEventListener("pagehide", persist);
        window.addEventListener("beforeunload", persist);
        const onVis = () => {
            if (document.visibilityState === "hidden") persist();
        };
        document.addEventListener("visibilitychange", onVis);
        return () => {
            persist();
            window.removeEventListener("pagehide", persist);
            window.removeEventListener("beforeunload", persist);
            document.removeEventListener("visibilitychange", onVis);
        };
    }, []);

    // Cycle Chat Mode via global keybinding registry (see config/keybindings.json).
    React.useEffect(() => {
        const onCycle = () => {
            setSelectedMode((prev) => {
                if (prev === "Code") return "Ask";
                if (prev === "Ask") return "Plan";
                return "Code";
            });
        };
        window.addEventListener("bettershape-chat-cycle-mode", onCycle);
        return () => window.removeEventListener("bettershape-chat-cycle-mode", onCycle);
    }, []);

    const handleInputChange = React.useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            const val = e.target.value;
            setInputValue(val);
            const editingId = editingQueueIdRef.current;
            if (editingId) {
                setMessageQueue((prev) =>
                    prev.map((m) => (m.id === editingId ? { ...m, content: val } : m)),
                );
            }
            if (draftPersistTimerRef.current !== null) {
                clearTimeout(draftPersistTimerRef.current);
            }
            draftPersistTimerRef.current = setTimeout(() => {
                draftPersistTimerRef.current = null;
                try {
                    if (inputValueRef.current) {
                        localStorage.setItem("bettershape-chat-input", inputValueRef.current);
                    } else {
                        localStorage.removeItem("bettershape-chat-input");
                    }
                } catch {
                    /* ignore */
                }
            }, 180);
            if (sendError) setSendError(null);
        },
        [sendError, setInputValue, setSendError],
    );

    const handleNewChatRef = React.useRef<() => Promise<void>>(() => Promise.resolve());
    const sendToChatRef = React.useRef<(content: string, target: string) => Promise<boolean>>(
        () => Promise.resolve(false),
    );
    /** Sends currently awaiting the backend. A counter, so overlapping sends cannot clear each other. */
    const sendsInFlightRef = React.useRef(0);
    const preparations = useSendPreparations(project_path ?? null, conversationId);
    const skipQueueDrainRef = React.useRef(false);
    // Set when a send to a chat failed. The queue for that chat then waits for the next
    // successful send, so a failing message is not re-sent in a loop, while the view still
    // ends its optimistic turn instead of showing a loading state forever.
    const failedSendHoldRef = React.useRef<{ conversationId: string | null } | null>(null);
    const forceSendRef = React.useRef(false);

    /**
     * Make `id` the backend's current chat. Only the backend-current operations (fork,
     * restore checkpoint, redo, generation state) need this. Sends name their chat explicitly.
     */
    const activateBackend = React.useCallback(
        async (id: string) => {
            const backendId = await commands.getCurrentConversationId();
            if (!needsBackendPin(backendId, id)) return;
            const conv = recentConvs.find((c) => c.id === id);
            await commands.loadConversation(id, conv?.project_path ?? project_path ?? undefined);
            clearAllDesignPreviewSessions();
            setContextSummarized(false);
        },
        [recentConvs, project_path, setContextSummarized],
    );

    const activateViewedBackend = React.useCallback(async () => {
        const id = getViewedConversationId();
        if (id) await activateBackend(id);
    }, [activateBackend, getViewedConversationId]);

    /**
     * Put chat `id` on screen at once, then activate it and load its transcript. A slower
     * load for a chat the user has since left is dropped.
     */
    const openConversation = React.useCallback(
        async (id: string, projectPath?: string | null) => {
            const seq = showConversation(id);
            setSendError(null);
            try {
                await commands.loadConversation(id, projectPath ?? null);
            } catch (err) {
                if (!isCurrentView(seq)) return;
                const message = err instanceof Error ? err.message : String(err);
                if (!message.includes("Conversation not found")) {
                    console.error("Failed to load conversation:", err);
                }
                startDraftChat();
                await refreshMetadataRef.current();
                return;
            }
            if (!isCurrentView(seq)) return;
            clearAllDesignPreviewSessions();
            setContextSummarized(false);
            const msgs = await reloadViewedMessages(seq);
            hydrateViewedExtras(id, msgs);
        },
        [
            showConversation,
            isCurrentView,
            setSendError,
            startDraftChat,
            setContextSummarized,
            reloadViewedMessages,
            hydrateViewedExtras,
        ],
    );

    /** Queue a follow-up bound to `conversationId` (defaults to the chat on screen). */
    const enqueueChatMessage = React.useCallback(
        (content: string, conversationId?: string | null) => {
            const id = `q-${Date.now()}-${randomSuffix(6)}`;
            const owner = conversationId === undefined ? conversationIdRef.current : conversationId;
            setMessageQueue((prev) => [...prev, { id, content: content.trim(), conversationId: owner }]);
        },
        [],
    );

    /** Put a queued message that could not be delivered back at the front of its chat's queue. */
    const restoreQueuedMessage = React.useCallback((item: QueuedChatMessage) => {
        setMessageQueue((prev) => (prev.some((m) => m.id === item.id) ? prev : [item, ...prev]));
    }, []);

    /**
     * Deliver one message. `fromQueue` sends leave the composer alone: the user may be
     * typing a new message, and any pending attachments belong to that message, not the
     * queued one.
     */
    const holdQueueAfterFailedSend = (conversationId: string | null) => {
        failedSendHoldRef.current = { conversationId };
        stopLiveTurn(conversationId);
    };

    const sendMessageNow = async (
        messageContent: string,
        fromQueue: boolean,
        targetId?: string | null,
    ): Promise<boolean> => {
        // The chat this message belongs to, fixed now: the user may switch chats mid-send.
        const target = targetId !== undefined ? targetId : getViewedConversationId();
        const submittedRevision = composerRevisionRef.current;
        const submittedIds = fromQueue ? [] : uploadedFilesRef.current.map(file => file.id);
        const submittedQuotes = fromQueue ? [] : quotedExcerptsRef.current;
        const preparation = preparations.begin(target);
        if (preparation.signal.aborted) return false;
        try {
            try {
                await waitForAiConfiguration(preparation.signal);
            } catch {
                if (preparation.signal.aborted) return false;
                throw new Error("Could not load provider settings. Retry after checking Settings > Providers.");
            }
            if (preparation.signal.aborted) return false;
            if (!hasUsableProvider(getSettings().ai.providers)) {
                throw new Error("Add an API key in Settings → Providers to chat.");
            }
            const readyFiles = await waitForSendAttachments(submittedIds, () => uploadedFilesRef.current, preparation.signal);
            const quotePrefix = submittedQuotes.length > 0 ? formatQuotesPrefix(submittedQuotes) : "";
            const effectivePrompt = quotePrefix
                ? messageContent.trim()
                    ? `${quotePrefix}\n\n${messageContent}`
                    : quotePrefix
                : messageContent;
            const userMsg = await messageWithAttachments(effectivePrompt, readyFiles, preparation.signal);

            if (preparation.signal.aborted) return false;
            if (getViewedConversationId() === target) setSendError(null);
            const settings = getSettings();
            const expandedMessage = await buildMessageWithMentions(
                userMsg,
                project_path ?? null,
                selectionContextRef.current,
            );
            try {
                const { mentionRanges } = await import("@/lib/chat/mentions");
                const { trySelectPendingDesignConcept } = await import("@/lib/agent-preview/store");
                for (const range of mentionRanges(userMsg)) {
                    if (range.mention.kind === "design") {
                        const id = range.mention.id || range.mention.path || range.mention.label;
                        if (id) await trySelectPendingDesignConcept(id);
                    }
                }
            } catch {
                /* pick already resolved or none pending */
            }
            const projectRules = isWorkspaceTrusted(project_path)
                ? await loadProjectRules(project_path ?? null)
                : "";
            const mergedRules = [settings.ai.customRules, projectRules].filter(Boolean).join("\n\n") || undefined;
            const { applyWorkflows, matchWorkflows, workflowAllowKeys } = await import("@/lib/chat/workflows");
            const messageWithWorkflows = applyWorkflows(expandedMessage, settings.ai.workflows);
            const pluginAutoAllow = matchWorkflows(userMsg, settings.ai.workflows).flatMap(workflowAllowKeys);

            const modelToSend = selectedModelRef.current || "auto";
            const modeToSend = selectedModeRef.current;
            const catalogIds = getCatalogModels().map((m) => m.id);
            const subagentSend = subagentModelsForSend(settings.ai.subagentModels, catalogIds, {
                defaultModel: settings.ai.subagentDefaultModel,
            });

            if (preparation.signal.aborted) return false;
            if (hasLiveTurn(target) || isChatGenerating(target)) {
                throw new Error("This chat is already running. Your message has not been sent.");
            }
            // Attachment and mention preparation can outlive a provider change; check again at admission.
            if (!hasUsableProvider(getSettings().ai.providers)) {
                throw new Error("Add an API key in Settings → Providers to chat.");
            }
            assertSendAttachmentsUnchanged(readyFiles, uploadedFilesRef.current);
            // No optimistic transcript exists until all asynchronous preparation succeeds.
            const clientRequestId = createChatRequestId(target);
            appendUserOptimistic(userMsg, target, clientRequestId);
            let restoreConsumedDraft: (() => void) | undefined;
            try {
                if (!fromQueue) {
                    // Only consume the submitted draft at admission. New edits/files belong to the next message.
                    const submitted = new Set(submittedIds);
                    const consumedFiles = uploadedFilesRef.current.filter(file => submitted.has(file.id));
                    setUploadedFiles(files => files.filter(file => !submitted.has(file.id)));
                    const submittedQuoteIds = new Set(submittedQuotes.map((q) => q.id));
                    if (submittedQuoteIds.size > 0) {
                        setQuotedExcerpts((prev) => prev.filter((q) => !submittedQuoteIds.has(q.id)));
                    }
                    const consumedComposer = getViewedConversationId() === target && composerRevisionRef.current === submittedRevision && inputValueRef.current === messageContent;
                    const previousEditingQueueId = editingQueueIdRef.current;
                    if (consumedComposer) {
                        inputValueRef.current = "";
                        setInputValue("");
                        editingQueueIdRef.current = null;
                        try { localStorage.removeItem("bettershape-chat-input"); } catch { /* Session draft still clears. */ }
                    }
                    restoreConsumedDraft = () => {
                        // Native admission can still reject the send. Give the submitted
                        // draft back instead of making the user retype it, without
                        // clobbering text or files added after the rejection.
                        const viewed = getViewedConversationId();
                        if (consumedFiles.length > 0) {
                            setUploadedFiles(files => restoreRejectedAttachments(consumedFiles, files, target, viewed));
                        }
                        if (submittedQuotes.length > 0 && viewed === target) {
                            setQuotedExcerpts((prev) => {
                                const existing = new Set(prev.map((q) => q.id));
                                return [...submittedQuotes.filter((q) => !existing.has(q.id)), ...prev];
                            });
                        }
                        // The composer was cleared at admission, which bumps the revision, so
                        // an empty composer is the guard: text typed since the failure stays.
                        if (consumedComposer && viewed === target && !inputValueRef.current) {
                            inputValueRef.current = messageContent;
                            setInputValue(messageContent);
                            editingQueueIdRef.current = previousEditingQueueId;
                        }
                    };
                }
                // Preparation ends at native admission, not at provider readiness.
                preparations.finish(preparation);
                await commands.sendChatMessage(
                    messageWithWorkflows,
                    modelToSend,
                    modeToSend,
                    mergedRules,
                    undefined,
                    settings.ai.reviewAdversarialEnabled,
                    {
                        autoRunMode: settings.ai.autoRunMode,
                        requireEditApproval: settings.ai.requireEditApproval,
                        protectDestructiveGit: settings.ai.protectDestructiveGit,
                        pluginApprovalDefault: settings.ai.pluginApprovalDefault ?? "ask",
                        pluginApprovals: settings.ai.pluginApprovals,
                        pluginDisabledActions: settings.ai.pluginDisabledActions,
                        pluginAutoAllow,
                    },
                    reasoningEffort,
                    undefined,
                    userMsg,
                    undefined,
                    undefined,
                    subagentSend.models,
                    subagentSend.defaultModel,
                    settings.ai.compactInstructions || undefined,
                    target,
                    clientRequestId,
                );
                // The message is now native state; a later failure must not put the
                // consumed draft back into the composer.
                restoreConsumedDraft = undefined;
                await refreshMetadata();
                failedSendHoldRef.current = null;
                return true;
            } catch (err) {
                restoreConsumedDraft?.();
                const owner = getRequestOwner(clientRequestId);
                if (!owner) return false;
                holdQueueAfterFailedSend(owner.conversationId);
                if (getViewedConversationId() !== owner.conversationId) {
                    notify.error("Could not send message", "The failed chat's queued messages remain paused. Open that chat to retry.");
                    return false;
                }
                console.error("Failed to send message:", err);
                const errMsg = err instanceof Error ? err.message : String(err);
                setSendError(errMsg);
                setMessages((prev) => {
                    if (prev.length < 1) return prev;
                    const last = prev[prev.length - 1];
                    if (last?.role === "assistant" && !last.content.trim()) {
                        return prev.slice(0, -1);
                    }
                    return prev;
                });
                return false;
            }
        } catch (error) {
            // Preparation failures happen before an optimistic/native turn exists.
            if (!preparation.signal.aborted) {
                failedSendHoldRef.current = { conversationId: target };
                const message = error instanceof Error ? error.message : "Could not prepare attachments. Retry or remove them before sending.";
                if (getViewedConversationId() === target) setSendError(message);
                else notify.error("Could not prepare message", message);
            }
            return false;
        } finally {
            preparations.finish(preparation);
        }
    };

    /**
     * Deliver `content` to chat `target`. A busy target queues it there. The chat on screen
     * uses the composer path. A background chat is sent to directly, so the view stays put.
     */
    const sendToChat = async (content: string, target: string): Promise<boolean> => {
        // The chat the build belongs to comes on screen first. `openConversation` puts it on
        // screen synchronously; its transcript load continues in the background.
        if (target !== getViewedConversationId()) openConversation(target).catch(() => undefined);
        // Busy means a turn is running in the target, or (for the chat on screen) a composer
        // send is still in flight. Read from the store, not from a possibly stale closure.
        const busy =
            hasLiveTurn(target) ||
            isChatGenerating(target) ||
            (target === getViewedConversationId() && sendsInFlightRef.current > 0);
        if (busy) {
            enqueueChatMessage(content, target);
            return true;
        }
        sendsInFlightRef.current += 1;
        let sent = false;
        try {
            sent = await sendMessageNow(content, true, target);
            return sent;
        } finally {
            sendsInFlightRef.current -= 1;
            if (sent) {
                setQueueDrainTick((t) => t + 1);
            } else {
                // A failed delivery goes back to the front of its own chat's queue.
                restoreQueuedMessage({
                    id: `q-${Date.now()}-${randomSuffix(6)}`,
                    content,
                    conversationId: target,
                });
            }
        }
    };

    /** `/compact [focus]` — summarize older turns without sending a chat turn. */
    const runCompactCommand = async (focus: string): Promise<void> => {
        if (isIncognitoChat()) {
            notify.info("Incognito chats are not summarized.");
            return;
        }
        if (!getViewedConversationId()) {
            notify.info("Nothing to compact yet. Send a few messages first.");
            return;
        }
        try {
            // Native compacts the chat it currently holds, so the chat on screen has to become
            // that one first: a tab that is still loading would otherwise summarize the chat
            // the user just left behind.
            await activateViewedBackend();
            const result = (await commands.compactChat({
                focus: focus || undefined,
                instructions: getSettings().ai.compactInstructions || undefined,
                model: selectedModelRef.current || undefined,
            })) as Awaited<ReturnType<typeof commands.compactChat>> | null | undefined;
            if (!result) {
                notify.info("Nothing to compact yet. This chat is still small.");
                return;
            }
            if (result.error) {
                notify.error("Could not compact this chat.", result.error);
                return;
            }
            if (result.alreadySmall || !result.record) {
                notify.info("Nothing to compact yet. This chat is still small.");
                return;
            }
            setContextSummarized(true);
            notify.success(
                `Compacted ${result.record.messagesBefore - result.record.messagesAfter} older messages.`,
                `Saved about ${result.record.tokensSaved.toLocaleString()} tokens. The full transcript stays in this chat.`,
            );
        } catch (err) {
            notify.error("Could not compact this chat.", err instanceof Error ? err.message : String(err));
        }
    };

    const handleSendMessage = async (overrideContent?: string): Promise<boolean> => {
        const messageContent = typeof overrideContent === "string" ? overrideContent : inputValue;
        const fromQueue = typeof overrideContent === "string";

        // Built-in commands are handled here and never reach the model as text.
        const slash = matchSlashCommand(messageContent);
        if (slash?.command.token === "/compact") {
            if (isLoading) {
                notify.info("Wait for this reply to finish, then run /compact.");
                return false;
            }
            if (!fromQueue) {
                setInputValue("");
                try {
                    localStorage.removeItem("bettershape-chat-input");
                } catch {
                    /* ignore */
                }
            }
            await runCompactCommand(slash.argument);
            return true;
        }

        if (!fromQueue && isLoading) {
            const pendingQuotes = quotedExcerptsRef.current;
            if (!messageContent.trim() && uploadedFiles.length === 0 && pendingQuotes.length === 0) return false;
            if (uploadedFiles.length > 0) return false;
            const quotePrefix = pendingQuotes.length > 0 ? formatQuotesPrefix(pendingQuotes) : "";
            const queuedText = quotePrefix
                ? messageContent.trim()
                    ? `${quotePrefix}\n\n${messageContent}`
                    : quotePrefix
                : messageContent;
            const editingId = editingQueueIdRef.current;
            if (editingId) {
                setMessageQueue((prev) =>
                    prev.map((m) =>
                        m.id === editingId ? { ...m, content: queuedText.trim() } : m,
                    ),
                );
                setInputValue("");
                if (pendingQuotes.length > 0) setQuotedExcerpts([]);
                editingQueueIdRef.current = null;
                try {
                    localStorage.removeItem("bettershape-chat-input");
                } catch {
                    /* ignore */
                }
                return true;
            }
            enqueueChatMessage(queuedText);
            setInputValue("");
            if (pendingQuotes.length > 0) setQuotedExcerpts([]);
            try {
                localStorage.removeItem("bettershape-chat-input");
            } catch {
                /* ignore */
            }
            return true;
        }

        if (
            (!messageContent.trim() && uploadedFiles.length === 0 && (fromQueue || quotedExcerptsRef.current.length === 0)) ||
            (!forceSendRef.current && (isLoading || sendsInFlightRef.current > 0))
        ) {
            return false;
        }

        sendsInFlightRef.current += 1;
        let sent = false;
        try {
            sent = await sendMessageNow(messageContent, fromQueue);
            return sent;
        } finally {
            sendsInFlightRef.current -= 1;
            // Only a delivered send frees the next queued message. A failed one is restored
            // to the queue instead, so a persistent failure cannot spin the drain forever.
            if (sent) setQueueDrainTick((t) => t + 1);
        }
    };

    React.useEffect(() => {
        handleSendMessageRef.current = handleSendMessage;
        sendToChatRef.current = sendToChat;
    });

    // Drain only the queue of the chat on screen, and only once it is idle with no send
    // pending. The send's own completion bumps `queueDrainTick`, so a finished turn can
    // never race its successor and drop the queued follow-up.
    React.useEffect(() => {
        if (
            !canDrainQueue({
                isLoading,
                sendsInFlight: sendsInFlightRef.current,
                skipDrain:
                    skipQueueDrainRef.current ||
                    (failedSendHoldRef.current !== null &&
                        failedSendHoldRef.current.conversationId === conversationId),
            })
        ) {
            return;
        }
        const taken = takeNextQueuedMessage(messageQueueRef.current, conversationId);
        if (!taken) return;
        messageQueueRef.current = taken.rest;
        setMessageQueue(taken.rest);
        const item = taken.item;
        handleSendMessageRef.current(item.content).then(
            (sent) => {
                if (!sent) restoreQueuedMessage(item);
            },
            (err) => {
                console.error("Failed to send queued message:", err);
                restoreQueuedMessage(item);
            },
        ).catch(() => undefined);
    }, [isLoading, conversationId, queueDrainTick, restoreQueuedMessage]);

    const handleEditQueuedMessage = React.useCallback((id: string) => {
        setMessageQueue((prev) => {
            const item = prev.find((m) => m.id === id);
            if (item) {
                setInputValue(item.content);
                editingQueueIdRef.current = id;
                try {
                    localStorage.setItem("bettershape-chat-input", item.content);
                } catch {
                    /* ignore */
                }
            }
            return prev;
        });
    }, [setInputValue]);

    const handleRemoveQueuedMessage = React.useCallback((id: string) => {
        if (editingQueueIdRef.current === id) {
            editingQueueIdRef.current = null;
            setInputValue("");
            try {
                localStorage.removeItem("bettershape-chat-input");
            } catch {
                /* ignore */
            }
        }
        setMessageQueue((prev) => prev.filter((m) => m.id !== id));
    }, [setInputValue]);

    const handleUpdateQueuedMessage = React.useCallback((id: string, content: string) => {
        setMessageQueue((prev) =>
            prev.map((m) => (m.id === id ? { ...m, content: content.trim() } : m)),
        );
    }, []);

    React.useEffect(() => {
        const handleBuildPlan = (e: Event) => {
            const custom = e as CustomEvent<{
                path: string;
                title?: string;
                conversationId?: string | null;
            }>;
            if (!custom.detail?.path) return;
            const message = buildPlanBuildMessage(custom.detail.path, custom.detail.title);
            setSelectedMode("Code");
            // The plan names the chat it was created in. Without a name, use the chat on screen.
            const target = custom.detail.conversationId || getViewedConversationId();
            if (!target) {
                if (isLoadingRef.current) enqueueChatMessage(message, null);
                else handleSendMessageRef.current(message).catch(() => undefined);
                return;
            }
            sendToChatRef.current(message, target).catch(() => undefined);
        };
        window.addEventListener("bettershape-build-plan", handleBuildPlan);
        return () => window.removeEventListener("bettershape-build-plan", handleBuildPlan);
    }, [enqueueChatMessage, getViewedConversationId]);

    React.useEffect(() => {
        /** Inserts or appends external prompt text into the active chat composer. */
        const handleInsertPrompt = (evt: Event) => {
            const detail = (evt as CustomEvent<InsertPromptDetail>).detail;
            applyInsertedPromptEvent(detail, {
                isBusy: isChatSendBusy(isLoadingRef.current, sendsInFlightRef.current),
                setInputValue,
                enqueue: enqueueChatMessage,
                sendNow: handleSendMessageRef.current,
            });
        };
        window.addEventListener("bettershape-chat-insert-prompt", handleInsertPrompt as EventListener);
        return () =>
            window.removeEventListener("bettershape-chat-insert-prompt", handleInsertPrompt as EventListener);
    }, [enqueueChatMessage, setInputValue]);

    React.useEffect(() => {
        const onQuote = (event: Event) => {
            const detail = (event as CustomEvent<{ id?: string; text?: string } | undefined>).detail;
            if (!detail) return;
            const text = detail.text?.trim();
            if (!text) return;
            const id = detail.id || `${Date.now()}-${randomSuffix(5)}`;
            setQuotedExcerpts((prev) => {
                if (prev.some((q) => q.text === text)) return prev;
                return [...prev.slice(-7), { id, text }];
            });
            window.dispatchEvent(new CustomEvent("bettershape-chat-focus-input"));
        };
        window.addEventListener("bettershape-chat-quote-selection", onQuote as EventListener);
        return () =>
            window.removeEventListener("bettershape-chat-quote-selection", onQuote as EventListener);
    }, []);

    const lastQuoteThreadRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (lastQuoteThreadRef.current !== null && lastQuoteThreadRef.current !== activeChatTabId) {
            setQuotedExcerpts([]);
        }
        lastQuoteThreadRef.current = activeChatTabId;
    }, [activeChatTabId]);

    const messagesRef = React.useRef(messages);
    React.useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    const [scrolledFromTop, setScrolledFromTop] = React.useState(false);
    const [scrolledFromBottom, setScrolledFromBottom] = React.useState(false);
    const isNearBottomRef = React.useRef(true);

    const handleRestore = React.useCallback(
        async (msgIdx: number) => {
            try {
                const msg = messagesRef.current[msgIdx];
                if (!msg || msg.role !== "user") return;

                const { confirmRestoreCheckpoint } = await import(
                    "@/features/chat/ui/shell/checkpoint-restore-dialog"
                );
                if (!(await confirmRestoreCheckpoint(msgIdx))) return;

                // Reverting the sole user turn empties the thread — drop the chat,
                // but keep the restored message in the composer on home.
                const soleUserTurn =
                    msgIdx === 0
                    && messagesRef.current.filter((m) => m.role === "user").length === 1;
                if (soleUserTurn) {
                    const {
                        parseUserAttachments,
                        attachmentsToComposer,
                    } = await import("@/features/chat/lib/user-attachments");
                    const parsed = parseUserAttachments(msg.content);
                    const files = await attachmentsToComposer(parsed.attachments);

                    await activateViewedBackend();

                    await commands.restoreCheckpoint(msgIdx);
                    clearAllDesignPreviewSessions();
                    const convId = conversationIdRef.current;
                    if (convId) {
                        try {
                            await commands.deleteConversation(convId);
                        } catch {
                            /* draft / already gone */
                        }
                    }
                    await handleNewChatRef.current();
                    setInputValue(parsed.text);
                    setUploadedFiles(files);
                    try {
                        localStorage.setItem("bettershape-chat-input", parsed.text);
                    } catch {
                        /* ignore */
                    }
                    return;
                }

                const {
                    parseUserAttachments,
                    attachmentsToComposer,
                } = await import("@/features/chat/lib/user-attachments");
                const parsed = parseUserAttachments(msg.content);

                await activateViewedBackend();

                await commands.restoreCheckpoint(msgIdx);
                clearAllDesignPreviewSessions();
                setInputValue(parsed.text);
                setUploadedFiles(await attachmentsToComposer(parsed.attachments));
                try {
                    localStorage.setItem("bettershape-chat-input", parsed.text);
                } catch {
                    /* ignore */
                }
                await refreshHistory();
                setTimeout(() => {
                    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                }, 100);
            } catch (err) {
                console.error("Failed to restore checkpoint:", err);
            }
        },
        [activateViewedBackend, setInputValue, refreshHistory, messagesEndRef],
    );

    const handleRedo = React.useCallback(
        async (msgIdx: number) => {
            try {
                const msgs = messagesRef.current;
                let userMsgIdx = -1;
                for (let i = msgIdx; i >= 0; i--) {
                    if (msgs[i].role === "user") {
                        userMsgIdx = i;
                        break;
                    }
                }

                if (userMsgIdx === -1) return;

                const userContent = msgs[userMsgIdx].content;
                // restore_checkpoint cancels any in-flight turn; wait until the
                // slot is free so the resent message is not silently dropped.
                await activateViewedBackend();
                await commands.restoreCheckpoint(userMsgIdx);
                clearAllDesignPreviewSessions();
                for (let i = 0; i < 40; i++) {
                    const gen = await commands.getChatGenerationState(getViewedConversationId());
                    if (!gen.isGenerating) break;
                    await new Promise((r) => setTimeout(r, 50));
                }
                await refreshHistory();
                await handleSendMessageRef.current(userContent);
            } catch (err) {
                console.error("Failed to redo message:", err);
            }
        },
        [refreshHistory, activateViewedBackend, getViewedConversationId],
    );

    const handleForkChat = React.useCallback(
        async (msgIdx: number) => {
            try {
                await activateViewedBackend();
                const res = await commands.forkConversation(msgIdx);
                const seq = showConversation(res.id);
                setChatTitle(res.title);
                syncOpenTabs(res.id, res.title);
                const msgs = await reloadViewedMessages(seq);
                hydrateViewedExtras(res.id, msgs);
                refreshHistory().catch(() => undefined);
            } catch (err) {
                console.error("Failed to fork chat:", err);
            }
        },
        [
            activateViewedBackend,
            showConversation,
            reloadViewedMessages,
            hydrateViewedExtras,
            syncOpenTabs,
            refreshHistory,
        ],
    );

    React.useEffect(() => {
        const onFork = (event: Event) => {
            const id = (event as CustomEvent<{ id?: string }>).detail?.id;
            if (id && id !== conversationIdRef.current) return;
            const msgs = messagesRef.current;
            let idx = -1;
            for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i]?.role === "user") {
                    idx = i;
                    break;
                }
            }
            if (idx < 0) return;
            handleForkChat(idx).catch(() => undefined);
        };
        window.addEventListener("bettershape-chat-fork", onFork);
        return () => window.removeEventListener("bettershape-chat-fork", onFork);
    }, [handleForkChat]);

    React.useEffect(() => {
        writeComposerPrefs({
            model: selectedModel,
            effort: reasoningEffort,
            fast: fastMode,
        });
    }, [selectedModel, reasoningEffort, fastMode]);

    if (catalog) {
        const ai = getSettings().ai;
        const keyed = resolveChatModels(getCatalogModels());
        if (!keyed.some(model => model.id === selectedModel)) {
            const enabled = sanitizeEnabledModels(ai.enabledModels, keyed.map(model => model.id), getCatalogDefaultEnabledIds());
            const visible = getVisibleModels(keyed, enabled);
            const replacement = visible.some(model => model.id === ai.defaultModel) ? ai.defaultModel : visible[0]?.id;
            if (replacement && replacement !== selectedModel) setSelectedModel(replacement);
        }
    }

    React.useEffect(() => {
        let disposed = false;
        let unlisten: (() => void) | undefined;
        import("@tauri-apps/api/event").then(({ listen }) => {
            listen<{ path?: string }>("bettershape-design-preview-close", (event) => {
                const path = event.payload?.path;
                if (!path) return;
                commands.closeFile(path).catch(() => { /* already closed */ });
            }).then((fn) => {
                if (disposed) fn();
                else unlisten = fn;
            }).catch(() => undefined);
        }).catch(() => undefined);
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);

    React.useEffect(() => {
        let disposed = false;
        const unlisteners: (() => void)[] = [];
        const register = (promise: Promise<() => void>) => {
            promise.then((fn) => {
                if (disposed) fn();
                else unlisteners.push(fn);
            }).catch(() => undefined);
        };

        register(
            listen<{ conversationId?: string; message?: string }>("parent_resume", (event) => {
                const cid = event.payload?.conversationId?.trim();
                const message = event.payload?.message;
                if (!cid || !message) return;
                (async () => {
                    if (getViewedConversationId() !== cid) await openConversation(cid);
                    if (isChatGenerating(cid)) {
                        enqueueChatMessage(message, cid);
                        return;
                    }
                    if (getViewedConversationId() === cid) {
                        await handleSendMessageRef.current(message);
                    } else {
                        await sendToChatRef.current(message, cid);
                    }
                })().catch(() => undefined);
            }),
        );

        register(
            listen<{ title?: string; conversationId?: string }>("chat_title", (event) => {
                const title = event.payload?.title?.trim();
                const convId = event.payload?.conversationId?.trim();
                if (!title || !convId) return;
                syncOpenTabs(convId, title);
                window.dispatchEvent(new CustomEvent("bettershape-chats-changed"));
                if (getViewedConversationId() === convId) setChatTitle(title);
            }),
        );

        return () => {
            disposed = true;
            unlisteners.forEach((fn) => fn());
        };
    }, [syncOpenTabs, enqueueChatMessage, openConversation, getViewedConversationId]);

    const handleNewChat = async () => {
        try {
            // Do not stop background generation; only the Stop button cancels.
            startDraftChat();
            await commands.newChat();
            clearAllDesignPreviewSessions();
            setSendError(null);
            setContextSummarized(false);
            import("@/features/agent/subagents/store").then(({ resetSubagentsForParent }) => {
                resetSubagentsForParent(conversationIdRef.current);
            }).catch(() => undefined);
            setChatTitle("New Chat");
            setResolvedFiles(new Set());
            clearAllProposedEdits();
            setOpenChatTabs((prev) => {
                const others = prev.filter((tab) => tab.id !== NEW_CHAT_TAB_ID);
                return [{ id: NEW_CHAT_TAB_ID, title: "New Chat" }, ...others];
            });
            setActiveChatTabId(NEW_CHAT_TAB_ID);
            refreshHistory().catch(() => undefined);
        } catch (err) {
            console.error("Failed to start new chat:", err);
        }
    };

    React.useEffect(() => {
        handleNewChatRef.current = handleNewChat;
    });

    const handleSelectChatTab = async (tabId: string) => {
        if (tabId === activeChatTabId) return;
        setSendError(null);
        if (tabId === NEW_CHAT_TAB_ID) {
            await handleNewChat();
            return;
        }
        try {
            await setIncognitoChat(false);
        } catch {
            /* ignore */
        }
        const conv = recentConvs.find((c) => c.id === tabId);
        await openConversation(tabId, conv?.project_path ?? project_path);
    };

    const handleCloseChatTab = async (tabId: string) => {
        if (isIncognitoChat() && tabId === conversationIdRef.current) {
            await purgeIncognitoConversation(tabId);
            await setIncognitoChat(false);
        }
        const remaining = openChatTabs.filter((tab) => tab.id !== tabId);
        if (remaining.length === 0) {
            setOpenChatTabs([{ id: NEW_CHAT_TAB_ID, title: "New Chat" }]);
            setActiveChatTabId(NEW_CHAT_TAB_ID);
            startDraftChat();
            setChatTitle("New Chat");
            window.dispatchEvent(
                new CustomEvent("bettershape-layout-toggle", {
                    detail: { id: "secondary-sidebar", value: false },
                }),
            );
            return;
        }
        setOpenChatTabs(remaining);
        if (tabId === activeChatTabId) {
            const next = remaining[remaining.length - 1];
            await handleSelectChatTab(next.id);
        }
    };

    const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSendMessageRef.current().catch((err) => {
                console.error("Failed to send message:", err);
            });
        }
    }, []);

    const userDetachedRef = React.useRef(false);
    const programmaticScrollRef = React.useRef(false);
    const disclosureLockUntilRef = React.useRef(0);
    const lastScrollTopRef = React.useRef(0);
    const prevMsgCountRef = React.useRef(messages.length);
    const prevConvIdRef = React.useRef(conversationId);

    const syncScrollFlags = React.useCallback(
        (el: HTMLDivElement, options?: { allowReattach?: boolean }) => {
            const distanceFromBottom = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
            const allowReattach =
                (options?.allowReattach ?? true) && Date.now() > disclosureLockUntilRef.current;
            if (allowReattach && distanceFromBottom <= 36) {
                userDetachedRef.current = false;
            }
            isNearBottomRef.current =
                !userDetachedRef.current && (isLoadingRef.current || distanceFromBottom <= 160);
            setScrolledFromTop((prev) => {
                const next = el.scrollTop > 6;
                return prev === next ? prev : next;
            });
            setScrolledFromBottom((prev) => {
                const next = distanceFromBottom > 36;
                return prev === next ? prev : next;
            });
        },
        [],
    );

    React.useEffect(() => {
        const onDisclosureToggle = (e: Event) => {
            disclosureLockUntilRef.current = Date.now() + 420;
            const el = scrollContainerRef.current;
            const trigger = (e as CustomEvent<{ element?: HTMLElement | null }>).detail?.element;
            if (!el) return;
            if (trigger && el.contains(trigger)) {
                const containerRect = el.getBoundingClientRect();
                const triggerRect = trigger.getBoundingClientRect();
                // Expanding/collapsing an earlier block above the bottom fold should keep
                // that disclosure anchored under the pointer instead of yanking to maxTop.
                if (containerRect.bottom - triggerRect.bottom > 96 || isLoadingRef.current) {
                    userDetachedRef.current = true;
                    isNearBottomRef.current = false;
                }
            } else if (isLoadingRef.current) {
                userDetachedRef.current = true;
                isNearBottomRef.current = false;
            }
        };
        window.addEventListener(
            "bettershape-transcript-disclosure-toggle",
            onDisclosureToggle as EventListener,
        );
        return () => {
            window.removeEventListener(
                "bettershape-transcript-disclosure-toggle",
                onDisclosureToggle as EventListener,
            );
        };
    }, [scrollContainerRef]);

    const scrollFlagsRafRef = React.useRef<number>(0);
    React.useEffect(() => {
        return () => {
            if (scrollFlagsRafRef.current) {
                cancelAnimationFrame(scrollFlagsRafRef.current);
                scrollFlagsRafRef.current = 0;
            }
        };
    }, []);

    const scrollToBottom = React.useCallback(
        (behavior: ScrollBehavior = "smooth") => {
            userDetachedRef.current = false;
            isNearBottomRef.current = true;
            const prefersReducedMotion =
                typeof window !== "undefined" &&
                Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
            const resolvedBehavior: ScrollBehavior = prefersReducedMotion ? "auto" : behavior;
            const el = scrollContainerRef.current;
            if (!el) {
                messagesEndRef.current?.scrollIntoView?.({ behavior: resolvedBehavior });
                setScrolledFromBottom(false);
                return;
            }
            const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
            programmaticScrollRef.current = true;
            if (resolvedBehavior === "smooth" && typeof el.scrollTo === "function") {
                el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            } else {
                el.scrollTop = maxTop;
            }
            lastScrollTopRef.current = maxTop;
            if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
                window.requestAnimationFrame(() => {
                    programmaticScrollRef.current = false;
                    if (scrollContainerRef.current) {
                        syncScrollFlags(scrollContainerRef.current);
                    }
                });
            } else {
                programmaticScrollRef.current = false;
            }
            setScrolledFromTop((prev) => {
                const next = maxTop > 6;
                return prev === next ? prev : next;
            });
            setScrolledFromBottom((prev) => (prev ? false : prev));
        },
        [messagesEndRef, scrollContainerRef, syncScrollFlags],
    );

    const notifyUserScrollUp = React.useCallback(() => {
        const el = scrollContainerRef.current;
        if (el && el.scrollHeight <= el.clientHeight + 8) return;
        userDetachedRef.current = true;
        isNearBottomRef.current = false;
        if (el) {
            const distanceFromBottom = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
            setScrolledFromBottom(distanceFromBottom > 12);
        }
    }, [scrollContainerRef]);

    const handleTranscriptResize = React.useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        if (!userDetachedRef.current && Date.now() > disclosureLockUntilRef.current) {
            const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
            programmaticScrollRef.current = true;
            el.scrollTop = maxTop;
            lastScrollTopRef.current = maxTop;
            programmaticScrollRef.current = false;
            isNearBottomRef.current = true;
            setScrolledFromTop((prev) => {
                const next = maxTop > 6;
                return prev === next ? prev : next;
            });
            setScrolledFromBottom((prev) => (prev ? false : prev));
            return;
        }
        // Passive content resize must never silently re-attach a scrolled-up reader.
        syncScrollFlags(el, { allowReattach: false });
    }, [scrollContainerRef, syncScrollFlags]);

    const handleScroll = React.useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const currentTop = el.scrollTop;
        const delta = currentTop - lastScrollTopRef.current;
        lastScrollTopRef.current = currentTop;
        if (!programmaticScrollRef.current && delta < -4) {
            userDetachedRef.current = true;
            isNearBottomRef.current = false;
        }
        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
            if (!scrollFlagsRafRef.current) {
                scrollFlagsRafRef.current = window.requestAnimationFrame(() => {
                    scrollFlagsRafRef.current = 0;
                    if (scrollContainerRef.current) {
                        syncScrollFlags(scrollContainerRef.current);
                    }
                });
            }
            return;
        }
        syncScrollFlags(el);
    }, [scrollContainerRef, syncScrollFlags]);

    React.useEffect(() => {
        const convSwitched = prevConvIdRef.current !== conversationId;
        const msgAdded = messages.length > prevMsgCountRef.current;
        const lastIsUser = messages.at(-1)?.role === "user";
        prevConvIdRef.current = conversationId;
        prevMsgCountRef.current = messages.length;

        if (convSwitched || (msgAdded && lastIsUser)) {
            userDetachedRef.current = false;
            isNearBottomRef.current = true;
        }

        if (!userDetachedRef.current && isNearBottomRef.current) {
            scrollToBottom(isLoading || convSwitched ? "auto" : "smooth");
            return;
        }
        const el = scrollContainerRef.current;
        if (el) syncScrollFlags(el);
    }, [conversationId, isLoading, messages, scrollContainerRef, scrollToBottom, syncScrollFlags]);

    const handleLoadConversation = React.useCallback(
        async (id: string, options?: { force?: boolean }) => {
            const isSameConversation = id === getViewedConversationId();
            const hasVisibleMessages = messagesRef.current.length > 0;
            if (!options?.force && isSameConversation && hasVisibleMessages) return;
            const conv =
                recentConvs.find((c) => c.id === id)
                ?? (project_path
                    ? null
                    : (await commands.getConversations()).find((c) => c.id === id));
            await openConversation(id, conv?.project_path ?? project_path);
        },
        [recentConvs, project_path, openConversation, getViewedConversationId],
    );

    React.useEffect(() => {
        const onLoad = (e: Event) => {
            const id = (e as CustomEvent<{ id?: string }>).detail?.id;
            if (!id) return;
            handleLoadConversation(id, { force: true }).catch(() => undefined);
        };
        window.addEventListener("bettershape-chat-load", onLoad as EventListener);
        return () => window.removeEventListener("bettershape-chat-load", onLoad as EventListener);
    }, [handleLoadConversation]);

    React.useEffect(() => {
        const onRename = (e: Event) => {
            const detail = (e as CustomEvent<{ id?: string; title?: string }>).detail;
            const id = detail?.id?.trim();
            const title = detail?.title?.trim();
            if (!id || !title) return;
            commands.renameConversation(id, title).then(() => {
                syncOpenTabs(id, title);
                if (conversationIdRef.current === id) setChatTitle(title);
                window.dispatchEvent(new CustomEvent("bettershape-chats-changed"));
            }).catch((err) => {
                console.error("Failed to rename chat:", err);
            });
        };
        window.addEventListener("bettershape-chat-rename", onRename as EventListener);
        return () => window.removeEventListener("bettershape-chat-rename", onRename as EventListener);
    }, [syncOpenTabs]);

    const handleViewAllHistory = React.useCallback(() => {
        openChatHistoryMenu();
    }, []);

    const stoppingRef = React.useRef(new Map<string, Promise<boolean>>());

    const handleStopMessage = (): Promise<boolean> => {
        const target = getViewedConversationId();
        preparations.cancel(target);
        const stop = prepareStop(target);
        if (!stop) return Promise.resolve(true);
        const key = stop.requestId ?? JSON.stringify([stop.conversationId, stop.turnId]);
        const pending = stoppingRef.current.get(key);
        if (pending) return pending;
        const stopped = Promise.resolve().then(async () => {
            try {
                await commands.stopChatMessage(stop.conversationId, stop.requestId);
                stop.commit();
                return true;
            } catch (error) {
                console.error("Failed to stop:", error);
                notify.error("Could not stop", "Stop was not confirmed. Try again.");
                return false;
            } finally {
                stoppingRef.current.delete(key);
            }
        });
        stoppingRef.current.set(key, stopped);
        return stopped;
    };

    const handleSendQueuedNow = async (id: string) => {
        const item = messageQueueRef.current.find((m) => m.id === id);
        if (!item) return;
        setMessageQueue((prev) => prev.filter((m) => m.id !== id));
        skipQueueDrainRef.current = true;
        forceSendRef.current = true;
        let delivered = false;
        try {
            // The chat whose lane this row has to cross: Stop below cancels that chat's
            // turn, and the wait after it belongs to the same chat.
            const stoppedTarget = getViewedConversationId();
            // Two rows clicked at once share this Stop: the lane admits one turn, so
            // the loser's row goes back to the front of its queue (restoreQueuedMessage
            // prepends) and the drain delivers it when the winner's turn ends, instead
            // of both racing native admission.
            if (isLoadingRef.current && !(await handleStopMessage())) {
                restoreQueuedMessage(item);
                return;
            }
            // Stop is only a cancellation *request*. Sending straight away can land while
            // the cancelled turn still holds the lane, and native admission then rejects
            // the send: the row goes back to a queue that drains only on some later state
            // change, so a successful Stop looks like a lost message. Wait for the lane.
            await waitForChatLaneFree(stoppedTarget);
            // The queue's rule is that a row goes out only while the chat it was queued in
            // is still the chat on screen. If the user switched tabs during the wait, keep
            // the row in its own queue - it drains when that chat is on screen and idle -
            // instead of delivering it into whichever chat is on screen now.
            if (getViewedConversationId() !== stoppedTarget) {
                restoreQueuedMessage(item);
                return;
            }
            delivered = await handleSendMessageRef.current(item.content);
            if (!delivered) restoreQueuedMessage(item);
        } catch (err) {
            console.error("Failed to send queued message:", err);
            restoreQueuedMessage(item);
        } finally {
            forceSendRef.current = false;
            skipQueueDrainRef.current = false;
            // Re-run the drain only now that skip is cleared, or the next queued
            // message would be passed over until some unrelated state change.
            if (delivered) setQueueDrainTick((t) => t + 1);
        }
    };

    const messageGroups = React.useMemo(() => groupChatMessages(messages), [messages]);
    const scopedMessageQueue = React.useMemo(() => {
        if (messageQueue.length === 0) return EMPTY_QUEUED_MESSAGES;
        const filtered = queueForConversation(messageQueue, conversationId);
        return filtered.length === 0 ? EMPTY_QUEUED_MESSAGES : filtered;
    }, [messageQueue, conversationId]);

    return {
        messages,
        isLoading,
        isPreparing: preparations.isPreparing,
        activityLabel,
        sendError,
        setSendError,
        contextSummarized,
        /** Latest transcript, for handlers that run outside the render pass. */
        messagesRef,
        inputValue,
        setInputValue,
        uploadedFiles,
        setUploadedFiles,
        addUploadedFiles,
        selectedModel,
        setSelectedModel,
        selectedWorkerModels,
        setSelectedWorkerModels,
        selectedMode,
        setSelectedMode,
        reasoningEffort,
        setReasoningEffort,
        fastMode,
        setFastMode,
        chatTitle,
        conversationId,
        recentConvs,
        pendingEdits,
        project_path,
        openChatTabs,
        activeChatTabId,
        handleScroll,
        scrollToBottom,
        notifyUserScrollUp,
        handleTranscriptResize,
        scrolledFromTop,
        scrolledFromBottom,
        isEditResolved,
        handleAcceptAll,
        handleRejectAll,
        handleAcceptEdit,
        handleRejectEdit,
        handleInputChange,
        handleSendMessage,
        handleKeyDown,
        handleNewChat,
        handleSelectChatTab,
        handleCloseChatTab,
        handleLoadConversation,
        handleFork: handleForkChat,
        handleViewAllHistory,
        handleRedo,
        handleRestore,
        handleStopMessage,
        messageGroups,
        refreshHistory,
        messageQueue: scopedMessageQueue,
        handleEditQueuedMessage,
        handleRemoveQueuedMessage,
        handleSendQueuedNow,
        handleUpdateQueuedMessage,
        projectRuleFiles,
        quotedExcerpts,
        removeQuotedExcerpt,
    };
};
