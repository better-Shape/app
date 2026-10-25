import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMocks = vi.hoisted(() => ({
    aiCheckProvider: vi.fn(async () => null as unknown),
    aiTestProvider: vi.fn(async () => null as unknown),
    openUrlExternal: vi.fn(async () => undefined),
    getOpenTurnJournals: vi.fn(async () => []),
    getConversations: vi.fn(async () => []),
    listWorkspaceFiles: vi.fn(async () => []),
    listBrowserTabs: vi.fn(async () => []),
    revealPath: vi.fn(async () => undefined),
    dictationStart: vi.fn(async () => undefined),
    dictationStop: vi.fn(async () => undefined),
    dictationPush: vi.fn(async () => undefined),
}));

vi.mock("@/lib/backend", () => ({
    commands: {
        aiCheckProvider: ipcMocks.aiCheckProvider,
        aiTestProvider: ipcMocks.aiTestProvider,
        openUrlExternal: ipcMocks.openUrlExternal,
        getOpenTurnJournals: ipcMocks.getOpenTurnJournals,
        getConversations: ipcMocks.getConversations,
        listWorkspaceFiles: ipcMocks.listWorkspaceFiles,
        listBrowserTabs: ipcMocks.listBrowserTabs,
        revealPath: ipcMocks.revealPath,
        dictationStart: ipcMocks.dictationStart,
        dictationStop: ipcMocks.dictationStop,
        dictationPush: ipcMocks.dictationPush,
    },
    getProjectPath: () => null,
    useProjectState: () => ({ project_path: null }),
}));

vi.mock("@/features/agent/workspace/branch-switch", () => ({
    WorkspaceBranchSwitch: () => <button type="button">main</button>,
}));

import {
    defaultProvidersSettings,
    hasAnyConfiguredConnection,
    hasAnyUsableProvider,
    isConnectionUsable,
    modelIdsFor,
    resolveActiveDefaultModelId,
} from "@/lib/ai/providers";
import { createPreviewInvokeHandler } from "@/lib/preview/tauri-mock";
import { getSettings, updateSettingSection } from "@/lib/settings";
import { providerIcon } from "@/lib/ui/provider-icon";
import { NotificationProvider } from "@/components/ui/notification";
import { notificationStore, notify } from "@/features/notifications";
import { ProvidersSettingsView } from "@/features/settings/ui/sections/providers";
import { ChatInput } from "@/features/chat/ui/composer/input";

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

function resetProvidersSettings() {
    updateSettingSection("ai", {
        providers: defaultProvidersSettings(),
        enabledModels: ["auto"],
    });
}

describe("Pass 8: Settings -> Providers Check chat & Test connection diagnostics guards", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetProvidersSettings();
    });

    afterEach(() => {
        resetProvidersSettings();
    });

    it("surfaces a clean alert message instead of crashing when clicking Check chat with an empty API key", async () => {
        const { host, root } = mount(<ProvidersSettingsView />);
        try {
            // Filter down to NVIDIA NIM so we target the exact card from image-1
            const searchInput = host.querySelector<HTMLInputElement>(
                'input[placeholder*="Search providers"]',
            );
            expect(searchInput).toBeTruthy();
            if (searchInput) {
                await act(async () => {
                    Object.getOwnPropertyDescriptor(
                        HTMLInputElement.prototype,
                        "value",
                    )?.set?.call(searchInput, "nvidia");
                    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
                    searchInput.dispatchEvent(new Event("change", { bubbles: true }));
                });
            }

            const checkButtons = Array.from(host.querySelectorAll("button")).filter(
                (b) => b.textContent?.trim() === "Check chat",
            );
            const firstCheck = checkButtons[0];
            if (!firstCheck) throw new Error("expected Check chat button");

            await act(async () => {
                firstCheck.click();
            });

            const alert = host.querySelector('[role="alert"]');
            expect(alert).toBeTruthy();
            expect(alert?.textContent).toContain("Enter an API key");
            expect(alert?.textContent).not.toContain("Cannot read properties of null");
            // Client-side validation short-circuits before sending an empty unauthenticated probe
            expect(ipcMocks.aiCheckProvider).not.toHaveBeenCalled();
        } finally {
            unmount(root, host);
        }
    });

    it("gracefully handles null IPC report from aiCheckProvider without throwing null.ok", async () => {
        const providers = defaultProvidersSettings();
        providers.connections.openai = {
            ...providers.connections.openai,
            enabled: true,
            apiKey: "sk-test-openai-key",
        };
        updateSettingSection("ai", { providers });
        ipcMocks.aiCheckProvider.mockResolvedValueOnce(null);

        const { host, root } = mount(<ProvidersSettingsView />);
        try {
            const checkBtn = Array.from(host.querySelectorAll("button")).find(
                (b) => b.textContent?.trim() === "Check chat",
            );
            if (!checkBtn) throw new Error("expected Check chat button");

            await act(async () => {
                checkBtn.click();
            });

            const alert = host.querySelector('[role="alert"]');
            expect(alert).toBeTruthy();
            expect(alert?.textContent).toContain("Could not complete chat check");
            expect(alert?.textContent).not.toContain("Cannot read properties of null");
        } finally {
            unmount(root, host);
        }
    });

    it("models ai_check_provider and ai_test_provider in tauri-mock with structured reports", () => {
        const { handle } = createPreviewInvokeHandler("project");

        const missingKeyCheck = handle("ai_check_provider", {
            providerId: "nvidia",
            apiKey: "",
            model: "nvidia/deepseek-ai/deepseek-r1",
        }) as { ok: boolean; status: number; message: string };
        expect(missingKeyCheck.ok).toBe(false);
        expect(missingKeyCheck.status).toBe(401);
        expect(missingKeyCheck.message).toContain("Enter an API key");

        const validCheck = handle("ai_check_provider", {
            providerId: "nvidia",
            apiKey: "nvapi-live",
            model: "nvidia/deepseek-ai/deepseek-r1",
        }) as { ok: boolean; status: number; message: string };
        expect(validCheck.ok).toBe(true);
        expect(validCheck.status).toBe(200);
        expect(validCheck.message).toContain("pong");

        const missingUrlTest = handle("ai_test_provider", {
            providerId: "custom",
            baseUrl: "",
        }) as { ok: boolean; message: string };
        expect(missingUrlTest.ok).toBe(false);
        expect(missingUrlTest.message).toContain("Enter a base URL");
    });
});

