"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { commands, useProjectState } from "@/lib/backend";
import { cn } from "@/lib/utils";
import {
    BETTERSHAPE_MODAL_PANEL_CLASS,
    BETTERSHAPE_OVERLAY_CLASS,
    BETTERSHAPE_OVERLAY_CONTENT_CLASS,
} from "@/lib/ui/modal-overlay";
import { useOverlayRoot } from "@/lib/ui/overlay-root";
import { normalizePath, resolveProjectFilePath } from "@/lib/path/utils";

const DEFAULT_NAME = "untitled.txt";

/**
 * Host for `bettershape-explorer-create` (Ctrl+N / File ▸ New Text File /
 * command palette). The file is created inside the open project and opened in
 * the editor; a trailing slash creates a folder instead.
 */
export function NewFilePromptHost() {
    const { project_path } = useProjectState();
    const overlayRoot = useOverlayRoot();
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState(DEFAULT_NAME);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const onCreate = () => {
            setError(null);
            setValue(DEFAULT_NAME);
            setOpen(true);
        };
        window.addEventListener("bettershape-explorer-create", onCreate);
        return () => window.removeEventListener("bettershape-explorer-create", onCreate);
    }, []);

    useEffect(() => {
        if (!open) return;
        const raf = requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        });
        return () => cancelAnimationFrame(raf);
    }, [open]);

    const submit = async () => {
        const raw = value.trim();
        if (!raw || busy) return;
        if (!project_path) {
            setError("Open a folder before creating a file.");
            return;
        }
        const absolute = resolveProjectFilePath(raw, project_path);
        const wantsFolder = /[\\/]$/.test(raw);
        setBusy(true);
        try {
            if (wantsFolder) {
                await commands.createDir(absolute);
            } else {
                await commands.createFile(absolute);
                await commands.grantIpcPath(absolute).catch(() => undefined);
                const name = normalizePath(absolute).split("/").pop() || absolute;
                await commands.openFile(absolute, name);
            }
            setOpen(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal container={overlayRoot}>
                <Dialog.Overlay className={cn(BETTERSHAPE_OVERLAY_CLASS, "z-[200]")} />
                <Dialog.Content
                    className={cn(
                        BETTERSHAPE_OVERLAY_CONTENT_CLASS,
                        "absolute left-1/2 top-[14%] z-[201] w-[min(460px,calc(100%-2rem))] -translate-x-1/2 outline-none",
                    )}
                    aria-describedby={undefined}
                >
                    <Dialog.Title className="sr-only">New file</Dialog.Title>
                    <Dialog.Description className="sr-only">
                        Path of the file to create, relative to the project
                    </Dialog.Description>
                    <div className={cn(BETTERSHAPE_MODAL_PANEL_CLASS, "overflow-hidden p-1.5")}>
                        <div className="px-2.5 py-1.5 text-sm text-text-primary">New file</div>
                        <div className="px-2 pb-1.5 pt-1">
                            <input
                                ref={inputRef}
                                value={value}
                                onChange={(e) => {
                                    setValue(e.target.value);
                                    setError(null);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        void submit();
                                    }
                                }}
                                placeholder="src/new-file.ts"
                                aria-label="New file path"
                                className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
                            />
                        </div>
                        {error ? (
                            <div className="px-2.5 pb-1.5 text-sm text-error">{error}</div>
                        ) : (
                            <div className="px-2.5 pb-1.5 text-sm text-text-muted">
                                Relative to the project root · end with / for a folder
                            </div>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
