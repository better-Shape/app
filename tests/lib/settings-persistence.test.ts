import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => { throw new Error("browser only"); } }));
const PRIMARY = "bettershape-settings-v1";
const REDACTED = "bettershape-settings-redacted-v1";
const malformed = '{"ai":{"providers":{"connections":{"openai":{"apiKey":"example-legacy"}}';
beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
async function open() {
    const settings = await import("@/lib/settings");
    await settings.initSettings();
    return settings;
}
it("persists and reloads redacted settings without destroying malformed legacy bytes", async () => {
    localStorage.setItem(PRIMARY, malformed);
    const settings = await open();
    settings.updateSettingSection("editor", { fontSize: 21 });
    const providers = settings.getSettings().ai.providers;
    settings.updateSettingSection("ai", { providers: { ...providers, connections: { ...providers.connections,
        openai: { ...providers.connections.openai, apiKey: "example-unsaved", headers: { Authorization: "example-header" } },
    } } });
    expect(localStorage.getItem(PRIMARY)).toBe(malformed);
    const saved = localStorage.getItem(REDACTED);
    expect(saved).not.toBeNull();
    expect(saved).not.toContain("example-");
    expect(JSON.parse(saved!).editor.fontSize).toBe(21);
    vi.resetModules();
    const reloaded = await open();
    expect(reloaded.getSettings().editor.fontSize).toBe(21);
    expect(reloaded.getSettings().ai.providers.connections.openai.apiKey).toBe("");
    expect(localStorage.getItem(PRIMARY)).toBe(malformed);
});
it("recovers even if both the legacy JSON and the redacted fallback are malformed", async () => {
    localStorage.setItem(PRIMARY, malformed); localStorage.setItem(REDACTED, "{");
    const settings = await open();
    settings.updateSettingSection("editor", { fontSize: 22 });
    expect(JSON.parse(localStorage.getItem(REDACTED)!).editor.fontSize).toBe(22);
    expect(localStorage.getItem(PRIMARY)).toBe(malformed);
});
it("returns to normal persistence after the primary settings have been repaired", async () => {
    localStorage.setItem(PRIMARY, malformed);
    const settings = await open();
    settings.updateSettingSection("editor", { fontSize: 23 });
    localStorage.setItem(PRIMARY, "{}");
    settings.updateSettingSection("editor", { fontSize: 24 });
    expect(JSON.parse(localStorage.getItem(PRIMARY)!).editor.fontSize).toBe(24);
    expect(localStorage.getItem(REDACTED)).toBeNull();
});
it("applies another window's fallback updates only while the primary is malformed", async () => {
    localStorage.setItem(PRIMARY, malformed);
    const settings = await open();
    window.dispatchEvent(new StorageEvent("storage", { key: REDACTED, newValue: JSON.stringify({ editor: { fontSize: 25 } }) }));
    expect(settings.getSettings().editor.fontSize).toBe(25);
    localStorage.setItem(PRIMARY, "{}");
    window.dispatchEvent(new StorageEvent("storage", { key: REDACTED, newValue: JSON.stringify({ editor: { fontSize: 26 } }) }));
    expect(settings.getSettings().editor.fontSize).toBe(25);
});
it("retains in-memory edits when storage itself is denied", async () => {
    const settings = await open();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => settings.updateSettingSection("editor", { fontSize: 27 })).not.toThrow();
    expect(settings.getSettings().editor.fontSize).toBe(27);
});
