"use client";

import { waitForAiConfiguration } from "@/lib/ai/bootstrap";
import { createChatRequestId } from "@/lib/chat/request-ownership";
import React from "react";
import { listen } from "@tauri-apps/api/event";
import { commands, Conversation, useProjectState } from "@/lib/backend";
import { useChatStream } from "./chat-stream-store";
import { isChatGenerating } from "./generating-chats";
import { type ReasoningEffort } from "../ui/composer/reasoning-effort";
import type { ChatMessage } from "@/lib/backend/types";
import { NEW_CHAT_TAB_ID, isEphemeralChatTabId, type ChatTab } from "../ui/shell/tabs";
import { openChatHistoryMenu } from "../ui/shell/history";
import { parseMessageContent, type Chunk } from "../ui/md/renderer";
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
} from "./chat-session-utils";
import { getSettings } from "@/lib/settings";
import { getVisibleModels, resolveChatModels, sanitizeEnabledModels, subagentModelsForSend } from "@/lib/settings/models";
import { getCatalogDefaultEnabledIds, getCatalogModels, useBetterShapeCatalog } from "@/lib/catalog/store";
import { messageWithAttachments, waitForSendAttachments } from "./send-attachments";
import { hasAnyUsableProvider as hasUsableProvider } from "@/lib/ai/providers";
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
        if (tabs.length === 0) return null;
        const activeId =
            typeof parsed.activeId === "string"
            && tabs.some((t) => t.id === parsed.activeId)
                ? parsed.activeId
                : tabs[0]!.id;
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

const COMPOSER_PREFS_KEY = "bettershape-composer";

type ComposerPrefs = { model?: string; effort?: ReasoningEffort; fast?: boolean };

