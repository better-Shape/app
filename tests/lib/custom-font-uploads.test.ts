import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomFontStore, StoredFont } from "@/lib/editor/custom-fonts";

type CustomFonts = typeof import("@/lib/editor/custom-fonts");

/** A store kept in memory, standing in for IndexedDB, which jsdom does not have. */
const memoryStore = (): CustomFontStore & { slots: Map<string, StoredFont> } => {
    const slots = new Map<string, StoredFont>();
    return {
        slots,
        put: async (font) => {
            slots.set(font.slot, font);
        },
        all: async () => [...slots.values()],
    };
};

const fontFile = (name: string, bytes: number[]) => new File([new Uint8Array(bytes)], name, { type: "font/woff2" });

let faces: { family: string; data: ArrayBuffer }[];
let added: unknown[];
let loadFails: boolean;

/** A fresh copy of the module, as a reloaded window has, with no faces registered yet. */
const freshModule = async (): Promise<CustomFonts> => {
    vi.resetModules();
    return import("@/lib/editor/custom-fonts");
};

beforeEach(() => {
    faces = [];
    added = [];
    loadFails = false;
    vi.stubGlobal(
        "FontFace",
        class {
            constructor(
                readonly family: string,
                readonly data: ArrayBuffer,
            ) {
                faces.push({ family, data });
            }
            load() {
                return loadFails ? Promise.reject(new Error("not a font")) : Promise.resolve(this);
            }
        },
    );
    Object.defineProperty(document, "fonts", {
        configurable: true,
        value: { add: (face: unknown) => added.push(face) },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "fonts");
});

describe("uploaded fonts", () => {
    it("names a family after the file and a hash of its bytes, and registers it", async () => {
        const { loadCustomEditorFont, customFontLabel } = await freshModule();
        const store = memoryStore();

        const value = await loadCustomEditorFont(fontFile("Studio Mono.woff2", [0, 1, 0, 0]), "terminal", store);

        expect(value).toMatch(/^'BetterShapeCustom-Studio Mono-[0-9a-f]{8}', monospace$/);
        expect(customFontLabel(value)).toBe("Studio Mono");
        expect(faces.map((face) => face.family)).toEqual([value.slice(1, value.indexOf("'", 1))]);
        expect(added).toHaveLength(1);
        expect(store.slots.get("terminal")?.family).toBe(faces[0]?.family);
    });

    it("keeps two different files with one name apart, and one file under one family", async () => {
        const { loadCustomEditorFont } = await freshModule();
        const store = memoryStore();

        const first = await loadCustomEditorFont(fontFile("My-Font.ttf", [1, 2, 3]), "terminal", store);
        const second = await loadCustomEditorFont(fontFile("My-Font.ttf", [4, 5, 6]), "terminal", store);
        const again = await loadCustomEditorFont(fontFile("My-Font.ttf", [4, 5, 6]), "terminal", store);

        expect(second).not.toBe(first);
        expect(again).toBe(second);
        expect(faces).toHaveLength(2);
        // One upload per slot: the second replaced the first.
        expect([...store.slots.values()].map((font) => `'${font.family}', monospace`)).toEqual([second]);
    });

    it("keeps the letters of a name in any script", async () => {
        const { loadCustomEditorFont, customFontLabel } = await freshModule();

        const japanese = await loadCustomEditorFont(fontFile("メイリオ.ttf", [7]), "terminal", memoryStore());
        const punctuation = await loadCustomEditorFont(fontFile("'\";.woff", [8]), "terminal", memoryStore());

        expect(customFontLabel(japanese)).toBe("メイリオ");
        expect(customFontLabel(punctuation)).toBe("Font");
        expect(punctuation).toMatch(/^'BetterShapeCustom-Font-[0-9a-f]{8}', monospace$/);
    });

    it("registers an upload again after a reload, from the slot it was kept in", async () => {
        const store = memoryStore();
        const value = await (await freshModule()).loadCustomEditorFont(fontFile("Studio.otf", [9, 9]), "terminal", store);
        faces = [];
        added = [];

        const reloaded = await freshModule();
        await reloaded.restoreCustomFonts(["'IBM Plex Mono', monospace", value], store);

        expect(faces.map((face) => `'${face.family}', monospace`)).toEqual([value]);
        expect(new Uint8Array(faces[0]?.data ?? new ArrayBuffer(0))).toEqual(new Uint8Array([9, 9]));
        expect(added).toHaveLength(1);

        // A second restore of the same family adds nothing.
        await reloaded.restoreCustomFonts([value], store);
        expect(added).toHaveLength(1);
    });

    it("reads no store for settings that name no upload, and survives a store that fails", async () => {
        const { restoreCustomFonts } = await freshModule();
        const all = vi.fn(async () => {
            throw new Error("blocked");
        });

        await restoreCustomFonts(["'IBM Plex Mono', Consolas, monospace", ""], { put: vi.fn(), all });
        expect(all).not.toHaveBeenCalled();

        await expect(
            restoreCustomFonts(["'BetterShapeCustom-Studio-0000abcd', monospace"], { put: vi.fn(), all }),
        ).resolves.toBeUndefined();
        expect(all).toHaveBeenCalledTimes(1);
        expect(added).toEqual([]);
    });

    it("still uses an upload it could not keep, and refuses a file that is not a font", async () => {
        const { loadCustomEditorFont } = await freshModule();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const failing: CustomFontStore = { put: () => Promise.reject(new Error("quota")), all: async () => [] };
        try {
            const value = await loadCustomEditorFont(fontFile("Kept.woff2", [3]), "terminal", failing);
            expect(added).toHaveLength(1);
            expect(value).toContain("BetterShapeCustom-Kept-");
            expect(warn).toHaveBeenCalledTimes(1);

            await expect(loadCustomEditorFont(fontFile("notes.txt", [1]), "terminal", failing)).rejects.toThrow(
                "Supported font formats",
            );
            loadFails = true;
            await expect(loadCustomEditorFont(fontFile("Broken.ttf", [2]), "terminal", failing)).rejects.toThrow(
                "not a font",
            );
        } finally {
            warn.mockRestore();
        }
    });
});

describe("customFontLabel", () => {
    it("names an upload without its prefix, tag, quotes or fallback", async () => {
        const { customFontLabel } = await freshModule();
        expect(customFontLabel("'BetterShapeCustom-Studio Mono-1a2b3c4d', monospace")).toBe("Studio Mono");
        // Uploads from before the tag existed show their name too.
        expect(customFontLabel("'BetterShapeCustom-StudioMono', monospace")).toBe("StudioMono");
    });

    it("unquotes the first family of any other stack, commas inside quotes included", async () => {
        const { customFontLabel } = await freshModule();
        expect(customFontLabel('"Fira Code", Consolas, monospace')).toBe("Fira Code");
        expect(customFontLabel("'IBM Plex Mono', 'Cascadia Code', Consolas, monospace")).toBe("IBM Plex Mono");
        expect(customFontLabel('"Studio, Mono", monospace')).toBe("Studio, Mono");
        expect(customFontLabel("'BetterShapeCustom-Studio, Mono'")).toBe("Studio, Mono");
    });

    it("keeps a bare family name", async () => {
        const { customFontLabel } = await freshModule();
        expect(customFontLabel("Berkeley Mono")).toBe("Berkeley Mono");
        expect(customFontLabel("  Berkeley Mono  ")).toBe("Berkeley Mono");
    });

    it("shows the whole value when the first family is empty", async () => {
        const { customFontLabel } = await freshModule();
        expect(customFontLabel("'BetterShapeCustom-', monospace")).toBe("'BetterShapeCustom-', monospace");
        expect(customFontLabel(", monospace")).toBe(", monospace");
    });

    it("leaves mismatched quotes alone", async () => {
        const { customFontLabel } = await freshModule();
        expect(customFontLabel("'Odd\", monospace")).toBe("'Odd\"");
    });
});

describe("restoring with a store that never answers", () => {
    it("lets the terminal open after a short wait instead of hanging", async () => {
        vi.useFakeTimers();
        try {
            const { restoreCustomFonts } = await freshModule();
            const never: CustomFontStore = { put: vi.fn(), all: () => new Promise<StoredFont[]>(() => {}) };
            let settled = false;
            const restoring = restoreCustomFonts(["'BetterShapeCustom-Studio-0000abcd', monospace"], never).then(() => {
                settled = true;
            });
            await vi.advanceTimersByTimeAsync(1000);
            expect(settled).toBe(false);
            await vi.advanceTimersByTimeAsync(600);
            await restoring;
            expect(settled).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});
