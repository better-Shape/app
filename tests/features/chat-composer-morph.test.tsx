import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providerState = vi.hoisted(() => ({ usable: false }));

vi.mock("@/lib/ai/providers", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/ai/providers")>()),
    hasAnyUsableProvider: () => providerState.usable,
}));

vi.mock("@/lib/backend", () => ({
    commands: {
        getOpenTurnJournals: vi.fn().mockResolvedValue([]),
        getConversations: vi.fn().mockResolvedValue([]),
        listWorkspaceFiles: vi.fn().mockResolvedValue([]),
        listBrowserTabs: vi.fn().mockResolvedValue([]),
        revealPath: vi.fn(),
        dictationStart: vi.fn(),
        dictationStop: vi.fn(),
        dictationPush: vi.fn(),
    },
    getProjectPath: () => null,
    useProjectState: () => ({ project_path: null }),
}));

vi.mock("@/features/agent/workspace/branch-switch", () => ({
    WorkspaceBranchSwitch: () => <button type="button">main</button>,
}));

import { ChatInput } from "@/features/chat/ui/composer/input";
import { ActionLine } from "@/features/chat/ui/blocks/action-line";
import { Collapse } from "@/features/chat/ui/blocks/collapse";
import { CHAT_EXPAND_FOR_FIND_EVENT, ChatFindBar } from "@/features/chat/ui/shell/find-bar";
import { openConversationById } from "@/features/agent/recovery/interrupted-turns";
import { NotificationsMenu } from "@/features/agent/workbench/status/ui/notifications-menu";
import { notificationStore } from "@/features/notifications";

function mount(node: React.ReactNode): { host: HTMLDivElement; root: Root } {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
        root.render(node);
    });
    return { host, root };
}

function unmount(root: Root, host: HTMLDivElement) {
    act(() => {
        root.unmount();
    });
    host.remove();
}

function renderComposer(
    overrides: Partial<React.ComponentProps<typeof ChatInput>> = {},
) {
    return mount(
        <ChatInput
            inputValue=""
            isLoading={false}
            isPreparing={false}
            uploadedFiles={[]}
            onInputChange={() => undefined}
            onKeyDown={() => undefined}
            onSendMessage={() => undefined}
            onStopMessage={() => undefined}
            setUploadedFiles={() => undefined}
            addUploadedFiles={() => undefined}
            selectedModel="auto"
            setSelectedModel={() => undefined}
            selectedWorkerModels={[]}
            setSelectedWorkerModels={() => undefined}
            selectedMode="Plan"
            setSelectedMode={() => undefined}
            reasoningEffort="high"
            setReasoningEffort={() => undefined}
            {...overrides}
        />,
    );
}

function dispatchPointerClick(el: Element) {
    act(() => {
        el.dispatchEvent(
            new PointerEvent("pointerdown", {
                bubbles: true,
                cancelable: true,
                button: 0,
                pointerType: "mouse",
            }),
        );
        (el as HTMLElement).click();
    });
}

describe("Pass 7: ModeMenu & BYOK pre-key composer controls", () => {
    beforeEach(() => {
        providerState.usable = false;
    });

    it("opens ModeMenu and switches mode even when no BYOK provider is configured yet", () => {
        const setSelectedMode = vi.fn();
        const { host, root } = renderComposer({
            selectedMode: "Plan",
            setSelectedMode,
        });
        try {
            const modeBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Plan"]');
            const addBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Add"]');
            const sendBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
            expect(modeBtn).toBeTruthy();
            expect(modeBtn?.getAttribute("aria-disabled")).toBeNull();
            expect(addBtn?.disabled).toBe(false);
            expect(sendBtn?.disabled).toBe(true);
            // Disabled Send button must not look active-blue when provider is missing
            expect(sendBtn?.className).not.toContain("bg-accent");

            dispatchPointerClick(modeBtn!);

            const menuItems = Array.from(
                document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
            );
            const labels = menuItems.map((el) => el.textContent ?? "");
            expect(labels.some((t) => t.includes("Code"))).toBe(true);
            expect(labels.some((t) => t.includes("Ask"))).toBe(true);
            expect(labels.some((t) => t.includes("Visual"))).toBe(true);
            expect(labels.some((t) => t.includes("Review"))).toBe(true);

            const codeItem = menuItems.find((el) => (el.textContent ?? "").includes("Code"));
            act(() => {
                codeItem?.click();
            });
            expect(setSelectedMode).toHaveBeenCalledWith("Code");
        } finally {
            unmount(root, host);
        }
    });

    it("provides a 1-click Open Providers affordance that routes to Settings -> Providers", async () => {
        const overlayEvents: Array<{ type?: string; category?: string }> = [];
        const onOverlay = (e: Event) => {
            overlayEvents.push((e as CustomEvent).detail);
        };
        window.addEventListener("bettershape-agent-overlay", onOverlay);

        const { host, root } = renderComposer({ inputValue: "" });
        try {
            const openBtn = Array.from(host.querySelectorAll("button")).find(
                (b) => b.textContent?.trim() === "Open Providers",
            );
            expect(openBtn).toBeTruthy();
            await act(async () => {
                openBtn?.click();
            });
            expect(overlayEvents).toEqual([{ type: "settings", category: "providers" }]);
        } finally {
            window.removeEventListener("bettershape-agent-overlay", onOverlay);
            unmount(root, host);
        }
    });
});

