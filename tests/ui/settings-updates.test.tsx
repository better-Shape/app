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

/** The bundle's answer. `null` makes the lookup fail, as a broken webview would. */
const bundle = vi.hoisted(() => ({ version: "1.0.3" as string | null }));

vi.mock("@/lib/backend", () => ({ commands: backend }));
vi.mock("@tauri-apps/api/app", () => ({
    getVersion: async () => {
        if (bundle.version === null) throw new Error("no bundle version");
        return bundle.version;
    },
}));

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
    bundle.version = "1.0.3";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const render = async () => {
    await act(async () => {
        root.render(<UpdatesSettings settings={DEFAULT_SETTINGS} />);
    });
};

const buttonText = () =>
    Array.from(container.querySelectorAll("button")).map((node) => node.textContent ?? "");

/** Clicks the one button whose text is `label`, inside act(). */
const press = async (label: string) => {
    await act(async () => {
        container.querySelectorAll("button").forEach((node) => {
            if (node.textContent === label) node.click();
        });
    });
};

describe("the About panel", () => {
    it("contacts nothing until the user asks for a check", async () => {
        await render();
        expect(container.textContent).toContain("Current version is v1.0.3");
        expect(buttonText()).toContain("Check for updates");
        expect(backend.checkAppUpdate).not.toHaveBeenCalled();
    });

    it("shows no version when the bundle cannot answer", async () => {
        // A placeholder here read as a real version next to a real update result.
        bundle.version = null;
        await render();
        expect(container.textContent).not.toContain("Current version is v");
        expect(buttonText()).toContain("Check for updates");
    });

    it("asks for the channel the settings name when the button is pressed", async () => {
        backend.checkAppUpdate.mockResolvedValue({ ...available("1.0.3"), newer: false });
        await render();

        await press("Check for updates");

        expect(backend.checkAppUpdate).toHaveBeenCalledTimes(1);
        expect(backend.checkAppUpdate).toHaveBeenCalledWith("stable");
        expect(container.textContent).toContain("You're on the latest version.");
        // Nothing to fetch, so no second button appears.
        expect(buttonText()).not.toContainEqual(expect.stringContaining("Get "));
    });

    it("offers the release page for a version it found, and opens it on a press", async () => {
        backend.checkAppUpdate.mockResolvedValue(available());
        await render();

        await press("Check for updates");

        expect(container.textContent).toContain("1.1.0 is available");
        expect(buttonText()).toContain("Get 1.1.0");

        await press("Get 1.1.0");

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

        await press("Check for updates");

        expect(container.textContent).toContain("Nothing has been published on this channel yet.");
    });
});
