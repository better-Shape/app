// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
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
import { ChatErrorDialog, redactErrorSecrets } from "@/features/chat/ui/blocks/error";
import {
    appendStreamAnsiChunk,
    commandSummary,
    selectAutoRunMode,
    stripAnsi,
    TerminalCommandStep,
    type TerminalStreamBuffer,
} from "@/features/chat/ui/blocks/terminal-live";
import { getSettings, updateSettingSection } from "@/lib/settings";
import { ActionLine } from "@/features/chat/ui/blocks/action-line";
import { TurnWorkflowSummary } from "@/features/chat/ui/blocks/turn";
import {
    computeShortenedCaret,
    insertDictatedSlice,
    isPlainEnterSubmit,
    shouldComposerBreakAll,
} from "@/features/chat/ui/composer/input";
import { computeProcessingSafetyTimeoutMs } from "@/features/chat/ui/composer/dictation-button";
import { resolveComposerSetupGap } from "@/features/chat/ui/composer/input-helpers";
import {
    dropSupersededPersonaReviews,
    MessageRenderer,
    parseMessageContent,
    type Chunk,
} from "@/features/chat/ui/md/renderer";
import {
    appendInlineCodeSpansInRange,
    preprocessChatMarkdown,
    repairStreamGlitches,
    stripLeakedToolMarkup,
} from "@/features/chat/ui/md/stream";
import { ChatMarkdown } from "@/features/chat/ui/md/view";
import { ChatMessageItem } from "@/features/chat/ui/message/item";
import {
    defaultProvidersSettings,
    describeProviderSetupGap,
    embeddingsTarget,
    keyFormatWarning,
    mergeProviderConnections,
    normalizeProvidersSettings,
    providerHeaders,
    providersForModelNames,
    toRustAiConfig,
    withFeatureModel,
} from "@/lib/ai/providers";
import { commands } from "@/lib/backend/commands";
import { shortenMentionTokensInText } from "@/lib/chat/mentions";
import { startDictation } from "@/lib/editor/dictation";
import { terminalSessionStore } from "@/features/terminal/session";
import { buildFailingTestPrompt } from "@/features/testing/ui/test-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** Creates a mocked `AudioContext` constructor wired to `getProcessor`. */
const createMockAudioContextFactory = (
    getProcessor: () => {
        connect: () => void;
        disconnect: () => void;
        onaudioprocess: ((ev: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null;
    },
) =>
    vi.fn(function MockAudioContext() {
        return {
            sampleRate: 16_000,
            destination: {},
            createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
            createScriptProcessor: getProcessor,
            createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
            close: (): Promise<void> => Promise.resolve(),
        };
    });

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
        const mountedRoot = root;
        root = null;
        act(() => mountedRoot.unmount());
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
        const prevExecDescriptor = Object.getOwnPropertyDescriptor(
            document,
            "execCommand",
        );
        try {
            const wrapped = tryWrapMarkdownLinkOnPaste(ta.value, 6, 10, "https://example.com");
            if (!wrapped) throw new Error("expected wrapped markdown link");

            const execSpy = vi.fn((cmd: string, _ui?: boolean, val?: string) => {
                if (cmd === "insertText" && typeof val === "string") {
                    const startOffset = ta.selectionStart;
                    const endOffset = ta.selectionEnd;
                    ta.value = `${ta.value.slice(0, startOffset)}${val}${ta.value.slice(endOffset)}`;
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
        } finally {
            if (prevExecDescriptor) {
                Object.defineProperty(document, "execCommand", prevExecDescriptor);
            } else {
                Reflect.deleteProperty(document, "execCommand");
            }
            ta.remove();
        }
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
        vi.stubGlobal("Highlight", FakeHighlight);
        vi.stubGlobal("CSS", {
            highlights: { set: setSpy, delete: deleteSpy },
        });

        const container = document.createElement("div");
        container.innerHTML = `
            <div data-recent-banner>TokenStore banner outside indexed rows</div>
            <div data-chat-message-index="0"><p>Check TokenStore vs tokenstore</p></div>
            <div data-chat-message-index="1"><p>Updated TokenStore and tokenstore.</p><button>TokenStore</button></div>
        `;
        document.body.appendChild(container);
        try {
            const secondP = container.querySelectorAll("p")[1];
            if (!secondP) throw new Error("expected second paragraph");
            const paragraphNodeBefore = secondP.firstChild;

            const { ranges, activeRange } = syncChatDomHighlights(container, "TokenStore", {
                caseSensitive: true,
                targetMessageIndex: 1,
                targetOccurrenceInMessage: 0,
            });

            // Skips unindexed banners + <button> chrome and preserves exact Text node identity without <mark> splitting!
            expect(ranges).toHaveLength(2);
            expect(activeRange?.toString()).toBe("TokenStore");
            expect(container.querySelectorAll("p")[1]?.firstChild).toBe(paragraphNodeBefore);
            expect(setSpy).toHaveBeenCalledWith("chat-find", expect.any(FakeHighlight));
            expect(setSpy).toHaveBeenCalledWith("chat-find-active", expect.any(FakeHighlight));

            clearChatDomHighlights();
            expect(deleteSpy).toHaveBeenCalledWith("chat-find");
            expect(deleteSpy).toHaveBeenCalledWith("chat-find-active");
        } finally {
            container.remove();
            vi.unstubAllGlobals();
        }
    });
});

describe("HITL single-owner shortcuts, tool-call presentation, and workbench bridges", () => {
    it("routes Ctrl+Enter to only the earliest pending ApprovalCard when multiple cards are mounted", () => {
        const acceptFirst = vi.fn();
        const acceptSecond = vi.fn();
        const skipFirst = vi.fn();
        const skipSecond = vi.fn();

        /** Test harness mounting stacked `ApprovalCard` instances to verify FIFO shortcut focus. */
        const Harness = ({ showFirst }: { showFirst: boolean }) => (
            <div>
                {showFirst ? (
                    <ApprovalCard title="Approve db migration" onAccept={acceptFirst} onSkip={skipFirst} />
                ) : null}
                <ApprovalCard title="Approve deploy" onAccept={acceptSecond} onSkip={skipSecond} />
            </div>
        );

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
        /** Captures workspace terminal open events dispatched by the shell action button. */
        const onOpen = (e: Event) => openEvents.push(e);
        window.addEventListener("bettershape-open-workspace-terminal", onOpen);
        try {
            const el = mount(<ChatMarkdown content={"```bash\n$ npm run lint:strict\n```"} />);
            const insertBtn = el.querySelector<HTMLButtonElement>('button[aria-label="Insert in terminal"]');
            if (!insertBtn) throw new Error("expected Insert in terminal button");

            act(() => {
                insertBtn.click();
            });
            expect(openEvents).toHaveLength(1);
            expect(terminalSessionStore.takePendingCommandInsert()).toBe("npm run lint:strict");
        } finally {
            window.removeEventListener("bettershape-open-workspace-terminal", onOpen);
        }
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

describe("Regression guards for error details, grapheme truncation, HTML tag boundaries, and provider setup gaps", () => {
    it("preserves raw provider error details alongside classified descriptions in ChatErrorDialog", () => {
        const onRetry = vi.fn();
        mount(
            <ChatErrorDialog
                message="401 invalid_api_key: model 'gpt-5-private' rejected for key sk-***9a"
                onDismiss={vi.fn()}
                onRetry={onRetry}
            />,
        );
        const bodyText = document.body.textContent ?? "";
        expect(bodyText).toContain("model 'gpt-5-private' rejected");
        const retryBtn = Array.from(document.body.querySelectorAll("button")).find(
            (btn) => btn.textContent === "Try again",
        );
        expect(retryBtn).toBeDefined();
        act(() => {
            retryBtn?.click();
        });
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("strips ANSI CSI, OSC, two-byte escapes, and carriage returns cleanly", () => {
        const raw =
            "\u001b]0;build-title\u0007\u001b[32mPASS\u001b[0m \u001b[38:2::255:128:0mcolor\u001b[m \u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\\r\n\u001bcok";
        expect(stripAnsi(raw)).toBe("PASS color link\nok");
    });

    it("truncates terminal command summaries on grapheme cluster boundaries without splitting surrogates or ZWJ emoji", () => {
        const prefix = "a".repeat(52);
        const familyEmoji = "👨‍👩‍👧‍👦";
        const summary = commandSummary(`${prefix}${familyEmoji}tail`);
        expect(summary).toBe(`${prefix}${familyEmoji}...`);
        expect(summary.includes("\uFFFD")).toBe(false);
    });

    it("restricts composer break-all to single-line unbroken tokens with leading whitespace", () => {
        expect(shouldComposerBreakAll("   https://example.com/very/long/token")).toBe(true);
        expect(
            shouldComposerBreakAll("   https://example.com/very/long/token\nnormal prose line"),
        ).toBe(false);
        expect(shouldComposerBreakAll("   normal multi word prose")).toBe(false);
    });

    it("ignores > inside quoted attributes across lines and preserves <scriptx> prose while stripping <script>", () => {
        const withQuotedGt = preprocessChatMarkdown(
            '<div data-expr="a > b">kept text</div>',
        );
        expect(withQuotedGt).toBe("kept text");

        const multiLineAttr = preprocessChatMarkdown(
            '<div\n  data-expr="a > b"\n  class="card">multi kept</div>',
        );
        expect(multiLineAttr).toBe("multi kept");

        const brokenQuotePairedTag = preprocessChatMarkdown(
            '<iframe\n  data-broken="unclosed\n  srcdoc="a > b">hidden</iframe>kept',
        );
        expect(brokenQuotePairedTag).toBe("kept");

        const customTag = preprocessChatMarkdown("<scriptx>safe body</scriptx>");
        expect(customTag).toContain("safe body");

        const scriptWithLookalikeCloser = preprocessChatMarkdown(
            "before<script>evil()</scriptx>stillEvil()</script>after",
        );
        expect(scriptWithLookalikeCloser).toBe("beforeafter");
    });

    it("distinguishes missing model IDs from missing base URLs and missing API keys in describeProviderSetupGap", () => {
        const empty = defaultProvidersSettings();
        expect(describeProviderSetupGap(empty)).toBe(
            "Add an API key in Settings -> Providers",
        );

        const customNoModels = defaultProvidersSettings();
        customNoModels.connections.custom = {
            ...customNoModels.connections.custom,
            enabled: true,
            authStyle: "none",
            baseUrl: "http://127.0.0.1:8080/v1",
            extraModels: [],
        };
        expect(describeProviderSetupGap(customNoModels)).toBe(
            "Add a model ID in Settings -> Providers",
        );

        const customMissingUrl = defaultProvidersSettings();
        customMissingUrl.connections.custom = {
            ...customMissingUrl.connections.custom,
            enabled: true,
            authStyle: "none",
            baseUrl: "   ",
            extraModels: [],
        };
        expect(describeProviderSetupGap(customMissingUrl)).toBe(
            "Set a base URL and model ID in Settings -> Providers",
        );
    });

    it("strips leaked tool calls inside backtick and tilde fences while preserving normal tilde-fenced code", () => {
        const leakedBacktick = preprocessChatMarkdown(
            'Before\n```\nprint(default_api.read_file(path="a.ts"))\n```\nAfter',
        );
        expect(leakedBacktick).toBe("Before\n\nAfter");

        const leakedTilde = preprocessChatMarkdown(
            'Before\n~~~\nprint(default_api.read_file(path="a.ts"))\n~~~\nAfter',
        );
        expect(leakedTilde).toBe("Before\n\nAfter");

        const leakedUnclosedTilde = preprocessChatMarkdown(
            'Before\n~~~python\nprint(default_api.read_file(path="a.ts"))\n',
            { streaming: true },
        );
        expect(leakedUnclosedTilde).toBe("Before");

        const userCodeTilde = preprocessChatMarkdown(
            "Before\n~~~ts\nconst answer = 42;\n~~~\nAfter",
        );
        expect(userCodeTilde).toContain("const answer = 42;");
    });

    it("enforces tag-name boundaries so <catalog> stays prose while <cat> parses as a cat chunk", () => {
        const chunks = parseMessageContent(
            'Inspect <catalog> entries first.\n<cat path="src/app.ts">body</cat>',
        );
        expect(
            chunks.some((chunk) => chunk.type === "text" && (chunk.content ?? "").includes("<catalog>")),
        ).toBe(true);
        expect(chunks.some((chunk) => chunk.type === "cat")).toBe(true);
    });

    it("drops non-string and whitespace-only entries when normalizing provider model lists", () => {
        const base = defaultProvidersSettings();
        const normalized = normalizeProvidersSettings({
            connections: {
                ...base.connections,
                openai: {
                    ...base.connections.openai,
                    enabled: true,
                    apiKey: "sk-test",
                    models: [123, { bad: true }, "  ", "gpt-5"] as unknown as string[],
                    extraModels: [true, "o4-mini"] as unknown as string[],
                },
            },
        });
        expect(normalized.connections.openai.models).toEqual(["gpt-5"]);
        expect(normalized.connections.openai.extraModels).toEqual(["o4-mini"]);
    });

    it("cleans up microphone tracks and backend recognizer if AudioContext setup throws", async () => {
        const stopTrack = vi.fn();
        const fakeStream = {
            getTracks: () => [{ stop: stopTrack }],
        } as unknown as MediaStream;
        const prevMediaDevices = navigator.mediaDevices;
        const prevAudioCtx = (window as unknown as { AudioContext?: unknown }).AudioContext;
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
        });
        /** Stub `AudioContext` constructor that throws synchronously to exercise startup teardown. */
        const ThrowingAudioContext = function (): never {
            throw new Error("audio graph init failed");
        };
        (window as unknown as { AudioContext?: unknown }).AudioContext = ThrowingAudioContext;

        /** Resolves an empty promise for mocked recognizer lifecycle hooks. */
        const resolveVoid = (): Promise<void> => Promise.resolve();
        const stopRecognizer = vi.fn(resolveVoid);
        const onError = vi.fn();
        try {
            await expect(
                startDictation(
                    { onText: vi.fn(), onError },
                    true,
                    {
                        start: vi.fn(resolveVoid),
                        push: vi.fn(resolveVoid),
                        stop: stopRecognizer,
                    },
                ),
            ).rejects.toThrow("audio graph init failed");
            expect(stopTrack).toHaveBeenCalledTimes(1);
            expect(stopRecognizer).toHaveBeenCalledTimes(1);
            expect(onError).toHaveBeenCalledWith("audio graph init failed");
        } finally {
            Object.defineProperty(navigator, "mediaDevices", {
                configurable: true,
                value: prevMediaDevices,
            });
            (window as unknown as { AudioContext?: unknown }).AudioContext = prevAudioCtx;
        }
    });

    it("restores mid-draft caret offsets for dictation insertion and shortened mentions with long suffixes", () => {
        const inserted = insertDictatedSlice("fix now", 3, "this bug");
        expect(inserted.next).toBe("fix this bug now");
        expect(inserted.caret).toBe("fix this bug".length);

        const rawBeforeCaret =
            "@file:features/chat/ui/composer/input.tsx explain how the parser handles edge cases in detail";
        const shortenedBeforeCaret = shortenMentionTokensInText(rawBeforeCaret);
        const rawCaret = "@file:features/chat/ui/composer/input.tsx".length;
        const nextCaret = computeShortenedCaret(
            rawBeforeCaret,
            shortenedBeforeCaret,
            rawCaret,
        );
        expect(shortenedBeforeCaret.slice(nextCaret)).toBe(
            " explain how the parser handles edge cases in detail",
        );

        const rawAfterCaret = "hello @file:features/chat/ui/composer/input.tsx";
        const shortenedAfterCaret = shortenMentionTokensInText(rawAfterCaret);
        expect(computeShortenedCaret(rawAfterCaret, shortenedAfterCaret, 5)).toBe(5);
    });

    it("keeps structured XML tags inside Markdown code fences as prose instead of interactive blocks", () => {
        const chunks = parseMessageContent(
            'Example syntax:\n```xml\n<edit path="demo.ts">x</edit>\n```\n<cat path="real.ts">ok</cat>',
        );
        expect(chunks.some((chunk) => chunk.type === "edit")).toBe(false);
        expect(chunks.some((chunk) => chunk.type === "cat")).toBe(true);
    });

    it("does not append a spurious fence when a four-backtick streaming block contains a three-backtick line", () => {
        const closedQuad = "````md\n```ts\nconst num = 1;\n```\n````";
        const processed = preprocessChatMarkdown(closedQuad, { streaming: true });
        expect(processed).toBe(closedQuad);
    });

    it("does not join searchable text across an excluded inline button in syncChatDomHighlights", () => {
        const container = document.createElement("div");
        const row = document.createElement("div");
        row.setAttribute("data-chat-message-index", "0");
        const paragraph = document.createElement("p");
        paragraph.appendChild(document.createTextNode("foo"));
        const inlineBtn = document.createElement("button");
        inlineBtn.textContent = "Copy";
        paragraph.appendChild(inlineBtn);
        paragraph.appendChild(document.createTextNode("bar"));
        row.appendChild(paragraph);
        container.appendChild(row);
        document.body.appendChild(container);
        try {
            const crossButton = syncChatDomHighlights(container, "foobar");
            expect(crossButton.ranges).toHaveLength(0);

            const leftOnly = syncChatDomHighlights(container, "foo");
            expect(leftOnly.ranges).toHaveLength(1);
        } finally {
            container.remove();
        }
    });

    it("normalizes non-string provider credentials, redacts echoed error secrets, collapses dictation spaces, and breaks highlight runs on br", () => {
        const normalized = normalizeProvidersSettings({
            chatMode: "openai/gpt-5",
            services: {
                search: { provider: "brave", apiKey: "bsa-123" },
                composio: { apiKey: "", userId: "" },
            },
            connections: {
                openai: {
                    apiKey: 12345 as unknown as string,
                    baseUrl: { bad: true } as unknown as string,
                    enabled: true,
                    models: ["gpt-5"],
                    extraModels: [],
                    headers: {},
                    authStyle: "",
                },
            } as unknown as ReturnType<typeof defaultProvidersSettings>["connections"],
        });
        expect(normalized.connections.openai.apiKey).toBe("");
        expect(normalized.connections.openai.baseUrl).toBe("");
        expect(normalized.services.search.provider).toBe("brave");
        expect(describeProviderSetupGap(normalized)).toMatch(/key/iu);

        const azureKeyedMissingUrl = defaultProvidersSettings();
        azureKeyedMissingUrl.connections.azure = {
            ...azureKeyedMissingUrl.connections.azure,
            enabled: true,
            apiKey: ["az", "fixture", "key"].join("-"),
            baseUrl: "  ",
        };
        expect(describeProviderSetupGap(azureKeyedMissingUrl)).toMatch(/base URL/iu);

        const sampleBearer = ["sk", "fixture", "redaction1234"].join("-");
        const sampleTogether = ["tgp_v1", "fixturetoken1234"].join("_");
        const samplePerplexity = ["pplx", "fixturetoken1234"].join("-");
        const sampleVercel = ["vck", "fixturetoken1234"].join("_");
        const sampleQuery = ["query", "fixture", "token9876"].join("_");
        const authPrefix = ["Authorization", "Bearer"].join(": ");
        const queryKey = ["api", "key"].join("_");
        const scrubbed = redactErrorSecrets(
            `HTTP 401: invalid ${authPrefix} ${sampleBearer} ${sampleTogether} ${samplePerplexity} ${sampleVercel} on https://api.example.com/v1?${queryKey}=${sampleQuery}`,
        );
        expect(scrubbed).not.toContain(sampleBearer);
        expect(scrubbed).not.toContain(sampleTogether);
        expect(scrubbed).not.toContain(samplePerplexity);
        expect(scrubbed).not.toContain(sampleVercel);
        expect(scrubbed).not.toContain(sampleQuery);
        expect(scrubbed).toContain("[REDACTED]");

        const yamlBlock = "```yaml\nitems:\n    - nested: true\n```";
        expect(preprocessChatMarkdown(yamlBlock)).toBe(yamlBlock);

        const legitimateRepeat =
            "Step one verifies the schema.\n\nDetails follow in paragraph two.\n\nStep one verifies the output.";
        expect(repairStreamGlitches(legitimateRepeat)).toBe(legitimateRepeat);

        expect(insertDictatedSlice("fix    now", 3, "this bug").next).toBe(
            "fix this bug now",
        );
        expect(insertDictatedSlice("hello\nworld", 5, "there").next).toBe(
            "hello there\nworld",
        );

        const container = document.createElement("div");
        const row = document.createElement("div");
        row.setAttribute("data-chat-message-index", "0");
        const paragraph = document.createElement("p");
        paragraph.appendChild(document.createTextNode("foo"));
        paragraph.appendChild(document.createElement("br"));
        paragraph.appendChild(document.createTextNode("bar"));
        row.appendChild(paragraph);
        container.appendChild(row);
        document.body.appendChild(container);
        try {
            expect(syncChatDomHighlights(container, "foobar").ranges).toHaveLength(0);
            expect(syncChatDomHighlights(container, "bar").ranges).toHaveLength(1);
        } finally {
            container.remove();
        }

        const proseWithContentTag = parseMessageContent(
            "Example payload: <content>visible text</content>",
        );
        expect(proseWithContentTag).toEqual([
            { type: "text", content: "Example payload: <content>visible text</content>" },
        ]);

        const manyTools = Array.from(
            { length: 200 },
            (_, idx) => `<cat path="file-${idx}.ts">body-${idx}</cat>`,
        ).join("\nProse between tools.\n");
        const parsedMany = parseMessageContent(manyTools);
        expect(parsedMany.filter((chunk) => chunk.type === "cat")).toHaveLength(200);
    });

    it("handles quoted '>' in tool attributes, inline code spans, blockquote fences, bounded bare tool_code, Basic auth redaction, and setup gaps", () => {
        const redirChunks = parseMessageContent(
            '<terminal_command id="cmd-r1" command="echo hi > out.txt" status="pending">echo hi > out.txt\nAwaiting approval: redirection</terminal_command>',
        );
        const term = redirChunks.find((c) => c.type === "terminal_command");
        expect(term?.commandId).toBe("cmd-r1");
        expect(term?.commandStatus).toBe("pending");
        expect(term?.command).toBe("echo hi > out.txt");

        const inlineCodeProse = parseMessageContent(
            'Run `<cat path="src/main.rs">` in docs, then read the summary below.\n\nTrailing paragraph stays visible.',
        );
        expect(inlineCodeProse.some((c) => c.type === "cat")).toBe(false);
        expect(inlineCodeProse[0]?.content).toContain("Trailing paragraph stays visible.");

        const quotedFence = [
            "> ```xml",
            '> <cat path="quoted.ts">inside blockquote fence</cat>',
            "> ```",
            "",
            "Outside summary.",
        ].join("\n");
        const quotedChunks = parseMessageContent(quotedFence);
        expect(quotedChunks.some((c) => c.type === "cat")).toBe(false);
        expect(quotedChunks[0]?.content).toContain("Outside summary.");

        const bareLeakWithTail = [
            "Intro paragraph.",
            '{ "tool_code": "print(render_design_previews(concepts=[]))" }',
        ].join("\n");
        const cleanedBare = preprocessChatMarkdown(bareLeakWithTail);
        expect(cleanedBare).not.toContain("render_design_previews");
        expect(cleanedBare).toContain("Intro paragraph.");

        const benignFenceThenPrint = [
            "```json",
            '{ "example_key": "echo sample" }',
            "```",
            "",
            "In Python, call print(value) to inspect output.",
        ].join("\n");
        const keptBenign = preprocessChatMarkdown(benignFenceThenPrint);
        expect(keptBenign).toContain('{ "example_key": "echo sample" }');
        expect(keptBenign).toContain("In Python, call print(value)");

        const b64Pair = btoa(["svc", "topsecret99"].join(":"));
        const b64Short = btoa(["u", "p"].join(":"));
        const rawAuthErr = [
            `Header Authorization: Basic ${b64Pair} rejected;`,
            `echoed Basic ${b64Short} and`,
            ["https://svc:", "topsecret99", "@llm.internal/v1"].join(""),
        ].join(" ");
        const redactedAuth = redactErrorSecrets(rawAuthErr);
        expect(redactedAuth).not.toContain(b64Pair);
        expect(redactedAuth).not.toContain(b64Short);
        expect(redactedAuth).not.toContain("topsecret99");
        expect(redactErrorSecrets("401 Basic authentication failed")).toBe(
            "401 Basic authentication failed",
        );

        expect(resolveComposerSetupGap(true, 0, {})).toBe(
            "Add an API key in Settings → Providers",
        );
        const customNoUrl = defaultProvidersSettings();
        customNoUrl.connections.custom = {
            ...customNoUrl.connections.custom,
            enabled: true,
            baseUrl: "",
        };
        expect(resolveComposerSetupGap(true, 0, customNoUrl)).toBe(
            "Set a base URL and model ID in Settings → Providers",
        );
        const lmstudioNoModels = defaultProvidersSettings();
        lmstudioNoModels.connections.lmstudio = {
            ...lmstudioNoModels.connections.lmstudio,
            enabled: true,
        };
        expect(resolveComposerSetupGap(true, 0, lmstudioNoModels)).toBe(
            "Add or import a model ID in Settings → Providers",
        );
    });

    it("matches disabled keyed providers in providersForModelNames and normalizes plan step statuses", () => {
        const settings = defaultProvidersSettings();
        settings.connections.anthropic = {
            ...settings.connections.anthropic,
            apiKey: ["ant", "test", "cred"].join("-"),
            enabled: false,
        };
        expect(
            providersForModelNames(["claude-3-7-sonnet"], settings.connections),
        ).toEqual(["anthropic"]);

        const renderedPlan = mount(
            <ChatMessageItem
                role="assistant"
                content={[
                    '<plan title="Migration">',
                    '<step status="completed">Ship parser</step>',
                    '<step status="in_progress">Verify suite</step>',
                    "</plan>",
                ].join("\n")}
                timestamp={1_700_000_000_000}
            />,
        );
        expect(renderedPlan.textContent ?? "").toContain("1/2");
    });

    it("cancels pending mic permission without starting recognizer and ignores stale push rejections", async () => {
        const stopTrack = vi.fn();
        const fakeStream = {
            getTracks: () => [{ stop: stopTrack }],
        } as unknown as MediaStream;
        const prevMediaDevices = navigator.mediaDevices;
        /** Resolves an empty promise for mocked recognizer lifecycle hooks. */
        const resolveVoid = (): Promise<void> => Promise.resolve();
        let resolveMic: ((s: MediaStream) => void) | undefined;
        const pendingMic = new Promise<MediaStream>((resolve) => {
            resolveMic = resolve;
        });
        const processor: {
            connect: () => void;
            disconnect: () => void;
            onaudioprocess: ((ev: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null;
        } = {
            connect: vi.fn(),
            disconnect: vi.fn(),
            onaudioprocess: null,
        };
        const createMockAudioContext = createMockAudioContextFactory(() => processor);
        vi.stubGlobal("AudioContext", createMockAudioContext);
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: { getUserMedia: vi.fn(() => pendingMic) },
        });
        const startRecognizer = vi.fn(resolveVoid);
        const stopRecognizer = vi.fn(resolveVoid);
        const abortCtrl = new AbortController();
        try {
            const pendingStart = startDictation(
                { onText: vi.fn(), onError: vi.fn(), signal: abortCtrl.signal },
                true,
                { start: startRecognizer, push: vi.fn(resolveVoid), stop: stopRecognizer },
            );
            abortCtrl.abort();
            resolveMic?.(fakeStream);
            await expect(pendingStart).rejects.toThrow("Dictation cancelled");
            expect(stopTrack).toHaveBeenCalledTimes(1);
            expect(startRecognizer).not.toHaveBeenCalled();
            expect(stopRecognizer).not.toHaveBeenCalled();

            Object.defineProperty(navigator, "mediaDevices", {
                configurable: true,
                value: { getUserMedia: vi.fn(() => Promise.resolve(fakeStream)) },
            });
            let rejectPush: ((err: Error) => void) | undefined;
            const pendingPush = new Promise<void>((_res, rej) => {
                rejectPush = rej;
            });
            const onStaleError = vi.fn();
            const active = await startDictation(
                { onText: vi.fn(), onError: onStaleError },
                true,
                { start: vi.fn(resolveVoid), push: vi.fn(() => pendingPush), stop: stopRecognizer },
            );
            processor.onaudioprocess?.({
                inputBuffer: { getChannelData: () => new Float32Array(320).fill(0.25) },
            });
            active.commit();
            active.dispose();
            rejectPush?.(new Error("Recognizer closed"));
            await pendingPush.catch(() => undefined);
            await Promise.resolve();
            expect(onStaleError).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
            Object.defineProperty(navigator, "mediaDevices", {
                configurable: true,
                value: prevMediaDevices,
            });
        }
    });

    it("routes custom embedding extraModels, preserves inline backtick tool tags, and applies workspace-resolved edits", () => {
        const settings = defaultProvidersSettings();
        const dummyKey = ["sk", "test", "placeholder0000"].join("-");
        settings.connections.openai.enabled = true;
        settings.connections.openai.apiKey = dummyKey;
        settings.connections.custom.enabled = true;
        settings.connections.custom.baseUrl = "https://gateway.example.test/v1";
        settings.connections.custom.extraModels = ["bge-m3"];
        const configured = withFeatureModel(settings, "embeddings", "custom/bge-m3");
        expect(embeddingsTarget(configured)).toEqual({
            id: "custom",
            model: "bge-m3",
        });

        const cleaned = stripLeakedToolMarkup(
            "Keep `<tool_call>{\"name\":\"read_file\"}</tool_call>` inline, strip <tool_call>{\"name\":\"leak\"}</tool_call>.",
        );
        expect(cleaned).toContain("`<tool_call>{\"name\":\"read_file\"}</tool_call>`");
        expect(cleaned).not.toContain('"leak"');

        const editMarkup =
            '<edit_pending id="ep-1" file="src/app.ts" status="pending"><original>a</original><replacement>b</replacement></edit_pending>';
        const appliedEl = mount(
            <MessageRenderer
                content={editMarkup}
                isFileEditResolved={(file) => file === "src/app.ts"}
            />,
        );
        expect(appliedEl.querySelector("[data-pending-approval='true']")).toBeNull();
        expect(appliedEl.textContent ?? "").toContain("Edited");
    });

    it("carries split ANSI CSI/OSC escapes across PTY chunks and highlights ActionLine buttons", () => {
        let buf: TerminalStreamBuffer = { output: "", carry: "" };
        buf = appendStreamAnsiChunk(buf, "Start \u001b[", false);
        expect(buf.output).toBe("Start ");
        expect(buf.carry).toBe("\u001b[");
        buf = appendStreamAnsiChunk(buf, "31mFailed\u001b[0m\u001b]0;Title\u001b", false);
        expect(buf.output).toBe("Start Failed");
        expect(buf.carry).toBe("\u001b]0;Title\u001b");
        buf = appendStreamAnsiChunk(buf, "\\ done", true);
        expect(buf.output).toBe("Start Failed done");
        expect(buf.carry).toBe("");

        const row = mount(
            <div data-chat-message-index="0">
                <ActionLine action="Edited" detail="src/lib/router.ts" onClick={vi.fn()} />
                <button type="button">Copy</button>
            </div>,
        );
        const { ranges } = syncChatDomHighlights(row, "router.ts");
        expect(ranges).toHaveLength(1);
        expect(ranges[0]?.range.toString()).toBe("router.ts");
        expect(syncChatDomHighlights(row, "Copy").ranges).toHaveLength(0);
    });

    it("canonicalizes aliased defaultModel in Auto routing, avoids wrong highlight occurrence fallback, and keeps approved command Running", async () => {
        const settings = defaultProvidersSettings();
        const dummyKey = ["sk", "test", "placeholder0000"].join("-");
        settings.connections.openai.enabled = true;
        settings.connections.openai.apiKey = dummyKey;
        settings.connections.google.enabled = true;
        settings.connections.google.apiKey = ["goog", "test", "placeholder0000"].join("-");
        settings.chatMode = "gemini/gemini-2.5-pro";
        expect(toRustAiConfig(settings).defaultModel).toBe("google/gemini-2.5-pro");

        const singleMatchRow = mount(
            <div data-chat-message-index="0">
                <p>token appears once in visible prose</p>
            </div>,
        );
        const missingOccurrence = syncChatDomHighlights(singleMatchRow, "token", {
            targetMessageIndex: 0,
            targetOccurrenceInMessage: 2,
        });
        expect(missingOccurrence.ranges).toHaveLength(1);
        expect(missingOccurrence.activeRange).toBeNull();

        const approveSpy = vi
            .spyOn(commands, "approveTerminalCommand")
            .mockImplementation(() => Promise.resolve(""));
        try {
            const pendingBlock: Chunk = {
                type: "terminal_command",
                commandId: "cmd-approve-live",
                command: "npm test",
                commandStatus: "pending",
            };
            const el = mount(<TerminalCommandStep block={pendingBlock} />);
            const runBtn = Array.from(el.querySelectorAll("button")).find(
                (b) => b.textContent?.trim() === "Run",
            );
            if (!runBtn) throw new Error("expected Run button");
            await act(async () => {
                runBtn.click();
                await Promise.resolve();
            });
            expect(el.textContent ?? "").toContain("Running");
            expect(el.textContent ?? "").not.toContain("Ran ");
        } finally {
            approveSpy.mockRestore();
        }
    });

    it("rewinds standalone carriage-return PTY progress updates, scales dictation timeouts, and mounts interactive design previews", async () => {
        expect(
            stripAnsi(
                "Building crate\nDownloading 10%\rDownloading 45%\r\u001b[2KDownloading 100%\r\nDone\r",
            ),
        ).toBe("Building crate\nDownloading 100%\nDone");

        let buf: TerminalStreamBuffer = { output: "", carry: "" };
        buf = appendStreamAnsiChunk(buf, "Step 1\nProgress 10%\r", false);
        expect(buf.output).toBe("Step 1\nProgress 10%");
        expect(buf.carry).toBe("\r");
        buf = appendStreamAnsiChunk(buf, "\u001b[", false);
        expect(buf.carry).toBe("\r\u001b[");
        buf = appendStreamAnsiChunk(buf, "2KProgress 80%\r", false);
        expect(buf.output).toBe("Step 1\nProgress 80%");
        buf = appendStreamAnsiChunk(buf, "\nComplete", true);
        expect(buf.output).toBe("Step 1\nProgress 80%\nComplete");
        expect(buf.carry).toBe("");

        expect(computeProcessingSafetyTimeoutMs(0)).toBe(30_000);
        expect(computeProcessingSafetyTimeoutMs(300_000)).toBe(330_000);

        const selectSpy = vi
            .spyOn(commands, "selectDesignPreview")
            .mockImplementation(() => Promise.resolve());
        try {
            const galleryMarkup = [
                '<design_previews id="dp-pick-1" status="pending" selected="">',
                '<design_preview id="card-a" name="Soft Button" style="ghost" width="640" height="360" kind="html">&lt;button&gt;Soft&lt;/button&gt;</design_preview>',
                '<design_preview id="card-b" name="Solid Button" style="filled" width="640" height="360" kind="html">&lt;button&gt;Solid&lt;/button&gt;</design_preview>',
                "</design_previews>",
            ].join("\n");
            const el = mount(<MessageRenderer content={galleryMarkup} />);
            expect(el.querySelector("[data-pending-approval='true']")).not.toBeNull();
            const useBtn = el.querySelector<HTMLButtonElement>(
                "button[aria-label='Use this variant']",
            );
            expect(useBtn).not.toBeNull();
            await act(async () => {
                useBtn?.click();
                await Promise.resolve();
            });
            expect(selectSpy).toHaveBeenCalledWith(
                "dp-pick-1",
                "card-a",
                false,
                expect.any(String),
            );
        } finally {
            selectSpy.mockRestore();
        }
    });

    it("guides enabling disabled saved providers, scans repeated phrases linearly, and retains PTY output across sessionId upserts", async () => {
        const disabledSaved = defaultProvidersSettings();
        disabledSaved.connections.openai = {
            ...disabledSaved.connections.openai,
            enabled: false,
            apiKey: "saved-test-credential",
        };
        expect(describeProviderSetupGap(disabledSaved)).toBe(
            "Enable a provider in Settings -> Providers",
        );
        expect(resolveComposerSetupGap(true, 0, disabledSaved)).toBe(
            "Enable a provider in Settings → Providers",
        );

        const repeatedValid =
            "In summary, validate the config first.\n\nDetails in section two.\n\nIn summary, validate the output.";
        expect(repairStreamGlitches(repeatedValid)).toBe(repeatedValid);
        const gluedReplay =
            "Here is the detailed summary: first point andHere is the detailed summary: second point.";
        expect(repairStreamGlitches(gluedReplay)).toBe(
            "Here is the detailed summary: first point andsecond point.",
        );

        mockIPC(() => undefined, { shouldMockEvents: true });
        try {
            const initialChunk: Chunk = {
                type: "terminal_command",
                commandId: "cmd-session-upsert",
                command: "cargo test",
                commandStatus: "running",
                isGenerating: true,
            };
            const el = mount(<TerminalCommandStep block={initialChunk} />);
            await act(async () => {
                await Promise.resolve();
                await emit("agent-terminal-stream", {
                    commandId: "cmd-session-upsert",
                    kind: "data",
                    data: "first chunk line\n",
                });
            });
            expect(el.textContent ?? "").toContain("first chunk line");

            const upsertedChunk: Chunk = {
                ...initialChunk,
                sessionId: 42,
            };
            act(() => {
                root?.render(
                    <TooltipProvider>
                        <TerminalCommandStep block={upsertedChunk} />
                    </TooltipProvider>,
                );
            });
            await act(async () => {
                await emit("agent-terminal-stream", {
                    commandId: "cmd-session-upsert",
                    kind: "data",
                    data: "second chunk line\n",
                });
            });
            expect(el.textContent ?? "").toContain("first chunk line");
            expect(el.textContent ?? "").toContain("second chunk line");
        } finally {
            clearMocks();
        }
    });

    it("matches custom provider extraModels, guards modified Enter submits, caps oversized settled markdown up front, and ignores escaped backticks", () => {
        const settings = defaultProvidersSettings();
        settings.connections.custom = {
            ...settings.connections.custom,
            enabled: false,
            apiKey: "saved-custom-credential",
            baseUrl: "https://gateway.example.test/v1",
            extraModels: ["corp-gpt-4"],
        };
        expect(providersForModelNames(["corp-gpt-4"], settings.connections)).toEqual([
            "custom",
        ]);

        const baseEvent = {
            key: "Enter",
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            altKey: false,
            nativeEvent: { isComposing: false } as KeyboardEvent,
        };
        expect(isPlainEnterSubmit(baseEvent)).toBe(true);
        expect(isPlainEnterSubmit({ ...baseEvent, ctrlKey: true })).toBe(false);
        expect(isPlainEnterSubmit({ ...baseEvent, metaKey: true })).toBe(false);
        expect(isPlainEnterSubmit({ ...baseEvent, altKey: true })).toBe(false);
        expect(isPlainEnterSubmit({ ...baseEvent, shiftKey: true })).toBe(false);

        const oversized = `${"A".repeat(47_990)}\n\`\`\`ts\nconst x = 1;\n${"B".repeat(20_000)}\n\`\`\``;
        const capped = preprocessChatMarkdown(oversized, { streaming: false });
        expect(capped).toContain("... (response truncated for display)");
        expect(capped.length).toBeLessThan(48_200);

        const escapedTickChunks = parseMessageContent(
            'Escaped \\` literal before <cat path="src/main.ts">src/main.ts</cat> and `inline` after.',
        );
        expect(escapedTickChunks.some((chunk) => chunk.type === "cat")).toBe(true);
    });

    it("treats zen-go as an oc_sk_ sibling and scans unmatched multi-length backtick runs linearly", () => {
        const sampleGoKey = `${"oc_sk"}_abcdefghijkl`;
        expect(keyFormatWarning("zen", sampleGoKey)).toBeNull();
        expect(keyFormatWarning("zen-messages", sampleGoKey)).toBeNull();
        expect(keyFormatWarning("zen-go", sampleGoKey)).toBeNull();
        expect(keyFormatWarning("openai", sampleGoKey)).toContain("OpenCode Zen");

        const unmatchedLadder = Array.from({ length: 180 }, (_, idx) =>
            "`".repeat(idx + 2),
        ).join(" prose ");
        const sample = `${unmatchedLadder} \`<cat path="kept.ts">kept.ts</cat>\`\r\n\r\n\\\`\`<cat path="inner.ts">inner.ts</cat>\` <cat path="real.ts">real.ts</cat>`;
        const spans: Array<[number, number]> = [];
        appendInlineCodeSpansInRange(sample, 0, sample.length, spans);
        expect(spans).toHaveLength(2);

        const cleaned = preprocessChatMarkdown(sample, { streaming: false });
        expect(cleaned).toContain('`<cat path="kept.ts">kept.ts</cat>`');

        const parsed = parseMessageContent(sample);
        expect(parsed.filter((chunk) => chunk.type === "cat")).toHaveLength(1);
    });

    it("keeps onRetry on invalid API key errors, preserves cancelled terminal exits, splits space-only blank lines, and merges headers case-insensitively", async () => {
        const onRetry = vi.fn();
        mount(
            <ChatErrorDialog
                message="401 Incorrect API key provided by upstream gateway"
                onDismiss={vi.fn()}
                onRetry={onRetry}
            />,
        );
        const retryBtn = Array.from(document.body.querySelectorAll("button")).find(
            (btn) => btn.textContent === "Try again",
        );
        expect(retryBtn).toBeDefined();

        mount(
            <ChatErrorDialog
                message="No model provider is configured"
                onDismiss={vi.fn()}
                onRetry={onRetry}
            />,
        );
        expect(
            Array.from(document.body.querySelectorAll("button")).some(
                (btn) => btn.textContent === "Try again",
            ),
        ).toBe(false);

        const blankLineSanitized = stripLeakedToolMarkup(
            "First `unclosed\n   \nsecond` <tool_call>leaked_payload</tool_call>",
        );
        expect(blankLineSanitized).not.toContain("leaked_payload");

        const settings = defaultProvidersSettings();
        const mergedHeaders = providerHeaders("nvidia", {
            ...settings.connections.nvidia,
            headers: { "x-billing-invoke-origin": "CustomOrigin" },
        });
        expect(mergedHeaders["X-BILLING-INVOKE-ORIGIN"]).toBeUndefined();
        expect(mergedHeaders["x-billing-invoke-origin"]).toBe("CustomOrigin");

        mockIPC(() => undefined, { shouldMockEvents: true });
        try {
            const stoppedChunk: Chunk = {
                type: "terminal_command",
                commandId: "cmd-cancel-race",
                command: "sleep 60",
                commandStatus: "running",
                isGenerating: true,
            };
            const el = mount(<TerminalCommandStep block={stoppedChunk} />);
            await act(async () => {
                await Promise.resolve();
                await emit("agent-terminal-stream", {
                    commandId: "cmd-cancel-race",
                    kind: "exit",
                    exitCode: 130,
                    cancelled: true,
                });
                await emit("agent-terminal-stream", {
                    commandId: "cmd-cancel-race",
                    kind: "exit",
                    exitCode: 130,
                });
            });
            expect(el.textContent ?? "").toContain("Cancelled");
            expect(el.textContent ?? "").not.toContain("Failed");
        } finally {
            clearMocks();
        }
    });

    it("highlights project-path buttons, hydrates case-varied header secrets, caps streaming markdown, and serializes overlapping dictation restarts", async () => {
        const container = document.createElement("div");
        const row = document.createElement("div");
        row.setAttribute("data-chat-message-index", "0");
        row.innerHTML =
            '<p>Inspect <button type="button" class="text-accent-text underline">src/app.tsx</button> and <button type="button" class="chat-text">providers.ts</button></p>';
        container.appendChild(row);
        document.body.appendChild(container);
        try {
            expect(syncChatDomHighlights(container, "src/app.tsx").ranges).toHaveLength(1);
            expect(syncChatDomHighlights(container, "providers.ts").ranges).toHaveLength(1);
        } finally {
            clearChatDomHighlights();
            container.remove();
        }

        const liveSettings = defaultProvidersSettings();
        liveSettings.connections.custom.headers = { "X-Gateway-Token": "live-token-val" };
        const loadedSettings = defaultProvidersSettings();
        loadedSettings.connections.custom.headers = { "x-gateway-token": "" };
        const hydrated = mergeProviderConnections(liveSettings, loadedSettings);
        expect(hydrated.connections.custom.headers["x-gateway-token"]).toBe("live-token-val");

        const pinnedSettings = defaultProvidersSettings();
        pinnedSettings.connections.openai.apiKey = ["sk", "test", "placeholder0000"].join("-");
        pinnedSettings.connections.openai.models = ["openai/gpt-4.1-mini"];
        expect(providersForModelNames(["openai/o4-mini"], pinnedSettings.connections)).toEqual([]);
        expect(providersForModelNames(["openai/gpt-4.1-mini"], pinnedSettings.connections)).toEqual(
            ["openai"],
        );

        const dedupedReviews = dropSupersededPersonaReviews([
            { type: "persona_review", content: "anon-a" },
            { type: "persona_review", commandId: "rev-1", content: "draft" },
            { type: "persona_review", content: "anon-b" },
            { type: "persona_review", commandId: "rev-2", content: "keep-2" },
            { type: "persona_review", commandId: "rev-1", content: "final-1" },
        ]);
        expect(dedupedReviews.map((c) => c.content)).toEqual([
            "anon-a",
            "anon-b",
            "keep-2",
            "final-1",
        ]);

        const oversizedStream = `${"S".repeat(47_990)}\n\`\`\`ts\nconst n = 1;\n${"T".repeat(22_000)}`;
        const cappedStream = preprocessChatMarkdown(oversizedStream, { streaming: true });
        expect(cappedStream).toContain("... (response truncated for display)");
        expect(cappedStream.length).toBeLessThan(48_200);
        expect(preprocessChatMarkdown(`${oversizedStream}extra`, { streaming: true })).toBe(
            cappedStream,
        );

        /** Parses the first structured chunk from `raw` without non-null assertions. */
        const parseFirstChunk = (raw: string): Chunk => {
            const [first] = parseMessageContent(raw);
            if (!first) throw new Error("Expected parsed chunk");
            return first;
        };
        const multilineChunk = parseFirstChunk(
            '<terminal_command status="failed" exit="1">curl -s \\\n  https://api.example.test/health\n{"status":"degraded"}</terminal_command>',
        );
        const multilineCmdEl = mount(<TerminalCommandStep block={multilineChunk} />);
        const expandedOutputText = multilineCmdEl.querySelector(".pr-8")?.textContent ?? "";
        expect(expandedOutputText).toContain('{"status":"degraded"}');
        expect(expandedOutputText).not.toContain("https://api.example.test/health");

        const prevMediaDevices = navigator.mediaDevices;
        const fakeStream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
        vi.stubGlobal(
            "AudioContext",
            createMockAudioContextFactory(() => ({
                connect: vi.fn(),
                disconnect: vi.fn(),
                onaudioprocess: null,
            })),
        );
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: { getUserMedia: vi.fn(() => Promise.resolve(fakeStream)) },
        });
        const ipcLog: string[] = [];
        let notifyFirstStartEntered: (() => void) | undefined;
        const firstStartEntered = new Promise<void>((res) => {
            notifyFirstStartEntered = res;
        });
        let finishFirstStart: (() => void) | undefined;
        let startCalls = 0;
        const invokeBridge = {
            start: vi.fn(() => {
                startCalls += 1;
                const callNo = startCalls;
                ipcLog.push(`start:${callNo}`);
                if (callNo === 1) {
                    notifyFirstStartEntered?.();
                    return new Promise<void>((res) => {
                        finishFirstStart = res;
                    });
                }
                return Promise.resolve();
            }),
            push: vi.fn((): Promise<void> => Promise.resolve()),
            stop: vi.fn(() => {
                ipcLog.push("stop");
                return Promise.resolve();
            }),
        };
        try {
            const abortFirst = new AbortController();
            const firstAttempt = startDictation(
                { onText: vi.fn(), onError: vi.fn(), signal: abortFirst.signal },
                true,
                invokeBridge,
            );
            await firstStartEntered;
            abortFirst.abort();
            const secondAttempt = startDictation(
                { onText: vi.fn(), onError: vi.fn() },
                true,
                invokeBridge,
            );
            await Promise.resolve();
            await Promise.resolve();
            expect(ipcLog).toEqual(["start:1"]);
            finishFirstStart?.();
            await expect(firstAttempt).rejects.toThrow("Dictation cancelled");
            const secondSession = await secondAttempt;
            expect(ipcLog).toEqual(["start:1", "stop", "start:2"]);
            secondSession.dispose();
            expect(ipcLog).toEqual(["start:1", "stop", "start:2", "stop"]);
        } finally {
            vi.unstubAllGlobals();
            Object.defineProperty(navigator, "mediaDevices", {
                configurable: true,
                value: prevMediaDevices,
            });
        }
    });

    it("rolls back autoRunMode when updateTurnPolicy rejects and serializes cancelled dictation WAV pushes", async () => {
        const initialMode = getSettings().ai.autoRunMode;
        updateSettingSection("ai", { autoRunMode: "ask" });
        mockIPC((cmd) => {
            if (cmd === "update_turn_policy") throw new Error("IPC turn policy rejected");
            return undefined;
        });
        try {
            await selectAutoRunMode("always");
            expect(getSettings().ai.autoRunMode).toBe("ask");
        } finally {
            clearMocks();
            updateSettingSection("ai", { autoRunMode: initialMode });
        }

        const prevMediaDevices = navigator.mediaDevices;
        const fakeStream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
        const processor: {
            connect: () => void;
            disconnect: () => void;
            onaudioprocess: ((ev: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null;
        } = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null };
        vi.stubGlobal(
            "AudioContext",
            createMockAudioContextFactory(() => processor),
        );
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: { getUserMedia: vi.fn(() => Promise.resolve(fakeStream)) },
        });
        const ipcLog: string[] = [];
        let finishPush: ((text: string) => void) | undefined;
        let startCalls = 0;
        const invokeBridge = {
            start: vi.fn(() => {
                startCalls += 1;
                ipcLog.push(`start:${startCalls}`);
                return Promise.resolve();
            }),
            push: vi.fn(() => {
                ipcLog.push("push:1");
                return new Promise<string>((res) => {
                    finishPush = res;
                });
            }),
            stop: vi.fn(() => {
                ipcLog.push("stop");
                return Promise.resolve();
            }),
        };
        try {
            const firstText = vi.fn();
            const firstSession = await startDictation(
                { onText: firstText, onError: vi.fn() },
                true,
                invokeBridge,
            );
            processor.onaudioprocess?.({
                inputBuffer: { getChannelData: () => new Float32Array(320).fill(0.25) },
            });
            firstSession.commit();
            firstSession.dispose();
            const secondAttempt = startDictation(
                { onText: vi.fn(), onError: vi.fn() },
                true,
                invokeBridge,
            );
            await Promise.resolve();
            await Promise.resolve();
            expect(ipcLog).toEqual(["start:1", "push:1"]);
            finishPush?.("stale transcript");
            const secondSession = await secondAttempt;
            expect(firstText).not.toHaveBeenCalled();
            expect(ipcLog).toEqual(["start:1", "push:1", "stop", "stop", "start:2"]);
            secondSession.dispose();
        } finally {
            vi.unstubAllGlobals();
            Object.defineProperty(navigator, "mediaDevices", {
                configurable: true,
                value: prevMediaDevices,
            });
        }
    });

    it("preserves UTF-16 surrogate boundaries at 48k display cap, parses unclosed mcp approval tags, and routes unadvertised custom embeddings away from OpenAI", () => {
        const prefix47999 = Array.from({ length: 4800 }, (_, idx) =>
            `[${String(idx).padStart(8, "0")}]`,
        )
            .join("")
            .slice(0, 47_999);
        const straddling = `${prefix47999}🚀 trailing text`;
        const displayedStatic = preprocessChatMarkdown(straddling, {
            streaming: false,
        });
        const displayedStreaming = preprocessChatMarkdown(straddling, {
            streaming: true,
        });
        expect(displayedStatic).toContain("... (response truncated for display)");
        expect(displayedStreaming).toContain(
            "... (response truncated for display)",
        );
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(displayedStatic)).toBe(
            false,
        );
        expect(
            /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(displayedStreaming),
        ).toBe(false);
        const zwjStraddling = `${prefix47999.slice(0, 47_996)}👨‍👩‍👧‍👦 trailing text`;
        const zwjStreaming = preprocessChatMarkdown(zwjStraddling, {
            streaming: true,
        });
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(zwjStreaming)).toBe(
            false,
        );
        expect(
            zwjStreaming.startsWith(
                `${prefix47999.slice(0, 47_996)}\n\n... (response truncated for display)`,
            ),
        ).toBe(true);

        const mcpMultiline =
            '<terminal_command status="pending" id="mcp-1" mcp=">npx @mcp/fs --label "docs"\nAwaiting approval: MCP fs</terminal_command>';
        const mcpSingleLine =
            '<terminal_command status="pending" id="mcp-2" mcp=">uvx mcp-git</terminal_command>';
        const parsedMulti = parseMessageContent(mcpMultiline);
        const parsedSingle = parseMessageContent(mcpSingleLine);
        expect(parsedMulti[0]).toMatchObject({
            type: "terminal_command",
            commandId: "mcp-1",
            commandStatus: "pending",
            command: 'npx @mcp/fs --label "docs"',
        });
        expect(parsedSingle[0]).toMatchObject({
            type: "terminal_command",
            commandId: "mcp-2",
            commandStatus: "pending",
            command: "uvx mcp-git",
        });

        const base = defaultProvidersSettings();
        base.connections.openai.enabled = true;
        base.connections.openai.apiKey = ["sk", "test", "placeholder0000"].join("-");
        base.connections.custom.enabled = true;
        base.connections.custom.baseUrl = "https://embed.internal.test/v1";
        const withCustomSlug = withFeatureModel(base, "embeddings", "BAAI/bge-m3");
        expect(embeddingsTarget(withCustomSlug)).toEqual({
            id: "custom",
            model: "BAAI/bge-m3",
        });
    });
});



