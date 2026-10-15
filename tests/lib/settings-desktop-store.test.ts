import { beforeEach, expect, it, vi } from "vitest";
import type { SettingsFileRecord } from "@/lib/backend/types";
const native = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/backend/commands", () => ({ commands: { readSettingsFile: native.read, writeSettingsFile: native.write } }));
import { loadDesktopStore } from "@/lib/settings/desktop-store";
beforeEach(() => { native.read.mockReset().mockResolvedValue({record:null,revision:"missing"}); native.write.mockReset().mockResolvedValue("next"); });

it("compares the original record without letting consumers mutate the comparison token", async () => {
    native.read.mockResolvedValue({ record: { settings: { editor: { fontSize: 15 } } }, revision: "original" });
    const store = await loadDesktopStore("settings.json");
    const settings = await store.get<{ editor: { fontSize: number } }>("settings");
    settings!.editor.fontSize = 23;
    await store.set("settings", settings);
    settings!.editor.fontSize = 25;
    await store.save();
    expect(native.write).toHaveBeenCalledWith("settings.json", { editor: { fontSize: 23 } }, "original");
});

it("does not turn an unreadable primary into an empty successful read", async () => {
    native.read.mockRejectedValue(new Error("Invalid JSON"));
    const store = await loadDesktopStore("settings.json");
    await expect(store.get("settings")).rejects.toThrow("Invalid JSON");
    await store.set("settings", { editor: { fontSize: 21 } });
    await expect(store.save()).rejects.toThrow("Invalid JSON");
    expect(native.write).not.toHaveBeenCalled();
    expect(store.replaceable).toBe(false);
});

it("protects unowned record fields and omits redundant writes", async () => {
    const record: SettingsFileRecord = { settings: {}, other: "retained" };
    native.read.mockResolvedValue({record,revision:"original"});
    const store = await loadDesktopStore("settings.json");
    await store.get("settings");
    expect(store.replaceable).toBe(false);
    const empty = await loadDesktopStore("settings-preferences.json");
    native.read.mockResolvedValue({record:{ settings: {} },revision:"original"});
    await empty.get("settings");
    await empty.set("settings", {});
    await empty.save();
    expect(native.write).not.toHaveBeenCalled();
});

it("retains failed saves for a deliberate retry", async () => {
    const store = await loadDesktopStore("settings-preferences.json");
    await store.set("settings", { editor: { fontSize: 24 } });
    native.write.mockRejectedValueOnce(new Error("Disk unavailable"));
    await expect(store.save()).rejects.toThrow("Disk unavailable");
    await store.save();
    expect(native.write).toHaveBeenCalledTimes(2);
    expect(native.write).toHaveBeenLastCalledWith("settings-preferences.json", { editor: { fontSize: 24 } }, "missing");
});

it("acknowledges the saved clone without losing a newer set during the write", async () => {
    const store = await loadDesktopStore("settings-preferences.json");
    await store.set("settings", { editor: { fontSize: 22 } });
    let finish!: (revision: string) => void;
    native.write.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = store.save();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await store.set("settings", { editor: { fontSize: 23 } });
    finish("first");
    await first;
    await store.save();
    expect(native.write).toHaveBeenCalledTimes(2);
    expect(native.write).toHaveBeenLastCalledWith("settings-preferences.json", { editor: { fontSize: 23 } }, "first");
    await store.save();
    expect(native.write).toHaveBeenCalledTimes(2);
});

it("still submits the opaque revision when property order prevents the no-op optimization", async () => {
    native.read.mockResolvedValue({ record: { settings: { editor: { fontSize: 22, tabSize: 4 } } }, revision: "opaque-before" });
    const store = await loadDesktopStore("settings-preferences.json");
    await store.get("settings");
    await store.set("settings", { editor: { tabSize: 4, fontSize: 22 } });
    native.write.mockRejectedValueOnce(new Error("Settings changed"));
    await expect(store.save()).rejects.toThrow("Settings changed");
    expect(native.write).toHaveBeenCalledWith("settings-preferences.json", { editor: { tabSize: 4, fontSize: 22 } }, "opaque-before");
    await store.save();
    expect(native.write).toHaveBeenCalledTimes(2);
    expect(native.write.mock.calls[1][2]).toBe("opaque-before");
});
