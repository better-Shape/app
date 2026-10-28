import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    usable: true,
    settings: { ai: { providers: {}, enabledModels: [], workflows: [] } },
}));
vi.mock("@/lib/settings", () => ({ useSettings: () => state.settings }));
vi.mock("@/lib/ai/providers", () => ({ hasAnyUsableProvider: () => state.usable }));
vi.mock("@/lib/catalog/store", () => ({
    useBetterShapeCatalog: () => ({ catalog: null }),
    getCatalogModels: () => [],
    getCatalogProviderOrder: () => [],
    getCatalogDefaultEnabledIds: () => [],
}));
vi.mock("@/lib/settings/models", () => ({
    resolveChatModels: () => [],
    getVisibleModels: () => [],
    sanitizeEnabledModels: () => [],
}));
vi.mock("@/lib/plugins/api", () => ({
    peekPluginsCache: () => ({ plugins: [] }),
    fetchPlugins: async () => ({ plugins: [] }),
}));
vi.mock("@/lib/chat/skills", () => ({ listSkills: () => [], subscribeSkills: () => () => {} }));
vi.mock("@/lib/chat/workflows", () => ({ slashCommandRanges: () => [] }));
vi.mock("@/features/chat/ui/composer/mentions", () => ({ MentionPicker: () => null }));
vi.mock("@/features/chat/ui/composer/edits", () => ({ PendingEditsPanel: () => null }));
vi.mock("@/features/chat/ui/composer/activity", () => ({ ComposerTasksStrip: () => null }));
vi.mock("@/features/chat/ui/composer/queue", () => ({ QueuedMessagesPanel: () => null }));
vi.mock("@/features/chat/ui/composer/attachments", () => ({
    ComposerAttachments: () => null,
    isImageFile: () => false,
    isAudioFile: () => false,
}));
vi.mock("@/features/chat/ui/composer/dictation-button", () => ({ DictationButton: () => null }));
vi.mock("@/features/chat/ui/composer/thinking-bar", () => ({ ThinkingEffortControl: () => null }));
vi.mock("@/features/chat/ui/blocks/lightbox", () => ({ MediaLightbox: () => null }));
vi.mock("@/features/agent/workspace/branch-switch", () => ({ WorkspaceBranchSwitch: () => null }));

import { ChatInput } from "@/features/chat/ui/composer/input";
import {
    isAllowedFile,
    isCodeFile,
    observeComposerGeometry,
} from "@/features/chat/ui/composer/input-helpers";
import { stripAssistantResponse } from "@/features/editor/ui/main/lib/use-text-rewrite";

type Props = ComponentProps<typeof ChatInput>;
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            disconnect() {}
            unobserve() {}
        },
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
});

async function renderComposer(patch: Partial<Props> = {}) {
    const props: Props = {
        inputValue: "",
        isLoading: false,
        uploadedFiles: [],
        onInputChange: () => {},
        onKeyDown: () => {},
        onSendMessage: () => {},
        onStopMessage: () => {},
        setUploadedFiles: () => {},
        addUploadedFiles: () => {},
        selectedModel: "auto",
        setSelectedModel: () => {},
        selectedMode: "Code",
        setSelectedMode: () => {},
        reasoningEffort: "low",
        setReasoningEffort: () => {},
        ...patch,
    };
    await act(async () => root.render(<ChatInput {...props} />));
}

