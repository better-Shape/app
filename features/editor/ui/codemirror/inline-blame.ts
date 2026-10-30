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
        const span = document.createElement("span");
        span.className = "cm-inline-blame ml-3 select-none text-xs italic text-text-muted";
        span.textContent = this.label;
        // Clicking the annotation must not move the caret into the widget.
        span.setAttribute("aria-hidden", "true");
        return span;
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
            Decoration.widget({ widget: new BlameWidget(label), side: 1 }).range(line.to),
        ]);
    },
    provide: (field) => EditorView.decorations.from(field),
});

/**
 * Fetches blame for the buffer and keeps it in step with the file the editor
 * shows. The path is read through a getter because switching files reuses the
 * same `EditorView`.
 */
function blameLoader(getPath: () => string | null) {
    return ViewPlugin.fromClass(
        class {
            private path: string | null = null;
            private timer: number | null = null;
            private destroyed = false;

            constructor(private readonly view: EditorView) {
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
export function inlineBlame({ enabled, getPath }: { enabled: boolean; getPath: () => string | null }) {
    if (!enabled) return [];
    return [blameRegions, blameDecoration, blameLoader(getPath)];
}
