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
});
