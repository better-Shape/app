"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { Annotation, EditorSelection, EditorState, Compartment } from "@codemirror/state";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
    EditorView,
    keymap,
    lineNumbers,
    highlightSpecialChars,
    dropCursor,
    rectangularSelection,
    crosshairCursor,
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
import { optionExtensions } from "@/features/editor/ui/codemirror/options";
import { stageDirtyBuffer, saveDirtyBuffer, loadDirtyBuffer, flushDirtyBuffers, clearSavedDirtyBuffer } from "@/lib/workspace/dirty-buffers";
import { commands, getProjectPath } from "@/lib/backend";
import { saveContents, toDiskText } from "@/lib/editor/save-pipeline";
import { rememberLiveEol } from "@/lib/editor/live-eol";
import { jumpToPosition } from "@/lib/editor/jump-to-position";
import { requestLocalHistory } from "@/lib/editor/local-history";
import { LocalHistoryPicker } from "@/features/editor/ui/local-history-picker";
import { getSettings } from "@/lib/settings";
import { notify } from "@/features/notifications";
import { getEditorOptionsFromSettings, subscribeSettings, updateSettingSection } from "@/lib/settings";
import { languageForPath, languageNameForPath } from "./lang";
import { detectIndentation } from "@/features/editor/lib/detect-indentation";
import { joinSelectedLines, sortSelectionLines, transformSelectionCase } from "@/features/editor/lib/line-actions";
import { gotoBracket } from "@/features/editor/lib/bracket-actions";
import { runClipboardAction } from "@/features/editor/lib/clipboard-actions";
import { normalizeEditorAction } from "@/lib/editor/action-contract";
import { betterShapeSyntaxLinter } from "./syntax-lint";
import { BETTERSHAPE_CLIP_CODE, rememberBetterShapeClip } from "@/features/chat/lib/bettershape-clip";
import { betterShapeEditorChrome } from "./theme";
import { lintGutter } from "@codemirror/lint";
import { inlineBlame } from "./inline-blame";

// `normalizeEditorAction` lives in the shared contract so the surfaces that
// offer a command and the switch that answers it agree on one spelling; the
// same module declares the ids that have no engine yet.
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

