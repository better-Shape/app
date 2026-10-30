import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingCard, SettingRow, SettingSelect, SettingSwitch } from "@/features/settings/ui/shared/controls";
import { AiSettingsPanel } from "@/features/settings/ui/sections/ai";
import { WelcomeScreen, parentDir } from "@/app/welcome-screen";
import { PanelStateMessage, openWorkspaceFilesTab } from "@/components/ui/state-message";
import { getSettings, updateSettingSection } from "@/lib/settings";
import { defaultProvidersSettings } from "@/lib/ai/providers";

vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn(async () => () => {}),
}));

vi.mock("@/lib/catalog/store", () => ({
    useBetterShapeCatalog: () => undefined,
    getCatalogDefaultEnabledIds: () => [],
    getCatalogModels: () => [
        {
            id: "auto",
            name: "Auto",
            description: "Automatic routing",
            provider: "Auto",
            inputCost: 0,
            cachedInputCost: 0,
            outputCost: 0,
            contextWindow: "200K",
            releaseDate: "Rolling",
        },
        {
            id: "openai/gpt-4o",
            name: "GPT-4o",
            description: "OpenAI flagship",
            provider: "OpenAI",
            inputCost: 0,
            cachedInputCost: 0,
            outputCost: 0,
            contextWindow: "128K",
            releaseDate: "Rolling",
        },
        {
            id: "anthropic/claude-sonnet-4.6",
            name: "Claude Sonnet 4.6",
            description: "Anthropic balanced",
            provider: "Anthropic",
            inputCost: 0,
            cachedInputCost: 0,
            outputCost: 0,
            contextWindow: "200K",
            releaseDate: "Rolling",
        },
    ],
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function render(node: React.ReactElement) {
    act(() => root.render(<TooltipProvider>{node}</TooltipProvider>));
}

const findButton = (text: string): HTMLButtonElement => {
    const match = Array.from(container.querySelectorAll("button")).find((btn) =>
        btn.textContent?.includes(text),
    );
    if (!match) throw new Error(`Expected button containing "${text}"`);
    return match;
};

describe("Settings row accessible labelling", () => {
    it("wires SettingRow title, description, and selected value IDs onto SettingSwitch and SettingSelect", () => {
        render(
            <SettingCard>
                <SettingRow title="Minimap" description="Show a miniature overview beside the editor.">
                    <SettingSwitch checked onChange={() => {}} />
                </SettingRow>
                <SettingRow title="Word wrap">
                    <SettingSelect
                        value="on"
                        options={[
                            { value: "off", label: "Off" },
                            { value: "on", label: "On" },
                        ]}
                        onChange={() => {}}
                    />
                </SettingRow>
            </SettingCard>,
        );

        const switchEl = container.querySelector('button[role="switch"]');
        if (!(switchEl instanceof HTMLButtonElement)) {
            throw new Error("Expected switch button");
        }
        const labelledBy = switchEl.getAttribute("aria-labelledby") ?? "";
        const describedBy = switchEl.getAttribute("aria-describedby") ?? "";
        expect(labelledBy.length).toBeGreaterThan(0);
        expect(describedBy.length).toBeGreaterThan(0);
        expect(document.getElementById(labelledBy)?.textContent).toBe("Minimap");
        expect(document.getElementById(describedBy)?.textContent).toBe(
            "Show a miniature overview beside the editor.",
        );

        const selectTrigger = findButton("On");
        const selectLabelIds = (selectTrigger.getAttribute("aria-labelledby") ?? "")
            .split(/\s+/)
            .filter(Boolean);
        expect(selectLabelIds).toHaveLength(2);
        const announced = selectLabelIds
            .map((id) => document.getElementById(id)?.textContent)
            .join(" ");
        expect(announced).toBe("Word wrap On");
    });

    it("locks the last enabled concrete model so disabling models cannot reset all models back on", () => {
        updateSettingSection("ai", {
            providers: defaultProvidersSettings(),
            enabledModels: [],
        });

        const rerenderModels = () => {
            render(<AiSettingsPanel settings={getSettings()} page="models" />);
        };
        rerenderModels();

        const getModelSwitch = (label: string) => {
            const match = container.querySelector(`button[role="switch"][aria-label="${label}"]`);
            if (!(match instanceof HTMLButtonElement)) {
                throw new Error(`Missing switch for ${label}`);
            }
            return match;
        };

        // Auto is always active and locked on.
        expect(getModelSwitch("Auto").disabled).toBe(true);
        expect(getModelSwitch("GPT-4o").disabled).toBe(false);
        expect(getModelSwitch("Claude Sonnet 4.6").disabled).toBe(false);

        // Turn off Claude Sonnet 4.6 -> GPT-4o becomes the sole enabled concrete model.
        act(() => {
            getModelSwitch("Claude Sonnet 4.6").click();
        });
        rerenderModels();

        expect(getSettings().ai.enabledModels).toEqual(["auto", "openai/gpt-4o"]);
        expect(getModelSwitch("Claude Sonnet 4.6").getAttribute("aria-checked")).toBe("false");
        expect(getModelSwitch("GPT-4o").getAttribute("aria-checked")).toBe("true");
        expect(getModelSwitch("GPT-4o").disabled).toBe(true);
    });
});

describe("WelcomeScreen surface polish, parentDir formatting, and RecentProjects Collapse", () => {
    it("formats Windows drive roots, UNC share roots, and POSIX roots accurately in parentDir", () => {
        expect(parentDir("C:\\repo")).toBe("C:\\");
        expect(parentDir("C:/repo")).toBe("C:/");
        expect(parentDir("C:\\Users\\ada\\repo\\")).toBe("C:\\Users\\ada");
        expect(parentDir("\\\\server\\share")).toBe("\\\\server\\share");
        expect(parentDir("\\\\server\\share\\")).toBe("\\\\server\\share");
        expect(parentDir("\\\\server\\share\\repo")).toBe("\\\\server\\share");
        expect(parentDir("/repo")).toBe("/");
        expect(parentDir("/Users/ada/repo/")).toBe("/Users/ada");
    });

    it("uses +1 surface step hover without light-fill inversion and reveals overflow projects via Collapse", () => {
        const folders = Array.from({ length: 7 }, (_, idx) => ({
            path: `/Users/dev/work/project-${idx + 1}`,
            lastOpenedAt: 1700000000000 - idx * 1000,
        }));

        render(
            <WelcomeScreen
                recentFolders={folders}
                onOpenProject={() => {}}
                onPickFolder={() => {}}
                onClone={() => {}}
                onSsh={() => {}}
                onConnectGitHub={() => {}}
            />,
        );

        const openProjectTile = findButton("Open project");
        expect(openProjectTile.className).toContain("hover:bg-surface-4");
        expect(openProjectTile.className).not.toContain("hover:bg-text-primary");

        const viewAllBtn = findButton("View all (7)");
        expect(viewAllBtn.getAttribute("aria-expanded")).toBe("false");
        const controlsId = viewAllBtn.getAttribute("aria-controls") ?? "";
        const collapseEl = document.getElementById(controlsId);
        if (!collapseEl) throw new Error("Expected Collapse element");
        expect(collapseEl.className).toContain("grid-rows-[0fr]");

        act(() => {
            viewAllBtn.click();
        });
        expect(viewAllBtn.getAttribute("aria-expanded")).toBe("true");
        expect(collapseEl.className).toContain("grid-rows-[1fr]");
    });
});

describe("PanelStateMessage recovery affordance and error semantics", () => {
    it("renders recovery button, dispatches workspace files tab navigation, and exposes alert role on errors", () => {
        const events: string[] = [];
        const onTab = (event: Event) => {
            events.push(String((event as CustomEvent).detail));
        };
        window.addEventListener("bettershape-set-active-tab", onTab);
        try {
            const onRetry = vi.fn();
            render(
                <PanelStateMessage
                    title="ESLint did not run"
                    detail="Configuration failed to load."
                    tone="error"
                    actionLabel="Browse files"
                    onAction={() => {
                        onRetry();
                        openWorkspaceFilesTab();
                    }}
                />,
            );
            expect(container.querySelector('[role="alert"]')).not.toBeNull();
            expect(container.querySelector("svg")).not.toBeNull();

            const btn = findButton("Browse files");
            act(() => {
                btn.click();
            });
            expect(onRetry).toHaveBeenCalledTimes(1);
            expect(events).toEqual(["files"]);
        } finally {
            window.removeEventListener("bettershape-set-active-tab", onTab);
        }
    });
});
