import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EDITOR_ACTIONS_WITHOUT_ENGINE, normalizeEditorAction } from "@/lib/editor/action-contract";

const HANDLER = "features/editor/ui/codemirror/editor.tsx";

/** Every source file that dispatches an editor action, minus the handler. */
function dispatchers(): string[] {
    const listed = execSync(
        "grep -rl bettershape-editor-action --include=*.ts --include=*.tsx features lib components",
        { cwd: process.cwd(), encoding: "utf8" },
    )
        .trim()
        .split("\n")
        .filter(Boolean);
    return listed.filter((file) => file !== HANDLER);
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
