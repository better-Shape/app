import { commands } from "@/lib/backend/commands";
import type { SettingsFileName, SettingsFileSnapshot } from "@/lib/backend/types";

/** Fixed native files avoid the store plugin's silent parse failures and unrestricted path grant. */
export async function loadDesktopStore(file: SettingsFileName) {
    let expected: SettingsFileSnapshot | undefined;
    let pending: unknown;
    let changed = false;
    return {
        get replaceable() {
            return expected?.record === null || (expected !== undefined && Object.keys(expected.record ?? {}).every(key => key === "settings"));
        },
        async get<T>(key: "settings"): Promise<T | undefined> {
            expected = await commands.readSettingsFile(file);
            return structuredClone(expected.record?.[key]) as T | undefined;
        },
        async set(_key: "settings", value: unknown) {
            pending = structuredClone(value);
            changed = true;
        },
        async save() {
            if (!changed) return;
            if (expected === undefined) expected = await commands.readSettingsFile(file);
            const value = pending;
            const next = { settings: value };
            const revision = JSON.stringify(next) === JSON.stringify(expected.record) ? expected.revision
                : await commands.writeSettingsFile(file, value, expected.revision);
            expected = { record: next, revision };
            if (pending === value) changed = false;
        },
    };
}
