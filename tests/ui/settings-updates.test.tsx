/**
 * The About panel used to check on mount and then claim it was downloading an
 * update. This build has no downloader, so the panel reads the version only, a
 * check happens when the user asks for one, and an available version opens its
 * release page.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
    checkAppUpdate: vi.fn(),
    openUrlExternal: vi.fn(async () => undefined),
}));

vi.mock("@/lib/backend", () => ({ commands: backend }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.0.3" }));

import { DEFAULT_SETTINGS } from "@/lib/settings";
import { UpdatesSettings } from "@/features/settings/ui/sections/updates";

const RELEASE_URL = "https://github.com/better-Shape/app/releases/tag/v1.1.0";

const available = (latest = "1.1.0") => ({
    current: "1.0.3",
    latest,
    newer: true,
    published: true,
    url: RELEASE_URL,
    notes: "Fixes",
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    backend.checkAppUpdate.mockReset();
    backend.openUrlExternal.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

async function render() {
    await act(async () => {
        root.render(<UpdatesSettings settings={DEFAULT_SETTINGS} />);
    });
}

function buttonText() {
    return Array.from(container.querySelectorAll("button")).map((node) => node.textContent ?? "");
}

describe("the About panel", () => {
    it("contacts nothing until the user asks for a check", async () => {
        await render();
        expect(container.textContent).toContain("Current version is v1.0.3");
        expect(buttonText()).toContain("Check for updates");
        expect(backend.checkAppUpdate).not.toHaveBeenCalled();
    });

    it("asks for the channel the settings name when the button is pressed", async () => {
        backend.checkAppUpdate.mockResolvedValue({ ...available("1.0.3"), newer: false });
        await render();

        await act(async () => {
            container
                .querySelectorAll("button")
                .forEach((node) => {
                    if (node.textContent === "Check for updates") node.click();
                });
        });

        expect(backend.checkAppUpdate).toHaveBeenCalledTimes(1);
        expect(backend.checkAppUpdate).toHaveBeenCalledWith("stable");
        expect(container.textContent).toContain("You're on the latest version.");
        // Nothing to fetch, so no second button appears.
        expect(buttonText()).not.toContainEqual(expect.stringContaining("Get "));
    });

    it("offers the release page for a version it found, and opens it on a press", async () => {
        backend.checkAppUpdate.mockResolvedValue(available());
        await render();

        await act(async () => {
            container
                .querySelectorAll("button")
                .forEach((node) => {
                    if (node.textContent === "Check for updates") node.click();
                });
        });

        expect(container.textContent).toContain("1.1.0 is available");
        expect(buttonText()).toContain("Get 1.1.0");

        await act(async () => {
            container
                .querySelectorAll("button")
                .forEach((node) => {
                    if (node.textContent === "Get 1.1.0") node.click();
                });
        });

        expect(backend.openUrlExternal).toHaveBeenCalledWith(RELEASE_URL);
        // No download, no install, no restart: the panel never says otherwise.
        expect(container.textContent?.toLowerCase()).not.toContain("restart");
        expect(container.textContent?.toLowerCase()).not.toContain("downloading");
    });

    it("says the channel has nothing to offer instead of failing", async () => {
        backend.checkAppUpdate.mockResolvedValue({
            current: "1.0.3",
            latest: "",
            newer: false,
            published: false,
            url: "https://github.com/better-Shape/app/releases",
            notes: "",
        });
        await render();

        await act(async () => {
            container
                .querySelectorAll("button")
                .forEach((node) => {
                    if (node.textContent === "Check for updates") node.click();
                });
        });

        expect(container.textContent).toContain("Nothing has been published on this channel yet.");
    });
});
