"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { Annotation, EditorSelection, EditorState, Compartment } from "@codemirror/state";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    drawSelection,
    dropCursor,
    rectangularSelection,
    crosshairCursor,
    scrollPastEnd,
} from "@codemirror/view";
import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
    indentMore,
    indentLess,
    undo,
    redo,
    selectAll,
    addCursorAbove,
    addCursorBelow,
    copyLineDown,
    deleteTrailingWhitespace,
    moveLineDown,
    moveLineUp,
    toggleComment,
    toggleLineComment,
} from "@codemirror/commands";
import {
    foldGutter,
    foldKeymap,
    bracketMatching,
    indentOnInput,
    indentUnit,
    foldAll,
    unfoldAll,
} from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap, SearchQuery, setSearchQuery, findNext, findPrevious, selectMatches, getSearchQuery, openSearchPanel } from "@codemirror/search";
import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
} from "@codemirror/autocomplete";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { stageDirtyBuffer, saveDirtyBuffer, flushDirtyBuffers } from "@/lib/workspace/dirty-buffers";
import { commands, getProjectPath } from "@/lib/backend";
import { saveContents, toDiskText } from "@/lib/editor/save-pipeline";
import { getSettings } from "@/lib/settings";
import { notify } from "@/features/notifications";
import { getEditorOptionsFromSettings, subscribeSettings } from "@/lib/settings";
import { languageForPath, languageNameForPath } from "./lang";
import { joinSelectedLines, sortSelectionLines, transformSelectionCase } from "@/features/editor/lib/line-actions";
import { gotoBracket } from "@/features/editor/lib/bracket-actions";
import { betterShapeSyntaxLinter } from "./syntax-lint";
import { BETTERSHAPE_CLIP_CODE, rememberBetterShapeClip } from "@/features/chat/lib/bettershape-clip";
import { betterShapeEditorChrome } from "./theme";
import { lintGutter } from "@codemirror/lint";

/**
 * Three different surfaces dispatch `bettershape-editor-action`: the command
 * palette and titlebar menu use VS Code-style ids (`editor.action.commentLine`),
 * while the status bar and the editor's own pickers send bare ids
 * (`commentLine`). The switch below was written against the bare form only, so
 * every `editor.action.*` entry was a silent no-op. Normalise once here instead
 * of duplicating every case under both spellings.
 */
const EDITOR_ACTION_PREFIX = "editor.action.";

function normalizeEditorAction(action: string | undefined): string | undefined {
    if (!action) return undefined;
    return action.startsWith(EDITOR_ACTION_PREFIX)
        ? action.slice(EDITOR_ACTION_PREFIX.length)
        : action;
}
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context";

/**
 * The most recently focused CodeMirror view. Menu/shortcut "editor actions"
 * target this one, so a split view never edits the wrong buffer.
 */

/**
 * Extensions that mirror Settings -> Editor and can change while a file is
 * open. They live in a compartment so a settings change reconfigures the live
 * editor instead of waiting for the file to be reopened.
 */
