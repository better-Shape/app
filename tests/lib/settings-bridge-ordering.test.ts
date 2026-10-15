import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import type { SettingsFileName, SettingsFileSnapshot } from "@/lib/backend/types";

const bridge = vi.hoisted(() => ({
    read: vi.fn(), write: vi.fn(), listener: undefined as undefined | ((event: { payload: unknown }) => void),
    files: new Map<string, SettingsFileSnapshot>(), revision: 0,
}));
vi.mock("@/lib/backend/commands", () => ({ commands: { readSettingsFile: bridge.read, writeSettingsFile: bridge.write } }));
vi.mock("@/lib/backend", () => ({ commands: {
    setIndexEmbeddings: async () => undefined, setChatMemoryEnabled: async () => undefined,
} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (_name: string, callback: typeof bridge.listener) => {
    bridge.listener = callback;
    return () => { bridge.listener = undefined; };
} }));
const PRIMARY = "bettershape-settings-v1";
let listeners: MockInstance<typeof window.addEventListener>;
beforeEach(() => {
    vi.resetModules(); localStorage.clear(); vi.stubGlobal("__TAURI_INTERNALS__", {});
    bridge.files.clear(); bridge.revision = 0; bridge.listener = undefined;
    bridge.read.mockReset().mockImplementation(async (file: SettingsFileName) => structuredClone(bridge.files.get(file) ?? { record: null, revision: "missing" }));
    bridge.write.mockReset().mockImplementation(async (file: SettingsFileName, settings: unknown, expected: string) => {
        if ((bridge.files.get(file)?.revision ?? "missing") !== expected) throw new Error("Settings changed");
        const revision = String(++bridge.revision);
        bridge.files.set(file, { record: { settings: structuredClone(settings) }, revision });
        return revision;
    });
    listeners = vi.spyOn(window, "addEventListener");
});
afterEach(async () => {
    await vi.dynamicImportSettled();
    for (const [name, callback, options] of listeners.mock.calls) {
        if (name === "storage") window.removeEventListener(name, callback, options);
    }
    listeners.mockRestore(); vi.unstubAllGlobals(); localStorage.clear();
});
async function open() {
    const settings = await import("@/lib/settings");
    await settings.initSettings();
    await vi.dynamicImportSettled();
    expect(bridge.listener).toBeTypeOf("function");
    return settings;
}

it("treats delayed Tauri payloads as invalidations instead of republishing old snapshots", async () => {
    const settings = await open();
    settings.updateSettingSection("editor", { fontSize: 29 });
    await vi.dynamicImportSettled();
    const saved = localStorage.getItem(PRIMARY);
    bridge.read.mockClear(); bridge.write.mockClear();
    bridge.listener!({ payload: { editor: { fontSize: 12 } } });
    expect(settings.getSettings().editor.fontSize).toBe(29);
    expect(localStorage.getItem(PRIMARY)).toBe(saved);
    expect(bridge.read).not.toHaveBeenCalled();
    expect(bridge.write).not.toHaveBeenCalled();
});

it("reads committed native preferences when browser storage supplies no snapshot", async () => {
    const settings = await open();
    localStorage.clear();
    const latest = structuredClone(settings.getSettings()); latest.editor.fontSize = 28;
    bridge.files.set("settings-preferences.json", { record: { settings: latest }, revision: "latest" });
    bridge.listener!({ payload: { editor: { fontSize: 11 } } });
    await vi.waitFor(() => expect(settings.getSettings().editor.fontSize).toBe(28));
    expect(localStorage.getItem(PRIMARY)).toBeNull();
});

it("rejects a late native read after a newer invalidation has reconciled", async () => {
    const settings = await open();
    localStorage.clear();
    let finish!: (snapshot: SettingsFileSnapshot) => void;
    bridge.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    bridge.listener!({ payload: null });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const latest = structuredClone(settings.getSettings()); latest.editor.fontSize = 27;
    bridge.files.set("settings-preferences.json", { record: { settings: latest }, revision: "latest" });
    bridge.listener!({ payload: null });
    await vi.waitFor(() => expect(settings.getSettings().editor.fontSize).toBe(27));
    finish({ record: { settings: { editor: { fontSize: 16 } } }, revision: "older" });
    await vi.dynamicImportSettled();
    expect(settings.getSettings().editor.fontSize).toBe(27);
});

it("retains a local edit made while a native reconciliation read is pending", async () => {
    const settings = await open();
    localStorage.clear();
    let finish!: (snapshot: SettingsFileSnapshot) => void;
    bridge.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    bridge.listener!({ payload: null });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    settings.updateSettingSection("editor", { fontSize: 26 });
    finish({ record: { settings: { editor: { fontSize: 16 } } }, revision: "older" });
    await vi.dynamicImportSettled();
    expect(settings.getSettings().editor.fontSize).toBe(26);
    expect(JSON.parse(localStorage.getItem(PRIMARY)!).editor.fontSize).toBe(26);
});


