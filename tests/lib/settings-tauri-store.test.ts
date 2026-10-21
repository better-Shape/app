import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { storeMock, loadMock } = vi.hoisted(() => ({
    storeMock: {
        get: vi.fn(),
        set: vi.fn(),
        save: vi.fn(),
    },
    loadMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({ load: loadMock }));
vi.mock("@tauri-apps/api/event", () => ({
    emit: async () => undefined,
    listen: async () => () => undefined,
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    storeMock.get.mockReset();
    storeMock.set.mockReset().mockResolvedValue(undefined);
    storeMock.save.mockReset().mockResolvedValue(undefined);
    loadMock.mockReset().mockResolvedValue(storeMock);
});

afterEach(() => {
    localStorage.clear();
});

describe("Tauri settings persistence", () => {
    it("loads desktop settings even when a component reads settings before initialization", async () => {
        storeMock.get.mockResolvedValueOnce({ appearance: { motionPreference: "reduced" } });
        const { getSettings, initSettings } = await import("@/lib/settings/store");

        expect(getSettings().appearance.motionPreference).toBe("system");
        await initSettings();

        expect(storeMock.get).toHaveBeenCalledOnce();
        expect(getSettings().appearance.motionPreference).toBe("reduced");
    });

    it("keeps a motion preference changed while startup hydration is pending", async () => {
        const pendingRead = deferred<{ appearance: { motionPreference: "system" } }>();
        storeMock.get.mockImplementationOnce(() => pendingRead.promise);
        const { getSettings, initSettings, updateSettingSection } = await import("@/lib/settings/store");

        const initialization = initSettings();
        await vi.waitFor(() => expect(storeMock.get).toHaveBeenCalledOnce());
        updateSettingSection("appearance", { motionPreference: "reduced" });
        pendingRead.resolve({ appearance: { motionPreference: "system" } });
        await initialization;

        expect(getSettings().appearance.motionPreference).toBe("reduced");
        const finalWrite = storeMock.set.mock.calls.at(-1);
        expect(finalWrite?.[0]).toBe("settings");
        expect(finalWrite?.[1].appearance.motionPreference).toBe("reduced");
    });

    it("serializes concurrent snapshots so an older save cannot finish last", async () => {
        const firstWrite = deferred<void>();
        storeMock.set
            .mockImplementationOnce(() => firstWrite.promise)
            .mockResolvedValue(undefined);
        const { updateSettingSection } = await import("@/lib/settings/store");

        updateSettingSection("appearance", { motionPreference: "reduced" });
        await vi.waitFor(() => expect(storeMock.set).toHaveBeenCalledOnce());
        updateSettingSection("appearance", { motionPreference: "system" });

        expect(storeMock.set).toHaveBeenCalledTimes(1);
        firstWrite.resolve();
        await vi.waitFor(() => expect(storeMock.save).toHaveBeenCalledTimes(2));

        expect(storeMock.set).toHaveBeenCalledTimes(2);
        const finalWrite = storeMock.set.mock.calls[1];
        expect(finalWrite?.[1].appearance.motionPreference).toBe("system");
    });
});
