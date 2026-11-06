import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, updateSettingSection } from "@/lib/settings";

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });

import { invalidatePluginsCache } from "@/lib/plugins/api";
import { PluginsSettingsView } from "@/features/settings/ui/sections/plugins";

const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

/** Composio, with Canva connected and an action list that repeats one slug. */
const composio = () =>
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/connected_accounts")) {
            return Promise.resolve(
                json({ items: [{ id: "acc_1", status: "ACTIVE", toolkit: { slug: "canva", name: "Canva" } }] }),
            );
        }
        if (url.includes("/toolkits")) {
            return Promise.resolve(
                json({ items: [{ slug: "canva", name: "Canva", meta: { description: "Designs", categories: ["Design"] } }] }),
            );
        }
        if (url.includes("/tools")) {
            return Promise.resolve(
                json({
                    items: [
                        { slug: "CANVA_CREATE_DESIGN", name: "Create design" },
                        { slug: "CANVA_CREATE_DESIGN", name: "Create design" },
                        { slug: "CANVA_EXPORT_DESIGN", name: "Export design" },
                    ],
                }),
            );
        }
        return Promise.resolve(json({ items: [] }));
    });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    fetchMock.mockReset();
    invalidatePluginsCache();
    updateSettingSection("ai", {
        providers: {
            ...DEFAULT_SETTINGS.ai.providers,
            services: {
                ...DEFAULT_SETTINGS.ai.providers.services,
                composio: { apiKey: "composio-key", userId: "bettershape-local" },
            },
        },
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
});

describe("plugin action list", () => {
    it("keys provider actions uniquely even when Composio repeats a slug", async () => {
        composio();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        await act(async () => root.render(<PluginsSettingsView />));

        const canva = await vi.waitFor(() => {
            const button = [...host.querySelectorAll("button")].find((el) => el.textContent?.includes("Canva"));
            expect(button).toBeDefined();
            return button!;
        });
        await act(async () => canva.click());

        await vi.waitFor(() => {
            expect(host.querySelectorAll('[role="switch"]').length).toBe(3);
        });
        const duplicateKeyWarnings = consoleError.mock.calls.filter((call) =>
            call.some((part) => String(part).includes("same key")),
        );
        expect(duplicateKeyWarnings).toEqual([]);
    });
});
