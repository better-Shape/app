/**
 * Review Z: a send rejected by native admission must give its draft back into the chat the
 * send was issued for, and into no other chat.
 *
 * One composer is shared by every open chat: `uploadedFiles` and `inputValue` are hook state
 * that nothing clears when the view moves. So the attachment a failed send consumed has to be
 * scoped by chat on the way back, exactly like the composer text beside it. Without that, a
 * send to chat A rejected after the user moved to chat B puts A's file into B's composer, and
 * B's next message carries a file the user attached to A.
 *
 * Both layers are covered: the pure helper that decides, and the hook that calls it. The hook
 * cases are the ones that would fail without the fix; the helper cases pin the rule itself.
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
    projectPath: "/proj" as string | null,
    initialization: vi.fn(),
    usableProvider: vi.fn(),
    expand: vi.fn(),
    current: null as string | null,
    sent: [] as { message: string; conversationId: string | null }[],
    pendingRejects: [] as Array<(error: Error) => void>,
    nextId: 1,
    conversations: new Set<string>(["X", "Y"]),
}));

const stream = vi.hoisted(() => ({
    adopter: null as null | ((id: string) => void),
    liveConvId: null as string | null,
    api: null as null | { setIsLoading: (v: boolean) => void; showConversation: (id: string | null) => void },
}));

vi.mock("@/lib/ai/bootstrap", () => ({ waitForAiConfiguration: backend.initialization }));
vi.mock("@/lib/backend", () => ({
    useProjectState: () => ({ project_path: backend.projectPath }),
    commands: {
        getCurrentConversationId: vi.fn(async () => backend.current),
        loadConversation: vi.fn(async (id: string) => {
            if (!backend.conversations.has(id)) throw new Error("Conversation not found");
            backend.current = id;
        }),
        newChat: vi.fn(async () => {
            backend.current = null;
        }),
        // The trailing argument is the chat the message belongs to (see sendMessageNow).
        // The promise stays pending so a test can move the view before admission settles.
        sendChatMessage: vi.fn(async (...args: unknown[]) => {
            const message = args[0] as string;
            const explicit = args[15] as string | null | undefined;
            const target = explicit || backend.current || `new-${backend.nextId++}`;
            if (!explicit) stream.adopter?.(target);
            backend.current = target;
            backend.sent.push({ message, conversationId: target });
            stream.liveConvId = target;
            return new Promise<string>((_resolve, reject) => {
                backend.pendingRejects.push(reject);
            });
        }),
        getConversations: vi.fn(async () => []),
        getChatTitle: vi.fn(async () => "Chat"),
        getChatHistory: vi.fn(async () => []),
        getChatGenerationState: vi.fn(async () => ({ isGenerating: false })),
        stopChatMessage: vi.fn(async () => {}),
        clearChatHistory: vi.fn(async () => {}),
        compactChat: vi.fn(async () => ({
            record: { messagesBefore: 8, messagesAfter: 3, tokensSaved: 900 },
            messages: 3,
            tokensBefore: 4000,
            tokensAfter: 1200,
            alreadySmall: false,
            error: null,
        })),
    },
}));

vi.mock("@/features/chat/lib/chat-stream-store", async () => {
    const ReactModule = await import("react");
    return {
        // Callbacks are memoized like the real store; unstable identities would loop the hook's effects.
        useChatStream: () => {
            const [isLoading, setIsLoading] = ReactModule.useState(false);
            const [messages, setMessages] = ReactModule.useState<unknown[]>([]);
            const [sendError, setSendError] = ReactModule.useState<string | null>(null);
            const [contextSummarized, setContextSummarized] = ReactModule.useState(false);
            const [viewedConversationId, setViewed] = ReactModule.useState<string | null>(null);
            const viewRef = ReactModule.useRef<string | null>(null);
            const seqRef = ReactModule.useRef(0);

            const getViewedConversationId = ReactModule.useCallback(() => viewRef.current, []);
            const getDraftConversationId = ReactModule.useCallback(() => null, []);
            const showConversation = ReactModule.useCallback((id: string | null) => {
                viewRef.current = id;
                setViewed(id);
                setIsLoading(Boolean(id && stream.liveConvId === id));
                return ++seqRef.current;
            }, []);
            stream.api = { setIsLoading, showConversation };
            const isCurrentView = ReactModule.useCallback(
                (seq: number) => seqRef.current === seq,
                [],
            );
            const reloadViewedMessages = ReactModule.useCallback(async () => null, []);
            const bootstrapFromBackend = ReactModule.useCallback(async () => {}, []);
            ReactModule.useEffect(() => {
                if (backend.current) showConversation(backend.current);
            }, []);
            const setDraftAdopter = ReactModule.useCallback((fn: ((id: string) => void) | null) => {
                stream.adopter = fn
                    ? (id: string) => {
                          const request = requests.current.get(null);
                          if (request) { requests.current.delete(null); requests.current.set(id, request); }
                          if (viewRef.current === null) {
                              viewRef.current = id;
                              setViewed(id);
                          }
                          fn(id);
                      }
                    : null;
            }, []);
            const requests = ReactModule.useRef(new Map<string | null, string>());
            const appendUserOptimistic = ReactModule.useCallback((_message: string, target: string | null, id: string) => {
                requests.current.set(target, id); setIsLoading(true);
            }, []);
            const ownsRequest = ReactModule.useCallback((target: string | null, id: string) => requests.current.get(target) === id, []);
            const getRequestOwner = ReactModule.useCallback((requestId: string) => {
                for (const [conversationId, owned] of requests.current) {
                    if (owned === requestId) return { conversationId };
                }
                return null;
            }, []);
            const stopLiveTurn = ReactModule.useCallback((target = viewRef.current) => {
                const id = requests.current.get(target) ?? null;
                requests.current.delete(target);
                if (stream.liveConvId === target) stream.liveConvId = null;
                if (viewRef.current === target) setIsLoading(false);
                return id;
            }, []);
            const prepareStop = ReactModule.useCallback((target: string | null) => {
                const requestId = requests.current.get(target) ?? null;
                if (!requestId && stream.liveConvId !== target) return null;
                return { conversationId: target, requestId, commit: () => {
                    if (requests.current.get(target) !== requestId) return;
                    stopLiveTurn(target);
                } };
            }, [stopLiveTurn]);
            const startDraftChat = ReactModule.useCallback(() => {
                showConversation(null);
                setMessages([]);
            }, [showConversation]);
            const hasLiveTurn = ReactModule.useCallback(
                (id: string | null) => Boolean(id && stream.liveConvId === id),
                [],
            );
            return {
                hasLiveTurn,
                ownsRequest,
                getRequestOwner,
                isLoading,
                messages,
                activityLabel: null,
                turnPhase: "idle",
                turnId: null,
                sendError,
                setSendError,
                contextSummarized,
                setContextSummarized,
                setMessages,
                viewedConversationId,
                getViewedConversationId,
                getDraftConversationId,
                showConversation,
                isCurrentView,
                reloadViewedMessages,
                bootstrapFromBackend,
                setDraftAdopter,
                appendUserOptimistic,
                stopLiveTurn,
                prepareStop,
                startDraftChat,
            };
        },
    };
});

vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn(async () => () => {}),
}));
vi.mock("@/lib/settings", () => ({
    getSettings: () => ({
        ai: {
            customRules: "",
            workflows: [],
            autoRunMode: "ask",
            requireEditApproval: false,
            protectDestructiveGit: true,
            pluginApprovalDefault: "ask",
            pluginApprovals: {},
            pluginDisabledActions: {},
            reviewAdversarialEnabled: false,
            autoApplyEdits: false,
            subagentModels: [],
            subagentDefaultModel: "auto",
            enabledModels: [],
            defaultModel: "auto",
        },
    }),
}));
vi.mock("@/lib/settings/models", () => ({
    getVisibleModels: () => [],
    resolveChatModels: (m: unknown[]) => m,
    sanitizeEnabledModels: () => [],
    subagentModelsForSend: () => ({ models: [], defaultModel: "auto" }),
}));
vi.mock("@/lib/catalog/store", () => ({
    getCatalogDefaultEnabledIds: () => [],
    getCatalogModels: () => [],
    isCatalogModelAllowed: () => true,
    useBetterShapeCatalog: () => ({ catalog: null }),
}));
vi.mock("@/lib/ai/providers", () => ({
    hasAnyUsableProvider: backend.usableProvider,
}));
vi.mock("@/features/notifications", () => ({ notify: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/chat/incognito", () => ({
    isIncognitoChat: () => false,
    purgeIncognitoConversation: async () => {},
    setIncognitoChat: async () => {},
    syncIncognitoFromBackend: async () => {},
}));
vi.mock("@/lib/chat/mentions", () => ({
    buildMessageWithMentions: backend.expand,
    mentionRanges: () => [],
}));
vi.mock("@/lib/chat/continue-action", () => ({ buildPlanBuildMessage: (p: string) => p }));
vi.mock("@/lib/chat/workflows", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/chat/workflows")>();
    return {
        ...actual,
        applyWorkflows: (m: string) => m,
        matchWorkflows: () => [],
        workflowAllowKeys: () => [],
    };
});
vi.mock("@/lib/workspace/rules", () => ({
    listProjectRuleFiles: async () => [],
    loadProjectRules: async () => "",
}));
vi.mock("@/lib/workspace/trust", () => ({ isWorkspaceTrusted: () => false }));
vi.mock("@/lib/agent-preview/store", () => ({
    clearAllDesignPreviewSessions: () => {},
    trySelectPendingDesignConcept: async () => {},
}));
vi.mock("@/features/chat/ui/composer/attachments", () => ({
    createPendingAttachment: vi.fn(),
    processAttachment: vi.fn(),
}));
vi.mock("@/features/chat/ui/shell/tabs", () => ({
    NEW_CHAT_TAB_ID: "__new__",
    isEphemeralChatTabId: (id: string) => id.startsWith("__"),
}));
vi.mock("@/features/chat/ui/shell/history", () => ({ openChatHistoryMenu: () => {} }));
vi.mock("@/features/chat/ui/md/renderer", () => ({ parseMessageContent: () => [] }));
vi.mock("@/features/chat/lib/proposed-edits", () => ({
    setProposedEdit: () => {},
    getProposedEdit: () => undefined,
    clearProposedEdit: () => {},
    clearAllProposedEdits: () => {},
    setCurrentConversationId: () => {},
    markFileResolved: () => {},
    isFileResolved: () => false,
    getResolvedFiles: () => ({}),
    getResolvedContentHash: () => undefined,
    editContentHash: () => "",
    pathsEqual: (a: string, b: string) => a === b,
}));
vi.mock("@/features/chat/lib/chat-session-utils", () => ({
    resolveChatFilePath: (p: string) => p,
    syncProposedEditsFromMessages: () => {},
    groupChatMessages: () => [],
}));
vi.mock("@/features/agent/subagents/store", () => ({ resetSubagentsForParent: () => {} }));
vi.mock("@/features/chat/lib/generating-chats", () => {
    const generating = new Set<string>();
    return {
        setChatGenerating: (id: string | null | undefined, on: boolean) => {
            if (!id) return;
            if (on) generating.add(id);
            else generating.delete(id);
        },
        isChatGenerating: (id: string | null | undefined) => Boolean(id && generating.has(id)),
    };
});

import { restoreRejectedAttachments, useChatSession } from "@/features/chat/lib/use-chat-session";

type Session = ReturnType<typeof useChatSession>;

let root: Root;
let host: HTMLDivElement;
let session: Session;

function Harness({ onRender }: { onRender: (s: Session) => void }) {
    const messagesEndRef = React.useRef<HTMLDivElement>(null);
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);
    const current = useChatSession(messagesEndRef, scrollContainerRef);
    React.useEffect(() => {
        onRender(current);
    });
    return null;
}

async function settle(rounds = 6) {
    for (let i = 0; i < rounds; i++) {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });
    }
}

function attachment(id = "attachment-one", name = "image.png") {
    return {
        id, name, file: new File(["image"], name, { type: "image/png" }),
        kind: "image" as const, mimeType: "image/png", size: 5, status: "ready" as const,
        dataUrl: "data:image/png;base64,aW1hZ2U=",
    };
}

beforeEach(async () => {
    backend.projectPath = "/proj";
    backend.initialization.mockReset().mockResolvedValue(undefined);
    backend.usableProvider.mockReset().mockReturnValue(true);
    backend.expand.mockReset().mockImplementation(async (message: string) => message);
    backend.current = "X";
    backend.sent = [];
    backend.pendingRejects = [];
    backend.nextId = 1;
    stream.liveConvId = null;
    localStorage.clear();

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
        root.render(React.createElement(Harness, { onRender: (s: Session) => { session = s; } }));
    });
    await settle();
});

afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await act(async () => root.unmount());
    host.remove();
});

describe("a rejected send restores its attachment only into the chat it was sent to", () => {
    it("scopes the restore to the send's chat", () => {
        const consumed = [attachment("a"), attachment("b", "second.png")];
        // Same chat on screen: the files come back.
        expect(restoreRejectedAttachments(consumed, [], "X", "X").map((f) => f.id)).toEqual(["a", "b"]);
        // The user moved to another chat while the send was in flight.
        expect(restoreRejectedAttachments(consumed, [], "X", "Y")).toEqual([]);
        // Draft chat (`null`) restores only while the draft is still the view.
        expect(restoreRejectedAttachments([attachment("a")], [], null, null).map((f) => f.id)).toEqual(["a"]);
        expect(restoreRejectedAttachments([attachment("a")], [], null, "X")).toEqual([]);
    });

    it("returns the composer untouched when the view moved, without rebuilding the array", () => {
        const current = [attachment("later", "later.png")];
        expect(restoreRejectedAttachments([attachment("a")], current, "X", "Y")).toBe(current);
    });

    it("never duplicates a file the user re-added after the rejection", () => {
        const consumed = [attachment("a"), attachment("b", "second.png")];
        const current = [attachment("b", "second.png")];
        // "a" is put back at the front; the file already in the composer is not duplicated.
        expect(restoreRejectedAttachments(consumed, current, "X", "X").map((f) => f.id)).toEqual(["a", "b"]);
    });

    it("gives the attachment back when the user is still in the chat", async () => {
        await act(async () => {
            session.setInputValue("use this attachment");
            session.setUploadedFiles([attachment()]);
        });
        act(() => { void session.handleSendMessage(); });
        await settle();
        // Admission consumed the draft: it is native's turn now.
        expect(session.uploadedFiles).toHaveLength(0);
        expect(session.inputValue).toBe("");

        await act(async () => { backend.pendingRejects.shift()!(new Error("admission rejected")); });
        await settle();

        expect(backend.sent).toHaveLength(1); // rejection came from native admission, not preparation
        expect(session.uploadedFiles.map((f) => f.id)).toEqual(["attachment-one"]);
        expect(session.inputValue).toBe("use this attachment");
    });

    it("does not move the attachment into the chat the user switched to mid-send", async () => {
        await act(async () => {
            session.setInputValue("use this attachment");
            session.setUploadedFiles([attachment()]);
        });
        act(() => { void session.handleSendMessage(); });
        await settle();
        expect(session.uploadedFiles).toHaveLength(0);

        // The user leaves for chat B before admission answers.
        act(() => stream.api?.showConversation("Y"));
        await settle();
        expect(session.conversationId).toBe("Y");

        await act(async () => { backend.pendingRejects.shift()!(new Error("admission rejected")); });
        await settle();

        expect(backend.sent).toHaveLength(1);
        // Regression: chat A's file used to land in B's shared composer, and B's next
        // message would then carry a file the user attached to A.
        expect(session.uploadedFiles).toHaveLength(0);
        // The text restore was already chat-scoped, so B's composer stays as it was.
        expect(session.inputValue).toBe("");
    });

    it("still attaches a file added after the rejection when the view did not move", async () => {
        await act(async () => {
            session.setInputValue("use this attachment");
            session.setUploadedFiles([attachment()]);
        });
        act(() => { void session.handleSendMessage(); });
        await settle();

        // The user re-attaches the same file while the rejected send is still settling.
        await act(async () => session.setUploadedFiles([attachment()]));
        await act(async () => { backend.pendingRejects.shift()!(new Error("admission rejected")); });
        await settle();

        expect(session.uploadedFiles.map((f) => f.id)).toEqual(["attachment-one"]);
    });
});