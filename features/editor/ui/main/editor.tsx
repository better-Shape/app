"use client";

import { stageDirtyBuffer, saveDirtyBuffer, clearDirtyBuffer } from "@/lib/workspace/dirty-buffers";

import React, { useMemo, useRef, useState, useLayoutEffect, useEffect, useCallback } from "react";
import { useEditorView } from "@/core/providers/editor";
import { useProjectState, commands } from "@/lib/backend";
import { getSettings, useSettings } from "@/lib/settings";
import { saveContents, toDiskText } from "@/lib/editor/save-pipeline";
import { diffLines } from "diff";
import { MarkdownPreview } from "../markdown/markdown";
import { Panel } from "@/features/panels";
import { getFileExtension, isImageExtension, isFontExtension } from "../../lib/image-types";

// UI Components
import { Breadcrumbs } from "./ui/breadcrumb";
import { MarkdownViewSwitch, PlanEditorHeader } from "./ui/plan-editor-header";
import { MarkdownLiveEditor } from "../markdown/live-editor";
import { LocalHistoryPicker } from "../local-history-picker";
import { ErrorView } from "./ui/error";
import { ImageView } from "./ui/image";
import { FontView } from "./ui/font";

import { getProposedEdit, clearProposedEdit, isFileResolvedForCurrentConversation } from "../../../chat/lib/proposed-edits";
import { usePerfRenderCount } from "@/lib/dev/perf-hud-hooks";
import { useFileContent } from "./hooks/use-file-content";
import { useImageLoader } from "./hooks/use-image-loader";
import { Button } from "@/components/ui/button";
import { CodeMirrorEditor } from "../codemirror/editor";
import { DiffView } from "../diff/diff-view";

import type { EditorGroupId } from "@/core/providers/editor";
import { isPlanFilePath } from "@/lib/plan/file";
import { parsePlanMarkdown } from "@/lib/plan/preview";


/** The line ending a file uses on disk, read from the bytes that were loaded. */
const lineEndingOf = (text: string): "LF" | "CRLF" => (text.includes("\r\n") ? "CRLF" : "LF");

/** Compares two documents without treating the line-ending convention as a change. */
const sameLines = (a: string, b: string) => a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");