function readComposerPrefs(): ComposerPrefs {
    if (typeof window === "undefined") return {};
    try {
        const raw = localStorage.getItem(COMPOSER_PREFS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as ComposerPrefs;
        const effort = parsed.effort;
        const known = effort === "low" || effort === "high" || effort === "ultra" || effort === "max" || effort === "super";
        return {
            model: typeof parsed.model === "string" ? parsed.model : undefined,
            effort: known ? effort : undefined,
            fast: typeof parsed.fast === "boolean" ? parsed.fast : undefined,
        };
    } catch {
        return {};
    }
}

function writeComposerPrefs(prefs: ComposerPrefs) {
    try {
        localStorage.setItem(COMPOSER_PREFS_KEY, JSON.stringify(prefs));
    } catch {
        /* ignore */
    }
}

/**
 * The scroll refs are created by the caller, not returned from this hook. Keeping refs out of the
 * returned session object lets components read session values during render.
 */
export function useChatSession(
    messagesEndRef: React.RefObject<HTMLDivElement | null>,
    scrollContainerRef: React.RefObject<HTMLDivElement | null>,
) {
    const [uploadedFiles, setUploadedFiles] = React.useState<ComposerAttachment[]>([]);

    const addUploadedFiles = React.useCallback((files: File[], peaks?: number[][]) => {
        if (files.length === 0) return;
        const pending = files.map((file, index) => createPendingAttachment(file, peaks?.[index]));
        setUploadedFiles((prev) => [...prev, ...pending]);
        for (const att of pending) {
            void processAttachment(att).then((ready) => {
                setUploadedFiles((prev) => prev.map((a) => (a.id === ready.id ? ready : a)));
            });
        }
    }, []);
    const uploadedFilesRef = React.useRef(uploadedFiles);
    uploadedFilesRef.current = uploadedFiles;
    const composerRevisionRef = React.useRef(0);
    const [inputValue, updateInputValue] = React.useState(() => {
        try {
            return localStorage.getItem("bettershape-chat-input") || "";
        } catch {
            return "";
        }
    });
    const setInputValue = React.useCallback((value: React.SetStateAction<string>) => {
        composerRevisionRef.current += 1;
        updateInputValue(value);
    }, []);
    /** Every queued follow-up, across chats. Each one is bound to its `conversationId`. */
    const [messageQueue, setMessageQueue] = React.useState<QueuedChatMessage[]>([]);
    const messageQueueRef = React.useRef(messageQueue);
    messageQueueRef.current = messageQueue;
    /** Bumped when a send is delivered so the queue drains the next message for this chat. */
    const [queueDrainTick, setQueueDrainTick] = React.useState(0);
    const [projectRuleFiles, setProjectRuleFiles] = React.useState<string[]>([]);
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
        ownsRequest,
        getRequestOwner,
    } = useChatStream();
    const refreshMetadataRef = React.useRef<() => Promise<void>>(async () => {});
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
    selectedModelRef.current = selectedModel;
    const appliedDefaultModelRef = React.useRef(Boolean(readComposerPrefs().model));
    const [selectedMode, setSelectedMode] = React.useState("Code");
    const selectedModeRef = React.useRef(selectedMode);
    selectedModeRef.current = selectedMode;
    const [reasoningEffort, setReasoningEffort] = React.useState<ReasoningEffort>(
        () => readComposerPrefs().effort || "low",
    );
    const [fastMode, setFastMode] = React.useState(() => readComposerPrefs().fast ?? true);
    const tabsHydratedForRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        setSelectedMode((mode) =>
            mode === "Debug" || mode === "Security"
                ? "Review"
                : mode === "Design"
                  ? "Visual"
                  : mode,
        );
    }, []);
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
    const [tabsReady, setTabsReady] = React.useState(false);
    // The project the tabs were last hydrated for. `undefined` only before the first run.
    const hydratedProjectRef = React.useRef<string | null | undefined>(undefined);

    // Restore open chat tabs per repo so switching projects keeps your session strip.
    React.useEffect(() => {
        let cancelled = false;
        setTabsReady(false);
        const key = chatTabsStorageKey(project_path);
        tabsHydratedForRef.current = key;
        const switchedProject =
            hydratedProjectRef.current !== undefined && hydratedProjectRef.current !== project_path;
        hydratedProjectRef.current = project_path;

        void (async () => {
            const persisted = readPersistedChatTabs(project_path);
            if (persisted) {
                const tabs = persisted.tabs.filter((t) => t.id !== "__demo_chat__");
                if (!tabs.some((t) => t.id === NEW_CHAT_TAB_ID)) {
                    tabs.unshift({ id: NEW_CHAT_TAB_ID, title: "New Chat" });
                }
                const activeId = persisted.activeId === "__demo_chat__" ? NEW_CHAT_TAB_ID : persisted.activeId;
                setOpenChatTabs(tabs);
                setActiveChatTabId(activeId);
                if (activeId === NEW_CHAT_TAB_ID) {
                    showConversation(null);
                } else if (!isEphemeralChatTabId(activeId)) {
                    const seq = showConversation(activeId);
                    try {
                        await commands.loadConversation(activeId, project_path ?? undefined);
                        if (!cancelled) {
                            clearAllDesignPreviewSessions();
                            setContextSummarized(false);
                            const msgs = await reloadViewedMessages(seq);
                            hydrateViewedExtras(activeId, msgs);
                        }
                    } catch (err) {
                        if (cancelled || !isCurrentView(seq)) return;
                        // A tab whose conversation is gone is expected: it was ephemeral,
                        // or deleted from another window. Drop the strip back to a draft.
                        //
                        // Anything else is a backend failure, and the saved tabs are still
                        // good. Keep them and move the active tab to a draft, rather than
                        // throwing the whole session strip away over one unreadable chat.
                        if (!String(err).includes("Conversation not found")) {
                            console.error("Could not restore conversation", activeId, err);
                        } else {
                            setOpenChatTabs([{ id: NEW_CHAT_TAB_ID, title: "New Chat" }]);
                        }
                        setActiveChatTabId(NEW_CHAT_TAB_ID);
                        showConversation(null);
                    }
                }
            } else {
                setOpenChatTabs([{ id: NEW_CHAT_TAB_ID, title: "New Chat" }]);
                setActiveChatTabId(NEW_CHAT_TAB_ID);
                // On a real project switch, drop the previous project's chat from the view.
                // Skipped on first mount so the chat the backend already has open is kept.
                if (switchedProject) showConversation(null);
            }
            if (!cancelled) setTabsReady(true);
        })();

        return () => {
            cancelled = true;
        };
    }, [
        project_path,
        setContextSummarized,
        showConversation,
        reloadViewedMessages,
        hydrateViewedExtras,
        isCurrentView,
    ]);

    React.useEffect(() => {
        let cancelled = false;
        if (!project_path || !isWorkspaceTrusted(project_path)) {
            setProjectRuleFiles([]);
            return;
        }
        void listProjectRuleFiles(project_path).then((names) => {
            if (!cancelled) setProjectRuleFiles(names);
        });
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

    React.useEffect(() => {
        const models = [
            ...new Set(
                messages
                    .filter((m) => m.role === "assistant" && m.model)
                    .map((m) => m.model as string)
                    .slice(-4),
            ),
        ];
        setOpenChatTabs((prev) =>
            prev.map((tab) => {
                if (tab.id !== activeChatTabId) return tab;
                const same =
                    (tab.models?.length ?? 0) === models.length
                    && (tab.models ?? []).every((m, i) => m === models[i]);
                return same ? tab : { ...tab, models };
            }),
        );
    }, [messages, activeChatTabId]);

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
        async (file: string, status: "applied" | "rejected", replacement?: string) => {
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
        },
        [conversationId],
    );

    const pendingEdits = React.useMemo(() => {
        type Pending = {
            id: string;
            file: string;
            baseline: string;
            original: string;
            replacement: string;
        };

        type Step = { id: string; file: string; original: string; replacement: string };
        const stepsByFile = new Map<string, Step[]>();

        const isReviewableEdit = (c: Chunk): c is Chunk & { file: string } => {
            if (!c.file) return false;
            if (c.type === "edit") return true;
            // Applied edits under require-edit-approval land as edit_pending status=applied.
            if (c.type === "edit_pending" && (c.commandStatus === "applied" || c.commandStatus === "approved")) {
                return true;
            }
            return false;
        };

        messages.forEach((m, msgIdx) => {
            if (m.role !== "assistant") return;
            const chunks = parseMessageContent(m.content);
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

        const edits: Pending[] = [];
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

    const handleRejectAll = async () => {
        const failures: string[] = [];
        for (const edit of pendingEdits) {
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
            void handleSendMessageRef.current(notice);
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
                void handleAcceptEdit(edit.id);
            }
        }
        prevPendingCountRef.current = pendingEdits.length;
    }, [pendingEdits, handleAcceptEdit]);

    const isLoadingRef = React.useRef(false);
    React.useEffect(() => {
        isLoadingRef.current = isLoading;
    }, [isLoading]);

    const activeChatTabIdRef = React.useRef(activeChatTabId);
    React.useEffect(() => {
        activeChatTabIdRef.current = activeChatTabId;
    }, [activeChatTabId]);

    const refreshMetadata = React.useCallback(async () => {
        try {
            const convs = await commands.getConversations(project_path ?? undefined);
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

    refreshMetadataRef.current = refreshMetadata;

    const conversationIdRef = React.useRef(conversationId);
    React.useEffect(() => {
        conversationIdRef.current = conversationId;
    }, [conversationId]);

    const refreshHistory = React.useCallback(
        async () => {
            try {
                const convs = await commands.getConversations(project_path ?? undefined);
                setRecentConvs(convs);
                await refreshMetadata();
                const viewed = getViewedConversationId();
                const msgs = await reloadViewedMessages();
                hydrateViewedExtras(viewed, msgs);
            } catch (err) {
                console.error("Failed to load chat history:", err);
            }
        },
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
        void refreshHistory();
    }, [tabsReady, refreshHistory]);

    // Mirror the view into the backend-facing store and the tab strip.
    React.useEffect(() => {
        setCurrentConversationId(viewedConversationId);
    }, [viewedConversationId]);

    React.useEffect(() => {
        if (!tabsReady) return;
        setActiveChatTabId(viewedConversationId ?? NEW_CHAT_TAB_ID);
        const conv = viewedConversationId
            ? recentConvs.find((c) => c.id === viewedConversationId)
            : undefined;
        syncOpenTabs(viewedConversationId, conv?.title);
    }, [viewedConversationId, tabsReady, recentConvs, syncOpenTabs]);

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
        void syncIncognitoFromBackend();
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

    const inputValueRef = React.useRef(inputValue);
    React.useEffect(() => {
        inputValueRef.current = inputValue;
    }, [inputValue]);

    React.useEffect(() => {
        const persist = () => {
            try {
                localStorage.setItem("bettershape-chat-input", inputValueRef.current);
            } catch {
                /* ignore */
            }
        };
        // Keep draft durable across blur / close even if last keystroke missed storage.
        window.addEventListener("pagehide", persist);
        window.addEventListener("beforeunload", persist);
        const onVis = () => {
            if (document.visibilityState === "hidden") persist();
        };
        document.addEventListener("visibilitychange", onVis);
        return () => {
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

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setInputValue(val);
        const editingId = editingQueueIdRef.current;
        if (editingId) {
            setMessageQueue((prev) =>
                prev.map((m) => (m.id === editingId ? { ...m, content: val } : m)),
            );
        }
        try {
            localStorage.setItem("bettershape-chat-input", val);
        } catch {
            /* ignore */
        }
        if (sendError) setSendError(null);
    };

    const handleSendMessageRef = React.useRef<(overrideContent?: string) => Promise<boolean>>(async () => false);
    const handleNewChatRef = React.useRef<() => Promise<void>>(async () => {});
    const sendToChatRef = React.useRef<(content: string, target: string) => Promise<boolean>>(
        async () => false,
    );
    /** Sends currently awaiting the backend. A counter, so overlapping sends cannot clear each other. */
    const sendsInFlightRef = React.useRef(0);
    const preparingSendsRef = React.useRef(new Map<AbortController, string | null>());
    React.useEffect(() => {
        const preparing = preparingSendsRef.current;
        return () => { for (const controller of preparing.keys()) controller.abort(); };
    }, []);
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
            const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
        const preparation = new AbortController();
        preparingSendsRef.current.set(preparation, target);
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
            const userMsg = await messageWithAttachments(messageContent, readyFiles, preparation.signal);

            if (preparation.signal.aborted) return false;
            if (getViewedConversationId() === target) setSendError(null);
            // Lets the backend's chat_started name this send, so a draft binds only to its own turn.
            const clientRequestId = createChatRequestId(target);
            appendUserOptimistic(userMsg, target, clientRequestId);

            try {
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

                if (preparation.signal.aborted) {
                    const owner = getRequestOwner(clientRequestId);
                    if (owner) stopLiveTurn(owner.conversationId);
                    return false;
                }
                if (!ownsRequest(target, clientRequestId)) return false;
                // Attachment and mention preparation can outlive a provider change; check again at admission.
                if (!hasUsableProvider(getSettings().ai.providers)) {
                    throw new Error("Add an API key in Settings → Providers to chat.");
                }
                if (!fromQueue) {
                    // Only consume the submitted draft at admission. New edits/files belong to the next message.
                    const submitted = new Set(submittedIds);
                    setUploadedFiles(files => files.filter(file => !submitted.has(file.id)));
                    if (getViewedConversationId() === target && composerRevisionRef.current === submittedRevision && inputValueRef.current === messageContent) {
                        inputValueRef.current = "";
                        setInputValue("");
                        editingQueueIdRef.current = null;
                        try { localStorage.removeItem("bettershape-chat-input"); } catch { /* Session draft still clears. */ }
                    }
                }
                // Preparation ends at native admission, not at provider readiness.
                preparingSendsRef.current.delete(preparation);
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
                await refreshMetadata();
                failedSendHoldRef.current = null;
                return true;
            } catch (err) {
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
            preparingSendsRef.current.delete(preparation);
        }
    };

    /**
     * Deliver `content` to chat `target`. A busy target queues it there. The chat on screen
     * uses the composer path. A background chat is sent to directly, so the view stays put.
     */
    const sendToChat = async (content: string, target: string): Promise<boolean> => {
        // The chat the build belongs to comes on screen first. `openConversation` puts it on
        // screen synchronously; its transcript load continues in the background.
        if (target !== getViewedConversationId()) void openConversation(target);
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
                    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    content,
                    conversationId: target,
                });
            }
        }
    };

    const handleSendMessage = async (overrideContent?: string): Promise<boolean> => {
        const messageContent = typeof overrideContent === "string" ? overrideContent : inputValue;
        const fromQueue = typeof overrideContent === "string";

        // Built-in commands are handled here and never reach the model as text.
        const slash = fromQueue ? null : matchSlashCommand(messageContent);
        if (slash?.command.token === "/compact") {
            setInputValue("");
            try {
                localStorage.removeItem("bettershape-chat-input");
            } catch {
                /* ignore */
            }
            if (isLoading) {
                notify.info("Wait for this reply to finish, then run /compact.");
                return false;
            }
            await runCompactCommand(slash.argument);
            return true;
        }

        if (!fromQueue && isLoading) {
            if (!messageContent.trim() && uploadedFiles.length === 0) return false;
            if (uploadedFiles.length > 0) return false;
            const editingId = editingQueueIdRef.current;
            if (editingId) {
                setMessageQueue((prev) =>
                    prev.map((m) =>
                        m.id === editingId ? { ...m, content: messageContent.trim() } : m,
                    ),
                );
                setInputValue("");
                editingQueueIdRef.current = null;
                try {
                    localStorage.removeItem("bettershape-chat-input");
                } catch {
                    /* ignore */
                }
                return true;
            }
            enqueueChatMessage(messageContent);
            setInputValue("");
            try {
                localStorage.removeItem("bettershape-chat-input");
            } catch {
                /* ignore */
            }
            return true;
        }

        if (
            (!messageContent.trim() && uploadedFiles.length === 0) ||
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
        void handleSendMessageRef.current(item.content).then(
            (sent) => {
                if (!sent) restoreQueuedMessage(item);
            },
            (err) => {
                console.error("Failed to send queued message:", err);
                restoreQueuedMessage(item);
            },
        );
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
                else void handleSendMessageRef.current(message);
                return;
            }
            void sendToChatRef.current(message, target);
        };
        window.addEventListener("bettershape-build-plan", handleBuildPlan);
        return () => window.removeEventListener("bettershape-build-plan", handleBuildPlan);
    }, [enqueueChatMessage, getViewedConversationId]);

    React.useEffect(() => {
        const handleInsertPrompt = (e: Event) => {
            const detail = (e as CustomEvent<{ prompt?: string; send?: boolean }>).detail;
            if (!detail?.prompt) return;
            setInputValue(detail.prompt);
            try {
                localStorage.setItem("bettershape-chat-input", detail.prompt);
            } catch {
                /* ignore */
            }
            window.dispatchEvent(
                new CustomEvent("bettershape-layout-toggle", { detail: { id: "secondary-sidebar", value: true } }),
            );
            if (detail.send) {
                if (isLoadingRef.current) enqueueChatMessage(detail.prompt);
                else void handleSendMessageRef.current(detail.prompt);
            }
        };
        window.addEventListener("bettershape-chat-insert-prompt", handleInsertPrompt as EventListener);
        return () =>
            window.removeEventListener("bettershape-chat-insert-prompt", handleInsertPrompt as EventListener);
    }, [enqueueChatMessage, setInputValue]);

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
                void refreshHistory();
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
            void handleForkChat(idx);
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

    React.useEffect(() => {
        if (!catalog) return;
        const ai = getSettings().ai;
        const keyed = resolveChatModels(getCatalogModels());
        const enabled = sanitizeEnabledModels(
            ai.enabledModels,
            keyed.map((m) => m.id),
            getCatalogDefaultEnabledIds(),
        );
        const visible = getVisibleModels(keyed, enabled);
        const current = selectedModelRef.current;
        if (keyed.some((m) => m.id === current)) return;
        if (!appliedDefaultModelRef.current && visible.some((m) => m.id === ai.defaultModel)) {
            appliedDefaultModelRef.current = true;
            setSelectedModel(ai.defaultModel);
            return;
        }
        appliedDefaultModelRef.current = true;
        if (visible.some((m) => m.id === ai.defaultModel)) {
            setSelectedModel(ai.defaultModel);
        } else if (visible.length > 0) {
            setSelectedModel(visible[0]!.id);
        }
    }, [catalog]);

    React.useEffect(() => {
        let disposed = false;
        let unlisten: (() => void) | undefined;
        void import("@tauri-apps/api/event").then(({ listen }) => {
            void listen<{ path?: string }>("bettershape-design-preview-close", (event) => {
                const path = event.payload?.path;
                if (!path) return;
                void commands.closeFile(path).catch(() => { /* already closed */ });
            }).then((fn) => {
                if (disposed) fn();
                else unlisten = fn;
            });
        });
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);

    React.useEffect(() => {
        let disposed = false;
        const unlisteners: (() => void)[] = [];
        const register = (promise: Promise<() => void>) => {
            void promise.then((fn) => {
                if (disposed) fn();
                else unlisteners.push(fn);
            });
        };

        register(
            listen<{ conversationId?: string; message?: string }>("parent_resume", (event) => {
                const cid = event.payload?.conversationId?.trim();
                const message = event.payload?.message;
                if (!cid || !message) return;
                void (async () => {
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
                })();
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

    /** `/compact [focus]` — summarize older turns without sending a chat turn. */
    const runCompactCommand = async (focus: string): Promise<void> => {
        if (isIncognitoChat()) {
            notify.info("Incognito chats are not summarized.");
            return;
        }
        try {
            const result = await commands.compactChat({
                focus: focus || undefined,
                instructions: getSettings().ai.compactInstructions || undefined,
                model: selectedModelRef.current || undefined,
            });
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

    const handleNewChat = async () => {
        try {
            // Do not stop background generation; only the Stop button cancels.
            startDraftChat();
            await commands.newChat();
            clearAllDesignPreviewSessions();
            setSendError(null);
            setContextSummarized(false);
            void import("@/features/agent/subagents/store").then(({ resetSubagentsForParent }) => {
                resetSubagentsForParent(conversationIdRef.current);
            });
            setChatTitle("New Chat");
            setResolvedFiles(new Set());
            clearAllProposedEdits();
            setOpenChatTabs((prev) => {
                const others = prev.filter((tab) => tab.id !== NEW_CHAT_TAB_ID);
                return [{ id: NEW_CHAT_TAB_ID, title: "New Chat" }, ...others];
            });
            setActiveChatTabId(NEW_CHAT_TAB_ID);
            void refreshHistory();
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

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const handleScroll = React.useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const threshold = 150;
        isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
        setScrolledFromTop(el.scrollTop > 4);
        setScrolledFromBottom(!isNearBottomRef.current);
    }, [scrollContainerRef]);

    React.useEffect(() => {
        if (isNearBottomRef.current) {
            messagesEndRef.current?.scrollIntoView({
                behavior: isLoading ? "auto" : "smooth",
            });
        }
        // Keep top-fade in sync after programmatic scroll (scroll events can lag).
        const el = scrollContainerRef.current;
        if (el) {
            setScrolledFromTop(el.scrollTop > 4);
            setScrolledFromBottom(
                el.scrollHeight - el.scrollTop - el.clientHeight >= 150,
            );
        }
    }, [messages, isLoading, messagesEndRef, scrollContainerRef]);

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
            void handleLoadConversation(id, { force: true });
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
            void commands.renameConversation(id, title).then(() => {
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
        for (const [controller, owner] of preparingSendsRef.current) {
            if (owner === target) controller.abort();
        }
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
            if (isLoadingRef.current && !(await handleStopMessage())) {
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

    const messageGroups = groupChatMessages(messages);

    return {
        messages,
        isLoading,
        activityLabel,
        sendError,
        setSendError,
        contextSummarized,
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
        messageQueue: queueForConversation(messageQueue, conversationId),
        handleEditQueuedMessage,
        handleRemoveQueuedMessage,
        handleSendQueuedNow,
        handleUpdateQueuedMessage,
        projectRuleFiles,
    };
}