describe("Pass 8: Provider usability, model routing edge cases, & brand icons", () => {
    it("distinguishes configured 0-model custom/local endpoints from routable providers", () => {
        const settings = defaultProvidersSettings();
        expect(hasAnyUsableProvider(settings)).toBe(false);
        expect(resolveActiveDefaultModelId(settings)).toBeNull();

        // Custom enabled + baseUrl, but 0 models added yet: connection is configured, NOT routable
        settings.connections.custom = {
            ...settings.connections.custom,
            enabled: true,
            baseUrl: "http://127.0.0.1:8080/v1",
        };
        expect(hasAnyConfiguredConnection(settings)).toBe(true);
        expect(hasAnyUsableProvider(settings)).toBe(false);
        expect(resolveActiveDefaultModelId(settings)).toBeNull();

        // Once a model ID is added, it becomes routable and resolves as the Auto target
        settings.connections.custom.extraModels = ["deepseek-ai/deepseek-r1"];
        expect(modelIdsFor("custom", settings.connections)).toEqual([
            "custom/deepseek-ai/deepseek-r1",
        ]);
        expect(hasAnyUsableProvider(settings)).toBe(true);
        expect(resolveActiveDefaultModelId(settings)).toBe("custom/deepseek-ai/deepseek-r1");
    });

    it("treats authStyle 'none' as usable without an API key and prefixes vendor-slashed extraModels", () => {
        const settings = defaultProvidersSettings();
        settings.connections.azure = {
            ...settings.connections.azure,
            enabled: true,
            baseUrl: "http://127.0.0.1:4000/v1",
            authStyle: "none",
            apiKey: "",
        };
        expect(isConnectionUsable("azure", settings.connections)).toBe(true);

        settings.connections.nvidia = {
            ...settings.connections.nvidia,
            enabled: true,
            apiKey: "nvapi-key",
            extraModels: ["meta/llama-3.3-70b-instruct", "nvidia/custom-slug"],
        };
        const ids = modelIdsFor("nvidia", settings.connections);
        expect(ids).toContain("nvidia/meta/llama-3.3-70b-instruct");
        expect(ids).toContain("nvidia/custom-slug");
    });

    it("renders vector brand SVG marks for newly wired providers (nvidia, groq, ollama, xai, mistral)", () => {
        const { host, root } = mount(
            <div>
                <div data-p="nvidia">{providerIcon("nvidia/deepseek-ai/deepseek-r1", 14)}</div>
                <div data-p="groq">{providerIcon("groq/llama-3.3-70b-versatile", 14)}</div>
                <div data-p="ollama">{providerIcon("ollama/llama3.3", 14)}</div>
                <div data-p="xai">{providerIcon("xai/grok-4", 14)}</div>
                <div data-p="mistral">{providerIcon("mistral/mistral-large-latest", 14)}</div>
            </div>,
        );
        try {
            for (const key of ["nvidia", "groq", "ollama", "xai", "mistral"]) {
                const slot = host.querySelector(`[data-p="${key}"]`);
                expect(slot?.querySelector("svg")).toBeTruthy();
                expect(slot?.querySelector("img")).toBeNull();
            }
        } finally {
            unmount(root, host);
        }
    });
});

