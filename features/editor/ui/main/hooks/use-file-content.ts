import { useState, useEffect } from "react";
import { commands, useProjectState } from "@/lib/backend";
import { listen } from "@tauri-apps/api/event";
import { notify } from "@/features/notifications";

export function useFileContent(
    path: string, 
    skipTextLoad: boolean, 
    isDiff: boolean, 
    savedContentRef: React.MutableRefObject<string>,
    bufferVersionRef: React.MutableRefObject<number>
) {
    const { project_path } = useProjectState();
    const [content, setContent] = useState<string>("");
    const [originalContent, setOriginalContent] = useState<string>("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(!skipTextLoad);
    const [loadedPath, setLoadedPath] = useState(path);
    
    useEffect(() => {
        let cancelled = false;

        if (skipTextLoad) {
            return;
        }

        setLoadedPath(path);
        const cached = !isDiff ? commands.getCachedFileContent(path) : undefined;
        if (cached !== undefined) {
            setContent(cached);
            savedContentRef.current = cached;
            setError(null);
            setLoading(false);
        } else {
            setContent("");
            setLoading(true);
        }

        const reportLoadFailure = () => {
            if (!cancelled) notify.error("File Error", "Could not refresh the editor. Save your changes before reopening the file.");
        };
        let loadSeq = 0;
        const loadFile = async (showLoading = true) => {
            if (cancelled) return;
            const seq = ++loadSeq;
            if (showLoading) setLoading(true);
            setError(null);
            try {
                let currentContent = "";
                if (isDiff) {
                    const isCommitDiff = path.startsWith('diff:commit:');
                    let realPath = path;
                    let staged = false;
                    let commitHash: string | undefined;

                    if (isCommitDiff) {
                        const match = path.match(/^diff:commit:([^:]+):(.+)$/);
                        if (match) {
                            commitHash = match[1];
                            realPath = match[2];
                        } else {
                            const parts = path.split(':');
                            commitHash = parts[2];
                            realPath = parts.slice(3).join(':');
                        }
                    } else {
                        realPath = path.replace(/^diff:(staged:|unstaged:)/, '');
                        staged = path.startsWith('diff:staged:');
                    }

                    // Stale commit/diff tabs from a previous project — don't look
                    // up their SHAs in the newly opened repo.
                    if (!project_path) {
                        setOriginalContent("");
                        setContent("");
                        setLoading(false);
                        return;
                    }

                    let gitRelativePath = realPath;
                    if (realPath.startsWith(project_path)) {
                        gitRelativePath = realPath.substring(project_path.length).replace(/^[\\/]+/, "");
                    }

                    const absPath = (!realPath.includes(':') && !realPath.startsWith('/') && !realPath.startsWith('\\'))
                        ? project_path + (project_path.endsWith('/') || project_path.endsWith('\\') ? '' : '/') + realPath
                        : realPath;

                    // Absolute paths under another workspace after a project switch.
                    if (
                        (realPath.includes(':') || realPath.startsWith('/') || realPath.startsWith('\\')) &&
                        !realPath.replace(/\\/g, '/').toLowerCase().startsWith(project_path.replace(/\\/g, '/').toLowerCase()) &&
                        !isCommitDiff
                    ) {
                        setOriginalContent("");
                        setContent("");
                        setLoading(false);
                        return;
                    }

                    const repoAtStart = project_path;
                    let orig: string;
                    let mod: string;

                    try {
                        if (isCommitDiff && commitHash) {
                            const res = await commands.gitGetCommitFileContent(repoAtStart, gitRelativePath, commitHash);
                            if (cancelled || seq !== loadSeq) return;
                            orig = res[0];
                            mod = res[1];
                        } else if (staged) {
                            const [o, m] = await Promise.all([
                                commands.gitGetItemContent(repoAtStart, gitRelativePath, true),
                                commands.gitGetItemContent(repoAtStart, gitRelativePath, false)
                            ]);
                            if (cancelled || seq !== loadSeq) return;
                            orig = o;
                            mod = m;
                        } else {
                            const [o, m] = await Promise.all([
                                commands.gitGetItemContent(repoAtStart, gitRelativePath, false).catch(() => ""),
                                commands.readFile(absPath).catch(() => "")
                            ]);
                            if (cancelled || seq !== loadSeq) return;
                            orig = o;
                            mod = m;
                        }
                    } catch (e) {
                        if (cancelled || seq !== loadSeq) return;
                        const msg = e instanceof Error ? e.message : String(e);
                        const isMissingRev =
                            msg.includes("revspec") ||
                            msg.includes("not found") ||
                            msg.includes("NotFound");
                        // Missing commit after project switch — stay quiet, don't
                        // fall back to reading a path that belongs to another repo.
                        if (isCommitDiff && isMissingRev) {
                            setOriginalContent("");
                            setContent("");
                            setLoading(false);
                            return;
                        }
                        console.warn("Git content load failed:", e);
                        const fallback = await commands.readFile(absPath).catch(() => "");
                        if (cancelled || seq !== loadSeq) return;
                        orig = fallback;
                        mod = fallback;
                    }

                    setOriginalContent(orig);
                    setContent(mod);
                    currentContent = mod;
                } else {
                    const data = await commands.readFile(path);
                    if (cancelled || seq !== loadSeq) return;
                    const { loadDirtyBuffer } = await import("@/lib/workspace/dirty-buffers");
                    if (cancelled || seq !== loadSeq) return;
                    const dirty = loadDirtyBuffer(path);
                    if (dirty && dirty.content !== data) {
                        setContent(dirty.content);
                        savedContentRef.current = data;
                        currentContent = dirty.content;
                        void commands.markFileDirty(path, true).catch(reportLoadFailure);
                    } else {
                        setContent(data);
                        savedContentRef.current = data;
                        currentContent = data;
                        if (dirty) {
                            const { clearDirtyBuffer } = await import("@/lib/workspace/dirty-buffers");
                            if (cancelled || seq !== loadSeq) return;
                            clearDirtyBuffer(path);
                        }
                    }
                }

                setLoading(false);

                if (!isDiff) {
                    bufferVersionRef.current += 1;
                    const ext = path.split(".").pop()?.toLowerCase() || "";
                    window.dispatchEvent(
                        new CustomEvent("bettershape-editor-buffer", {
                            detail: {
                                path,
                                content: currentContent,
                                extension: ext,
                                version: bufferVersionRef.current,
                            },
                        })
                    );
                }
            } catch (err: unknown) {
                if (cancelled || seq !== loadSeq) return;
                const errorStr = (err as string | Error)?.toString() || String(err);
                const errorMsg = errorStr.startsWith("Message: ") ? errorStr.replace("Message: ", "") : errorStr;

                const isGitIndexError = errorMsg.includes("File not in index") || errorMsg.includes("os error 2") || errorMsg.includes("os error 3") || errorMsg.includes("cannot find the file") || errorMsg.includes("cannot find the path");
                if (isDiff && isGitIndexError) {
                    setError(errorMsg);
                    setLoading(false);
                    return;
                }

                setError(errorMsg);
                setLoading(false);

                const isAccessDenied =
                    errorMsg.includes("Access is denied") || errorMsg.includes("os error 5");
                const isCommonError =
                    errorMsg.includes("binary") ||
                    errorMsg.includes("UTF-8") ||
                    isGitIndexError ||
                    isAccessDenied;
                if (!isCommonError) {
                    console.error("Failed to read file:", err);
                    notify.error("File Error", `Failed to read file: ${errorMsg}`, { code: 4000 });
                }
            }
        };

        void loadFile(cached === undefined).catch(reportLoadFailure);

        const unlistenPromise = listen<string>("bettershape-file-edited", (event) => {
            if (cancelled) return;
            const cleanPayload = event.payload.replace(/\\/g, '/').toLowerCase();
            const cleanPath = path.replace(/\\/g, '/').toLowerCase();
            if (cleanPayload === cleanPath) {
                commands.invalidateFileCache(path);
                void import("@/lib/workspace/dirty-buffers").then(({ loadDirtyBuffer }) => {
                    if (cancelled) return;
                    const dirty = loadDirtyBuffer(path);
                    if (!dirty) void commands.markFileDirty(path, false).catch(reportLoadFailure);
                    if (dirty) {
                        notify.info(
                            "File updated by agent",
                            "Your unsaved edits remain open. Review the disk changes before saving.",
                        );
                    }
                    return loadFile(false);
                }).catch(reportLoadFailure);
            }
        });

        const norm = (r: string) => { const s = r.replace(/\\/g, "/").replace(/\/+$/, ""); return /^[a-zA-Z]:[\\/]/.test(r) || r.includes("\\") ? s.toLowerCase() : s; };
        const unlistenChangedPromise = listen<string[]>("bettershape-files-changed", (event) => {
            if (cancelled) return;
            commands.invalidateAllFileCaches();
            if (!(Array.isArray(event.payload) ? event.payload : []).some((p) => typeof p === "string" && norm(p) === norm(path))) return;
            commands.invalidateFileCache(path);
            void import("@/lib/workspace/dirty-buffers").then(({ loadDirtyBuffer }) => {
                if (!cancelled && !loadDirtyBuffer(path)) return loadFile(false);
            }).catch(reportLoadFailure);
        });

        const onGitRefresh = () => {
            if (!isDiff) return;
            void loadFile(false).catch(reportLoadFailure);
        };
        window.addEventListener("bettershape-git-refresh", onGitRefresh);

        return () => {
            cancelled = true;
            unlistenPromise.then(u => u()).catch(() => { });
            unlistenChangedPromise.then(u => u()).catch(() => { });
            window.removeEventListener("bettershape-git-refresh", onGitRefresh);
        };
    }, [path, skipTextLoad, isDiff, project_path, savedContentRef, bufferVersionRef]);

    const current = loadedPath === path;
    return { content: current ? content : "", setContent, originalContent: current ? originalContent : "", error: current ? error : null, loading: !current || loading };
}
