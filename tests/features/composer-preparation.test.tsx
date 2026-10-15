import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ usable: true, stop: vi.fn(), send: vi.fn(), settings: { ai: { providers: {}, enabledModels: [], workflows: [] } } }));
vi.mock("@/lib/settings", () => ({ useSettings: () => state.settings }));
vi.mock("@/lib/ai/providers", () => ({ hasAnyUsableProvider: () => state.usable }));
vi.mock("@/lib/catalog/store", () => ({ useBetterShapeCatalog: () => ({ catalog: null }), getCatalogModels: () => [], getCatalogProviderOrder: () => [], getCatalogDefaultEnabledIds: () => [] }));
vi.mock("@/lib/settings/models", () => ({ resolveChatModels: () => [], getVisibleModels: () => [], sanitizeEnabledModels: () => [], isApiModel: () => false }));
vi.mock("@/lib/plugins/api", () => ({ peekPluginsCache: () => ({ plugins: [] }), fetchPlugins: async () => ({ plugins: [] }) }));
vi.mock("@/lib/chat/skills", () => ({ listSkills: () => [], subscribeSkills: () => () => {} }));
vi.mock("@/lib/chat/workflows", () => ({ slashCommandRanges: () => [] }));
vi.mock("@/features/chat/ui/composer/mentions", () => ({ MentionPicker: () => null }));
vi.mock("@/features/chat/ui/composer/edits", () => ({ PendingEditsPanel: () => null }));
vi.mock("@/features/chat/ui/composer/activity", () => ({ ComposerTasksStrip: () => null }));
vi.mock("@/features/chat/ui/composer/queue", () => ({ QueuedMessagesPanel: () => null }));
vi.mock("@/features/chat/ui/composer/attachments", () => ({ ComposerAttachments: () => null, isImageFile: () => false, isAudioFile: () => false }));
vi.mock("@/features/chat/ui/composer/dictation-button", () => ({ DictationButton: () => null }));
vi.mock("@/features/chat/ui/composer/thinking-bar", () => ({ ThinkingEffortControl: () => null }));
vi.mock("@/features/chat/ui/blocks/lightbox", () => ({ MediaLightbox: () => null }));
vi.mock("@/features/agent/workspace/branch-switch", () => ({ WorkspaceBranchSwitch: () => null }));

import { ChatInput } from "@/features/chat/ui/composer/input";
type Props = ComponentProps<typeof ChatInput>;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
    state.usable = true; state.stop.mockReset(); state.send.mockReset();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(patch: Partial<Props> = {}) {
    const props: Props = {
        inputValue: "", isLoading: false, uploadedFiles: [], onInputChange: () => {}, onKeyDown: () => {},
        onSendMessage: state.send, onStopMessage: state.stop, setUploadedFiles: () => {}, addUploadedFiles: () => {},
        selectedModel: "auto", setSelectedModel: () => {}, selectedMode: "agent", setSelectedMode: () => {},
        reasoningEffort: "low", setReasoningEffort: () => {}, ...patch,
    };
    await act(async () => root.render(<ChatInput {...props} />));
}
function escape(init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init });
    host.querySelector("textarea")!.dispatchEvent(event);
    return event;
}

it.each(["preparing", "expanding", "generating"])("keeps %s cancellable despite processing files and unavailable providers", async stage => {
    state.usable = false;
    await render({
        isPreparing: stage !== "generating", isLoading: stage !== "preparing", inputValue: stage !== "generating" ? "keep this draft" : "",
        uploadedFiles: [{ id: "one", name: "image.png", file: new File(["image"], "image.png"), kind: "image", mimeType: "image/png", size: 5, status: "processing" }],
    });
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Stop"]');
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(false);
    await act(async () => button!.click());
    expect(state.stop).toHaveBeenCalledOnce();
    expect(state.send).not.toHaveBeenCalled();
});
it("exposes preparation to screen readers and permits Escape before a turn is loading", async () => {
    await render({ isPreparing: true, inputValue: "keep this draft" });
    expect(host.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Preparing message");
    await act(async () => { expect(escape().defaultPrevented).toBe(true); });
    expect(state.stop).toHaveBeenCalledOnce();
});
it("preserves the native-turn queue action for a new nonempty draft", async () => {
    await render({ isLoading: true, inputValue: "next message" });
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Queue message"]')!.click());
    expect(state.send).toHaveBeenCalledOnce();
    expect(state.stop).not.toHaveBeenCalled();
});
it.each([{ isComposing: true }, { keyCode: 229 }])("does not cancel a turn for composition Escape %j", async init => {
    await render({ isLoading: true });
    await act(async () => { escape(init); });
    expect(state.stop).not.toHaveBeenCalled();
});
it("does not take an Escape already consumed by another handler", async () => {
    await render({ isLoading: true });
    const input = host.querySelector("textarea")!;
    input.addEventListener("keydown", event => event.preventDefault(), { once: true });
    await act(async () => { escape(); });
    expect(state.stop).not.toHaveBeenCalled();
});
it("does not take Escape from another textbox", async () => {
    await render({ isPreparing: true });
    const input = document.createElement("input"); host.append(input);
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(state.stop).not.toHaveBeenCalled();
});

it("removes preparation's Escape handler when preparation ends", async () => {
    await render({ isPreparing: true });
    await render({ isPreparing: false });
    await act(async () => { escape(); });
    expect(state.stop).not.toHaveBeenCalled();
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
    expect(button?.disabled).toBe(true);
});
