// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
    canStepPromptHistoryUp,
    insertTextareaRangeWithUndo,
    isUnmodifiedHistoryRecall,
    stepPromptHistoryUp,
    stripShellPromptPrefix,
    tryWrapMarkdownLinkOnPaste,
} from "@/lib/chat/prompt-history";
import { findTranscriptMatches } from "@/lib/chat/transcript-search";
import { clearChatDomHighlights, syncChatDomHighlights } from "@/lib/chat/dom-highlights";
import { ApprovalCard } from "@/features/chat/ui/blocks/approval";
import { TurnWorkflowSummary } from "@/features/chat/ui/blocks/turn";
import { ChatMarkdown } from "@/features/chat/ui/md/view";
import { ChatMessageItem } from "@/features/chat/ui/message/item";
import { terminalSessionStore } from "@/features/terminal/session";
import { buildFailingTestPrompt } from "@/features/testing/ui/test-panel";
import type { Chunk } from "@/features/chat/ui/md/renderer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** Mounts `node` inside a fresh DOM container with `TooltipProvider`, tearing down any prior mount. */
const mount = (node: React.ReactElement) => {
    if (root) {
        const prevRoot = root;
        act(() => {
            prevRoot.unmount();
        });
    }
    if (host) {
        host.remove();
    }
    const nextHost = document.createElement("div");
    document.body.appendChild(nextHost);
    const nextRoot = createRoot(nextHost);
    host = nextHost;
    root = nextRoot;
    act(() => {
        nextRoot.render(<TooltipProvider delayDuration={0}>{node}</TooltipProvider>);
    });
    return nextHost;
};

afterEach(() => {
    clearChatDomHighlights();
    terminalSessionStore.pendingCommandInsert = null;
    if (root) {
        const r = root;
        root = null;
        act(() => r.unmount());
    }
    if (host) {
        host.remove();
        host = null;
    }
});

describe("Composer undo-safe insertion, prompt recall guards, and shell prompt stripping", () => {
    it("uses native execCommand('insertText') when supported so Cmd+Z undo history stays intact", () => {
        const ta = document.createElement("textarea");
        ta.value = "check docs now";
        document.body.appendChild(ta);

        const wrapped = tryWrapMarkdownLinkOnPaste(ta.value, 6, 10, "https://example.com");
        if (!wrapped) throw new Error("expected wrapped markdown link");

        const execSpy = vi.fn((cmd: string, _ui?: boolean, val?: string) => {
            if (cmd === "insertText" && typeof val === "string") {
                const s = ta.selectionStart;
                const e = ta.selectionEnd;
                ta.value = `${ta.value.slice(0, s)}${val}${ta.value.slice(e)}`;
                return true;
            }
            return false;
        });
        Object.defineProperty(document, "execCommand", {
            configurable: true,
            writable: true,
            value: execSpy,
        });

        const fallbackSpy = vi.fn();
        insertTextareaRangeWithUndo(
            ta,
            wrapped.start,
            wrapped.end,
            wrapped.replacement,
            wrapped.nextValue,
            fallbackSpy,
        );

        expect(execSpy).toHaveBeenCalledWith("insertText", false, "[docs](https://example.com)");
        expect(fallbackSpy).not.toHaveBeenCalled();
        expect(ta.value).toBe("check [docs](https://example.com) now");

        // Same-text native replacement (`ta.value === fallbackNextValue`) still preserves native undo without fallback.
        insertTextareaRangeWithUndo(ta, 0, 5, "check", ta.value, fallbackSpy);
        expect(fallbackSpy).not.toHaveBeenCalled();

        // Stubbed `execCommand` returning `true` without updating DOM falls back cleanly.
        execSpy.mockImplementationOnce(() => true);
        insertTextareaRangeWithUndo(
            ta,
            0,
            5,
            "verify",
            "verify [docs](https://example.com) now",
            fallbackSpy,
        );
        expect(fallbackSpy).toHaveBeenCalledWith("verify [docs](https://example.com) now", 6);
        ta.remove();
    });

    it("stashes non-empty unsent drafts at caret 0 and protects customized recalled prompts from Escape overwrite", () => {
        // Non-empty draft with caret in middle does not hijack ArrowUp (lets browser move caret to 0 first).
        expect(canStepPromptHistoryUp(null, "draft work", 5, 5)).toBe(false);
        // Once caret reaches 0..0, ArrowUp enters recall and stashes "draft work".
        expect(canStepPromptHistoryUp(null, "draft work", 0, 0)).toBe(true);

        const stepped = stepPromptHistoryUp(null, "draft work", ["fix auth race", "init repo"]);
        if (!stepped) throw new Error("expected recalled history step");
        expect(stepped.cursor.stashedDraft).toBe("draft work");
        expect(stepped.cursor.recalledValue).toBe("fix auth race");
        expect(isUnmodifiedHistoryRecall(stepped.cursor, "fix auth race")).toBe(true);

        // User edits the recalled prompt: Escape/ArrowDown must not overwrite their new text!
        expect(isUnmodifiedHistoryRecall(stepped.cursor, "fix auth race in session.ts")).toBe(false);
    });

    it("strips leading '$ ' shell prompts without mangling $ENV variables", () => {
        expect(stripShellPromptPrefix("$ npm run test:unit\n$ npm run typecheck")).toBe(
            "npm run test:unit\nnpm run typecheck",
        );
        expect(stripShellPromptPrefix("echo $HOME/bin")).toBe("echo $HOME/bin");
    });
});

