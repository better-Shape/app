import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    EDITOR_ACTIONS_WITHOUT_ENGINE,
    editorActionImplemented,
    normalizeEditorAction,
} from "@/lib/editor/action-contract";

describe("editor action contract", () => {
    it("folds the three spellings onto one id", () => {
        expect(normalizeEditorAction("editor.action.commentLine")).toBe("commentLine");
        expect(normalizeEditorAction("editor.foldAll")).toBe("foldAll");
        expect(normalizeEditorAction("commentLine")).toBe("commentLine");
    });

    it("keeps ids that only look prefixed", () => {
        expect(normalizeEditorAction("editorial")).toBe("editorial");
        expect(normalizeEditorAction(undefined)).toBeUndefined();
    });

    it("answers the menubar's fold and unfold ids", () => {
        expect(editorActionImplemented("editor.foldAll")).toBe(true);
        expect(editorActionImplemented("editor.unfoldAll")).toBe(true);
    });

    it("reports the commands that need an engine as unimplemented", () => {
        for (const id of ["editor.action.rename", "quickFix", "referenceSearch.trigger", "inlineEdit"]) {
            expect(editorActionImplemented(id)).toBe(false);
        }
    });

    it("answers the commands the handler does implement", () => {
        for (const id of ["undo", "editor.action.commentLine", "trimTrailingWhitespace", "cut"]) {
            expect(editorActionImplemented(id)).toBe(true);
        }
    });

    it("explains every gap it declares", () => {
        for (const [id, reason] of Object.entries(EDITOR_ACTIONS_WITHOUT_ENGINE)) {
            expect(reason.length, id).toBeGreaterThan(20);
        }
    });
});

describe("editor action contract and the handler", () => {
    const handler = readFileSync(
        join(process.cwd(), "features/editor/ui/codemirror/editor.tsx"),
        "utf8",
    );
    const handled = new Set([...handler.matchAll(/case "([A-Za-z.]+)":/g)].map((match) => match[1]));

    it("does not declare an action the handler already answers", () => {
        const contradictory = [...handled].filter((id) => id in EDITOR_ACTIONS_WITHOUT_ENGINE);
        expect(contradictory).toEqual([]);
    });

    it("answers every id the contract says is implemented", () => {
        // A surface gated on the contract would otherwise promise a command the
        // switch still ignores; this is the assertion that keeps them paired.
        const gated = ["cut", "copy", "paste", "foldAll", "unfoldAll", "trimTrailingWhitespace"];
        expect(gated.filter((id) => !handled.has(id))).toEqual([]);
    });
});
