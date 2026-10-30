import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
    prettier: vi.fn(),
    eslint: vi.fn(),
    save: vi.fn(),
    project: "/project",
}));

vi.mock("@/lib/backend", () => ({
    getProjectPath: () => backend.project,
    commands: {
        prettierFormatFile: backend.prettier,
        eslintLintFile: backend.eslint,
        saveFile: backend.save,
    },
}));

const settings = vi.hoisted(() => ({
    formatOnSave: false,
    trimTrailingWhitespace: false,
    insertFinalNewline: true,
    prettier: true,
    eslint: false,
    eslintFix: false,
}));

vi.mock("@/lib/settings", () => ({
    getSettings: () => ({
        editor: { ...settings },
        prettier: { enable: settings.prettier },
        eslint: { enable: settings.eslint, fixOnSave: settings.eslintFix },
    }),
}));

import {
    fixLintForSave,
    formatForSave,
    prepareDocForSave,
    saveContents,
    toDiskText,
} from "@/lib/editor/save-pipeline";

describe("save pipeline", () => {
    beforeEach(() => {
        settings.formatOnSave = false;
        settings.trimTrailingWhitespace = false;
        settings.insertFinalNewline = true;
        settings.prettier = true;
        settings.eslint = false;
        settings.eslintFix = false;
        backend.prettier.mockReset();
        backend.eslint.mockReset().mockResolvedValue({ diagnostics: [], content: null });
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

    it("applies ESLint fixes before writing when Fix on save is on", async () => {
        settings.eslint = true;
        settings.eslintFix = true;
        backend.eslint.mockResolvedValue({ diagnostics: [], content: "const a: number = 1;\n" });
        await saveContents("/project/a.ts", "const a:any=1");
        expect(backend.eslint).toHaveBeenCalledWith("/project", "/project/a.ts", "const a:any=1\n", true);
        expect(backend.save).toHaveBeenCalledWith("/project/a.ts", "const a: number = 1;\n");
    });

    it("does not run ESLint on save when Fix on save is off", async () => {
        settings.eslint = true;
        settings.eslintFix = false;
        await saveContents("/project/a.ts", "const a=1");
        expect(backend.eslint).not.toHaveBeenCalled();
    });

    it("keeps the text when ESLint cannot fix the file", async () => {
        settings.eslint = true;
        settings.eslintFix = true;
        backend.eslint.mockResolvedValue({ diagnostics: [], content: null });
        await expect(fixLintForSave("/project/a.ts", "x")).resolves.toBe("x");
        backend.eslint.mockRejectedValue(new Error("no eslint installed"));
        await expect(fixLintForSave("/project/a.ts", "x")).resolves.toBe("x");
    });

    it("does not format when Prettier is switched off", async () => {
        settings.formatOnSave = true;
        settings.prettier = false;
        await expect(formatForSave("/project/a.ts", "const a=1;\n")).resolves.toBe("const a=1;\n");
        expect(backend.prettier).not.toHaveBeenCalled();
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

describe("save ordering", () => {
    it("writes overlapping saves of one path in the order they were requested", async () => {
        backend.save.mockReset();
        const written: string[] = [];
        // The first write is the slow one, so without per-path ordering the
        // second snapshot would land first and the older text would survive.
        backend.save.mockImplementation(async (_path: string, text: string) => {
            if (text.startsWith("first")) await new Promise((resolve) => setTimeout(resolve, 20));
            written.push(text);
        });

        await Promise.all([saveContents("/project/a.ts", "first"), saveContents("/project/a.ts", "second")]);

        expect(written).toEqual(["first\n", "second\n"]);
    });
});