describe("Pass 8: Composer Open Providers bottom-right slot, marquees, & live provider swap", () => {
    beforeEach(() => {
        resetProvidersSettings();
    });

    afterEach(() => {
        resetProvidersSettings();
    });

    it("replaces Auto + ThinkingEffortControl with marquee Open Providers until a provider is set, then shows the available provider", async () => {
        let currentModel = "auto";
        const setSelectedModel = vi.fn((next: string) => {
            currentModel = next;
        });

        const renderBox = (selectedModel = currentModel) => (
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
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                selectedWorkerModels={[]}
                setSelectedWorkerModels={() => undefined}
                selectedMode="Code"
                setSelectedMode={() => undefined}
                reasoningEffort="low"
                setReasoningEffort={() => undefined}
            />
        );

        const { host, root } = mount(renderBox("anthropic/claude-sonnet-4-5"));
        try {
            // 1. Before any provider is set:
            //    - RotatingComposerHint marquee is active in the input box
            //    - Open Providers (with animated marquee SVG) replaces Auto + Low effort on bottom-right
            const hint = host.querySelector(".t-composer-hint__text");
            expect(hint?.textContent).toContain("Add an API key in Settings → Providers to chat");

            const openProvidersBtn = host.querySelector<HTMLButtonElement>(
                'button[aria-label="Open Providers"]',
            );
            expect(openProvidersBtn).toBeTruthy();
            expect(
                openProvidersBtn?.querySelector('img[src="/logos/logo_animated.svg"]'),
            ).toBeTruthy();
            // Neither Auto nor Low effort is shown before a provider is set
            expect(
                Array.from(host.querySelectorAll("button")).some((b) =>
                    (b.textContent ?? "").includes("Auto"),
                ),
            ).toBe(false);
            expect(
                Array.from(host.querySelectorAll("button")).some(
                    (b) => b.textContent?.trim() === "Low",
                ),
            ).toBe(false);

            // 2. Configure NVIDIA NIM:
            //    - Stale `anthropic/claude-sonnet-4-5` resets to `"auto"`
            //    - `Open Providers` swaps to `Auto · NVIDIA NIM` (with NVIDIA brand SVG) + `Low` effort
            await act(async () => {
                const next = defaultProvidersSettings();
                next.connections.nvidia = {
                    ...next.connections.nvidia,
                    enabled: true,
                    apiKey: "nvapi-live-key",
                };
                updateSettingSection("ai", {
                    providers: next,
                    enabledModels: getSettings().ai.enabledModels,
                });
            });
            expect(setSelectedModel).toHaveBeenCalledWith("auto");

            act(() => {
                root.render(renderBox("auto"));
            });

            expect(host.querySelector('button[aria-label="Open Providers"]')).toBeNull();
            const modelTrigger = host.querySelector<HTMLButtonElement>(
                'button[aria-label="Auto · NVIDIA NIM"]',
            );
            expect(modelTrigger).toBeTruthy();
            expect(modelTrigger?.querySelector("svg")).toBeTruthy();
            expect(
                Array.from(host.querySelectorAll("button")).some(
                    (b) => b.textContent?.trim() === "Low",
                ),
            ).toBe(true);
            expect(host.querySelector(".t-composer-hint__text")?.textContent).toContain(
                "Ask a task",
            );
        } finally {
            unmount(root, host);
        }
    });
});

describe("Pass 8: Native DESIGN.md anti-slop toast & quote surfaces", () => {
    beforeEach(() => {
        notificationStore.clearAll();
    });

    afterEach(() => {
        notificationStore.clearAll();
    });

    it("renders opaque bg-surface-3 workbench toasts without backdrop-blur or slop icon columns", () => {
        const { host, root } = mount(
            <NotificationProvider>
                <div />
            </NotificationProvider>,
        );
        try {
            act(() => {
                notify.error("Git push rejected", "Remote contains work you do not have locally.", {
                    code: 4100,
                });
            });
            const card = document.querySelector<HTMLElement>("[data-toast-stack] [role='status']");
            expect(card).toBeTruthy();
            expect(card?.className).toContain("bg-surface-3");
            expect(card?.className).toContain("rounded-xl");
            expect(card?.className).not.toContain("backdrop-blur");
            expect(card?.textContent).toContain("Error 4100");
        } finally {
            unmount(root, host);
        }
    });
});
