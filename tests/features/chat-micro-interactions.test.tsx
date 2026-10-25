import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const askMocks = vi.hoisted(() => ({
    answerAskUser: vi.fn(async () => undefined),
    openUrlExternal: vi.fn(async () => undefined),
}));

vi.mock("@/lib/backend/commands", () => ({
    commands: {
        answerAskUser: askMocks.answerAskUser,
        openUrlExternal: askMocks.openUrlExternal,
    },
}));

vi.mock("@/lib/backend", () => ({
    commands: {
        answerAskUser: askMocks.answerAskUser,
        openUrlExternal: askMocks.openUrlExternal,
        readFile: vi.fn(async () => {
            throw new Error("missing");
        }),
        lsDir: vi.fn(async () => {
            throw new Error("missing");
        }),
    },
    getProjectPath: () => "/project",
    useProjectState: () => ({ project_path: "/project" }),
}));

vi.mock("mermaid", () => ({
    default: {
        initialize: vi.fn(),
        render: vi.fn(async () => ({ svg: "<svg></svg>" })),
    },
}));

import {
    extractCleanSelectionText,
    formatQuotesPrefix,
    splitLeadingQuoteBlock,
} from "@/features/chat/ui/quote-selection";
import { ApprovalCard } from "@/features/chat/ui/blocks/approval";
import { QuestionsCard } from "@/features/chat/ui/blocks/questions";
import { ChatErrorDialog } from "@/features/chat/ui/blocks/error";
import { ChatMarkdown } from "@/features/chat/ui/md/view";

describe("Transcript select-to-quote extraction & formatting", () => {
    it("skips buttons, [data-quote-skip], and status chrome when extracting selected text", () => {
        const messageBody = document.createElement("div");
        messageBody.setAttribute("data-chat-message-body", "");
        messageBody.innerHTML = `
            <p>Keep this prose line.</p>
            <div data-quote-skip><button>Copy code</button><span>18 lines</span></div>
            <pre><code>const answer = 42;</code></pre>
        `;
        document.body.appendChild(messageBody);

        const range = document.createRange();
        range.selectNodeContents(messageBody);
        const extracted = extractCleanSelectionText(range, messageBody);

        expect(extracted).toContain("Keep this prose line.");
        expect(extracted).toContain("const answer = 42;");
        expect(extracted).not.toContain("Copy code");
        expect(extracted).not.toContain("18 lines");

        messageBody.remove();
    });

    it("rejects ranges that cross outside the single message body", () => {
        const msgA = document.createElement("div");
        msgA.textContent = "First message";
        const msgB = document.createElement("div");
        msgB.textContent = "Second message";
        document.body.append(msgA, msgB);

        const range = document.createRange();
        if (!msgA.firstChild || !msgB.firstChild) throw new Error("expected text children");
        range.setStart(msgA.firstChild, 0);
        range.setEnd(msgB.firstChild, 6);

        expect(extractCleanSelectionText(range, msgA)).toBe("");
        msgA.remove();
        msgB.remove();
    });

    it("formats stacked quotes and round-trips leading quote blocks out of user messages", () => {
        const prefix = formatQuotesPrefix([
            { id: "1", text: "Line one\nLine two" },
            { id: "2", text: "Second excerpt" },
        ]);
        const sent = `${prefix}\n\nWhy does Line two fail here?`;
        const parsed = splitLeadingQuoteBlock(sent);

        expect(parsed.quotes).toEqual(["Line one\nLine two", "Second excerpt"]);
        expect(parsed.rest).toBe("Why does Line two fail here?");
    });
});

describe("HITL cards, smart CodeBlock & Error recovery micro-interactions", () => {
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: vi.fn(async () => undefined) },
        });
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it("lets ApprovalCard accept with Ctrl+Enter and skip with Escape outside inputs", async () => {
        const onAccept = vi.fn();
        const onSkip = vi.fn();
        await act(async () => {
            root.render(
                <ApprovalCard title="Run migrations" onAccept={onAccept} onSkip={onSkip}>
                    <div>db push</div>
                </ApprovalCard>,
            );
        });

        await act(async () => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
            );
        });
        expect(onAccept).toHaveBeenCalledTimes(1);

        await act(async () => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });
        expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it("lets QuestionsCard pick options via number keys 1..9", async () => {
        await act(async () => {
            root.render(
                <QuestionsCard
                    askId="ask-42"
                    status="pending"
                    questions={[
                        {
                            id: "scope",
                            prompt: "Which scope?",
                            options: [
                                { id: "min", label: "Minimal" },
                                { id: "full", label: "Comprehensive", recommended: true },
                            ],
                        },
                    ]}
                />,
            );
        });

        await act(async () => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true }));
        });

        expect(askMocks.answerAskUser).toHaveBeenCalledWith(
            "ask-42",
            JSON.stringify({ scope: "full" }),
            false,
        );
    });

    it("toggles line wrap and renders stroked DrawnCheck on CodeBlock copy", async () => {
        const code = ["const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;"].join("\n");
        await act(async () => {
            root.render(<ChatMarkdown content={"```ts\n" + code + "\n```"} />);
        });
        await act(async () => {
            await new Promise((r) => setTimeout(r, 25));
        });

        expect(host.textContent).toContain("4 lines");
        const wrapBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Wrap long lines"]');
        if (!wrapBtn) throw new Error("expected Wrap long lines button");
        expect(wrapBtn.getAttribute("aria-pressed")).toBe("false");

        await act(async () => {
            wrapBtn.click();
        });
        const disableWrapBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Disable line wrap"]');
        expect(disableWrapBtn?.getAttribute("aria-pressed")).toBe("true");

        const copyBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Copy code"]');
        if (!copyBtn) throw new Error("expected Copy code button");
        await act(async () => {
            copyBtn.click();
            await Promise.resolve();
        });
        expect(host.querySelector(".t-success-check")).not.toBeNull();
    });

    it("detects context window overflow in ChatErrorDialog and dispatches /compact recovery", async () => {
        const inserted: Array<{ prompt?: string; send?: boolean }> = [];
        const onInsert = (e: Event) => {
            inserted.push((e as CustomEvent).detail);
        };
        window.addEventListener("bettershape-chat-insert-prompt", onInsert);
        const onDismiss = vi.fn();

        await act(async () => {
            root.render(
                <ChatErrorDialog
                    message="invalid_request_error: context_length_exceeded - Your input exceeds the context window of this model."
                    onDismiss={onDismiss}
                />,
            );
        });

        expect(document.body.textContent).toContain("Context window full");
        const compactBtn = Array.from(document.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Compact context"),
        );
        if (!compactBtn) throw new Error("expected Compact context button");

        await act(async () => {
            compactBtn.click();
        });

        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(inserted).toEqual([{ prompt: "/compact", send: true }]);
        window.removeEventListener("bettershape-chat-insert-prompt", onInsert);
    });
});
