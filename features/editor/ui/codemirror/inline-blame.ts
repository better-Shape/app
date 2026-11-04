"use client";

import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from "@codemirror/view";
import { commands, getProjectPath } from "@/lib/backend";
import type { BlameLine } from "@/lib/backend/types";
import { blameEntryAt, inlineBlameLabel, toInlineBlameEntries } from "@/features/editor/lib/inline-blame";
import type { BlameEntry } from "@/features/git/ui/blame/model";

/** Result of the last `git_blame_file` for the open buffer. */
const setBlameRegions = StateEffect.define<readonly BlameEntry[]>();

const blameRegions = StateField.define<readonly BlameEntry[]>({
    create: () => [],
    update(value, transaction) {
        // A new document invalidates every line number we hold.
        if (transaction.docChanged) return [];
        for (const effect of transaction.effects) {
            if (effect.is(setBlameRegions)) return effect.value;
        }
        return value;
    },
});

class BlameWidget extends WidgetType {
    constructor(private readonly label: string) {
        super();
    }

    eq(other: BlameWidget) {
        return other.label === this.label;
    }

    toDOM() {
        // A block row under the caret line, not a trailing span: the editor
        // lives in the dock, where almost every line is longer than the view,
        // so an end-of-line annotation was scrolled out of sight every time.
        const row = document.createElement("div");
        // `w-full truncate`: a block widget sits inside `.cm-content`, which does
        // not wrap it, so an unconstrained row hangs past the right edge.
        row.className = "cm-inline-blame block w-full truncate pl-2 select-none text-xs italic text-text-muted";
        row.textContent = this.label;
        // Clicking the annotation must not move the caret into the widget.
        row.setAttribute("aria-hidden", "true");
        return row;
    }

    ignoreEvent() {
        return true;
    }
}

const blameDecoration = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(decorations, transaction) {
        const regions = transaction.state.field(blameRegions);
        if (!transaction.docChanged && !transaction.selection && regions === transaction.startState.field(blameRegions)) {
            return decorations;
        }
        if (regions.length === 0) return Decoration.none;
        const doc = transaction.state.doc;
        const head = transaction.state.selection.main.head;
        const line = doc.lineAt(head);
        const entry = blameEntryAt(regions, line.number);
        if (!entry) return Decoration.none;
        const label = inlineBlameLabel(entry, Math.floor(Date.now() / 1000));
        return Decoration.set([
            Decoration.widget({ widget: new BlameWidget(label), block: true, side: 1 }).range(line.to),
        ]);
    },
    provide: (field) => EditorView.decorations.from(field),
});

/**
 * Publishes the caret line's blame to the status bar. The annotation drawn in
 * the document is a trailing row, so a line longer than the dock hides it; the
 * status segment is the copy that is always on screen.
 */
function blameReporter() {
    return ViewPlugin.fromClass(
        class {
            private last: string | null = null;

            constructor(private readonly view: EditorView) {
                this.publish();
            }

            update(update: ViewUpdate) {
                const line = update.state.doc.lineAt(update.state.selection.main.head);
                const regions = update.state.field(blameRegions, false);
                const entry = regions ? blameEntryAt(regions, line.number) : undefined;
                const label = entry ? inlineBlameLabel(entry, Math.floor(Date.now() / 1000)) : null;
                if (label === this.last) return;
                this.last = label;
                this.publish();
            }

            destroy() {
                // Switching the setting off removes this plugin; the label has to
                // go with it, or the status bar keeps advertising a line nobody
                // is blaming any more.
                this.last = null;
                this.publish();
            }

            private publish() {
                if (typeof window === "undefined") return;
                window.dispatchEvent(
                    new CustomEvent("bettershape-editor-status", {
                        detail: { blame: this.last ?? "" },
                    }),
                );
            }
        },
    );
}

/**
 * Fetches blame for the buffer and keeps it in step with the file the editor
 * shows. The path is read through a getter because switching files reuses the
 * same `EditorView`.
 */
function blameLoader(getPath: () => string | null, isDirty: () => boolean) {
    return ViewPlugin.fromClass(
        class {
            private path: string | null = null;
            private timer: number | null = null;
            private destroyed = false;

            /** Reloads after a save: the file on disk now matches the buffer. */
            private readonly onSaved = (event: Event) => {
                const detail = (event as CustomEvent<{ path?: string }>).detail;
                if (!detail?.path || detail.path !== this.path) return;
                this.schedule();
            };

            constructor(private readonly view: EditorView) {
                window.addEventListener("bettershape-file-saved", this.onSaved);
                this.schedule();
            }

            update(update: ViewUpdate) {
                const next = getPath();
                if (next !== this.path) {
                    this.schedule();
                } else if (update.docChanged) {
                    // Editing drops the line numbers we hold, so ask git again
                    // once the typing settles.
                    this.reload(next);
                }
            }

            private reload(path: string | null) {
                if (this.timer !== null) window.clearTimeout(this.timer);
                this.timer = null;
                if (!path) return;
                this.timer = window.setTimeout(() => void this.load(path), 900);
            }

            private schedule() {
                const next = getPath();
                this.path = next;
                if (this.timer !== null) window.clearTimeout(this.timer);
                // Debounced, and never synchronous: a plugin cannot dispatch
                // while the view is being created or updated.
                this.timer = window.setTimeout(() => void this.load(next), 150);
            }

            private async load(path: string | null) {
                if (!path) {
                    if (!this.destroyed) this.view.dispatch({ effects: setBlameRegions.of([]) });
                    return;
                }
                // `git_blame_file` reads the file on disk. Blaming it while the
                // buffer holds unsaved edits would annotate shifted lines, so the
                // annotation stays off until the file is saved.
                if (isDirty()) return;
                const project = getProjectPath();
                if (!project) return;
                try {
                    const raw: BlameLine[] = await commands.gitBlameFile(project, path);
                    if (this.destroyed || this.path !== path) return;
                    this.view.dispatch({ effects: setBlameRegions.of(toInlineBlameEntries(raw)) });
                } catch {
                    // An uncommitted or untracked file simply has no blame; the
                    // annotation stays off instead of reporting an error mid-typing.
                    if (this.destroyed || this.path !== path) return;
                    this.view.dispatch({ effects: setBlameRegions.of([]) });
                }
            }

            destroy() {
                this.destroyed = true;
                window.removeEventListener("bettershape-file-saved", this.onSaved);
                if (this.timer !== null) window.clearTimeout(this.timer);
            }
        },
    );
}

/**
 * Inline blame for the caret line, driven by Settings -> Git -> Inline Git
 * Blame. Returns an empty extension when switched off so the compartment can
 * reconfigure a live editor.
 */
export function inlineBlame({
    enabled,
    getPath,
    isDirty = () => false,
}: {
    enabled: boolean;
    getPath: () => string | null;
    isDirty?: () => boolean;
}) {
    if (!enabled) return [];
    return [blameRegions, blameDecoration, blameLoader(getPath, isDirty), blameReporter()];
}