describe("Pass 7: Continuous 3-column composer morph & @ mention guards", () => {
    beforeEach(() => {
        providerState.usable = true;
    });

    it("maintains continuous 32px action rails and immediately returns to rounded-[22px] on 1-line text", () => {
        const { host, root } = renderComposer({
            inputValue: "Line 1\nLine 2\nLine 3",
        });
        try {
            const vessel = host.querySelector<HTMLElement>("[data-expanded-layout]");
            expect(vessel?.getAttribute("data-expanded-layout")).toBe("true");
            expect(vessel?.className).toContain("rounded-[16px]");

            act(() => {
                root.render(
                    <ChatInput
                        inputValue="A fifty-character single-line prompt after backspacing!"
                        isLoading={false}
                        isPreparing={false}
                        uploadedFiles={[]}
                        onInputChange={() => undefined}
                        onKeyDown={() => undefined}
                        onSendMessage={() => undefined}
                        onStopMessage={() => undefined}
                        setUploadedFiles={() => undefined}
                        addUploadedFiles={() => undefined}
                        selectedModel="auto"
                        setSelectedModel={() => undefined}
                        selectedWorkerModels={[]}
                        setSelectedWorkerModels={() => undefined}
                        selectedMode="Code"
                        setSelectedMode={() => undefined}
                        reasoningEffort="high"
                        setReasoningEffort={() => undefined}
                    />,
                );
            });
            // Must NOT stay trapped in expanded layout due to >=42 char hysteresis
            expect(vessel?.getAttribute("data-expanded-layout")).toBe("false");
            expect(vessel?.className).toContain("rounded-[22px]");
        } finally {
            unmount(root, host);
        }
    });

    it("ignores email addresses for @ mentions and lets Enter submit when @ picker has 0 matches", () => {
        const onKeyDown = vi.fn();
        const onInputChange = vi.fn();
        const { host, root } = renderComposer({
            inputValue: "",
            onInputChange,
            onKeyDown,
        });
        try {
            const textarea = host.querySelector("textarea")!;
            expect(textarea).toBeTruthy();

            // Typing an email address must NOT open the @ mention popover
            act(() => {
                const email = "Email alex@stripe.com please";
                Object.getOwnPropertyDescriptor(
                    HTMLTextAreaElement.prototype,
                    "value",
                )?.set?.call(textarea, email);
                textarea.setSelectionRange(email.length, email.length);
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
            });
            expect(document.body.querySelector(".bettershape-popover-content")).toBeNull();

            // Typing a standalone @nonexistent query with 0 matches must still allow Enter to submit
            act(() => {
                const query = "@zzzz_nonexistent_token_99999";
                Object.getOwnPropertyDescriptor(
                    HTMLTextAreaElement.prototype,
                    "value",
                )?.set?.call(textarea, query);
                textarea.setSelectionRange(query.length, query.length);
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
            });

            act(() => {
                textarea.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        key: "Enter",
                        bubbles: true,
                        cancelable: true,
                    }),
                );
            });
            expect(onKeyDown).toHaveBeenCalledTimes(1);
        } finally {
            unmount(root, host);
        }
    });
});

