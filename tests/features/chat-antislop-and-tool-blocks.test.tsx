// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { classifyMarkdownHref } from "@/lib/chat/link-safety";
import { selectPlanningPreviewSteps } from "@/lib/chat/planning-block";
import {
    CHAT_FIND_HIGHLIGHT_NAME,
    clearChatDomHighlights,
    syncChatDomHighlights,
} from "@/lib/chat/dom-highlights";
import { ChatLinkChip } from "@/features/chat/ui/md/link-chip";
import { PlanningBlock } from "@/features/chat/ui/blocks/plan";
import { QuestionsCard } from "@/features/chat/ui/blocks/questions";
import { PluginActivityCard } from "@/features/chat/ui/blocks/plugin-card";
import { WebSearchBlock } from "@/features/chat/ui/blocks/search";
import { ReviewDebatePanel } from "@/features/chat/ui/blocks/debate";
import { CodebaseAnalysis } from "@/features/chat/ui/blocks/analysis";
import { SentFileCard } from "@/features/chat/ui/blocks/sent-file";
import { detectPendingHitl } from "@/features/chat/ui/chat";
import { CHAT_EXPAND_FOR_FIND_EVENT } from "@/features/chat/ui/shell/find-bar";
import { commands } from "@/lib/backend/commands";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(node: React.ReactElement) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
        root!.render(<TooltipProvider delayDuration={0}>{node}</TooltipProvider>);
    });
    return host;
}

