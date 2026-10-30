"use client";

import { EditorView } from "@codemirror/view";
import {
    drawSelection,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightTrailingWhitespace,
    highlightWhitespace,
    scrollPastEnd,
} from "@codemirror/view";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { bracketColors } from "@/features/editor/ui/codemirror/bracket-colors";
import { minimap } from "@/features/editor/ui/codemirror/minimap";
import type { getEditorOptionsFromSettings } from "@/lib/settings";

type EditorOptions = ReturnType<typeof getEditorOptionsFromSettings>;

/** Draws CodeMirror's caret element as the cursor style the setting names. */
export function cursorStyleFor(style: string): Record<string, string> {
    switch (style) {
        case "block":
            return { borderLeftColor: "transparent", background: "currentColor", width: "0.65em", opacity: "0.55" };
        case "block-outline":
            return { border: "1px solid currentColor", borderLeftColor: "currentColor", width: "0.65em", opacity: "0.7" };
        case "underline":
            return { borderLeftColor: "transparent", borderBottom: "2px solid currentColor", height: "0" };
        case "underline-thin":
            return { borderLeftColor: "transparent", borderBottom: "1px solid currentColor", height: "0" };
        case "line-thin":
            return { borderLeftWidth: "1px" };
        default:
            return { borderLeftWidth: "2px" };
    }
}

/**
 * The indent one Tab press inserts: spaces to the configured tab size, or a tab
 * character when the user asked for tabs. Both editors use it, so the status
 * bar's "Spaces: n" describes what Tab actually does.
 */
export function indentUnitFor(options: EditorOptions): string {
    if (options.insertSpaces === false) return "\t";
    const size = typeof options.tabSize === "number" && options.tabSize > 0 ? options.tabSize : 4;
    return " ".repeat(size);
}

/**
 * Extensions that mirror Settings -> Editor and can change while a file is
 * open. They live in a compartment so a settings change reconfigures the live
 * editor instead of waiting for the file to be reopened.
 *
 * Both editors use this list: a setting that reaches the code editor and not
 * the Markdown document editor is a setting that works on some files only.
 */
export const optionExtensions = (options: EditorOptions) => [
    // Render whitespace: CodeMirror has "all" and "trailing" decorators, and no
    // selection-scoped one, so "selection" is the same as off rather than a lie
    // about a decoration that does not exist.
    ...(options.renderWhitespace === "all"
        ? [highlightWhitespace()]
        : options.renderWhitespace === "trailing" || options.renderWhitespace === "boundary"
          ? [highlightTrailingWhitespace()]
          : []),
    // Font ligatures and the scroll feel come from the settings the font is
    // drawn with, so they belong on the same compartment as the sizes.
    EditorView.theme({
        "&": { fontFeatureSettings: options.fontLigatures ? '"liga" 1, "calt" 1' : '"liga" 0, "calt" 0' },
        ".cm-scroller": { scrollBehavior: options.smoothScrolling ? "smooth" : "auto" },
        // The caret glyphs CodeMirror ships are a thin left border; a block and
        // an underline are the same element drawn differently.
        ".cm-cursor": cursorStyleFor(options.cursorStyle),
    }),
    ...(options.renderLineHighlight === "none"
        ? []
        : [
              ...(options.renderLineHighlight === "gutter" || options.renderLineHighlight === "all"
                  ? [highlightActiveLineGutter()]
                  : []),
              ...(options.renderLineHighlight === "line" || options.renderLineHighlight === "all"
                  ? [highlightActiveLine()]
                  : []),
          ]),
    ...(options.bracketPairColorization.enabled ? [bracketColors()] : []),
    ...(options.minimap.enabled ? [minimap()] : []),
    drawSelection({ cursorBlinkRate: options.cursorBlinking === "solid" ? 0 : 1100 }),
    ...(options.scrollBeyondLastLine ? [scrollPastEnd()] : []),
    ...(options.guides.indentation
        ? [
              indentationMarkers({
                  highlightActiveBlock: options.guides.highlightActiveIndentation,
                  markerType: "codeOnly",
                  thickness: 1,
                  activeThickness: 1.5,
                  colors: {
                      light: "rgba(0,0,0,0.08)",
                      dark: "rgba(255,255,255,0.07)",
                      activeLight: "rgba(0,0,0,0.18)",
                      activeDark: "rgba(255,255,255,0.16)",
                  },
              }),
          ]
        : []),
];
