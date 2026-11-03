import { describe, expect, it } from "vitest";
import type { OutlineSymbol } from "@/lib/backend/types";
import { outlineSymbols, symbolPaletteRows } from "@/features/command-palette/symbols";
import { listenCustomEvent } from "../helpers/events";

function symbol(overrides: Partial<OutlineSymbol>): OutlineSymbol {
    return {
        id: overrides.id ?? "s",
        name: overrides.name ?? "name",
        kind: overrides.kind ?? "function",
        start_line: overrides.start_line ?? 1,
        start_col: overrides.start_col ?? 1,
        end_line: overrides.end_line ?? 1,
        end_col: overrides.end_col ?? 1,
        children: overrides.children ?? [],
    };
}

describe("outline to palette symbols", () => {
    it("flattens children and keeps their depth", () => {
        const tree = [
            symbol({
                name: "boot",
                start_line: 3,
                children: [symbol({ name: "inner", start_line: 4, children: [symbol({ name: "deep", start_line: 5 })] })],
            }),
        ];

        expect(outlineSymbols("src/main.ts", tree).map((entry) => [entry.name, entry.depth, entry.line])).toEqual([
            ["boot", 0, 3],
            ["inner", 1, 4],
            ["deep", 2, 5],
        ]);
    });

    it("indents nested rows in the flat list", () => {
        const rows = symbolPaletteRows("src/main.ts", [
            symbol({ name: "boot", start_line: 3, children: [symbol({ name: "inner", start_line: 4 })] }),
        ]);

        expect(rows.map((row) => row.label)).toEqual(["boot", "  inner"]);
        expect(rows.map((row) => row.meta)).toEqual(["Ln 3", "Ln 4"]);
        expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    });

    it("jumps to the symbol's own line and column", () => {
        const jumps = listenCustomEvent<{ path: string; line: number; column: number }>("bettershape-editor-jump");
        const rows = symbolPaletteRows("src/main.ts", [symbol({ name: "boot", start_line: 7, start_col: 5 })]);

        rows[0].run();

        expect(jumps.events[0]?.detail).toEqual({ path: "src/main.ts", line: 7, column: 5 });
        jumps.off();
    });

    it("returns nothing for a file without symbols", () => {
        expect(symbolPaletteRows("src/empty.ts", [])).toEqual([]);
    });
});