afterEach(() => {
    clearChatDomHighlights();
    vi.restoreAllMocks();
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

describe("Pass 6 URI scheme allowlist & ChatLinkChip security", () => {
    it("blocks dangerous or unknown schemes and preserves safe external, anchor, and workspace targets", () => {
        expect(classifyMarkdownHref("javascript:alert(1)").kind).toBe("blocked");
        expect(classifyMarkdownHref("DATA:text/html,<script>alert(1)</script>").kind).toBe("blocked");
        expect(classifyMarkdownHref("vbscript:msgbox(1)").kind).toBe("blocked");
        expect(classifyMarkdownHref("file:///etc/passwd").kind).toBe("blocked");
        expect(classifyMarkdownHref("http_evil:payload").kind).toBe("blocked");
        expect(classifyMarkdownHref("//evil.example/payload").kind).toBe("blocked");

        expect(classifyMarkdownHref("https://github.com/zed-industries/zed")).toEqual({
            kind: "external",
            href: "https://github.com/zed-industries/zed",
        });
        expect(classifyMarkdownHref("mailto:team@example.com")).toEqual({
            kind: "external",
            href: "mailto:team@example.com",
        });
        expect(classifyMarkdownHref("#architecture")).toEqual({
            kind: "anchor",
            href: "#architecture",
        });
        expect(classifyMarkdownHref("features/chat/ui/chat.tsx#L42")).toEqual({
            kind: "workspace",
            path: "features/chat/ui/chat.tsx",
        });
        expect(classifyMarkdownHref("C:\\repo\\src\\main.rs")).toEqual({
            kind: "workspace",
            path: "C:\\repo\\src\\main.rs",
        });

        const el = mount(<ChatLinkChip href="javascript:alert(1)">Click me</ChatLinkChip>);
        expect(el.querySelector("a")).toBeNull();
        expect(el.querySelector("button")).toBeNull();
        expect(el.textContent).toBe("Click me");
    });
});

describe("Pass 6 PlanningBlock sliding focus window & Find-in-Chat expansion", () => {
    it("anchors collapsed preview around the active or next pending step instead of pinning step 0", () => {
        const steps = [
            { status: "done" as const, label: "Audit CSS tokens" },
            { status: "done" as const, label: "Refactor link chip" },
            { status: "done" as const, label: "Fix HITL detector" },
            { status: "active" as const, label: "Wire multi-select questions" },
            { status: "pending" as const, label: "Run Playwright axe suite" },
            { status: "pending" as const, label: "Capture motion GIF" },
        ];

        const preview = selectPlanningPreviewSteps(steps, 2);
        expect(preview.hiddenCount).toBe(4);
        expect(preview.items.map((i) => i.step.label)).toEqual([
            "Fix HITL detector",
            "Wire multi-select questions",
        ]);

        const el = mount(
            <div data-chat-message-index={3}>
                <PlanningBlock
                    steps={steps}
                    completedCount={3}
                    totalCount={6}
                    isGenerating
                />
            </div>,
        );
        expect(el.textContent).toContain("+4 more");
        expect(el.textContent).toContain("Wire multi-select questions");
        expect(el.textContent).not.toContain("Capture motion GIF");

        // Dispatch Find-in-Chat expand event targeting hidden step text.
        act(() => {
            window.dispatchEvent(
                new CustomEvent(CHAT_EXPAND_FOR_FIND_EVENT, {
                    detail: { messageIndex: 3, query: "Capture motion GIF" },
                }),
            );
        });
        expect(el.textContent).toContain("Capture motion GIF");
    });
});

describe("Pass 6 QuestionsCard multi-select, IME composition guard, and anti-slop badge removal", () => {
    it("toggles multiple options when allowMultiple is true, omits Recommended pills, and guards IME Enter", async () => {
        const answerSpy = vi.spyOn(commands, "answerAskUser").mockResolvedValue(undefined as never);

        const el = mount(
            <QuestionsCard
                askId="ask-42"
                status="pending"
                questions={[
                    {
                        id: "scopes",
                        prompt: "Which tool blocks should we test?\nPick one or more.",
                        allowMultiple: true,
                        options: [
                            { id: "search", label: "Web search", recommended: true },
                            { id: "plugin", label: "Plugin cards", description: "Includes pending args" },
                            { id: "plan", label: "Planning checklists" },
                        ],
                    },
                ]}
            />,
        );

        // Anti-slop: never render an unsolicited "Recommended" pill.
        expect(el.textContent).not.toContain("Recommended");
        expect(el.textContent).toContain("Select all that apply");
        expect(el.textContent).toContain("Includes pending args");

        const optButtons = Array.from(el.querySelectorAll("button")).filter((b) =>
            b.textContent?.includes("Web search") || b.textContent?.includes("Plugin cards"),
        );
        expect(optButtons).toHaveLength(2);

        act(() => {
            optButtons[0]!.click();
            optButtons[1]!.click();
        });
        // Multi-select does NOT auto-submit on option click!
        expect(answerSpy).not.toHaveBeenCalled();

        const submitBtn = Array.from(el.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Submit (2)"),
        );
        expect(submitBtn).toBeTruthy();

        // IME composition Enter must be ignored.
        act(() => {
            const imeEnter = new KeyboardEvent("keydown", {
                key: "Enter",
                isComposing: true,
                bubbles: true,
                cancelable: true,
            });
            window.dispatchEvent(imeEnter);
        });
        expect(answerSpy).not.toHaveBeenCalled();

        await act(async () => {
            submitBtn!.click();
        });
        expect(answerSpy).toHaveBeenCalledWith(
            "ask-42",
            JSON.stringify({ scopes: ["search", "plugin"] }),
            false,
        );
    });
});

describe("Pass 6 PluginActivityCard pending arg inspection, WebSearchBlock fallback, ReviewDebatePanel, and DOM highlights", () => {
    it("allows inspecting JSON arguments while PluginActivityCard is pending and routes Ctrl+Enter", () => {
        const allowSpy = vi.fn();
        const rejectSpy = vi.fn();

        const el = mount(
            <PluginActivityCard
                toolkit="github"
                slug="github_create_issue"
                label="Create issue"
                body={JSON.stringify({ repo: "better-Shape/app", title: "Fix target-size" })}
                status="pending"
                pending
                onAllow={allowSpy}
                onReject={rejectSpy}
            />,
        );

        expect(el.querySelector("[data-pending-approval='true']")).toBeTruthy();
        const headerBtn = el.querySelector<HTMLButtonElement>("button[aria-expanded]");
        expect(headerBtn?.getAttribute("aria-expanded")).toBe("false");

        act(() => {
            headerBtn!.click();
        });
        expect(headerBtn?.getAttribute("aria-expanded")).toBe("true");
        expect(el.textContent).toContain("better-Shape/app");

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }),
            );
        });
        expect(allowSpy).toHaveBeenCalledTimes(1);
    });

    it("caches failed CDN brand icons in WebSearchBlock and wires ReviewDebatePanel, CodebaseAnalysis, and SentFileCard cleanly", () => {
        const el = mount(
            <div data-chat-message-index={1}>
                <WebSearchBlock
                    query="github target-size issue"
                    results={[
                        {
                            title: "Fix axe target-size",
                            url: "https://github.com/zed-industries/zed/issues/1",
                            snippet: "Ensure compact controls meet 24px minimum target size.",
                        },
                    ]}
                />
                <ReviewDebatePanel content="### Verdict\nAll security and motion checks passed cleanly across blocks." />
                <CodebaseAnalysis items={[{ type: "file", label: "features/chat/ui/chat.tsx" }]} />
                <SentFileCard name="audit-report.md" mime="text/markdown" src="blob:test" />
            </div>,
        );

        expect(el.textContent).toContain("Ensure compact controls meet 24px minimum target size.");
        const brandImg = el.querySelector<HTMLImageElement>('img[src*="cdn.simpleicons.org"]');
        if (brandImg) {
            act(() => {
                brandImg.dispatchEvent(new Event("error"));
            });
            expect(el.querySelector('img[src*="cdn.simpleicons.org"]')).toBeNull();
        }

        // SentFileCard uses single clean Download button without redundant split dropdown.
        const downloadButtons = Array.from(el.querySelectorAll("button")).filter((b) =>
            b.textContent?.includes("Download"),
        );
        expect(downloadButtons).toHaveLength(1);

        // ReviewDebatePanel expands via ActionLine on click.
        const debateBtn = Array.from(el.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Adversarial review"),
        );
        expect(debateBtn?.getAttribute("aria-expanded")).toBe("false");
        act(() => {
            debateBtn!.click();
        });
        expect(debateBtn?.getAttribute("aria-expanded")).toBe("true");
        expect(el.textContent).toContain("All security and motion checks passed");
    });

    it("skips nested spans inside <button> and [data-find-skip] and preserves foreign CSS.highlights instances", () => {
        const map = new Map<string, unknown>();
        class FakeHighlight {
            ranges: AbstractRange[];
            constructor(...ranges: AbstractRange[]) {
                this.ranges = ranges;
            }
        }
        (window as unknown as { Highlight?: unknown; CSS?: unknown }).Highlight = FakeHighlight;
        (window as unknown as { CSS?: unknown }).CSS = {
            highlights: {
                get: (k: string) => map.get(k),
                set: (k: string, v: unknown) => map.set(k, v),
                delete: (k: string) => map.delete(k),
            },
        };

        const container = document.createElement("div");
        container.innerHTML = `
            <div data-chat-message-index="0">
                <div data-find-skip><span>needle</span></div>
                <button><span>needle</span></button>
                <p>Real needle in prose.</p>
            </div>
        `;
        document.body.appendChild(container);

        const { ranges } = syncChatDomHighlights(container, "needle");
        expect(ranges).toHaveLength(1);

        // Simulate another subsystem overwriting the highlight key; clearChatDomHighlights must not clobber it!
        const foreign = new FakeHighlight();
        map.set(CHAT_FIND_HIGHLIGHT_NAME, foreign);
        clearChatDomHighlights();
        expect(map.get(CHAT_FIND_HIGHLIGHT_NAME)).toBe(foreign);

        container.remove();
    });
});

