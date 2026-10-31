import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { EDITOR_ACTIONS_WITHOUT_ENGINE, normalizeEditorAction } from "@/lib/editor/action-contract";

const HANDLER = "features/editor/ui/codemirror/editor.tsx";

/**
 * Source roots that can dispatch an editor action. Walked in Node rather than
 * shelled out to `grep`, which a Windows checkout does not have.
 */
const ROOTS = ["features", "lib", "components", "app", "core"];

function sourceFiles(directory: string, found: string[] = []): string[] {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
            sourceFiles(full, found);
            continue;
        }
        if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
    }
    return found;
}

/** Every source file that dispatches an editor action, minus the handler. */
function dispatchers(): string[] {
    const handler = join(process.cwd(), HANDLER);
    return ROOTS.filter((root) => existsSync(join(process.cwd(), root)))
        .flatMap((root) => sourceFiles(join(process.cwd(), root)))
        .filter((file) => file !== handler)
        .filter((file) => readFileSync(file, "utf8").includes("bettershape-editor-action"))
        .map((file) => relative(process.cwd(), file).split("\\").join("/"));
}

/**
 * Dispatched ids come in three spellings and two shapes (`detail: { action: "x" }`
 * on one line, or wrapped), so look at the text after each mention of the event
 * rather than trying to match one call layout.
 */
function dispatchedActions(source: string): string[] {
    const found: string[] = [];
    for (const match of source.matchAll(/bettershape-editor-action/g)) {
        const window = source.slice(match.index, match.index + 240);
        const id = /action:\s*"([A-Za-z][\w.]*)"/.exec(window);
        if (id) found.push(id[1]);
    }
    return found;
}

describe("editor action dispatch coverage", () => {
    const handler = readFileSync(join(process.cwd(), HANDLER), "utf8");
    const handled = new Set([...handler.matchAll(/case "([A-Za-z.]+)":/g)].map((m) => m[1]));

    it("walks the source roots it claims to", () => {
        // An empty list would make the coverage assertion below vacuous.
        expect(dispatchers().length).toBeGreaterThan(0);
    });

    it("answers or declares every action a surface dispatches", () => {
        const unanswered: string[] = [];
        for (const file of dispatchers()) {
            const source = readFileSync(join(process.cwd(), file), "utf8");
            for (const id of dispatchedActions(source)) {
                const normalized = normalizeEditorAction(id) ?? id;
                if (handled.has(normalized)) continue;
                if (normalized in EDITOR_ACTIONS_WITHOUT_ENGINE) continue;
                unanswered.push(`${normalized} <- ${file}`);
            }
        }
        expect([...new Set(unanswered)]).toEqual([]);
    });
});
