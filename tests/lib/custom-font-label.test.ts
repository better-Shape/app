import { afterEach, describe, expect, it, vi } from "vitest";
import { customFontLabel, loadCustomEditorFont } from "@/lib/editor/custom-fonts";

describe("customFontLabel", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("names an uploaded font without its family prefix, quotes or fallback", () => {
        expect(customFontLabel("'BetterShapeCustom-StudioMono', monospace")).toBe("StudioMono");
    });

    it("names the font an upload actually returns", async () => {
        vi.stubGlobal(
            "URL",
            class extends URL {
                static override createObjectURL(): string {
                    return "blob:font";
                }
            },
        );
        const file = new File([new Uint8Array([0, 1, 0, 0])], "Studio Mono.woff2", { type: "font/woff2" });

        const value = await loadCustomEditorFont(file);

        expect(value).toBe("'BetterShapeCustom-StudioMono', monospace");
        expect(customFontLabel(value)).toBe("StudioMono");
    });

    it("unquotes the first family of any other stack", () => {
        expect(customFontLabel('"Fira Code", Consolas, monospace')).toBe("Fira Code");
        expect(customFontLabel("'IBM Plex Mono', 'Cascadia Code', Consolas, monospace")).toBe("IBM Plex Mono");
    });

    it("keeps a bare family name", () => {
        expect(customFontLabel("Berkeley Mono")).toBe("Berkeley Mono");
        expect(customFontLabel("  Berkeley Mono  ")).toBe("Berkeley Mono");
    });

    it("shows the whole value when the first family is empty", () => {
        expect(customFontLabel("'BetterShapeCustom-', monospace")).toBe("'BetterShapeCustom-', monospace");
        expect(customFontLabel(", monospace")).toBe(", monospace");
    });

    it("leaves mismatched quotes alone", () => {
        expect(customFontLabel("'Odd\", monospace")).toBe("'Odd\"");
    });
});