describe("Pass 6 source-level anti-slop guards", () => {
    it("keeps transitions.css, dom-highlights.ts, and chat UI free of pulsing dots, nested timeline rails, style-jsx, and raw hex colors", () => {
        const rootDir = process.cwd();
        const transitionsCss = fs.readFileSync(path.join(rootDir, "app/transitions.css"), "utf8");
        expect(transitionsCss).not.toContain("t-status-pulse");
        expect(transitionsCss).not.toContain("t-timeline-rail");

        const domHighlights = fs.readFileSync(path.join(rootDir, "lib/chat/dom-highlights.ts"), "utf8");
        expect(domHighlights).not.toContain("#ffffff");
        expect(domHighlights).toContain("var(--text-on-accent)");

        const mdDiff = fs.readFileSync(path.join(rootDir, "features/chat/ui/md/diff.tsx"), "utf8");
        expect(mdDiff).not.toContain("<style jsx>");
    });

    it("detectPendingHitl counts parallel pending approvals and clears immediately when <question> settles in-place", () => {
        const pendingTwoApprovals = [
            {
                role: "assistant",
                content:
                    '<terminal_command id="c1" status="pending">npm test</terminal_command>' +
                    '<plugin_call id="p1" toolkit="github" slug="create_issue" status="pending">{}</plugin_call>',
            },
        ];
        expect(detectPendingHitl(pendingTwoApprovals, true)).toEqual({
            kind: "approval",
            count: 2,
        });

        const pendingQuestion = [
            {
                role: "assistant",
                content:
                    '<questions id="q1" status="pending">{"questions":[{"id":"a","prompt":"Pick","options":[{"id":"1","label":"One"}]}]}</questions>',
            },
        ];
        expect(detectPendingHitl(pendingQuestion, false)).toEqual({
            kind: "question",
            count: 1,
        });

        const answeredInPlace = [
            {
                role: "assistant",
                content:
                    '<questions id="q1" status="answered">{"questions":[{"id":"a","prompt":"Pick","options":[{"id":"1","label":"One"}]}],"answers":{"a":"1"}}</questions>',
            },
        ];
        // Even with zero user reply after the assistant turn, in-place answered question clears immediately!
        expect(detectPendingHitl(answeredInPlace, false)).toBeNull();
    });
});