const optionExtensions = (options: ReturnType<typeof getEditorOptionsFromSettings>) => [
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

let activeView: EditorView | null = null;
const externalContentUpdate = Annotation.define<boolean>();

function sameIgnoringEol(a: string, b: string): boolean {
    return a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");
}

export function CodeMirrorEditor({
    path,
    content,
    setContent,
    savedContentRef,
    isDirtyRef,
    bufferVersionRef,
}: {
    path: string;
    content: string;
    setContent: (v: string) => void;
    savedContentRef: React.MutableRefObject<string>;
    isDirtyRef: React.MutableRefObject<boolean>;
    bufferVersionRef: React.MutableRefObject<number>;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const pathRef = useRef(path);
    const setContentRef = useRef(setContent);
    useLayoutEffect(() => { setContentRef.current = setContent; }, [setContent]);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        const lang = languageForPath(path);
        const langCompartment = new Compartment();
        const wrapCompartment = new Compartment();
        // Line highlight, cursor blink, scroll past end and indent guides are
        // all read from settings, so they need to be reconfigurable too.
        const optionsCompartment = new Compartment();
        // Indentation and line-separator are user-visible settings (Settings ->
        // Editor) and are also driven by the status bar's Indentation / EOL
        // pickers, so they live in compartments rather than being fixed at
        // construction time.
        const indentCompartment = new Compartment();
        const eolCompartment = new Compartment();
        // Seed from Settings -> Editor. `getEditorOptionsFromSettings()` is the
        // tested settings->editor mapper; before this it had no production caller
        // and every editor setting except font family/size was inert.
        const editorOptions = getEditorOptionsFromSettings();
        let wrapEnabled = editorOptions.wordWrap !== "off";
        let insertSpaces = editorOptions.insertSpaces !== false;
        let tabSize =
            typeof editorOptions.tabSize === "number" && editorOptions.tabSize > 0
                ? editorOptions.tabSize
                : 4;
        let eol: "LF" | "CRLF" = editorOptions.defaultEol === "CRLF" ? "CRLF" : "LF";
        const applyIndent = (v: EditorView) => {
            v.dispatch({
                effects: indentCompartment.reconfigure([
                    EditorState.tabSize.of(tabSize),
                    indentUnit.of(insertSpaces ? " ".repeat(tabSize) : "\t"),
                ]),
            });
        };
        const applyEol = (v: EditorView) => {
            v.dispatch({
                effects: eolCompartment.reconfigure(
                    EditorState.lineSeparator.of(eol === "CRLF" ? "\r\n" : "\n"),
                ),
            });
        };

        /**
         * Cursor/indent/language report. The breadcrumb, the symbol chain and the
         * status bar all listen for this event — publishing it is what keeps them
         * in step with the buffer.
         */
        const publishStatus = (view: EditorView) => {
            const head = view.state.selection.main.head;
            const line = view.state.doc.lineAt(head);
            window.dispatchEvent(
                new CustomEvent("bettershape-editor-status", {
                    detail: {
                        path: pathRef.current,
                        line: line.number,
                        column: head - line.from + 1,
                        spaces: 4,
                        insertSpaces: true,
                        eol: view.state.lineBreak === "\r\n" ? "CRLF" : "LF",
                        language: languageNameForPath(pathRef.current),
                    },
                }),
            );
        };

        /**
         * The current selection, for the chat's selection context. Chat has
         * always listened for this event; nothing published it, so selecting
         * code and then asking about it attached nothing. Capped so a careless
         * "select all" on a huge file cannot blow up a prompt.
         */
        const SELECTION_CONTEXT_LIMIT = 8000;
        const publishSelection = (view: EditorView) => {
            const range = view.state.selection.main;
            let detail: {
                path: string;
                startLine: number;
                endLine: number;
                text: string;
            } | null = null;
            if (!range.empty) {
                const raw = view.state.sliceDoc(range.from, range.to);
                detail = {
                    path: pathRef.current,
                    startLine: view.state.doc.lineAt(range.from).number,
                    endLine: view.state.doc.lineAt(range.to).number,
                    text:
                        raw.length > SELECTION_CONTEXT_LIMIT
                            ? `${raw.slice(0, SELECTION_CONTEXT_LIMIT)}\n… (selection truncated)`
                            : raw,
                };
            }
            window.dispatchEvent(
                new CustomEvent("bettershape-editor-selection", { detail }),
            );
        };

        /** Buffer contents for the outline parser, debounced while typing. */
        let bufferTimer: number | null = null;
        const publishBuffer = (view: EditorView) => {
            window.dispatchEvent(
                new CustomEvent("bettershape-editor-buffer", {
                    detail: {
                        path: pathRef.current,
                        content: view.state.doc.toString(),
                        extension: pathRef.current.split(".").pop() ?? "",
                        version: bufferVersionRef.current,
                    },
                }),
            );
        };
        const scheduleBuffer = (view: EditorView) => {
            if (bufferTimer !== null) window.clearTimeout(bufferTimer);
            bufferTimer = window.setTimeout(() => {
                bufferTimer = null;
                publishBuffer(view);
            }, 250);
        };
        const state = EditorState.create({
            // CodeMirror splits the doc on the line separator, so a CRLF string
            // would otherwise seed one giant line. The doc holds `\n` breaks and
            // the separator only records what to write back on save.
            doc: content.replace(/\r\n/g, "\n"),
            extensions: [
                ...betterShapeEditorChrome(),
                search({ top: false }),
                lineNumbers(),
                highlightSpecialChars(),
                history(),
                foldGutter({
                    openText: "▾",
                    closedText: "▸",
                }),
                optionsCompartment.of(optionExtensions(editorOptions)),
                dropCursor(),
                EditorState.allowMultipleSelections.of(true),
                indentCompartment.of([
                    EditorState.tabSize.of(tabSize),
                    indentUnit.of(insertSpaces ? " ".repeat(tabSize) : "\t"),
                ]),
                eolCompartment.of(EditorState.lineSeparator.of(eol === "CRLF" ? "\r\n" : "\n")),
                indentOnInput(),
                bracketMatching({ brackets: "()[]{}«»‹›" }),
                closeBrackets(),
                autocompletion({
                    activateOnTyping: true,
                    maxRenderedOptions: 12,
                    defaultKeymap: true,
                }),
                rectangularSelection(),
                crosshairCursor(),
                highlightSelectionMatches({ highlightWordAroundCursor: true }),
                keymap.of([
                    ...closeBracketsKeymap,
                    ...defaultKeymap,
                    // Ctrl+F opens CodeMirror's search panel (the global shortcut
                    // handler leaves "Find" to the focused surface).
                    ...searchKeymap,
                    ...historyKeymap,
                    ...foldKeymap,
                    ...completionKeymap,
                    indentWithTab,
                    { key: "Mod-]", run: indentMore },
                    { key: "Mod-[", run: indentLess },
                ]),
                wrapCompartment.of(wrapEnabled ? EditorView.lineWrapping : []),
                langCompartment.of(lang ? [lang, betterShapeSyntaxLinter(path), lintGutter()] : []),
                EditorView.updateListener.of((update) => {
                    if (!update.docChanged) {
                        // Moving the caret in the focused view moves the breadcrumb.
                        if ((update.selectionSet || update.focusChanged) && update.view.hasFocus) {
                            publishStatus(update.view);
                        }
                        // Deliberately published even when focus is elsewhere:
                        // the point of a selection is to attach it to a question
                        // typed in the chat, which blurs the editor first.
                        if (update.selectionSet) publishSelection(update.view);
                        return;
                    }
                    if (update.transactions.some((transaction) => transaction.annotation(externalContentUpdate))) {
                        publishBuffer(update.view);
                        return;
                    }
                    const next = update.state.doc.toString();
                    stageDirtyBuffer(pathRef.current, next, savedContentRef.current);
                    setContentRef.current(next);
                    window.dispatchEvent(new CustomEvent("bettershape-editor-changed", { detail: { path: pathRef.current } }));
                    const dirty = !sameIgnoringEol(toDiskText(next, eol), savedContentRef.current);
                    isDirtyRef.current = dirty;
                    bufferVersionRef.current += 1;
                    void commands.markFileDirty(pathRef.current, dirty).catch(() => undefined);
                    scheduleAutosave(dirty);
                    scheduleBuffer(update.view);
                    if (update.view.hasFocus) publishStatus(update.view);
                    if (update.selectionSet || update.docChanged) publishSelection(update.view);
                }),
                EditorView.domEventHandlers({
                    dragstart(event, view) {
                        const sel = view.state.selection.main;
                        if (sel.empty) return;
                        const text = view.state.sliceDoc(sel.from, sel.to);
                        if (!text) return;
                        const path = pathRef.current;
                        event.dataTransfer?.setData(
                            BETTERSHAPE_CLIP_CODE,
                            JSON.stringify({ path, text }),
                        );
                        event.dataTransfer?.setData("text/plain", text);
                        rememberBetterShapeClip({ kind: "code", text, label: path });
                        return false;
                    },
                    keydown(e) {
                        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                            e.preventDefault();
                            void persistNow();
                            return true;
                        }
                        return false;
                    },
                    blur() {
                        if (getSettings().editor.autoSave === "onFocusChange") void persistNow();
                    },
                }),
            ],
        });

        const view = new EditorView({ state, parent: host });
        viewRef.current = view;
        // A settings change reaches the open document, not only the next one.
        const unsubscribeSettings = subscribeSettings(() => {
            view.dispatch({
                effects: optionsCompartment.reconfigure(optionExtensions(getEditorOptionsFromSettings())),
            });
        });
        pathRef.current = path;

        let autosaveTimer: number | null = null;
        /** Writes the current buffer through the shared save pipeline. */
        const persistNow = async () => {
            const live = viewRef.current;
            if (!live) return;
            const doc = live.state.doc.toString();
            try {
                const written = await saveContents(pathRef.current, doc, eol);
                // Typing during the write keeps the buffer dirty; an unchanged
                // buffer is clean whether or not the write changed the text.
                if (viewRef.current !== live || live.state.doc.toString() !== doc) return;
                if (written !== doc) {
                    live.dispatch({
                        changes: { from: 0, to: doc.length, insert: written },
                        annotations: externalContentUpdate.of(true),
                    });
                    setContentRef.current(written);
                    publishBuffer(live);
                }
                // The prepared text is what is on disk now, so it is the baseline
                // the dirty check compares against.
                savedContentRef.current = written;
                isDirtyRef.current = false;
                void commands.markFileDirty(pathRef.current, false).catch(() => undefined);
            } catch (error) {
                notify.error("Save failed", error instanceof Error ? error.message : String(error));
            }
        };
        const scheduleAutosave = (dirty: boolean) => {
            if (autosaveTimer !== null) {
                window.clearTimeout(autosaveTimer);
                autosaveTimer = null;
            }
            const editorSettings = getSettings().editor;
            if (!dirty || editorSettings.autoSave !== "afterDelay") return;
            autosaveTimer = window.setTimeout(() => {
                autosaveTimer = null;
                void persistNow();
            }, Math.max(250, editorSettings.autoSaveDelay));
        };
        // Seed both consumers: the breadcrumb reads the buffer for its symbol
        // chain, and the status bar wants a caret position before the first key.
        publishBuffer(view);
        if (view.hasFocus) publishStatus(view);
        publishSelection(view);
        const fileName = path.split(/[\\/]/).pop() || path;
        const described = LanguageDescription.matchFilename(languages, fileName);
        if (described) {
            void described.load().then((support) => {
                if (viewRef.current !== view) return;
                view.dispatch({
                    effects: langCompartment.reconfigure([support, betterShapeSyntaxLinter(path), lintGutter()]),
                });
            }).catch(() => {});
        }
        const onSearch = (event: Event) => {
            const detail = (event as CustomEvent<{
                path?: string;
                query?: string;
                caseSensitive?: boolean;
                regexp?: boolean;
                nav?: "next" | "prev";
            }>).detail;
            if (!detail || detail.path !== pathRef.current) return;
            // "Find in File" sends no query: open and focus the panel instead of
            // setting an empty search that shows nothing.
            if (detail.query === undefined) {
                openSearchPanel(view);
                return;
            }
            const query = new SearchQuery({
                search: detail.query || "",
                caseSensitive: Boolean(detail.caseSensitive),
                regexp: Boolean(detail.regexp),
            });
            view.dispatch({ effects: setSearchQuery.of(query) });
            if (detail.nav === "next") findNext(view);
            if (detail.nav === "prev") findPrevious(view);
        };
        window.addEventListener("bettershape-editor-search", onSearch as EventListener);

        const jumpToPosition = (v: EditorView, line: number, column = 1) => {
            const total = v.state.doc.lines;
            const target = Math.min(Math.max(Math.trunc(line) || 1, 1), total);
            const info = v.state.doc.line(target);
            const offset = Math.max(0, Math.trunc(column) - 1);
            const pos = Math.min(info.from + offset, info.to);
            v.dispatch({
                selection: EditorSelection.cursor(pos),
                effects: EditorView.scrollIntoView(pos, { y: "center" }),
            });
            v.focus();
        };

        const onJump = (event: Event) => {
            const v = viewRef.current;
            if (!v || activeView !== v) return;
            const detail = (event as CustomEvent<{ path?: string; line?: number; column?: number }>).detail;
            if (!detail || (detail.path && detail.path !== pathRef.current)) return;
            if (typeof detail.line !== "number") return;
            jumpToPosition(v, detail.line, detail.column ?? 1);
        };

        const onEditorAction = (event: Event) => {
            const v = viewRef.current;
            if (!v || activeView !== v) return;
            const detail = (event as CustomEvent<{
                action?: string;
                line?: number;
                column?: number;
                value?: unknown;
            }>).detail;
            switch (normalizeEditorAction(detail?.action)) {
                case "undo":
                    undo(v);
                    break;
                case "redo":
                    redo(v);
                    break;
                case "selectAll":
                    selectAll(v);
                    break;
                case "jumpToPosition":
                    jumpToPosition(v, detail.line ?? 1, detail.column ?? 1);
                    break;
                case "goToBracket": {
                    const target = gotoBracket(v.state, v.state.selection.main.head);
                    if (target !== null) {
                        v.dispatch({ selection: EditorSelection.cursor(target) });
                    }
                    break;
                }
                case "toggleWordWrap":
                    wrapEnabled = !wrapEnabled;
                    v.dispatch({
                        effects: wrapCompartment.reconfigure(
                            wrapEnabled ? EditorView.lineWrapping : [],
                        ),
                    });
                    break;
                case "indentLines":
                    indentMore(v);
                    break;
                case "outdentLines":
                    indentLess(v);
                    break;
                case "commentLine":
                    toggleLineComment(v);
                    break;
                case "blockComment":
                    toggleComment(v);
                    break;
                case "moveLinesUpAction":
                    moveLineUp(v);
                    break;
                case "moveLinesDownAction":
                    moveLineDown(v);
                    break;
                case "copyLinesDownAction":
                    copyLineDown(v);
                    break;
                case "insertCursorAbove":
                    addCursorAbove(v);
                    break;
                case "insertCursorBelow":
                    addCursorBelow(v);
                    break;
                case "trimTrailingWhitespace":
                    deleteTrailingWhitespace(v);
                    break;
                case "transformToLowercase":
                    transformSelectionCase("lower")(v);
                    break;
                case "transformToUppercase":
                    transformSelectionCase("upper")(v);
                    break;
                case "transformToTitlecase":
                    transformSelectionCase("title")(v);
                    break;
                case "sortLinesAscending":
                    sortSelectionLines("asc")(v);
                    break;
                case "sortLinesDescending":
                    sortSelectionLines("desc")(v);
                    break;
                case "joinLines":
                    joinSelectedLines(v);
                    break;
                case "foldAll":
                    foldAll(v);
                    break;
                case "unfoldAll":
                    unfoldAll(v);
                    break;
                case "selectHighlights": {
                    // `selectMatches` is a Command that acts on whatever the
                    // search panel is currently matching, so guard on an empty
                    // query first rather than selecting nothing silently.
                    if (!getSearchQuery(v.state).search.trim()) break;
                    selectMatches(v);
                    break;
                }
                case "marker.next":
                    findNext(v);
                    break;
                case "marker.prev":
                    findPrevious(v);
                    break;
                case "setInsertSpaces":
                    insertSpaces = detail.value !== false;
                    applyIndent(v);
                    break;
                case "setTabSize": {
                    const size = Number(detail.value);
                    if (!Number.isInteger(size) || size < 1 || size > 8) break;
                    tabSize = size;
                    applyIndent(v);
                    break;
                }
                case "setEol":
                    eol = detail.value === "CRLF" ? "CRLF" : "LF";
                    applyEol(v);
                    break;
                case "setLanguage": {
                    const requested =
                        typeof detail.value === "string" ? detail.value.toLowerCase() : "";
                    const described = requested
                        ? LanguageDescription.matchLanguageName(languages, requested)
                        : null;
                    if (!described) {
                        // Unknown name, or the picker asked for auto-detect: fall
                        // back to the language implied by the file extension.
                        const detected = languageForPath(path);
                        v.dispatch({
                            effects: langCompartment.reconfigure(
                                detected
                                    ? [detected, betterShapeSyntaxLinter(path), lintGutter()]
                                    : [],
                            ),
                        });
                        publishStatus(v);
                        break;
                    }
                    // `matchLanguageName` returns a LanguageDescription; the
                    // compartment needs the loaded LanguageSupport, which is async.
                    void described
                        .load()
                        .then((support) => {
                            const live = viewRef.current;
                            if (!live) return;
                            live.dispatch({
                                effects: langCompartment.reconfigure([
                                    support,
                                    betterShapeSyntaxLinter(path),
                                    lintGutter(),
                                ]),
                            });
                            publishStatus(live);
                        })
                        .catch(() => undefined);
                    break;
                }
                case "format":
                case "formatDocument":
                case "formatSelection": {
                    // Prettier formats whole documents; selection formatting falls back to it.
                    const source = v.state.doc.toString();
                    void commands
                        .prettierFormatFile(getProjectPath() ?? "", pathRef.current, source)
                        .then((formatted) => {
                            const live = viewRef.current;
                            if (!live || typeof formatted !== "string" || !formatted || formatted === source) return;
                            // Drop the result if the user typed while formatting ran;
                            // replacing the document would discard those edits.
                            if (live.state.doc.toString() !== source) return;
                            live.dispatch({
                                changes: { from: 0, to: live.state.doc.length, insert: formatted },
                            });
                        })
                        .catch(() => undefined);
                    break;
                }
                default:
                    break;
            }
        };

        const onFileSaved = (event: Event) => {
            const detail = (event as CustomEvent<{ path: string; content: string }>).detail;
            if (detail?.path !== pathRef.current || typeof detail.content !== "string") return;
            savedContentRef.current = detail.content;
            const current = view.state.doc.toString();
            const savedForCompare = toDiskText(current, eol);
            saveDirtyBuffer(pathRef.current, current, detail.content);
            const dirty = !sameIgnoringEol(savedForCompare, detail.content);
            isDirtyRef.current = dirty;
            // Always state the answer: the tab could have been dirty before this
            // save, and skipping the false case leaves that marker behind.
            void commands.markFileDirty(pathRef.current, dirty).catch(() => undefined);
        };
        window.addEventListener("bettershape-file-saved", onFileSaved);
        const onFlushBuffer = (event: Event) => {
            const requested = (event as CustomEvent<{ path: string }>).detail?.path;
            if (requested === pathRef.current) publishBuffer(view);
        };
        window.addEventListener("bettershape-editor-flush-buffer", onFlushBuffer);

        const markActive = () => {
            activeView = view;
            publishStatus(view);
        };
        if (!activeView) activeView = view;
        view.dom.addEventListener("focusin", markActive);
        view.dom.addEventListener("pointerdown", markActive);
        window.addEventListener("bettershape-editor-action", onEditorAction as EventListener);
        window.addEventListener("bettershape-editor-jump", onJump as EventListener);

        return () => {
            publishBuffer(view);
            flushDirtyBuffers();
            window.removeEventListener("bettershape-file-saved", onFileSaved);
            window.removeEventListener("bettershape-editor-flush-buffer", onFlushBuffer);
            window.removeEventListener("bettershape-editor-search", onSearch as EventListener);
            window.removeEventListener("bettershape-editor-action", onEditorAction as EventListener);
            window.removeEventListener("bettershape-editor-jump", onJump as EventListener);
            view.dom.removeEventListener("focusin", markActive);
            view.dom.removeEventListener("pointerdown", markActive);
            if (activeView === view) activeView = null;
            if (bufferTimer !== null) window.clearTimeout(bufferTimer);
            if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
            unsubscribeSettings();
            view.destroy();
            viewRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- content synced separately
    }, [path]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        const normalized = content.replace(/\r\n/g, "\n");
        if (current === normalized) return;
        view.dispatch({
            changes: { from: 0, to: current.length, insert: normalized },
            annotations: externalContentUpdate.of(true),
        });
    }, [content]);

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div
                    ref={hostRef}
                    className="h-full min-h-0 w-full overflow-hidden bg-panel"
                    // CodeMirror saves/formats the buffer itself; the window
                    // handler must not run the same chord a second time.
                    data-shortcut-owner="Ctrl+S,Ctrl+Shift+S,Alt+Shift+F"
                />
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-44">
                <ContextMenuItem
                    onClick={() => {
                        const v = viewRef.current;
                        if (v) undo(v);
                    }}
                >
                    Undo
                </ContextMenuItem>
                <ContextMenuItem
                    onClick={() => {
                        const v = viewRef.current;
                        if (v) redo(v);
                    }}
                >
                    Redo
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                    onClick={() => {
                        const v = viewRef.current;
                        if (!v) return;
                        const sel = v.state.selection.main;
                        const text = v.state.sliceDoc(sel.from, sel.to);
                        if (!text) return;
                        void navigator.clipboard.writeText(text).then(() => {
                            v.dispatch({ changes: { from: sel.from, to: sel.to, insert: "" } });
                        });
                    }}
                >
                    Cut
                </ContextMenuItem>
                <ContextMenuItem
                    onClick={() => {
                        const v = viewRef.current;
                        if (!v) return;
                        const sel = v.state.selection.main;
                        const text = v.state.sliceDoc(sel.from, sel.to);
                        if (text) void navigator.clipboard.writeText(text);
                    }}
                >
                    Copy
                </ContextMenuItem>
                <ContextMenuItem
                    onClick={() => {
                        const v = viewRef.current;
                        if (!v) return;
                        void navigator.clipboard.readText().then((text) => {
                            v.dispatch(v.state.replaceSelection(text));
                        });
                    }}
                >
                    Paste
                </ContextMenuItem>
                <ContextMenuItem
                    onClick={() => {
                        const v = viewRef.current;
                        if (v) selectAll(v);
                    }}
                >
                    Select All
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
