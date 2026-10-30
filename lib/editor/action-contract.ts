/**
 * The contract between the surfaces that ask for an editor action and the
 * CodeMirror handler that answers it.
 *
 * Three surfaces dispatch `bettershape-editor-action` with three spellings: the
 * command palette and the titlebar menu use VS Code ids (`editor.action.rename`),
 * the menubar sends some `editor.` ids (`editor.foldAll`), and the status bar and
 * the editor's own pickers send bare ids (`commentLine`). Normalising belongs
 * here so the handler and anything that gates on it agree.
 */
const EDITOR_ACTION_PREFIXES = ["editor.action.", "editor."] as const;

export function normalizeEditorAction(action: string | undefined): string | undefined {
    if (!action) return undefined;
    const prefix = EDITOR_ACTION_PREFIXES.find((candidate) => action.startsWith(candidate));
    return prefix ? action.slice(prefix.length) : action;
}

/**
 * Actions the editor cannot serve yet, keyed by their normalised id. Every one
 * of them needs an engine the repo does not ship — see
 * `.github/SERVER_INDEPENDENCE.md` §9: "Either hide them, or build the LSP
 * client — do not leave them as silent no-ops."
 *
 * Surfaced commands are filtered against this map instead of being deleted, so
 * the wording stays in one place and the wiring comes back with the engine.
 */
export const EDITOR_ACTIONS_WITHOUT_ENGINE: Readonly<Record<string, string>> = {
    rename: "Rename Symbol needs a language server (the repo has no LSP client)",
    quickFix: "Quick Fix needs diagnostics with actions, which only a language server produces",
    organizeImports: "Organize Imports needs a language server",
    revealDefinition: "Go to Definition needs a language server",
    peekDefinition: "Peek Definition needs a language server",
    "referenceSearch.trigger": "Find All References needs a language server",
    definition: "Go to Definition needs a language server",
    declaration: "Go to Declaration needs a language server",
    typeDefinition: "Go to Type Definition needs a language server",
    implementation: "Go to Implementations needs a language server",
    goToReferences: "Go to References needs a language server",
    goToSymbolInEditor: "Go to Symbol needs a language server",
    goToSymbolInWorkspace: "Go to Symbol needs a workspace index",
    inlineEdit: "Inline Edit needs a language server",
    "inlayHints.toggle": "Inlay hints need a language server",
    back: "Back needs a navigation history the editor does not keep",
    forward: "Forward needs a navigation history the editor does not keep",
    lastEditLocation: "Last Edit Location needs a navigation history the editor does not keep",
};

/** Whether the editor's action handler answers this id. */
export function editorActionImplemented(action: string | undefined): boolean {
    const normalized = normalizeEditorAction(action);
    if (!normalized) return false;
    return !(normalized in EDITOR_ACTIONS_WITHOUT_ENGINE);
}