// Main file viewer component handling various file types (text, image, markdown)
export default function FileViewer({ path, group: _group = "left", variant = "editor" }: { path: string; group?: EditorGroupId; variant?: "editor" | "workspace" }) {
    usePerfRenderCount("editor");
    const { getViewMode, setViewMode } = useEditorView();
    // getFileExtension handles diff: prefixes and display-name suffixes like " (abc1234)"
    const ext = useMemo(() => getFileExtension(path), [path]);
    const isSvg = ext === "svg";
    const isFont = useMemo(() => isFontExtension(ext), [ext]);
    const isImage = useMemo(() => isImageExtension(ext), [ext]);
    const isRasterImage = isImage && !isSvg;
    const isMarkdown = /\.(md|mdx|markdown)$/i.test(path);
    const isPlanFile = isPlanFilePath(path);
    const imagePreviewEnabled = useSettings().editor.imagePreview;
    // Image preview decides how images open. Markdown and fonts open in their
    // own previews either way, so turning image previews off must not demote them.
    const defaultMode = isImage && !imagePreviewEnabled ? "raw" : isImage || isFont || isMarkdown ? "preview" : "raw";
    const mode = getViewMode(path, defaultMode);
    const showImagePreview = isImage && imagePreviewEnabled && (mode === "preview" || mode === "split");
    const showFontPreview = isFont && (mode === "preview" || mode === "split");
    const skipTextContent = isRasterImage || (isSvg && showImagePreview) || (isFont && showFontPreview);

    const { open_files, project_path } = useProjectState();

    const fileInfo = useMemo(() => open_files.find(f => f.path === path), [path, open_files]);
    const isDiff = fileInfo?.kind === 'diff';

    // Core Refs
    const savedContentRef = useRef<string>("");
    const bufferVersionRef = useRef(0);
    const previewRef = useRef<HTMLDivElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const isDirty = useMemo(() => open_files.find(f => f.path === path)?.is_dirty || false, [path, open_files]);
    const isDirtyRef = useRef(isDirty);
    const markdownUndoRef = useRef<string[]>([]);
    const markdownRedoRef = useRef<string[]>([]);

    useEffect(() => {
        isDirtyRef.current = isDirty;
    }, [isDirty]);

    useEffect(() => {
        markdownUndoRef.current = [];
        markdownRedoRef.current = [];
    }, [path]);

    const [diffState, setDiffState] = useState<{
        original: string;
        replacement: string;
        snippetOriginal: string;
        snippetReplacement: string;
        /** Undo target for the unresolved edit chain. */
        baseline: string;
        path: string;
    } | null>(null);

    const { content, setContent, originalContent, error, loading } = useFileContent(
        path, skipTextContent, isDiff, savedContentRef, bufferVersionRef
    );

    const currentContentRef = useRef(content);
    useLayoutEffect(() => { currentContentRef.current = content; }, [content]);
    const previewAutosaveRef = useRef<number | null>(null);
    const pathRef = useRef(path);
    useLayoutEffect(() => { pathRef.current = path; }, [path]);
    useEffect(
        () => () => {
            // The viewer stays mounted while the path changes, so a timer
            // scheduled for the previous file has to be dropped with it.
            if (previewAutosaveRef.current !== null) {
                window.clearTimeout(previewAutosaveRef.current);
                previewAutosaveRef.current = null;
            }
        },
        [path],
    );

    /**
     * Writes the preview buffer through the shared save pipeline.
     *
     * The pipeline can trim or format the text, so the returned document is
     * what the preview shows afterwards; leaving the old buffer on screen would
     * both misreport the file and leave it marked dirty against its own disk
     * contents.
     */
    const persistPreview = useCallback(async () => {
        if (previewAutosaveRef.current !== null) {
            window.clearTimeout(previewAutosaveRef.current);
            previewAutosaveRef.current = null;
        }
        if (pathRef.current !== path) return;
        const doc = currentContentRef.current;
        const eol = lineEndingOf(savedContentRef.current || doc);
        try {
            const written = await saveContents(path, doc, eol);
            // Typing during the write wins: the buffer on screen is newer. A
            // path change means this text belongs to another file now.
            if (pathRef.current !== path || currentContentRef.current !== doc) return;
            currentContentRef.current = written;
            // Keep the on-disk line ending in the baseline: the next save reads
            // the convention from it, and `written` is LF by construction.
            savedContentRef.current = toDiskText(written, eol);
            setContent(written);
            clearDirtyBuffer(path);
            isDirtyRef.current = false;
            await commands.markFileDirty(path, false).catch(() => undefined);
            window.dispatchEvent(new CustomEvent("bettershape-editor-buffer", { detail: { path, content: written } }));
        } catch (e) {
            const { notify } = await import("@/features/notifications");
            notify.error("Save Error", `Failed to save file: ${e instanceof Error ? e.message : String(e)}`, {
                code: 4000,
            });
        }
    }, [path, setContent]);

    /** Schedules the autosave the editor settings ask for, if any. */
    const schedulePreviewAutosave = useCallback(() => {
        if (previewAutosaveRef.current !== null) window.clearTimeout(previewAutosaveRef.current);
        previewAutosaveRef.current = null;
        const editorSettings = getSettings().editor;
        if (editorSettings.autoSave !== "afterDelay" || !isDirtyRef.current) return;
        previewAutosaveRef.current = window.setTimeout(() => {
            previewAutosaveRef.current = null;
            void persistPreview();
        }, Math.max(250, editorSettings.autoSaveDelay));
    }, [persistPreview]);
    const planTitle = isPlanFile ? parsePlanMarkdown(content || "").title : "";

    useEffect(() => {
        const constructDiff = (origText: string, replText: string) => {
            if (!content) return { original: origText, replacement: replText };
            const nContent = content.replace(/\r\n/g, '\n');
            const nOrig = origText.replace(/\r\n/g, '\n');
            const nRepl = replText.replace(/\r\n/g, '\n');

            if (nOrig.trim() === "") {
                return { original: nContent, replacement: nRepl };
            }

            if (nContent.includes(nOrig)) {
                return { original: nContent, replacement: nContent.replace(nOrig, nRepl) };
            }

            const origTrimmed = nOrig.trim();
            if (origTrimmed && nContent.includes(origTrimmed)) {
                return { original: nContent, replacement: nContent.replace(origTrimmed, nRepl.trim()) };
            }

            // Case B: File is already in modified state (contains nRepl)
            if (nContent.includes(nRepl)) {
                return { original: nContent.replace(nRepl, nOrig), replacement: nContent };
            }

            const replTrimmed = nRepl.trim();
            if (replTrimmed && nContent.includes(replTrimmed)) {
                return { original: nContent.replace(replTrimmed, nOrig.trim()), replacement: nContent };
            }

            // Fallback sliding window fuzzy match
            const contentLines = nContent.split('\n');
            const origLines = nOrig.split('\n').map(l => l.trim()).filter(Boolean);
            if (origLines.length > 0) {
                const startIdx = contentLines.findIndex(l => l.trim() === origLines[0]);
                if (startIdx !== -1) {
                    // Try to see if next lines match roughly
                    const endIdx = startIdx + origLines.length;
                    const before = contentLines.slice(0, startIdx).join('\n');
                    const after = contentLines.slice(endIdx).join('\n');
                    return {
                        original: nContent,
                        replacement: (before ? before + '\n' : '') + nRepl + (after ? '\n' + after : '')
                    };
                }
            }

            return { original: nContent, replacement: nContent }; // Default to no-op if we really can't find it to avoid destroying file content
        };

        const applyDiffState = (
            origText: string,
            replText: string,
            snippetOriginal: string,
            snippetReplacement: string,
            baseline?: string,
        ) => {
            if (isFileResolvedForCurrentConversation(path, replText)) {
                setDiffState(null);
                return;
            }
            const diff = constructDiff(origText, replText);
            if (diff.original === diff.replacement) {
                setDiffState(null);
                return;
            }
            setDiffState({
                path,
                original: diff.original,
                replacement: diff.replacement,
                snippetOriginal,
                snippetReplacement,
                baseline: baseline ?? origText,
            });
        };

        const checkProposed = () => {
            const proposed = getProposedEdit(path);
            if (proposed) {
                applyDiffState(
                    proposed.original,
                    proposed.replacement,
                    proposed.original,
                    proposed.replacement,
                    proposed.baseline ?? proposed.original,
                );
            } else {
                setDiffState(null);
            }
        };

        checkProposed();

        const handleProposedChange = () => {
            checkProposed();
        };

        const handlePreviewDiff = (e: Event) => {
            const custom = e as CustomEvent<{ path: string; original: string; replacement: string }>;
            const eventPath = custom.detail.path.replace(/\\/g, '/').toLowerCase();
            const currentPath = path.replace(/\\/g, '/').toLowerCase();

            const eventBase = eventPath.split('/').pop() || '';
            const currentBase = currentPath.split('/').pop() || '';
            const pathsMatch = eventPath === currentPath
                || currentPath.endsWith('/' + eventPath)
                || eventPath.endsWith('/' + currentPath)
                || currentPath.endsWith(eventPath)
                || (eventBase === currentBase && eventBase.length > 0);

            if (pathsMatch) {
                if (
                    isFileResolvedForCurrentConversation(path, custom.detail.replacement)
                    || isFileResolvedForCurrentConversation(custom.detail.path, custom.detail.replacement)
                ) {
                    setDiffState(null);
                    return;
                }
                const proposed = getProposedEdit(path) || getProposedEdit(custom.detail.path);
                applyDiffState(
                    custom.detail.original,
                    custom.detail.replacement,
                    custom.detail.original,
                    custom.detail.replacement,
                    proposed?.baseline ?? custom.detail.original,
                );
            }
        };

        // Listen for dismiss-diff events from the pending edits panel
        const handleDismissDiff = (e: Event) => {
            const custom = e as CustomEvent<{ path: string; rawPath?: string }>;
            const eventPath = (custom.detail.path || '').replace(/\\/g, '/').toLowerCase();
            const rawPath = (custom.detail.rawPath || '').replace(/\\/g, '/').toLowerCase();
            const currentPath = path.replace(/\\/g, '/').toLowerCase();

            const eventBase = eventPath.split('/').pop() || '';
            const currentBase = currentPath.split('/').pop() || '';
            const pathsMatch = eventPath === currentPath
                || currentPath.endsWith('/' + eventPath)
                || eventPath.endsWith('/' + currentPath)
                || currentPath.endsWith(eventPath)
                || currentPath.endsWith('/' + rawPath)
                || rawPath.endsWith('/' + currentPath)
                || currentPath.endsWith(rawPath)
                || (eventBase === currentBase && eventBase.length > 0);

            if (pathsMatch) {
                setDiffState(null);
            }
        };

        window.addEventListener("bettershape-proposed-edits-changed", handleProposedChange);
        window.addEventListener("bettershape-editor-preview-diff", handlePreviewDiff as EventListener);
        window.addEventListener("bettershape-dismiss-diff", handleDismissDiff as EventListener);
        return () => {
            window.removeEventListener("bettershape-proposed-edits-changed", handleProposedChange);
            window.removeEventListener("bettershape-editor-preview-diff", handlePreviewDiff as EventListener);
            window.removeEventListener("bettershape-dismiss-diff", handleDismissDiff as EventListener);
        };
    }, [path, content]);

    const { additions, deletions } = useMemo(() => {
        if (!diffState) return { additions: 0, deletions: 0 };
        const changes = diffLines(diffState.original, diffState.replacement);
        let add = 0;
        let del = 0;
        changes.forEach(c => {
            if (c.added) add += c.value.split('\n').length - 1 || 1;
            if (c.removed) del += c.value.split('\n').length - 1 || 1;
        });
        return { additions: add, deletions: del };
    }, [diffState]);

    const { imageSrc, svgContent, error: imageLoadError } = useImageLoader(path, showImagePreview);

    const [zoom, setZoom] = useState(1);
    const handleWheel = (e: React.WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            setZoom(prev => Math.min(Math.max(prev + delta, 0.1), 10));
        }
    };

    // Preview-only markdown — wire Save / Undo / Redo here.
    // Must stay above early returns so hook order is stable across renders.
    useEffect(() => {
        if (!(isMarkdown && mode === "preview")) return;

        const handleSave = async () => {
            await persistPreview();
        };

        const handleEditorAction = (event: Event) => {
            const action = (event as CustomEvent<{ action?: string }>).detail?.action;
            if (action === "undo") {
                const prev = markdownUndoRef.current.pop();
                if (prev === undefined) return;
                markdownRedoRef.current.push(content);
                currentContentRef.current = prev;
                stageDirtyBuffer(path, prev, savedContentRef.current);
                setContent(prev);
                window.dispatchEvent(new CustomEvent("bettershape-editor-changed", { detail: { path } }));
                window.dispatchEvent(new CustomEvent("bettershape-editor-buffer", { detail: { path, content: prev } }));
                const dirty = !sameLines(prev, savedContentRef.current);
                isDirtyRef.current = dirty;
                void commands.markFileDirty(path, dirty).catch(() => undefined);
            } else if (action === "redo") {
                const next = markdownRedoRef.current.pop();
                if (next === undefined) return;
                markdownUndoRef.current.push(content);
                currentContentRef.current = next;
                stageDirtyBuffer(path, next, savedContentRef.current);
                setContent(next);
                window.dispatchEvent(new CustomEvent("bettershape-editor-changed", { detail: { path } }));
                window.dispatchEvent(new CustomEvent("bettershape-editor-buffer", { detail: { path, content: next } }));
                const dirty = !sameLines(next, savedContentRef.current);
                isDirtyRef.current = dirty;
                void commands.markFileDirty(path, dirty).catch(() => undefined);
            }
        };

        const onFileSaved = (event: Event) => {
            const detail = (event as CustomEvent<{ path: string; content: string }>).detail;
            if (detail?.path !== path || typeof detail.content !== "string") return;
            savedContentRef.current = detail.content;
            saveDirtyBuffer(path, currentContentRef.current, detail.content);
            isDirtyRef.current = !sameLines(currentContentRef.current, detail.content);
            // Always state the answer: a save that now matches the buffer has to
            // clear a dirty marker an earlier edit set.
            void commands.markFileDirty(path, isDirtyRef.current).catch(() => undefined);
        };
        window.addEventListener("bettershape-file-saved", onFileSaved);
        window.addEventListener("save-request", handleSave);
        window.addEventListener("bettershape-editor-action", handleEditorAction as EventListener);
        return () => {
            window.removeEventListener("bettershape-file-saved", onFileSaved);
            window.removeEventListener("save-request", handleSave);
            window.removeEventListener("bettershape-editor-action", handleEditorAction as EventListener);
        };
    }, [isMarkdown, mode, path, content, setContent, persistPreview]);

    const workspace = variant === "workspace";

    if (error) {
        return <ErrorView error={error} />;
    }

    if (showFontPreview) {
        return <FontView path={path.replace(/^diff:(un)?staged:/, "")} />;
    }

    if (isRasterImage && !imagePreviewEnabled) {
        return (
            <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 bg-editor px-6 text-center">
                <p className="text-sm text-text-secondary">
                    Image preview is off.
                </p>
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                        window.dispatchEvent(
                            new CustomEvent("bettershape-settings-navigate", { detail: { category: "editor" } }),
                        );
                        void import("@/lib/window/open-settings").then(({ openSettingsWindow }) =>
                            openSettingsWindow({ category: "editor" }),
                        );
                    }}
                >
                    Open editor settings
                </Button>
            </div>
        );
    }

    if (showImagePreview) {
        return (
            <div className="flex h-full min-h-0 w-full flex-col bg-editor overflow-hidden relative">
                {workspace ? null : (
                <div className="flex w-full items-center justify-between pr-2 min-h-[28px] shrink-0 gap-1 bg-editor">
                    <Breadcrumbs path={path} projectPath={project_path} isDiff={isDiff} isImage className="flex-1 min-w-0" />
                </div>
                )}
                <div className="relative min-h-0 w-full flex-1 overflow-hidden">
                    <ImageView
                        path={path}
                        imageSrc={imageSrc}
                        svgContent={svgContent}
                        loadError={imageLoadError}
                        zoom={zoom}
                        onZoomChange={setZoom}
                        containerRef={containerRef}
                        handleWheel={handleWheel}
                    />
                </div>
            </div>
        );
    }

    if (loading) {
        return <div className="flex-1 w-full h-full min-h-0 bg-editor" />;
    }

    const renderDiffEditor = () => {
        if (diffState) {
            return (
                <DiffView
                    path={path}
                    originalContent={diffState.original}
                    content={diffState.replacement}
                    mode="unified"
                />
            );
        }
        return (
            <DiffView
                path={path}
                originalContent={originalContent}
                content={content}
                mode="unified"
            />
        );
    };

    const renderEditor = () => {
        if (isDiff) return renderDiffEditor();
        if (diffState) {
            return (
                <div className="flex flex-col w-full h-full min-h-0 bg-editor overflow-hidden relative">
                    <div className="flex w-full items-center justify-between pr-2 min-h-[28px] shrink-0">
                        {workspace ? <span className="min-w-0 flex-1" /> : (
                        <Breadcrumbs path={path} projectPath={project_path} isDiff={isDiff} className="flex-1 min-w-0" />
                        )}
                        <div className="flex items-center gap-1 shrink-0">
                            <div className="flex items-center gap-2 pl-2 border-l border-border-subtle h-[28px] shrink-0">
                                <div className="flex items-center gap-1.5 font-sans text-xs font-medium mr-1">
                                    <span className="text-success">+{additions}</span>
                                    <span className="text-error">-{deletions}</span>
                                </div>
                                <span className="text-sm font-medium text-text-secondary">Reviewing changes</span>
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    onClick={async () => {
                                        try {
                                            window.dispatchEvent(new CustomEvent('bettershape-editor-edit-action', {
                                                detail: {
                                                    path: diffState.path,
                                                    action: 'rejected',
                                                    replacement: diffState.replacement,
                                                }
                                            }));
                                            await commands.applyFileEdit(
                                                diffState.path,
                                                "",
                                                diffState.baseline || diffState.snippetOriginal,
                                            );
                                            clearProposedEdit(diffState.path);
                                            window.dispatchEvent(new CustomEvent('bettershape-dismiss-diff', {
                                                detail: { path: diffState.path, rawPath: diffState.path }
                                            }));
                                            setDiffState(null);
                                        } catch (e) { console.error("Failed to revert diff:", e) }
                                    }}
                                >
                                    Revert
                                </Button>
                                <Button
                                    variant="default"
                                    size="xs"
                                    onClick={() => {
                                        window.dispatchEvent(new CustomEvent('bettershape-editor-edit-action', {
                                            detail: {
                                                path: diffState.path,
                                                action: 'applied',
                                                replacement: diffState.replacement,
                                            }
                                        }));
                                        clearProposedEdit(diffState.path);
                                        window.dispatchEvent(new CustomEvent('bettershape-dismiss-diff', {
                                            detail: { path: diffState.path, rawPath: diffState.path }
                                        }));
                                        setDiffState(null);
                                    }}
                                >
                                    Accept
                                </Button>
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 w-full min-h-0 overflow-hidden relative">
                        <DiffView
                            path={path}
                            originalContent={diffState.original}
                            content={diffState.replacement}
                        />
                    </div>
                </div>
            );
        }
        return (
            <div className="flex flex-col w-full h-full min-h-0 bg-editor overflow-hidden relative">
                {workspace ? null : (
                <div className="flex w-full items-center justify-between pr-2 min-h-[28px] shrink-0">
                    <Breadcrumbs path={path} projectPath={project_path} isDiff={isDiff} className="flex-1 min-w-0" />
                    {isMarkdown && !isPlanFile ? (
                        <MarkdownViewSwitch
                            raw={mode === "raw"}
                            onRawChange={(next) => setViewMode(path, next ? "raw" : "preview")}
                        />
                    ) : null}
                </div>
                )}
                <div className="flex-1 w-full min-h-0 overflow-hidden relative">
                    <CodeMirrorEditor
                        path={path}
                        content={content}
                        setContent={setContent}
                        savedContentRef={savedContentRef}
                        isDirtyRef={isDirtyRef}
                        bufferVersionRef={bufferVersionRef}
                    />
                </div>
            </div>
        );
    };

    const applyMarkdownContent = async (next: string) => {
        // Local undo stack for markdown preview edits.
        const prev = content;
        if (prev !== next) {
            markdownUndoRef.current.push(prev);
            if (markdownUndoRef.current.length > 100) markdownUndoRef.current.shift();
            markdownRedoRef.current = [];
        }
        currentContentRef.current = next;
        stageDirtyBuffer(path, next, savedContentRef.current);
        setContent(next);
        window.dispatchEvent(new CustomEvent("bettershape-editor-changed", { detail: { path } }));
        window.dispatchEvent(new CustomEvent("bettershape-editor-buffer", { detail: { path, content: next } }));
        isDirtyRef.current = !sameLines(next, savedContentRef.current);
        try {
            await commands.markFileDirty(path, isDirtyRef.current);
        } catch {
            /* ignore */
        }
        schedulePreviewAutosave();
    };

    if (isMarkdown && !isPlanFile && mode === "preview") {
        return (
            <div className="flex flex-col w-full h-full min-h-0 bg-editor overflow-hidden relative">
                {isPlanFile ? (
                    <PlanEditorHeader
                        path={path}
                        title={planTitle}
                        raw={false}
                        onRawChange={(next) => setViewMode(path, next ? "raw" : "preview")}
                    />
                ) : workspace ? null : (
                    <div className="flex w-full items-center justify-between pr-2 min-h-[28px] shrink-0">
                        <Breadcrumbs path={path} projectPath={project_path} isDiff={isDiff} className="flex-1 min-w-0" />
                        <MarkdownViewSwitch
                            raw={false}
                            onRawChange={(next) => setViewMode(path, next ? "raw" : "preview")}
                        />
                    </div>
                )}
                <div className="flex-1 w-full min-h-0 overflow-hidden relative">
                    <MarkdownLiveEditor content={content} onChange={(next) => void applyMarkdownContent(next)} path={path} />
                </div>
                <LocalHistoryPicker path={path} onRestore={(next) => void applyMarkdownContent(next)} />
            </div>
        );
    }

    if (isMarkdown && mode === "split") {
        return (
            <div className="flex-1 w-full h-full min-h-0 overflow-hidden outline-none focus:outline-none">
                <Panel
                    storageKey={`md-split-${path}`}
                    panes={[
                        {
                            id: "md-editor",
                            minSize: 150,
                            preferredSize: 500,
                            children: renderEditor(),
                        },
                        {
                            id: "md-preview",
                            minSize: 150,
                            flexible: true,
                            children: (
                                <MarkdownPreview
                                    ref={previewRef}
                                    content={content}
                                    filePath={path}
                                    projectPath={project_path}
                                    onApplyContent={(next) => void applyMarkdownContent(next)}
                                />
                            ),
                        },
                    ]}
                />
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden relative">
            {renderEditor()}
        </div>
    );
}