describe("Sub-node CSS.highlights search and case sensitivity", () => {
    it("supports case-sensitive findTranscriptMatches and registers CSS.highlights ranges without mutating DOM text nodes", () => {
        const msgs = [
            { role: "user", content: "Check TokenStore vs tokenstore" },
            {
                role: "assistant",
                content: '<cat path="src/TokenStore.ts"></cat>Updated TokenStore and tokenstore.',
            },
        ];
        expect(findTranscriptMatches(msgs, "TokenStore", { caseSensitive: false })).toHaveLength(5);
        expect(findTranscriptMatches(msgs, "TokenStore", { caseSensitive: true })).toHaveLength(3);

        const setSpy = vi.fn();
        const deleteSpy = vi.fn();
        class FakeHighlight {
            ranges: AbstractRange[];
            constructor(...ranges: AbstractRange[]) {
                this.ranges = ranges;
            }
        }
        (window as unknown as { Highlight?: unknown; CSS?: unknown }).Highlight = FakeHighlight;
        (window as unknown as { CSS?: unknown }).CSS = {
            highlights: { set: setSpy, delete: deleteSpy },
        };

        const container = document.createElement("div");
        container.innerHTML = `
            <div data-chat-message-index="0"><p>Check TokenStore vs tokenstore</p></div>
            <div data-chat-message-index="1"><p>Updated TokenStore and tokenstore.</p><button>TokenStore</button></div>
        `;
        document.body.appendChild(container);
        const secondP = container.querySelectorAll("p")[1];
        if (!secondP) throw new Error("expected second paragraph");
        const paragraphNodeBefore = secondP.firstChild;

        const { ranges, activeRange } = syncChatDomHighlights(container, "TokenStore", {
            caseSensitive: true,
            targetMessageIndex: 1,
            targetOccurrenceInMessage: 0,
        });

        // Skips <button> chrome and preserves exact Text node identity without <mark> splitting!
        expect(ranges).toHaveLength(2);
        expect(activeRange?.toString()).toBe("TokenStore");
        expect(container.querySelectorAll("p")[1]?.firstChild).toBe(paragraphNodeBefore);
        expect(setSpy).toHaveBeenCalledWith("chat-find", expect.any(FakeHighlight));
        expect(setSpy).toHaveBeenCalledWith("chat-find-active", expect.any(FakeHighlight));

        clearChatDomHighlights();
        expect(deleteSpy).toHaveBeenCalledWith("chat-find");
        expect(deleteSpy).toHaveBeenCalledWith("chat-find-active");
        container.remove();
    });
});

