import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { listenCustomEvent } from "../helpers/events";
import { mockInvoke } from "../helpers/tauri";
import { ChatFindBar } from "@/features/chat/ui/shell/find-bar";
import { ProblemsPanel } from "@/features/git/ui/problems/panel";
import { groupProblems, summarize, toProblem } from "@/features/git/ui/problems/model";
import { PendingEditsPanel } from "@/features/chat/ui/composer/edits";
import { ChatEditDiff } from "@/features/chat/ui/blocks/chat-diff";
import {
    ChatStreamProvider,
    useChatStream,
    useChatStreamStatus,
} from "@/features/chat/lib/chat-stream-store";

function mount(node: React.ReactElement) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
        root.render(node);
    });
    return { host, root };
}

function unmount(root: Root, host: HTMLElement) {
    act(() => root.unmount());
    host.remove();
}

describe("ChatFindBar", () => {
    it("displays tabular match count and navigates via Enter, Shift+Enter, and Escape", () => {
        const events: string[] = [];
        const { host, root } = mount(
            createElement(ChatFindBar, {
                open: true,
                query: "useChatSession",
                matchCount: 4,
                activeMatchIndex: 1,
                onQueryChange: (q) => events.push(`query:${q}`),
                onNext: () => events.push("next"),
                onPrev: () => events.push("prev"),
                onClose: () => events.push("close"),
            }),
        );
        try {
            expect(host.textContent).toContain("2 / 4");
            const input = host.querySelector("input");
            if (!input) throw new Error("expected find bar input");

            act(() => {
                input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
                input.dispatchEvent(
                    new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }),
                );
                input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            });

            expect(events).toEqual(["next", "prev", "close"]);
        } finally {
            unmount(root, host);
        }
    });
});

describe("ProblemsPanel -> Chat bridge", () => {
    it("sends individual or all ESLint problems to the chat composer with @file context", () => {
        const groups = groupProblems([
            toProblem(
                {
                    line: 14,
                    column: 5,
                    end_line: 14,
                    end_column: 10,
                    severity: "error",
                    rule_id: "no-undef",
                    message: "'foo' is not defined.",
                },
                "/repo/src/index.ts",
                "/repo",
            ),
        ]);

        const inserts = listenCustomEvent<{ prompt: string; send: boolean }>(
            "bettershape-chat-insert-prompt",
        );
        const centerViews = listenCustomEvent<string>("bettershape-center-view");
        const toggles = listenCustomEvent<{ id: string; value: boolean }>("bettershape-layout-toggle");
        const { host, root } = mount(
            createElement(ProblemsPanel, {
                state: {
                    kind: "ready",
                    groups,
                    summary: summarize(groups),
                    lintedCount: 1,
                    skippedCount: 0,
                    partialErrors: [],
                },
                busy: false,
                onOpen: () => {},
                onRerun: () => {},
            }),
        );
        try {
            const rowFixBtn = host.querySelector<HTMLButtonElement>(
                'button[aria-label="Fix problem at 14:5 in chat"]',
            );
            if (!rowFixBtn) throw new Error("expected row Fix button");
            act(() => rowFixBtn.click());

            expect(centerViews.events.at(-1)?.detail).toBe("chat");
            expect(toggles.events).toHaveLength(0);
            expect(inserts.events).toHaveLength(1);
            expect(inserts.events[0]?.detail.prompt).toContain("@src/index.ts");
            expect(inserts.events[0]?.detail.prompt).toContain("14:5");
            expect(inserts.events[0]?.detail.prompt).toContain("no-undef");

            const fixAllBtn = host.querySelector<HTMLButtonElement>(
                'button[aria-label="Fix all problems in chat"]',
            );
            if (!fixAllBtn) throw new Error("expected Fix all problems button");
            act(() => fixAllBtn.click());
            expect(inserts.events).toHaveLength(2);
            expect(inserts.events[1]?.detail.prompt).toContain("Fix these ESLint problems:");
            expect(inserts.events[1]?.detail.prompt).toContain("@src/index.ts:14:5 [no-undef]");
        } finally {
            inserts.off();
            centerViews.off();
            toggles.off();
            unmount(root, host);
        }
    });
});

