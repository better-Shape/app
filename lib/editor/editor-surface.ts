/**
 * Which editor surface the user is working in.
 *
 * The file editor and the Markdown document editor are two CodeMirror
 * instances, and only the file editor answers `bettershape-editor-action`. The
 * command palette asks this module before it offers a row that would otherwise
 * close the palette and do nothing.
 *
 * Focus decides it, not mounting: a split view holds both at once, and the row
 * has to follow the pane the user last touched. A claim carries the owner that
 * made it, so a viewer that changes file or leaves cannot clear a claim another
 * pane made in the meantime.
 *
 * `document` is the Markdown live editor, which answers undo, redo and a jump.
 * `rendered` is the read-only preview beside it in split view, which answers no
 * editor action at all: a row offered there would close the palette and do
 * nothing.
 */
export type EditorSurface = "codemirror" | "document" | "rendered";

type Claim = { surface: EditorSurface; owner: string };

let claim: Claim | null = null;
let ownerSeq = 0;

/** A stable id for one editor instance, used to release only its own claim. */
export function createSurfaceOwner(): string {
    ownerSeq += 1;
    return `editor-surface-${ownerSeq}`;
}

export function claimEditorSurface(owner: string, surface: EditorSurface): void {
    claim = { surface, owner };
}

/** Drops the claim only when this owner still holds it. */
export function releaseEditorSurface(owner: string): void {
    if (claim?.owner === owner) claim = null;
}

/** The surface holding focus, or null when nothing has claimed it. */
export function getActiveEditorSurface(): EditorSurface | null {
    return claim?.surface ?? null;
}