describe("Pass 7: Lazy Collapse first-open spring, ActionLine Find-in-Chat, & Workbench polish", () => {
    afterEach(() => {
        notificationStore.clearAll();
    });

    it("Collapse defers DOM mount when closed, mounts at 0fr on first open, and promotes to 1fr on rAF", () => {
        const rafQueue: FrameRequestCallback[] = [];
        const origRaf = window.requestAnimationFrame;
        window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
            rafQueue.push(cb);
            return rafQueue.length;
        }) as typeof window.requestAnimationFrame;

        const { host, root } = mount(
            <Collapse open={false}>
                <div data-testid="lazy-body">Tool output</div>
            </Collapse>,
        );
        try {
            expect(host.querySelector("[data-testid='lazy-body']")).toBeNull();

            act(() => {
                root.render(
                    <Collapse open>
                        <div data-testid="lazy-body">Tool output</div>
                    </Collapse>,
                );
            });
            const grid = host.querySelector<HTMLElement>("[data-open='true']");
            expect(grid).toBeTruthy();
            expect(host.querySelector("[data-testid='lazy-body']")).toBeTruthy();
            expect(grid?.className).toContain("grid-rows-[0fr]");

            act(() => {
                const next = rafQueue.splice(0);
                for (const fn of next) fn(16);
            });
            expect(grid?.className).toContain("grid-rows-[1fr]");
        } finally {
            window.requestAnimationFrame = origRaf;
            unmount(root, host);
        }
    });

    it("ActionLine expands unmounted collapsed bodies only when Find-in-Chat matches their content", () => {
        const { host, root } = mount(
            <div data-chat-message-index="2">
                <ActionLine action="Grepped" detail="auth">
                    <pre>Found needle_token_42 in session.ts</pre>
                </ActionLine>
                <ActionLine action="Grepped" detail="styles">
                    <pre>Unrelated stylesheet line</pre>
                </ActionLine>
            </div>,
        );
        try {
            const buttons = host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]");
            expect(buttons[0]?.getAttribute("aria-expanded")).toBe("false");
            expect(buttons[1]?.getAttribute("aria-expanded")).toBe("false");

            act(() => {
                window.dispatchEvent(
                    new CustomEvent(CHAT_EXPAND_FOR_FIND_EVENT, {
                        detail: {
                            messageIndex: 2,
                            query: "needle_token_42",
                            caseSensitive: false,
                        },
                    }),
                );
            });

            expect(buttons[0]?.getAttribute("aria-expanded")).toBe("true");
            expect(buttons[1]?.getAttribute("aria-expanded")).toBe("false");
        } finally {
            unmount(root, host);
        }
    });

    it("ChatFindBar stays mounted as inert after closing so Collapse can animate out smoothly", () => {
        const { host, root } = mount(
            <ChatFindBar
                open={false}
                query=""
                matchCount={0}
                activeMatchIndex={0}
                onQueryChange={() => undefined}
                onNext={() => undefined}
                onPrev={() => undefined}
                onClose={() => undefined}
            />,
        );
        try {
            expect(host.querySelector("[data-chat-find-bar]")).toBeNull();

            act(() => {
                root.render(
                    <ChatFindBar
                        open
                        query="test"
                        matchCount={1}
                        activeMatchIndex={0}
                        onQueryChange={() => undefined}
                        onNext={() => undefined}
                        onPrev={() => undefined}
                        onClose={() => undefined}
                    />,
                );
            });
            expect(host.querySelector("[data-chat-find-bar]")).toBeTruthy();

            act(() => {
                root.render(
                    <ChatFindBar
                        open={false}
                        query="test"
                        matchCount={1}
                        activeMatchIndex={0}
                        onQueryChange={() => undefined}
                        onNext={() => undefined}
                        onPrev={() => undefined}
                        onClose={() => undefined}
                    />,
                );
            });
            const bar = host.querySelector<HTMLElement>("[data-chat-find-bar]");
            expect(bar).toBeTruthy();
            expect(bar?.getAttribute("aria-hidden")).toBe("true");
        } finally {
            unmount(root, host);
        }
    });

    it("openConversationById switches center view to chat and NotificationsMenu exposes accessible button name", () => {
        const events: string[] = [];
        const onCenter = (e: Event) => events.push(`center:${(e as CustomEvent).detail}`);
        const onLoad = (e: Event) => events.push(`load:${(e as CustomEvent).detail?.id}`);
        window.addEventListener("bettershape-center-view", onCenter);
        window.addEventListener("bettershape-chat-load", onLoad);

        const { host, root } = mount(<NotificationsMenu />);
        try {
            openConversationById("conv-abc");
            expect(events).toEqual(["center:chat", "load:conv-abc"]);

            const trigger = host.querySelector<HTMLButtonElement>("button");
            expect(trigger?.getAttribute("aria-label")).toBe("Notifications");
        } finally {
            window.removeEventListener("bettershape-center-view", onCenter);
            window.removeEventListener("bettershape-chat-load", onLoad);
            unmount(root, host);
        }
    });
});
