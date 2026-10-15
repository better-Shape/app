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
