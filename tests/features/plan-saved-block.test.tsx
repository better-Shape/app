import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn(), save: vi.fn(), error: vi.fn(), loading: false }));
vi.mock("@/lib/backend", () => ({
    commands: { readFile: mocks.read, createFile: mocks.create, saveFile: mocks.save },
    useProjectState: () => ({ project_path: "/project" }),
}));
vi.mock("@/features/chat/lib/chat-stream-store", () => ({
    useChatStream: () => ({ isLoading: mocks.loading, viewedConversationId: "origin-chat" }),
    useChatStreamStatus: () => ({ isLoading: mocks.loading, viewedConversationId: "origin-chat" }),
}));
vi.mock("@/features/chat/ui/md/view", () => ({ ChatMarkdown: ({ content }: { content: string }) => <div>{content}</div> }));
vi.mock("@/features/notifications", () => ({ notify: { error: mocks.error } }));
import { PlanSavedBlock } from "@/features/chat/ui/blocks/plan";

let host: HTMLDivElement;
let root: Root;
const build = vi.fn();
beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); mocks.loading = false;
    mocks.read.mockReset().mockResolvedValue("# Saved plan\n\nImplement the feature.");
    mocks.create.mockReset().mockResolvedValue(undefined);
    mocks.save.mockReset().mockResolvedValue(undefined);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    window.addEventListener("bettershape-build-plan", build);
});
afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
    window.removeEventListener("bettershape-build-plan", build);
});
function button(): HTMLButtonElement {
    const found = [...host.querySelectorAll("button")].find(node => /Build|Plan missing/.test(node.textContent ?? ""));
    if (!found) throw new Error("Plan build button missing");
    return found;
}
async function render(markdown?: string) {
    await act(async () => root.render(<PlanSavedBlock title="Saved plan" path="plan.md" markdown={markdown} />));
}
it("builds an existing plan in its originating conversation without rewriting it", async () => {
    await render(); await act(async () => button().click());
    expect(build).toHaveBeenCalledTimes(1);
    expect((build.mock.calls[0][0] as CustomEvent).detail).toEqual({ path: "plan.md", title: "Saved plan", conversationId: "origin-chat" });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(button().getAttribute("aria-disabled")).not.toBe("true");
});
it("restores supplied markdown before dispatching Build", async () => {
    mocks.read.mockRejectedValue(new Error("missing"));
    await render("# Recovered plan"); await act(async () => button().click());
    expect(mocks.create).toHaveBeenCalledWith("/project/plan.md");
    expect(mocks.save).toHaveBeenCalledWith("/project/plan.md", "# Recovered plan");
    expect(build).toHaveBeenCalledTimes(1);
});
it("shows a disabled missing state when no recovery content exists", async () => {
    mocks.read.mockRejectedValue(new Error("missing"));
    await render(); await act(async () => button().click());
    expect(button().textContent).toBe("Plan missing");
    expect(button().getAttribute("aria-disabled")).toBe("true");
    expect(button().querySelector("kbd")).toBeNull();
    const reads = mocks.read.mock.calls.length;
    await act(async () => button().click());
    expect(mocks.read).toHaveBeenCalledTimes(reads);
    expect(build).not.toHaveBeenCalled();
});
it("prevents duplicate builds during file validation", async () => {
    await render();
    let finish!: (content: string) => void;
    mocks.read.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    act(() => button().click());
    expect(button().getAttribute("aria-disabled")).toBe("true");
    expect(button().textContent).toContain("Building…");
    act(() => button().click());
    await act(async () => finish("# Saved plan"));
    expect(build).toHaveBeenCalledTimes(1);
});
it("disables Build while the conversation is generating", async () => {
    mocks.loading = true; await render();
    expect(button().getAttribute("aria-disabled")).toBe("true");
    expect(button().textContent).toContain("Building…");
    act(() => button().click()); expect(build).not.toHaveBeenCalled();
});
it("reports a failed recovery save and permits retry without dispatching early", async () => {
    mocks.read.mockRejectedValue(new Error("missing"));
    mocks.save.mockRejectedValueOnce(new Error("permission denied"));
    await render("# Recovered plan"); await act(async () => button().click());
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(build).not.toHaveBeenCalled();
    expect(button().getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => button().click());
    expect(build).toHaveBeenCalledTimes(1);
});
