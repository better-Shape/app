import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingCard, SettingRow, SettingSelect, SettingSwitch } from "@/features/settings/ui/shared/controls";
import { WelcomeScreen } from "@/app/welcome-screen";
import { PanelStateMessage, openWorkspaceFilesTab } from "@/components/ui/state-message";

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
    it("wires SettingRow title and description IDs onto SettingSwitch and SettingSelect", () => {
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
        const selectLabelId = selectTrigger.getAttribute("aria-labelledby") ?? "";
        expect(selectLabelId.length).toBeGreaterThan(0);
        expect(document.getElementById(selectLabelId)?.textContent).toBe("Word wrap");
    });
});

describe("WelcomeScreen surface polish and RecentProjects Collapse", () => {
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

describe("PanelStateMessage recovery affordance", () => {
    it("renders recovery button and dispatches workspace files tab navigation", () => {
        const events: string[] = [];
        const onTab = (event: Event) => {
            events.push(String((event as CustomEvent).detail));
        };
        window.addEventListener("bettershape-set-active-tab", onTab);
        try {
            const onRetry = vi.fn();
            render(
                <PanelStateMessage
                    title="Nothing to lint"
                    detail="Open a TypeScript or JavaScript file first."
                    actionLabel="Browse files"
                    onAction={() => {
                        onRetry();
                        openWorkspaceFilesTab();
                    }}
                />,
            );
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
