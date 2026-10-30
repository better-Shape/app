import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ prettier: vi.fn(), save: vi.fn(), project: "/project" }));

vi.mock("@/lib/backend", () => ({
    getProjectPath: () => backend.project,
    commands: {
        prettierFormatFile: backend.prettier,
        saveFile: backend.save,
    },
}));

const settings = vi.hoisted(() => ({
    formatOnSave: false,
    trimTrailingWhitespace: false,
    insertFinalNewline: true,
}));

vi.mock("@/lib/settings", () => ({
    getSettings: () => ({ editor: { ...settings } }),
}));

import { formatForSave, prepareDocForSave, saveContents, toDiskText } from "@/lib/editor/save-pipeline";

describe("save pipeline", () => {
    beforeEach(() => {
        settings.formatOnSave = false;
        settings.trimTrailingWhitespace = false;
        settings.insertFinalNewline = true;
        backend.prettier.mockReset();
        backend.save.mockReset().mockResolvedValue(undefined);
    });

    it("adds the missing final newline", () => {
        expect(prepareDocForSave("const a = 1;")).toBe("const a = 1;\n");
    });

    it("keeps a single trailing newline", () => {
        expect(prepareDocForSave("const a = 1;\n")).toBe("const a = 1;\n");
    });

    it("trims trailing whitespace only when the setting is on", () => {
        const source = "const a = 1;   \nconst b = 2;\t\n";
        expect(prepareDocForSave(source)).toBe(source);
        settings.trimTrailingWhitespace = true;
        expect(prepareDocForSave(source)).toBe("const a = 1;\nconst b = 2;\n");
    });

    it("leaves an empty document empty", () => {
        expect(prepareDocForSave("")).toBe("");
    });

    it("does not call the formatter when Format on save is off", async () => {
        await formatForSave("/project/a.ts", "const a=1\n");
        expect(backend.prettier).not.toHaveBeenCalled();
    });

    it("formats when Format on save is on", async () => {
        settings.formatOnSave = true;
        backend.prettier.mockResolvedValue("const a = 1;\n");
        await expect(formatForSave("/project/a.ts", "const a=1;\n")).resolves.toBe("const a = 1;\n");
        expect(backend.prettier).toHaveBeenCalledWith("/project", "/project/a.ts", "const a=1;\n");
    });

    it("keeps the unformatted text when the formatter rejects", async () => {
        settings.formatOnSave = true;
        backend.prettier.mockRejectedValue(new Error("no parser"));
        await expect(formatForSave("/project/a.md", "text\n")).resolves.toBe("text\n");
    });

    it("writes CRLF bytes for a CRLF file and returns LF text", async () => {
        const written = await saveContents("/project/a.ts", "const a = 1;", "CRLF");
        expect(written).toBe("const a = 1;\n");
        expect(backend.save).toHaveBeenCalledWith("/project/a.ts", "const a = 1;\r\n");
    });

    it("converts only the line endings on the way out", () => {
        expect(toDiskText("a\nb", "CRLF")).toBe("a\r\nb");
        expect(toDiskText("a\r\nb", "LF")).toBe("a\nb");
    });
});
