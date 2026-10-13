"use client";

import { lazy, Suspense, type ComponentType } from "react";

type CmdPaletteMod = { CommandPalette: ComponentType };

function loadCommandPalette(): Promise<{ default: ComponentType }> {
    const g = globalThis as typeof globalThis & {
        __bettershapeCmdPalettePromise?: Promise<{ default: ComponentType }>;
    };
    if (!g.__bettershapeCmdPalettePromise) {
        g.__bettershapeCmdPalettePromise = import("@/features/command-palette").then(
            (m: CmdPaletteMod) => ({ default: m.CommandPalette }),
        );
    }
    return g.__bettershapeCmdPalettePromise;
}

const CommandPalette = lazy(() => loadCommandPalette());

/** Always mounted so Ctrl+K / sidebar Search open reliably on first press. */
export function CommandPaletteBridge() {
    return (
        <Suspense fallback={null}>
            <CommandPalette />
        </Suspense>
    );
}