it("keeps native reconciliation available when compatibility-file cleanup fails", async () => {
    const settings = await open();
    const write = bridge.write.getMockImplementation()!;
    bridge.write.mockImplementation((file: SettingsFileName, settings: unknown, expected: string) => {
        if (file === "settings.json") return Promise.reject(new Error("Primary is read-only"));
        return write(file, settings, expected);
    });
    settings.updateSettingSection("editor", { fontSize: 23 });
    await vi.dynamicImportSettled();
    localStorage.clear();
    const latest = structuredClone(settings.getSettings()); latest.editor.fontSize = 24;
    bridge.files.set("settings-preferences.json", { record: { settings: latest }, revision: "latest" });
    bridge.listener!({ payload: null });
    await vi.waitFor(() => expect(settings.getSettings().editor.fontSize).toBe(24));
});

it("does not overwrite unread preferences when the store recovers between initialization and saving", async () => {
    const original = { record: { settings: { editor: { fontSize: 27, tabSize: 8 } } }, revision: "saved" };
    bridge.files.set("settings-preferences.json", original);
    const read = bridge.read.getMockImplementation()!;
    let failed = false;
    bridge.read.mockImplementation((file: SettingsFileName) => {
        if (file === "settings-preferences.json" && !failed) {
            failed = true;
            return Promise.reject(new Error("Temporarily unavailable"));
        }
        return read(file);
    });
    const settings = await open();
    expect(bridge.write).not.toHaveBeenCalled();
    expect(bridge.files.get("settings-preferences.json")).toEqual(original);
    settings.updateSettingSection("terminal", { fontSize: 21 });
    await vi.waitFor(() => expect(settings.getSettings().editor.fontSize).toBe(27));
    await vi.dynamicImportSettled();
    expect(settings.getSettings().editor.tabSize).toBe(8);
    expect(settings.getSettings().terminal.fontSize).toBe(21);
    expect(bridge.files.get("settings-preferences.json")?.record?.settings).toMatchObject({
        editor: { fontSize: 27, tabSize: 8 }, terminal: { fontSize: 21 },
    });
});

it("retries incomplete initialization without granting writes during a continuing read outage", async () => {
    bridge.files.set("settings-preferences.json", { record: { settings: { editor: { fontSize: 28 } } }, revision: "saved" });
    const read = bridge.read.getMockImplementation()!;
    let unavailable = true;
    bridge.read.mockImplementation((file: SettingsFileName) => file === "settings-preferences.json" && unavailable
        ? Promise.reject(new Error("Temporarily unavailable")) : read(file));
    const settings = await open();
    settings.updateSettingSection("terminal", { fontSize: 22 });
    await vi.dynamicImportSettled();
    await settings.initSettings();
    expect(bridge.write).not.toHaveBeenCalled();
    unavailable = false;
    await settings.initSettings();
    await vi.dynamicImportSettled();
    expect(settings.getSettings().editor.fontSize).toBe(28);
    expect(settings.getSettings().terminal.fontSize).toBe(22);
});

it("keeps edits made during a recovery read while hydrating unrelated saved fields", async () => {
    const read = bridge.read.getMockImplementation()!;
    bridge.read.mockImplementation((file: SettingsFileName) => file === "settings-preferences.json"
        ? Promise.reject(new Error("Unavailable")) : read(file));
    const settings = await open();
    const saved = { record: { settings: { editor: { fontSize: 26, tabSize: 8 }, terminal: { fontSize: 20 } } }, revision: "saved" };
    bridge.files.set("settings-preferences.json", saved);
    let finish!: (snapshot: SettingsFileSnapshot) => void;
    bridge.read.mockImplementation((file: SettingsFileName) => file === "settings-preferences.json"
        ? new Promise(resolve => { finish = resolve; }) : read(file));
    const recovery = settings.initSettings();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    settings.updateSettingSection("editor", { fontSize: 31 });
    bridge.read.mockImplementation(read);
    finish(structuredClone(saved));
    await recovery;
    await vi.dynamicImportSettled();
    expect(settings.getSettings().editor).toMatchObject({ fontSize: 31, tabSize: 8 });
    expect(settings.getSettings().terminal.fontSize).toBe(20);
});

