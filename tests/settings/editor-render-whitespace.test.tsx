import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));

import { EditorSettings } from "@/features/settings/ui/settings";
import { getSettings, resetSettings, updateSettingSection } from "@/lib/settings";

let host: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
    resetSettings();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root?.unmount());
    host.remove();
    resetSettings();
});

function render() {
    act(() => {
        root?.render(<EditorSettings settings={getSettings()} />);
    });
}

/** Finds the dropdown that belongs to a settings row, through its a11y wiring. */
function rowTrigger(title: string): HTMLButtonElement {
    const label = [...host.querySelectorAll("div")].find((node) => node.textContent === title);
    expect(label, `row "${title}" is missing`).toBeDefined();
    const trigger = host.querySelector<HTMLButtonElement>(
        `button[aria-haspopup="menu"][aria-labelledby*="${label!.id}"]`,
    );
    expect(trigger, `row "${title}" has no dropdown`).not.toBeNull();
    return trigger!;
}

async function pick(trigger: HTMLButtonElement, label: string) {
    await act(async () => {
        trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const menu = document.querySelector('[role="menu"]');
    expect(menu, `menu for "${label}" did not open`).not.toBeNull();
    const item = [...menu!.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"], [role="menuitem"]')].find(
        (node) => node.textContent === label,
    );
    expect(item, `option "${label}" is missing`).toBeDefined();
    await act(async () => item!.click());
}

describe("editor settings rows", () => {
    it("offers every white-space mode the editor understands", async () => {
        render();

        const trigger = rowTrigger("Render whitespace");
        // The default is shown on the closed trigger.
        expect(trigger.textContent).toContain("Selection");

        await pick(trigger, "All");
        expect(getSettings().editor.renderWhitespace).toBe("all");
    });

    it("writes the chosen white-space mode back to the store", async () => {
        updateSettingSection("editor", { renderWhitespace: "trailing" });
        render();

        const trigger = rowTrigger("Render whitespace");
        expect(trigger.textContent).toContain("Trailing");

        await pick(trigger, "None");
        expect(getSettings().editor.renderWhitespace).toBe("none");
    });
});