describe("HITL single-owner shortcuts, tool-call presentation, and workbench bridges", () => {
    it("routes Ctrl+Enter to only the earliest pending ApprovalCard when multiple cards are mounted", () => {
        const acceptFirst = vi.fn();
        const acceptSecond = vi.fn();

        function Harness({ showFirst }: { showFirst: boolean }) {
            return (
                <div>
                    {showFirst ? (
                        <ApprovalCard title="Approve db migration" onAccept={acceptFirst} onSkip={() => {}} />
                    ) : null}
                    <ApprovalCard title="Approve deploy" onAccept={acceptSecond} onSkip={() => {}} />
                </div>
            );
        }

        const el = mount(<Harness showFirst />);
        expect(el.querySelectorAll("[data-pending-approval='true']")).toHaveLength(2);

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }),
            );
        });
        expect(acceptFirst).toHaveBeenCalledTimes(1);
        expect(acceptSecond).toHaveBeenCalledTimes(0);

        // Once card #1 settles/unmounts, Ctrl+Enter cleanly routes to card #2.
        const currentRoot = root;
        if (!currentRoot) throw new Error("expected mounted root");
        act(() => {
            currentRoot.render(
                <TooltipProvider delayDuration={0}>
                    <Harness showFirst={false} />
                </TooltipProvider>,
            );
        });
        act(() => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }),
            );
        });
        expect(acceptSecond).toHaveBeenCalledTimes(1);
    });

    it("surfaces durationMs, failure badges, expandable streaming thoughts, grouped file drill-downs, and showHeader=false steps in TurnWorkflowSummary", () => {
        const blocks: Chunk[] = [
            {
                type: "think",
                content: "Inspecting auth flow\nChecking session expiry edge cases",
                isGenerating: true,
            },
            { type: "cat", content: "src/auth.ts", catStartLine: 10, catEndLine: 45 },
            { type: "cat", content: "src/session.ts", catStartLine: 1, catEndLine: 30 },
            {
                type: "terminal_command",
                command: "npm test",
                content: "npm test\nFAIL src/auth.test.ts",
                commandStatus: "failed",
                exitCode: 1,
            },
        ];

        const el = mount(<TurnWorkflowSummary blocks={blocks} isActive={false} durationMs={4200} />);

        // Failure badge + settled durationMs badge visible on summary header; failed turn stays open!
        expect(el.textContent).toContain("1 failed");
        expect(el.textContent).toContain("4.2s");
        expect(el.textContent).toContain("auth.ts + 1 more");
        // Live streaming thought shows latest line preview and can expand while isActive!
        expect(el.textContent).toContain("Checking session expiry edge cases");

        // Click grouped read row ("Explored auth.ts + 1 more") to drill down into individual files + line ranges.
        const exploredBtn = Array.from(el.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("auth.ts + 1 more"),
        );
        if (!exploredBtn) throw new Error("expected explored group button");
        act(() => {
            exploredBtn.click();
        });
        expect(el.textContent).toContain("L10-45");
        expect(el.textContent).toContain("session.ts");
    });

    it("renders shell 'Insert in terminal' button on bash CodeBlocks and queues stripped commands cleanly", () => {
        const openEvents: Event[] = [];
        const onOpen = (e: Event) => openEvents.push(e);
        window.addEventListener("bettershape-open-workspace-terminal", onOpen);

        const el = mount(<ChatMarkdown content={"```bash\n$ npm run lint:strict\n```"} />);
        const insertBtn = el.querySelector<HTMLButtonElement>('button[aria-label="Insert in terminal"]');
        if (!insertBtn) throw new Error("expected Insert in terminal button");

        act(() => {
            insertBtn.click();
        });
        expect(openEvents).toHaveLength(1);
        expect(terminalSessionStore.takePendingCommandInsert()).toBe("npm run lint:strict");
        window.removeEventListener("bettershape-open-workspace-terminal", onOpen);
    });

    it("builds @file-scoped repair prompts from failing tests", () => {
        const prompt = buildFailingTestPrompt(
            [
                {
                    suiteFile: "/repo/tests/auth.test.ts",
                    testName: "refreshes expired token",
                    error: "AssertionError: expected 401 to equal 200",
                },
            ],
            "/repo",
        );
        expect(prompt).toContain('@tests/auth.test.ts');
        expect(prompt).toContain('Fix failing test "refreshes expired token"');
        expect(prompt).toContain("expected 401 to equal 200");
    });

    it("suppresses checkpoint restore action when ChatMessageItem index is omitted or negative", () => {
        const onRestore = vi.fn();
        const withoutIndex = mount(
            <ChatMessageItem
                role="user"
                content="Standalone preview turn"
                timestamp={1_700_000_000_000}
                onRestore={onRestore}
            />,
        );
        expect(
            withoutIndex.querySelector('button[aria-label="Restore to this checkpoint"]'),
        ).toBeNull();

        const withZeroIndex = mount(
            <ChatMessageItem
                role="user"
                content="First persisted turn"
                timestamp={1_700_000_000_000}
                index={0}
                onRestore={onRestore}
            />,
        );
        const restoreBtn = withZeroIndex.querySelector<HTMLButtonElement>(
            'button[aria-label="Restore to this checkpoint"]',
        );
        expect(restoreBtn).not.toBeNull();
        act(() => {
            restoreBtn?.click();
        });
        expect(onRestore).toHaveBeenCalledWith(0);

        const onRedo = vi.fn();
        const assistantWithoutIndex = mount(
            <ChatMessageItem
                role="assistant"
                content="Standalone assistant preview"
                timestamp={1_700_000_000_000}
                onRedo={onRedo}
            />,
        );
        const actionsBtn = assistantWithoutIndex.querySelector<HTMLButtonElement>(
            'button[aria-label="Message actions"]',
        );
        expect(actionsBtn).not.toBeNull();
        act(() => {
            actionsBtn?.dispatchEvent(
                new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
            );
            actionsBtn?.click();
        });
        expect(document.body.textContent ?? "").not.toContain("Regenerate");
        expect(onRedo).not.toHaveBeenCalled();
    });
});