it("uses the hydration read revision for the first write instead of acquiring overwrite authority from a second read", async () => {
    const original = { record: { settings: { editor: { fontSize: 26 } } }, revision: "before" };
    const replacement = { record: { settings: { editor: { fontSize: 30 } } }, revision: "replacement" };
    bridge.files.set("settings-preferences.json", original);
    const read = bridge.read.getMockImplementation()!;
    let first = true;
    bridge.read.mockImplementation(async (file: SettingsFileName) => {
        const snapshot = await read(file);
        if (file === "settings-preferences.json" && first) {
            first = false;
            bridge.files.set(file, replacement);
        }
        return snapshot;
    });
    await open();
    expect(bridge.files.get("settings-preferences.json")).toEqual(replacement);
    expect(bridge.write).toHaveBeenCalledWith("settings-preferences.json", expect.anything(), "before");
    expect(bridge.write).not.toHaveBeenCalledWith("settings.json", expect.anything(), expect.anything());
});

it("does not use an earlier vault receipt to erase credentials first recovered after a read outage", async () => {
    const settingsModule = await import("@/lib/settings");
    const legacy = structuredClone(settingsModule.DEFAULT_SETTINGS);
    legacy.ai.providers.connections.openai.apiKey = "example-late-legacy";
    const primary = { record: { settings: legacy }, revision: "legacy" };
    bridge.files.set("settings.json", primary);
    const read = bridge.read.getMockImplementation()!;
    let unavailable = true;
    bridge.read.mockImplementation((file: SettingsFileName) => unavailable
        ? Promise.reject(new Error("Unavailable")) : read(file));
    const settings = await open();
    expect(settings.providerSecretsForVault().openai).toBeUndefined();
    settings.setSecretsVaulted(true);
    await vi.dynamicImportSettled();
    expect(settings.areSecretsVaulted()).toBe(true);
    unavailable = false;
    await settings.initSettings();
    await vi.dynamicImportSettled();
    expect(settings.providerSecretsForVault().openai).toBe("example-late-legacy");
    expect(settings.areSecretsVaulted()).toBe(false);
    expect(bridge.files.get("settings.json")).toEqual(primary);
    expect(JSON.stringify(bridge.files.get("settings-preferences.json"))).not.toContain("example-late-legacy");
});

it("keeps unknown primary fields out of the overlay and hydrates them when that file recovers", async () => {
    const original = { record: { settings: { editor: { fontSize: 28, tabSize: 8 }, terminal: { fontSize: 19 } } }, revision: "primary" };
    bridge.files.set("settings.json", original);
    const read = bridge.read.getMockImplementation()!;
    let primaryUnavailable = true;
    bridge.read.mockImplementation((file: SettingsFileName) => file === "settings.json" && primaryUnavailable
        ? Promise.reject(new Error("Primary unavailable")) : read(file));
    const settings = await open();
    settings.updateSettingSection("editor", { fontSize: 31 });
    await vi.dynamicImportSettled();
    expect(bridge.files.get("settings.json")).toEqual(original);
    expect(bridge.files.get("settings-preferences.json")?.record?.settings).toEqual({ editor: { fontSize: 31 } });
    primaryUnavailable = false;
    await settings.initSettings();
    await vi.dynamicImportSettled();
    expect(settings.getSettings().editor).toMatchObject({ fontSize: 31, tabSize: 8 });
    expect(settings.getSettings().terminal.fontSize).toBe(19);
});

it("preserves sparse local preferences across a restart before the unknown primary recovers", async () => {
    bridge.files.set("settings.json", { record: { settings: { editor: { fontSize: 28, tabSize: 8 } } }, revision: "primary" });
    const read = bridge.read.getMockImplementation()!;
    let unavailable = true;
    bridge.read.mockImplementation((file: SettingsFileName) => file === "settings.json" && unavailable
        ? Promise.reject(new Error("Unavailable")) : read(file));
    const first = await open();
    first.updateSettingSection("editor", { fontSize: 31 });
    await vi.dynamicImportSettled();
    expect(JSON.parse(localStorage.getItem(PRIMARY)!)).toEqual({ editor: { fontSize: 31 } });
    vi.resetModules();
    const second = await open();
    expect(second.getSettings().editor.fontSize).toBe(31);
    expect(bridge.files.get("settings-preferences.json")?.record?.settings).toEqual({ editor: { fontSize: 31 } });
    unavailable = false;
    await second.initSettings();
    expect(second.getSettings().editor).toMatchObject({ fontSize: 31, tabSize: 8 });
});

it("does not replace another window's known fields with absent sparse overlay defaults", async () => {
    const settings = await open();
    settings.updateSettingSection("editor", { tabSize: 8 });
    await vi.dynamicImportSettled();
    localStorage.setItem(PRIMARY, JSON.stringify({ editor: { fontSize: 29 } }));
    bridge.listener!({ payload: null });
    expect(settings.getSettings().editor).toMatchObject({ fontSize: 29, tabSize: 8 });
});