describe("PendingEditsPanel", () => {
    it("renders nothing when edits is empty and summarizes +add/-del counts when populated", () => {
        const empty = mount(
            createElement(PendingEditsPanel, {
                edits: [],
                onAcceptAll: () => {},
                onRejectAll: () => {},
            }),
        );
        try {
            expect(empty.host.childElementCount).toBe(0);
        } finally {
            unmount(empty.root, empty.host);
        }

        const populated = mount(
            createElement(PendingEditsPanel, {
                edits: [
                    {
                        id: "e1",
                        file: "features/chat/index.ts",
                        original: "const a = 1;\n",
                        replacement: "const a = 2;\nconst b = 3;\n",
                    },
                    {
                        id: "e2",
                        file: "features/git/index.ts",
                        original: "export {};\n",
                        replacement: "",
                    },
                ],
                onAcceptAll: () => {},
                onRejectAll: () => {},
            }),
        );
        try {
            expect(populated.host.textContent).toContain("Changes");
            expect(populated.host.textContent).toContain("+2");
            expect(populated.host.textContent).toContain("-2");
        } finally {
            unmount(populated.root, populated.host);
        }
    });

    it("renders explicit + and - non-color diff markers and screen-reader labels in ChatEditDiff", () => {
        const diff = mount(
            createElement(ChatEditDiff, {
                original: "const oldVal = 1;\n",
                replacement: "const newVal = 2;\n",
            }),
        );
        try {
            const text = diff.host.textContent ?? "";
            expect(text).toContain("-");
            expect(text).toContain("+");
            expect(text).toContain("oldVal");
            expect(text).toContain("newVal");
            const srLabels = Array.from(
                diff.host.querySelectorAll(".sr-only"),
                (node) => node.textContent?.trim(),
            );
            expect(srLabels).toEqual(["Removed line", "Added line"]);
        } finally {
            unmount(diff.root, diff.host);
        }
    });
});

describe("ChatStreamProvider stale completion guard", () => {
    it("ignores a delayed chat_complete from an older turn when a newer turn is already live", async () => {
        const listeners = new Map<string, Array<(event: { payload: unknown }) => void>>();
        mockInvoke((cmd, args) => {
            if (cmd === "plugin:event|listen") {
                const payload = args as { event: string; handler: number };
                const list = listeners.get(payload.event) ?? [];
                list.push((ev) => {
                    const run = (
                        window as unknown as {
                            __TAURI_INTERNALS__?: {
                                runCallback?: (id: number, data: unknown) => void;
                            };
                        }
                    ).__TAURI_INTERNALS__?.runCallback;
                    run?.(payload.handler, ev);
                });
                listeners.set(payload.event, list);
                return Promise.resolve(payload.handler);
            }
            if (cmd === "plugin:event|unlisten") return Promise.resolve();
            if (cmd === "get_conversation_messages") return Promise.resolve([]);
            if (cmd === "get_active_turns") return Promise.resolve([]);
            return Promise.resolve(null);
        });

        const emit = (event: string, payload: unknown) => {
            for (const fn of listeners.get(event) ?? []) {
                fn({ payload });
            }
        };

        let statusSnapshot = { isLoading: false, turnId: null as string | null };
        let latestContent = "";

        function Probe() {
            const status = useChatStreamStatus();
            const stream = useChatStream();
            React.useEffect(() => {
                stream.showConversation("conv-1");
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, []);
            statusSnapshot = { isLoading: status.isLoading, turnId: stream.turnId };
            latestContent = stream.messages.at(-1)?.content ?? "";
            return null;
        }

        const { host, root } = mount(
            createElement(ChatStreamProvider, null, createElement(Probe)),
        );
        try {
            await act(async () => {
                await new Promise((r) => setTimeout(r, 30));
            });

            act(() => {
                emit("chat_started", { conversationId: "conv-1", turnId: "1:turn-old" });
                emit("chat_token", {
                    conversationId: "conv-1",
                    turnId: "1:turn-old",
                    chunk: "Old partial",
                });
            });
            expect(statusSnapshot.isLoading).toBe(true);
            expect(statusSnapshot.turnId).toBe("1:turn-old");

            act(() => {
                emit("chat_started", { conversationId: "conv-1", turnId: "2:turn-new" });
                emit("chat_token", {
                    conversationId: "conv-1",
                    turnId: "2:turn-new",
                    chunk: "Fresh live stream",
                });
            });
            expect(statusSnapshot.isLoading).toBe(true);
            expect(statusSnapshot.turnId).toBe("2:turn-new");

            // Delayed completion for Turn 1 arrives out-of-order: must NOT stop Turn 2!
            act(() => {
                emit("chat_complete", {
                    conversationId: "conv-1",
                    turnId: "1:turn-old",
                    content: "Stale content",
                });
            });
            expect(statusSnapshot.isLoading).toBe(true);
            expect(statusSnapshot.turnId).toBe("2:turn-new");
            expect(latestContent).toContain("Fresh live stream");
            expect(latestContent).not.toBe("Stale content");
        } finally {
            unmount(root, host);
        }
    });
});
