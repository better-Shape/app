/**
 * A downgrade or a newer build can put fields in the record this build does not model. Writing
 * the record back must not delete them just because a setting was touched: the file the app owns
 * is rewritten wholesale, so anything it read and did not change has to survive.
 */
import { expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
    records: {} as Record<string, unknown>,
    writes: [] as Array<{ file: string; settings: Record<string, unknown>; expected: string }>,
}));

vi.mock("@/lib/backend/commands", () => ({
    // The benchmarker module subscribes to invocation timings at import time.
    setInvokeLogger: vi.fn(),
    commands: {
        // The hydration tail syncs two native flags; this test does not exercise them.
        setIndexEmbeddings: async () => {},
        setChatMemoryEnabled: async () => {},
        readSettingsFile: async (file: string) => ({ record: backend.records[file] ?? null, revision: "r1" }),
        writeSettingsFile: async (file: string, settings: Record<string, unknown>, expected: string) => {
            backend.writes.push({ file, settings, expected });
            return "r2";
        },
    },
}));

it("keeps fields this build does not model when the app rewrites its own record", async () => {
    backend.records["settings-preferences.json"] = {
        settings: {
            editor: { fontSize: 19 },
            futureRelease: { experimental: true },
            ai: { providers: { connections: { openai: { model: "gpt" }, openrouter: { model: "claude" } } } },
        },
    };
    const settings = await import("@/lib/settings");
    await settings.initSettings();
    settings.updateSettingSection("editor", { fontSize: 20 });
    const edited = (write: { settings: Record<string, unknown> }) =>
        (write.settings.editor as { fontSize: number }).fontSize === 20;
    await vi.waitFor(() => expect(backend.writes.some(entry => entry.file === "settings-preferences.json" && edited(entry))).toBe(true));
    const write = backend.writes.filter(entry => entry.file === "settings-preferences.json" && edited(entry)).at(-1)!;
    // Nothing set these, so the rewrite must leave them exactly as they were read.
    expect(write.settings.futureRelease).toEqual({ experimental: true });
    // Model normalization fills every preset's fields in, so the record is not byte-identical -
    // but the connection this build knows about and the values it did not touch are still there.
    expect((write.settings.ai as { providers: { connections: Record<string, { model?: string }> } }).providers.connections)
        .toMatchObject({ openai: { model: "gpt" }, openrouter: { model: "claude" } });
});
