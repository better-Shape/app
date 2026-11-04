import type { OutlineSymbol } from "@/lib/backend/types";

export interface PaletteSymbol {
    id: string;
    name: string;
    kind: string;
    line: number;
    column: number;
    depth: number;
}

/**
 * Flattens the outline tree the breadcrumb already uses so "Go to Symbol in
 * Editor..." can list it. The palette mode existed but had no source, so it
 * always answered "No symbols in the current file".
 */
export function outlineSymbols(
    path: string,
    symbols: readonly OutlineSymbol[],
    depth = 0,
): PaletteSymbol[] {
    const flat: PaletteSymbol[] = [];
    for (const symbol of symbols) {
        flat.push({
            id: `${path}:${symbol.start_line}:${symbol.start_col}:${symbol.name}`,
            name: symbol.name,
            kind: symbol.kind,
            line: symbol.start_line,
            column: symbol.start_col,
            depth,
        });
        flat.push(...outlineSymbols(path, symbol.children ?? [], depth + 1));
    }
    return flat;
}

export interface SymbolPaletteRow {
    id: string;
    label: string;
    shortcut: string;
    meta: string;
    section: string;
    run: () => void;
}

/**
 * Rows for the `editor_symbols` palette mode. Children are indented rather than
 * nested: the list is flat, so depth is the only thing that shows the tree.
 */
export function symbolPaletteRows(path: string, symbols: readonly OutlineSymbol[]): SymbolPaletteRow[] {
    return outlineSymbols(path, symbols).map((symbol) => ({
        id: `symbol:${symbol.id}`,
        label: symbol.depth > 0 ? `${"  ".repeat(symbol.depth)}${symbol.name}` : symbol.name,
        shortcut: "",
        meta: `Ln ${symbol.line}`,
        section: "Symbols",
        run: () => {
            window.dispatchEvent(
                new CustomEvent("bettershape-editor-jump", {
                    detail: { path, line: symbol.line, column: symbol.column },
                }),
            );
        },
    }));
}
