import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ settings: vi.fn(), sync: vi.fn(), stop: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/settings" }));
vi.mock("@/lib/settings", () => ({ initSettings: mocks.settings }));
vi.mock("@/lib/github/store", () => ({ initGitHubAuth: vi.fn() }));
vi.mock("@/lib/ai/sync", () => ({ initAiConfigSync: mocks.sync }));
vi.mock("@/lib/mcp/registry", () => ({ syncActiveMcpServers: vi.fn() }));
vi.mock("@/features/notifications", () => ({ notify: { error: mocks.error } }));
vi.mock("@/lib/window/tauri-window", () => ({ isTauriRuntime: () => true, isMainTauriWindow: async () => false }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "settings" }) }));
vi.mock("@/lib/editor/benign-errors", () => ({ installBenignErrorFilters: vi.fn() }));
vi.mock("@/components/layout/main", () => ({ default: () => null }));
vi.mock("@/features/agent/workbench", () => ({ Titlebar: () => null }));
vi.mock("@/features/loading/context", () => ({ LoadingProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/ui/notification", () => ({ NotificationProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/core/providers/menu", () => ({ GlobalContextMenu: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/features/chat/lib/chat-stream-store", () => ({ ChatStreamProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/features/git/ui/manager/filter-context", () => ({ FilterProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/features/chat/ui/shell/checkpoint-restore-dialog", () => ({ CheckpointRestoreDialog: () => null }));
vi.mock("@/components/ui/suppress-native-tooltips", () => ({ SuppressNativeTooltips: () => null }));
vi.mock("@/features/agent/palette", () => ({ CommandPaletteBridge: () => null }));
vi.mock("@/features/chat/ui/design-capture", () => ({ DesignPreviewCaptureHost: () => null }));
vi.mock("@/components/layout/webview-reconnect", () => ({ WebviewReconnect: () => null }));
import ClientLayout from "@/app/client-layout";
let host: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => {
    vi.clearAllMocks(); mocks.settings.mockResolvedValue(undefined); mocks.sync.mockReturnValue(mocks.stop);
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root?.unmount()); host.remove(); });
async function render() { await act(async () => root?.render(<ClientLayout><div>Settings</div></ClientLayout>)); }
it("reports hydration failure without leaking rejection details or starting sync", async () => {
    mocks.settings.mockRejectedValue(new Error("private backend detail"));
    await render();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith("Could not initialize app settings", "Reload the app to try again.");
});
it("ignores a late failure after the owning layout unmounts", async () => {
    let reject!: (reason: Error) => void;
    mocks.settings.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    await render(); act(() => root?.unmount()); root = undefined;
    await act(async () => reject(new Error("late")));
    expect(mocks.error).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
});
it("unsubscribes successful synchronization when its layout unmounts", async () => {
    await render(); expect(mocks.sync).toHaveBeenCalledTimes(1);
    act(() => root?.unmount()); root = undefined;
    expect(mocks.stop).toHaveBeenCalledTimes(1);
});
