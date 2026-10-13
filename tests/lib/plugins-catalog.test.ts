import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, updateSettingSection } from "@/lib/settings";

const fetchMock = vi.hoisted(() => vi.fn());

vi.stubGlobal("fetch", fetchMock);

import {
    fetchPlugins,
    invalidatePluginsCache,
    peekPluginsCache,
    subscribePlugins,
} from "@/lib/plugins/api";

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

/** Composio answers two things for a catalog load: accounts and toolkits. */
function composio(connected: boolean) {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/connected_accounts")) {
            return Promise.resolve(
                jsonResponse({
                    items: connected
                        ? [{ id: "acc_1", status: "ACTIVE", toolkit: { slug: "canva", name: "Canva" } }]
                        : [],
                }),
            );
        }
        if (url.includes("/toolkits")) {
            return Promise.resolve(
                jsonResponse({
                    items: [
                        {
                            slug: "canva",
                            name: "Canva",
                            meta: { description: "Designs", categories: ["Design"] },
                        },
                    ],
                }),
            );
        }
        return Promise.resolve(jsonResponse({ items: [] }));
    });
}

function withComposioKey(key = "composio-key") {
    const providers = {
        ...DEFAULT_SETTINGS.ai.providers,
        services: {
            ...DEFAULT_SETTINGS.ai.providers.services,
            composio: { apiKey: key, userId: "bettershape-local" },
        },
    };
    updateSettingSection("ai", { providers });
}

beforeEach(() => {
    fetchMock.mockReset();
    invalidatePluginsCache();
    withComposioKey();
});

describe("plugin catalog", () => {
    it("refetches when the window is focused again", async () => {
        composio(false);
        const updates: boolean[] = [];
        subscribePlugins(() => {
            updates.push(Boolean(peekPluginsCache()?.plugins.some((plugin) => plugin.connected)));
        });

        await fetchPlugins({ force: true });
        expect(peekPluginsCache()?.plugins[0]?.connected).toBe(false);
        const callsAfterFirst = fetchMock.mock.calls.length;
        expect(callsAfterFirst).toBeGreaterThan(0);

        composio(true);
        window.dispatchEvent(new Event("focus"));

        await vi.waitFor(() => {
            expect(peekPluginsCache()?.plugins[0]?.connected).toBe(true);
        });
        expect(updates).toContain(true);
        expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });

    it("stays empty without a Composio key", async () => {
        withComposioKey("");
        invalidatePluginsCache();
        const result = await fetchPlugins({ force: true });
        expect(result).toEqual({ plugins: [], configured: false });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
