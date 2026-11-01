/**
 * Which editor surface the user is working in.
 *
 * The file editor and the Markdown document editor are two CodeMirror
 * instances, and only the file editor answers `bettershape-editor-action`. The
 * command palette asks this module before it offers a row that would otherwise
 * close the palette and do nothing.
 *
 * Focus decides it, not mounting: a split view holds both at once, and the row
 * has to follow the pane the user last touched.
 */
export type EditorSurface = "codemirror" | "preview";

let activeSurface: EditorSurface | null = null;

export function setActiveEditorSurface(surface: EditorSurface | null): void {
    activeSurface = surface;
}

/** The surface holding focus, or null when nothing has claimed it. */
export function getActiveEditorSurface(): EditorSurface | null {
    return activeSurface;
}