describe("ChatInput overflow, sheet expansion, hints & quoted excerpts", () => {
    it("keeps the exact same textarea DOM node across compact 1-line and multi-line expanded morphs, with a spacious sheet floor", async () => {
        await renderComposer({ inputValue: "short" });
        const box = host.querySelector("[data-expanded-layout]");
        const initialTextarea = host.querySelector("textarea");
        if (!box || !initialTextarea) throw new Error("expected composer box and textarea");
        const editorFrame = initialTextarea.closest("div[style]") as HTMLDivElement;
        expect(box.getAttribute("data-expanded-layout")).toBe("false");
        expect(editorFrame.style.height).toBe("32px");

        const multiLineText = Array.from({ length: 8 }, (_, i) => `Line ${i + 1}: refactor composer`).join("\n");
        await renderComposer({ inputValue: multiLineText });

        const afterTextarea = host.querySelector("textarea");
        expect(afterTextarea).toBe(initialTextarea);
        expect(box.getAttribute("data-expanded-layout")).toBe("true");

        const expandBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Expand composer"]');
        if (!expandBtn) throw new Error("expected Expand composer button");
        expect(box.getAttribute("data-expanded-sheet")).toBe("false");

        await act(async () => {
            expandBtn.click();
        });
        expect(box.getAttribute("data-expanded-sheet")).toBe("true");
        expect(parseInt(editorFrame.style.height, 10)).toBeGreaterThanOrEqual(290);
        expect(host.querySelector('button[aria-label="Collapse composer"]')).not.toBeNull();

        // Resets expanded sheet automatically when input clears after send
        await renderComposer({ inputValue: "" });
        expect(box.getAttribute("data-expanded-sheet")).toBe("false");
        expect(box.getAttribute("data-expanded-layout")).toBe("false");
    });

    it("switches RotatingComposerHint copy across idle, active streaming, and preparing states", async () => {
        await renderComposer({ inputValue: "", isLoading: false, isPreparing: false });
        const hintEl = () => host.querySelector(".t-composer-hint__text");
        expect(hintEl()?.textContent).toContain("Ask a task");

        await renderComposer({ inputValue: "", isLoading: true, isPreparing: false });
        expect(hintEl()?.textContent).toContain("Queue a follow-up");

        await renderComposer({ inputValue: "", isLoading: false, isPreparing: true });
        expect(hintEl()?.textContent).toContain("Preparing context");
    });

    it("renders stacked quoted excerpts, enables sending, and removes individual quotes cleanly", async () => {
        const removed: string[] = [];
        await renderComposer({
            inputValue: "",
            quotedExcerpts: [
                { id: "q1", text: "First quoted passage from the assistant response" },
                { id: "q2", text: "Second quoted passage" },
            ],
            onRemoveQuote: (id) => removed.push(id),
        });

        const quoteTray = host.querySelector("[data-composer-quotes]");
        expect(quoteTray).not.toBeNull();
        expect(quoteTray?.textContent).toContain("First quoted passage");
        expect(quoteTray?.textContent).toContain("Second quoted passage");

        const sendBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
        expect(sendBtn?.disabled).toBe(false);

        const removeFirst = host.querySelector<HTMLButtonElement>('button[aria-label="Remove quote 1"]');
        if (!removeFirst) throw new Error("expected Remove quote 1 button");
        await act(async () => {
            removeFirst.click();
        });
        expect(removed).toEqual(["q1"]);
    });

    it("measures scrollHeight for wrapped wide-ASCII strings like repeated Ws instead of clamping to single-line height", async () => {
        await renderComposer({ inputValue: "seed" });
        const textarea = host.querySelector("textarea");
        const box = host.querySelector("[data-expanded-layout]");
        if (!textarea || !box) throw new Error("expected textarea and composer box");

        Object.defineProperty(textarea, "clientWidth", { configurable: true, get: () => 300 });
        Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => 52 });

        await renderComposer({ inputValue: "W".repeat(26) });
        expect(box.getAttribute("data-expanded-layout")).toBe("true");
        expect(parseInt(textarea.style.height, 10)).toBe(52);
    });

    it("accepts extensionless Dockerfile and Makefile attachments and strips c++/c# rewrite fences", () => {
        const dockerfile = new File(["FROM node:22-alpine"], "Dockerfile", { type: "" });
        const makefile = new File(["all:\n\techo ok"], "Makefile", { type: "" });
        expect(isCodeFile(dockerfile)).toBe(true);
        expect(isAllowedFile(dockerfile)).toBe(true);
        expect(isCodeFile(makefile)).toBe(true);
        expect(isAllowedFile(makefile)).toBe(true);

        expect(stripAssistantResponse("```c++\nint main() { return 0; }\n```")).toBe(
            "int main() { return 0; }",
        );
        expect(stripAssistantResponse("```c#\nConsole.WriteLine(1);\n```")).toBe(
            "Console.WriteLine(1);",
        );
        expect(stripAssistantResponse("```first line of prose\nsecond line```")).toBe(
            "first line of prose\nsecond line",
        );
    });

    it("updates all observed geometry refs when a single ResizeObserver batch delivers multiple changed entries", () => {
        let capturedCallback: ResizeObserverCallback | null = null;
        const MockResizeObserver = function (
            this: ResizeObserver,
            cb: ResizeObserverCallback,
        ) {
            capturedCallback = cb;
            this.observe = vi.fn();
            this.disconnect = vi.fn();
            this.unobserve = vi.fn();
        };
        vi.stubGlobal("ResizeObserver", MockResizeObserver);

        const stage = document.createElement("div");
        stage.setAttribute("data-chat-stage", "");
        const box = document.createElement("div");
        const textarea = document.createElement("textarea");
        stage.append(box);
        box.append(textarea);

        let stageH = 600;
        let boxW = 700;
        let taW = 660;
        Object.defineProperty(stage, "clientHeight", { configurable: true, get: () => stageH });
        Object.defineProperty(box, "clientWidth", { configurable: true, get: () => boxW });
        Object.defineProperty(textarea, "clientWidth", { configurable: true, get: () => taW });

        const refs = {
            stageHeightRef: { current: 0 },
            composerBoxWidthRef: { current: 0 },
            textareaClientWidthRef: { current: 0 },
        };
        const onGeometryChanged = vi.fn();
        const cleanup = observeComposerGeometry(box, textarea, refs, onGeometryChanged);
        expect(refs.stageHeightRef.current).toBe(600);
        expect(refs.composerBoxWidthRef.current).toBe(700);
        expect(refs.textareaClientWidthRef.current).toBe(660);

        stageH = 500;
        boxW = 480;
        taW = 440;
        const fire = capturedCallback as ResizeObserverCallback | null;
        if (!fire) throw new Error("expected ResizeObserver callback");
        fire(
            [
                {
                    target: stage,
                    contentRect: { height: 500, width: 700 },
                } as unknown as ResizeObserverEntry,
                {
                    target: box,
                    contentRect: { height: 60, width: 480 },
                } as unknown as ResizeObserverEntry,
                {
                    target: textarea,
                    contentRect: { height: 22, width: 440 },
                } as unknown as ResizeObserverEntry,
            ],
            {} as ResizeObserver,
        );

        expect(refs.stageHeightRef.current).toBe(500);
        expect(refs.composerBoxWidthRef.current).toBe(480);
        expect(refs.textareaClientWidthRef.current).toBe(440);
        expect(onGeometryChanged).toHaveBeenCalledTimes(1);
        cleanup?.();
    });
});