let activeView: EditorView | null = null;
const externalContentUpdate = Annotation.define<boolean>();

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
    /** Set by the mount effect; the content effect calls through it. */
    const contentSyncRef = useRef<((text: string) => void) | null>(null);
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
        // Settings -> Git -> Inline Git Blame can be flipped while a file is
        // open, so the annotation lives in its own compartment.
        const blameCompartment = new Compartment();
        let blameEnabled = getSettings().git.blame.enabled;
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
        // What the settings last said, so a settings emission that changed
        // nothing here cannot overwrite a manual choice made in the status bar.
        let seenIndentSetting = `${editorOptions.tabSize ?? ""}\u0000${editorOptions.insertSpaces ?? ""}\u0000${editorOptions.detectIndentation ?? ""}`;
        let seenWrapSetting = editorOptions.wordWrap;
        // The file's own line ending wins for an existing file: `defaultEol` is
        // the convention for a new one, not a conversion order. Saving a CRLF
        // file under the LF default used to rewrite every line ending.
        const loadedText = savedContentRef.current || content;
        // Set when the status bar picks an ending, so a file that finishes loading
        // afterwards does not override the choice.
        let eolChosenByUser = false;
        let eol: "LF" | "CRLF" = loadedText.includes("\r\n")
            ? "CRLF"
            : loadedText.length > 0
              ? "LF"
              : editorOptions.defaultEol === "CRLF"
                ? "CRLF"
                : "LF";
        // Settings -> Editor -> "Detect indentation": match the buffer instead of
        // reindenting a two-space file with four.
        if (editorOptions.detectIndentation === true) {
            const detected = detectIndentation(content);
            if (detected) {
                tabSize = detected.tabSize;
                insertSpaces = detected.insertSpaces;
            }
        }
        const applyIndent = (v: EditorView) => {
            v.dispatch({
                effects: indentCompartment.reconfigure([
                    EditorState.tabSize.of(tabSize),
                    indentUnit.of(insertSpaces ? " ".repeat(tabSize) : "\t"),
                ]),
            });
        };
        const applyEol = (v: EditorView) => {
            // The registry is what menu saves read, so it follows the choice.
            rememberLiveEol(pathRef.current, eol);
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
            // Menu saves have no view to ask, so record the ending this file
            // was loaded with for them.
            rememberLiveEol(pathRef.current, view.state.lineBreak === "\r\n" ? "CRLF" : "LF");
            window.dispatchEvent(
                new CustomEvent("bettershape-editor-status", {
                    detail: {
                        path: pathRef.current,
                        line: line.number,
                        column: head - line.from + 1,
                        // Live values, not the shipped defaults: the status bar
                        // used to say "Spaces: 4" over a two-space file and kept
                        // saying it after the Indentation picker changed the unit.
                        spaces: tabSize,
                        insertSpaces,
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
        // Set before the state is built: extensions read it while they are
        // constructed (inline blame fetches for the path it sees).
        pathRef.current = path;
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
                blameCompartment.of(
                    inlineBlame({
                        enabled: blameEnabled,
                        getPath: () => pathRef.current,
                        isDirty: () => isDirtyRef.current,
                    }),
                ),
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
                    const dirty = toDiskText(next, eol) !== savedContentRef.current;
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
                        // Saving a clean buffer would rewrite the file on every
                        // focus change, and a trim or a formatter can turn that
                        // into a content change nobody asked for.
                        if (getSettings().editor.autoSave === "onFocusChange" && isDirtyRef.current) {
                            void persistNow();
                        }
                    },
                }),
            ],
        });

        const view = new EditorView({ state, parent: host });
        viewRef.current = view;
        // A settings change reaches the open document, not only the next one.
        const unsubscribeSettings = subscribeSettings(() => {
            const next = getEditorOptionsFromSettings();
            const effects = [optionsCompartment.reconfigure(optionExtensions(next))];
            // Indentation and wrapping live in their own compartments, so a
            // Settings change has to reach the open document here. Without this
            // the setting only applied to the next file the user opened.
            //
            // The live values are not the settings: the status bar's Indentation
            // picker and the word-wrap command change them too. Acting whenever
            // they differ would undo those choices on the next unrelated settings
            // emission, so this only acts when the setting itself moved.
            const indentSetting = `${next.tabSize ?? ""}\u0000${next.insertSpaces ?? ""}\u0000${next.detectIndentation ?? ""}`;
            const indentSettingChanged = indentSetting !== seenIndentSetting;
            seenIndentSetting = indentSetting;
            let indentChanged = false;
            if (indentSettingChanged) {
                let nextTabSize =
                    typeof next.tabSize === "number" && next.tabSize > 0 ? next.tabSize : 4;
                let nextInsertSpaces = next.insertSpaces !== false;
                // Detect indentation is a standing instruction to read the buffer,
                // so it re-detects rather than imposing the configured unit on a
                // file that was opened with its own.
                const detected = next.detectIndentation === true
                    ? detectIndentation(view.state.doc.toString())
                    : null;
                if (detected) {
                    nextTabSize = detected.tabSize;
                    nextInsertSpaces = detected.insertSpaces;
                }
                indentChanged = nextTabSize !== tabSize || nextInsertSpaces !== insertSpaces;
                if (indentChanged) {
                    tabSize = nextTabSize;
                    insertSpaces = nextInsertSpaces;
                    effects.push(
                        indentCompartment.reconfigure([
                            EditorState.tabSize.of(tabSize),
                            indentUnit.of(insertSpaces ? " ".repeat(tabSize) : "\t"),
                        ]),
                    );
                }
            }
            const nextWrap = next.wordWrap !== "off";
            const wrapSettingChanged = next.wordWrap !== seenWrapSetting;
            seenWrapSetting = next.wordWrap;
            if (wrapSettingChanged && nextWrap !== wrapEnabled) {
                wrapEnabled = nextWrap;
                effects.push(
                    wrapCompartment.reconfigure(nextWrap ? EditorView.lineWrapping : []),
                );
            }
            const nextBlame = getSettings().git.blame.enabled;
            // Reconfiguring the compartment throws away the reporter and builds
            // a new one, which blanks the status segment and repeats the blame
            // fetch. Only a real change is worth that.
            if (nextBlame !== blameEnabled) {
                blameEnabled = nextBlame;
                effects.push(
                    blameCompartment.reconfigure(
                        inlineBlame({
                            enabled: nextBlame,
                            getPath: () => pathRef.current,
                            isDirty: () => isDirtyRef.current,
                        }),
                    ),
                );
            }
            view.dispatch({ effects });
            // The status bar reports the live indent unit, so state the new one.
            if (indentChanged) publishStatus(view);
        });
        pathRef.current = path;
        // Recorded at open, not only on the first status report: a file that is
        // never focused still has an ending a menu save must keep.
        rememberLiveEol(path, eol);

        /**
         * Adopts text that arrived after the editor opened.
         *
         * The first open of a file can start with an empty buffer while the read
         * is in flight, so the indentation and the line ending derived above came
         * from nothing. Both are derived again from the text that actually loads.
         */
        const syncContent = (text: string) => {
            const v = viewRef.current;
            if (!v) return;
            // The ending is read before the text comparison: a file that came back
            // as CRLF over an LF buffer is the same document and different bytes.
            let eolChanged = false;
            // The disk text is the file's own convention; the prop is whatever the
            // loader normalized it to, which is LF.
            const diskText = savedContentRef.current || text;
            if (!eolChosenByUser && diskText.length > 0) {
                const loadedEnding: "LF" | "CRLF" = diskText.includes("\r\n") ? "CRLF" : "LF";
                if (loadedEnding !== eol) {
                    eol = loadedEnding;
                    eolChanged = true;
                }
            }
            const current = v.state.doc.toString();
            const normalized = text.replace(/\r\n/g, "\n");
            if (current !== normalized) {
                v.dispatch({
                    changes: { from: 0, to: current.length, insert: normalized },
                    annotations: externalContentUpdate.of(true),
                });
                if (getSettings().editor.detectIndentation === true) {
                    const detected = detectIndentation(normalized);
                    if (detected && (detected.tabSize !== tabSize || detected.insertSpaces !== insertSpaces)) {
                        tabSize = detected.tabSize;
                        insertSpaces = detected.insertSpaces;
                        applyIndent(v);
                    }
                }
            }
            if (eolChanged) {
                applyEol(v);
                // The dirty answer depends on the ending, so it is stated again.
                const dirty = toDiskText(v.state.doc.toString(), eol) !== savedContentRef.current;
                isDirtyRef.current = dirty;
                void commands.markFileDirty(pathRef.current, dirty).catch(() => undefined);
            }
            publishStatus(v);
        };
        contentSyncRef.current = syncContent;

        /**
         * Replaces the buffer with the text a save wrote, keeping the caret.
         *
         * Replacing the whole document maps a cursor into the replaced range back
         * to its start, which jumps the caret to the top without this mapping.
         */
        const applyWrittenText = (live: EditorView, written: string, doc: string) => {
            if (written === doc) return;
            const head = Math.min(live.state.selection.main.head, written.length);
            live.dispatch({
                changes: { from: 0, to: doc.length, insert: written },
                selection: EditorSelection.cursor(head),
                annotations: externalContentUpdate.of(true),
            });
            setContentRef.current(written);
            publishBuffer(live);
        };

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
                applyWrittenText(live, written, doc);
                // The prepared text is what is on disk now, so it is the baseline
                // the dirty check compares against, in the disk ending: the
                // preview reads its own ending from this ref.
                const onDisk = toDiskText(written, eol);
                savedContentRef.current = onDisk;
                isDirtyRef.current = false;
                // The draft in recovery is the text from before the save. Rebase it
                // on what was written, so reopening the file cannot restore an
                // older copy over the bytes that are on disk now.
                saveDirtyBuffer(pathRef.current, written, onDisk);
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
                // Auto Save can be switched off while the delay is pending, and a
                // timer that fires anyway would write the file after the setting
                // that asked for it was turned off.
                if (getSettings().editor.autoSave !== "afterDelay") return;
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
                // The keyboard bindings are native; a menubar click is not.
                case "cut":
                    runClipboardAction(v, "cut");
                    break;
                case "copy":
                    runClipboardAction(v, "copy");
                    break;
                case "paste":
                    runClipboardAction(v, "paste");
                    break;
                case "localHistory":
                    requestLocalHistory(pathRef.current);
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
                case "toggleMinimap":
                    // The minimap lives in the options compartment, so the command
                    // and the Settings switch drive the same one place.
                    updateSettingSection("editor", { minimap: !getSettings().editor.minimap });
                    break;
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
                    // The status bar reads the live unit from this report.
                    publishStatus(v);
                    break;
                case "setTabSize": {
                    const size = Number(detail.value);
                    if (!Number.isInteger(size) || size < 1 || size > 8) break;
                    tabSize = size;
                    applyIndent(v);
                    publishStatus(v);
                    break;
                }
                case "setEol": {
                    const requested = detail.value === "CRLF" ? "CRLF" : "LF";
                    // The choice counts even when it matches the provisional default:
                    // the file may still be loading, and its own ending would
                    // otherwise replace what the user just asked for.
                    eolChosenByUser = true;
                    if (requested === eol) break;
                    eol = requested;
                    applyEol(v);
                    // The ending is part of the file's bytes. Without marking the
                    // buffer dirty, a clean file would never be written and the
                    // conversion the user asked for would be lost.
                    const doc = v.state.doc.toString();
                    const dirty = toDiskText(doc, eol) !== savedContentRef.current;
                    isDirtyRef.current = dirty;
                    if (dirty) stageDirtyBuffer(pathRef.current, doc, savedContentRef.current);
                    void commands.markFileDirty(pathRef.current, dirty).catch(() => undefined);
                    if (dirty) scheduleAutosave(true);
                    publishStatus(v);
                    break;
                }
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
                    if (!getSettings().prettier.enable) {
                        notify.info("Prettier is off", "Turn on Prettier in Settings to format files.");
                        break;
                    }
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
            const dirty = savedForCompare !== detail.content;
            isDirtyRef.current = dirty;
            // Always state the answer: the tab could have been dirty before this
            // save, and skipping the false case leaves that marker behind.
            void commands.markFileDirty(pathRef.current, dirty).catch(() => undefined);
        };
        window.addEventListener("bettershape-file-saved", onFileSaved);
        /**
         * A save started elsewhere (Save All, Save As) went through the pipeline
         * with the text this editor was showing. Adopting the written text keeps
         * the buffer and the file in step; a doc that has moved on since is the
         * user typing, and that stays dirty.
         */
        const onBufferSaved = (event: Event) => {
            const detail = (event as CustomEvent<{ path?: string; content?: string; submitted?: string }>).detail;
            const live = viewRef.current;
            if (!live || !detail || detail.path !== pathRef.current) return;
            if (typeof detail.content !== "string" || typeof detail.submitted !== "string") return;
            if (live.state.doc.toString() !== detail.submitted) return;
            applyWrittenText(live, detail.content, detail.submitted);
            const onDisk = toDiskText(detail.content, eol);
            savedContentRef.current = onDisk;
            isDirtyRef.current = false;
            saveDirtyBuffer(pathRef.current, detail.content, onDisk);
            void commands.markFileDirty(pathRef.current, false).catch(() => undefined);
        };
        window.addEventListener("bettershape-buffer-saved", onBufferSaved as EventListener);
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
            window.removeEventListener("bettershape-buffer-saved", onBufferSaved as EventListener);
            window.removeEventListener("bettershape-editor-flush-buffer", onFlushBuffer);
            window.removeEventListener("bettershape-editor-search", onSearch as EventListener);
            window.removeEventListener("bettershape-editor-action", onEditorAction as EventListener);
            window.removeEventListener("bettershape-editor-jump", onJump as EventListener);
            view.dom.removeEventListener("focusin", markActive);
            view.dom.removeEventListener("pointerdown", markActive);
            if (activeView === view) activeView = null;
            if (bufferTimer !== null) window.clearTimeout(bufferTimer);
            if (autosaveTimer !== null) {
                window.clearTimeout(autosaveTimer);
                autosaveTimer = null;
            }
            // Closing the file, or switching to another one, must not be how an
            // after-delay autosave goes missing: Auto Save asked for the write, so
            // write the buffer now instead of leaving it only in recovery.
            if (getSettings().editor.autoSave === "afterDelay") {
                const pending = view.state.doc.toString();
                const pendingPath = pathRef.current;
                if (toDiskText(pending, eol) !== savedContentRef.current) {
                    void saveContents(pendingPath, pending, eol)
                        .then(() => {
                            // The file can be reopened and edited while this write
                            // is in flight; that newer text owns the dirty marker,
                            // and this save describes older bytes.
                            const newer = loadDirtyBuffer(pendingPath);
                            if (newer && newer.content !== pending) return;
                            clearSavedDirtyBuffer(pendingPath, pending);
                            return commands.markFileDirty(pendingPath, false).catch(() => undefined);
                        })
                        .catch(() => undefined);
                }
            }
            unsubscribeSettings();
            contentSyncRef.current = null;
            view.destroy();
            viewRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- content synced separately
    }, [path]);

    useEffect(() => {
        // The sync lives in the mount effect, which holds the indentation and the
        // line ending this editor is using.
        contentSyncRef.current?.(content);
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
                {/* The menubar dispatches the same three actions; one
                    implementation keeps the failure handling honest (the old
                    inline cut dropped the edit when the clipboard refused). */}
                <ContextMenuItem
                    onClick={() => {
                        const v = viewRef.current;
                        if (v) runClipboardAction(v, "cut");
                    }}
                >
                    Cut
                </ContextMenuItem>
                <ContextMenuItem
                    onClick={() => {
                        const v = viewRef.current;
                        if (v) runClipboardAction(v, "copy");
                    }}
                >
                    Copy
                </ContextMenuItem>
                <ContextMenuItem
                    onClick={() => {
                        const v = viewRef.current;
                        if (v) runClipboardAction(v, "paste");
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
                <ContextMenuSeparator />
                <ContextMenuItem
                    onClick={() =>
                        window.dispatchEvent(
                            new CustomEvent("bettershape-editor-action", { detail: { action: "localHistory" } })
                        )
                    }
                >
                    Local history...
                </ContextMenuItem>
            </ContextMenuContent>
            <LocalHistoryPicker
                path={path}
                onRestore={(restored) => {
                    // A picker opened for this file can answer after the viewer moved
                    // to another one; writing the old history into the new buffer is
                    // the wrong file's text.
                    if (pathRef.current !== path) return;
                    const view = viewRef.current;
                    if (!view) {
                        setContentRef.current(restored);
                        return;
                    }
                    // A plain transaction, so the normal change path stages the
                    // buffer, recomputes dirtiness and leaves the restore undoable.
                    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: restored } });
                }}
            />
        </ContextMenu>
    );
}
