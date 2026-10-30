import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    editor: {
        trimTrailingWhitespace: true,
        insertFinalNewline: true,
        formatOnSave: false,
    },
    prettier: { enable: true },
}));

const backend = vi.hoisted(() => ({
    prettierFormatFile: vi.fn(),
}));

const notifyMock = vi.hoisted(() => ({
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({ getSettings: () => ({ editor: state.editor, prettier: state.prettier }) }));
vi.mock("@/lib/backend", () => ({
    commands: backend,
    getProjectPath: () => "/repo",
}));
vi.mock("@/features/notifications", () => ({ notify: notifyMock }));

import { formatForSave, prepareDocForSave } from "@/lib/editor/save-pipeline";

describe("save formatting settings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.editor.trimTrailingWhitespace = true;
        state.editor.insertFinalNewline = true;
        state.editor.formatOnSave = false;
        state.prettier.enable = true;
    });

    it("trims trailing whitespace only when the setting is on", () => {
        expect(prepareDocForSave("a  \nb\t\n")).toBe("a\nb\n");
        state.editor.trimTrailingWhitespace = false;
        expect(prepareDocForSave("a  \nb\t\n")).toBe("a  \nb\t\n");
    });

    it("inserts a final newline only when the setting is on", () => {
        expect(prepareDocForSave("a")).toBe("a\n");
        state.editor.insertFinalNewline = false;
        expect(prepareDocForSave("a")).toBe("a");
    });

    it("does not format when Format on save is off", async () => {
        await expect(formatForSave("a.ts", "const a=1")).resolves.toBe("const a=1");
        expect(backend.prettierFormatFile).not.toHaveBeenCalled();
    });

    it("does not format when Prettier is switched off", async () => {
        state.editor.formatOnSave = true;
        state.prettier.enable = false;
        await expect(formatForSave("off.ts", "const a=1")).resolves.toBe("const a=1");
        expect(backend.prettierFormatFile).not.toHaveBeenCalled();
    });

    it("returns the formatted text when formatting succeeds", async () => {
        state.editor.formatOnSave = true;
        backend.prettierFormatFile.mockResolvedValue("const a = 1;\n");
        await expect(formatForSave("a.ts", "const a=1")).resolves.toBe("const a = 1;\n");
        expect(notifyMock.warn).not.toHaveBeenCalled();
    });

    it("saves the original text and says so when formatting fails", async () => {
        state.editor.formatOnSave = true;
        backend.prettierFormatFile.mockRejectedValue(new Error("No parser could be inferred"));
        await expect(formatForSave("notes.md", "text")).resolves.toBe("text");
        expect(notifyMock.warn).toHaveBeenCalledWith(
            "Format on save skipped",
            "notes.md: No parser could be inferred",
        );
    });

    it("reports a repeated failure once", async () => {
        state.editor.formatOnSave = true;
        backend.prettierFormatFile.mockRejectedValue(new Error("broken parser"));
        await formatForSave("repeat.ts", "a");
        await formatForSave("repeat.ts", "b");
        expect(notifyMock.warn).toHaveBeenCalledTimes(1);
    });
});
