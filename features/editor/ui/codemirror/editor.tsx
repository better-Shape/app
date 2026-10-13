"use client";

import { useEffect, useRef } from "react";
import { EditorSelection, EditorState, Compartment } from "@codemirror/state";
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
} from "@codemirror/commands";
import {
    foldGutter,
    foldKeymap,
    bracketMatching,
    indentOnInput,
    indentUnit,
} from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap, SearchQuery, setSearchQuery, findNext, findPrevious } from "@codemirror/search";
import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
} from "@codemirror/autocomplete";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { commands, getProjectPath } from "@/lib/backend";
import { languageForPath, languageNameForPath } from "./lang";
import { betterShapeSyntaxLinter } from "./syntax-lint";
import { BETTERSHAPE_CLIP_CODE, rememberBetterShapeClip } from "@/features/chat/lib/bettershape-clip";
import { betterShapeEditorChrome } from "./theme";
import { lintGutter } from "@codemirror/lint";
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

export function CodeMirrorEditor({
    path,
    content,
    setContent,
    savedContentRef,
    isDirtyRef,
    bufferVersionRef,
    isFirstLoadRef,
}: {
    path: string;
    content: string;
    setContent: (v: string) => void;
    savedContentRef: React.MutableRefObject<string>;
    isDirtyRef: React.MutableRefObject<boolean>;
    bufferVersionRef: React.MutableRefObject<number>;
    isFirstLoadRef: React.MutableRefObject<boolean>;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const pathRef = useRef(path);
    const setContentRef = useRef(setContent);
    setContentRef.current = setContent;

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        const lang = languageForPath(path);
        const langCompartment = new Compartment();
        const wrapCompartment = new Compartment();
        let wrapEnabled = false;

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
            doc: content,
            extensions: [
                ...betterShapeEditorChrome(),
                search({ top: false }),
                lineNumbers(),
                highlightActiveLineGutter(),
                highlightActiveLine(),
                highlightSpecialChars(),
                history(),
                foldGutter({
                    openText: "▾",
                    closedText: "▸",
                }),
                drawSelection({ cursorBlinkRate: 1100 }),
                dropCursor(),
                scrollPastEnd(),
                EditorState.allowMultipleSelections.of(true),
                EditorState.tabSize.of(4),
                indentUnit.of("    "),
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
                indentationMarkers({
                    highlightActiveBlock: true,
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
                wrapCompartment.of([]),
                langCompartment.of(lang ? [lang, betterShapeSyntaxLinter(path), lintGutter()] : []),
                EditorView.updateListener.of((update) => {
                    if (!update.docChanged) {
                        // Moving the caret in the focused view moves the breadcrumb.
                        if ((update.selectionSet || update.focusChanged) && update.view.hasFocus) {
                            publishStatus(update.view);
                        }
                        return;
                    }
                    const next = update.state.doc.toString();
                    setContentRef.current(next);
                    const dirty = next !== savedContentRef.current;
                    isDirtyRef.current = dirty;
                    bufferVersionRef.current += 1;
                    void commands.markFileDirty(pathRef.current, dirty);
                    scheduleBuffer(update.view);
                    if (update.view.hasFocus) publishStatus(update.view);
                }),
                EditorView.domEventHandlers({
                    dragstart(event, view) {
                        const sel = view.state.selection.main;
                        if (sel.empty) return false;
                        const text = view.state.sliceDoc(sel.from, sel.to);
                        if (!text) return false;
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
                            const view = viewRef.current;
                            if (!view) return true;
                            const text = view.state.doc.toString();
                            void (async () => {
                                try {
                                    await commands.saveFile(pathRef.current, text);
                                    savedContentRef.current = text;
                                    isDirtyRef.current = false;
                                    void commands.markFileDirty(pathRef.current, false);
                                } catch {
                                    /* ignore */
                                }
                            })();
                            return true;
                        }
                        return false;
                    },
                }),
            ],
        });

        const view = new EditorView({ state, parent: host });
        viewRef.current = view;
        pathRef.current = path;
        // Seed both consumers: the breadcrumb reads the buffer for its symbol
        // chain, and the status bar wants a caret position before the first key.
        publishBuffer(view);
        if (view.hasFocus) publishStatus(view);
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
            const query = new SearchQuery({
                search: detail.query || "",
                caseSensitive: Boolean(detail.caseSensitive),
                regexp: Boolean(detail.regexp),
            });
            view.dispatch({ effects: setSearchQuery.of(query) });
            if (detail.nav === "next") findNext(view);
            if (detail.nav === "prev") findPrevious(view);
            let count = 0;
            if (detail.query && query.valid) {
                const cursor = query.getCursor(view.state);
                for (let step = cursor.next(); !step.done; step = cursor.next()) count += 1;
            }
            window.dispatchEvent(
                new CustomEvent("bettershape-editor-search-count", { detail: { path: pathRef.current, count } }),
            );
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
            const detail = (event as CustomEvent<{ action?: string; line?: number; column?: number }>).detail;
            switch (detail?.action) {
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
                case "toggleWordWrap":
                    wrapEnabled = !wrapEnabled;
                    v.dispatch({
                        effects: wrapCompartment.reconfigure(
                            wrapEnabled ? EditorView.lineWrapping : [],
                        ),
                    });
                    break;
                case "format":
                case "formatSelection": {
                    // Prettier formats whole documents; selection formatting falls back to it.
                    const source = v.state.doc.toString();
                    void commands
                        .prettierFormatFile(getProjectPath() ?? "", pathRef.current, source)
                        .then((formatted) => {
                            const live = viewRef.current;
                            if (!live || typeof formatted !== "string" || !formatted || formatted === source) return;
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

        const markActive = () => {
            activeView = view;
            publishStatus(view);
        };
        if (!activeView) activeView = view;
        view.dom.addEventListener("focusin", markActive);
        view.dom.addEventListener("pointerdown", markActive);
        window.addEventListener("bettershape-editor-action", onEditorAction as EventListener);
        window.addEventListener("bettershape-editor-jump", onJump as EventListener);
        if (isFirstLoadRef.current) {
            isFirstLoadRef.current = false;
            savedContentRef.current = content;
        }

        return () => {
            window.removeEventListener("bettershape-editor-search", onSearch as EventListener);
            window.removeEventListener("bettershape-editor-action", onEditorAction as EventListener);
            window.removeEventListener("bettershape-editor-jump", onJump as EventListener);
            view.dom.removeEventListener("focusin", markActive);
            view.dom.removeEventListener("pointerdown", markActive);
            if (activeView === view) activeView = null;
            if (bufferTimer !== null) window.clearTimeout(bufferTimer);
            view.destroy();
            viewRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- content synced separately
    }, [path]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (current === content) return;
        view.dispatch({
            changes: { from: 0, to: current.length, insert: content },
        });
    }, [content]);

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div ref={hostRef} className="h-full min-h-0 w-full overflow-hidden bg-panel" />
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
