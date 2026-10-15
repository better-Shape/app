import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => { throw new Error("browser only"); } }));
vi.mock("@/lib/settings/desktop-store", () => ({ loadDesktopStore: async () => { throw new Error("browser only"); } }));
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
    localStorage.setItem(REDACTED, JSON.stringify({ editor: { fontSize: 25 } }));
    window.dispatchEvent(new StorageEvent("storage", { key: REDACTED, newValue: localStorage.getItem(REDACTED) }));
    expect(settings.getSettings().editor.fontSize).toBe(25);
    localStorage.setItem(PRIMARY, "{}");
    localStorage.setItem(REDACTED, JSON.stringify({ editor: { fontSize: 26 } }));
    window.dispatchEvent(new StorageEvent("storage", { key: REDACTED, newValue: localStorage.getItem(REDACTED) }));
    expect(settings.getSettings().editor.fontSize).toBe(25);
});
it("retains in-memory edits when storage itself is denied", async () => {
    const settings = await open();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => settings.updateSettingSection("editor", { fontSize: 27 })).not.toThrow();
    expect(settings.getSettings().editor.fontSize).toBe(27);
});


it("persists ordinary settings around a valid unmigrated legacy credential", async () => {
    const settings = await import("@/lib/settings");
    const legacy = structuredClone(settings.DEFAULT_SETTINGS);
    legacy.ai.providers.connections.openai.apiKey = "example-legacy-valid";
    const original = JSON.stringify(legacy);
    localStorage.setItem(PRIMARY, original);
    await settings.initSettings();
    settings.updateSettingSection("editor", { fontSize: 28 });
    expect(localStorage.getItem(PRIMARY)).toBe(original);
    expect(localStorage.getItem(REDACTED)).not.toContain("example-");
    vi.resetModules();
    const reopened = await open();
    expect(reopened.getSettings().editor.fontSize).toBe(28);
    expect(reopened.providerSecretsForVault().openai).toBe("example-legacy-valid");
    expect(localStorage.getItem(PRIMARY)).toBe(original);
});

it("does not block redacted preferences solely because keychain recovery needs review", async () => {
    const settings = await open();
    settings.updateSettingSection("editor", { fontSize: 20 });
    settings.registerCredentialRecoveryConflicts(["openai"]);
    settings.updateSettingSection("editor", { fontSize: 29 });
    expect(JSON.parse(localStorage.getItem(PRIMARY)!).editor.fontSize).toBe(29);
    vi.resetModules();
    expect((await open()).getSettings().editor.fontSize).toBe(29);
});


it("never stores a new draft in the preference overlay or rebinds the retained legacy key on restart", async () => {
    const settings = await import("@/lib/settings");
    const legacy = structuredClone(settings.DEFAULT_SETTINGS);
    legacy.ai.providers.connections.openai.apiKey = "example-retained";
    legacy.ai.providers.connections.openai.baseUrl = "https://original.invalid/v1";
    const original = JSON.stringify(legacy);
    localStorage.setItem(PRIMARY, original);
    await settings.initSettings();
    const providers = settings.getSettings().ai.providers;
    settings.updateSettingSection("ai", { providers: { ...providers, connections: { ...providers.connections,
        openai: { ...providers.connections.openai, apiKey: "example-new-draft", baseUrl: "https://new.invalid/v1" },
    } } });
    settings.updateSettingSection("terminal", { fontSize: 19 });
    expect(localStorage.getItem(PRIMARY)).toBe(original);
    expect(localStorage.getItem(REDACTED)).not.toContain("example-");
    vi.resetModules();
    const reopened = await open();
    expect(reopened.getSettings().terminal.fontSize).toBe(19);
    expect(reopened.providerSecretsForVault().openai).toBe("example-retained");
    expect(reopened.getSettings().ai.providers.connections.openai.baseUrl).toBe("https://original.invalid/v1");
});

it("reconciles delayed storage events against the current durable record", async () => {
    const settings = await open();
    settings.updateSettingSection("editor", { fontSize: 27 });
    window.dispatchEvent(new StorageEvent("storage", { key: PRIMARY, newValue: JSON.stringify({ editor: { fontSize: 12 } }) }));
    expect(settings.getSettings().editor.fontSize).toBe(27);
    expect(JSON.parse(localStorage.getItem(PRIMARY)!).editor.fontSize).toBe(27);
});


it("does not accept credentials from a tampered redacted notification record", async () => {
    localStorage.setItem(PRIMARY, malformed);
    const settings = await open();
    const providers = settings.getSettings().ai.providers;
    settings.updateSettingSection("ai", { providers: { ...providers, connections: { ...providers.connections,
        openai: { ...providers.connections.openai, apiKey: "example-live-draft" },
    } } });
    const incoming = JSON.parse(localStorage.getItem(REDACTED)!);
    incoming.ai.providers.connections.openai.apiKey = "example-forged";
    localStorage.setItem(REDACTED, JSON.stringify(incoming));
    window.dispatchEvent(new StorageEvent("storage", { key: REDACTED, newValue: JSON.stringify(incoming) }));
    expect(settings.providerSecretsForVault().openai).toBe("example-live-draft");
});
