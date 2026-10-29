"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EditorSplitProvider, EditorViewProvider } from "@/core/providers/editor";
import { commands } from "@/lib/backend";
import FileViewer from "@/features/editor/ui/main/editor";

/** Scans `localStorage` for a seeded `bettershape-popout-file:*` entry when `?file=` is absent. */
const readStoredPopoutPath = (): string | null => {
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith("bettershape-popout-file:")) continue;
        const value = localStorage.getItem(key);
        if (value) return value;
    }
    return null;
};

/** Resolves the initial popout file path from the URL query string or `localStorage`. */
const readSeededPath = (): string | null => {
    if (typeof window === "undefined") return null;
    try {
        const fromQuery = new URLSearchParams(window.location.search).get("file");
        return fromQuery || readStoredPopoutPath();
    } catch {
        return null;
    }
};

/** Wraps `FileViewer` in the required editor view and split context providers for `/popout`. */
const PopoutEditorViewport = ({ file, title }: { file: string; title: string }) => (
    <EditorViewProvider>
        <EditorSplitProvider>
            <div className="flex h-full min-h-0 w-full flex-col overflow-hidden" data-popout-title={title}>
                <FileViewer path={file} group="left" />
            </div>
        </EditorSplitProvider>
    </EditorViewProvider>
);

export default function PopoutPage() {
    const searchParams = useSearchParams();
    const fileFromQuery = searchParams.get("file");
    const [file, setFile] = useState<string | null>(() => fileFromQuery || readSeededPath());
    // Adopt a new `?file=` while mounted. Done during render, so there is no extra pass.
    const [seenQuery, setSeenQuery] = useState(fileFromQuery);
    if (fileFromQuery !== seenQuery) {
        setSeenQuery(fileFromQuery);
        if (fileFromQuery) setFile(fileFromQuery);
    }

    useEffect(() => {
        if (!file) return;
        const name = file.split(/[\\/]/).pop() || file;
        commands.openFile(file, name).catch(() => undefined);
    }, [file]);

    const title = useMemo(() => file?.split(/[\\/]/).pop() || "Editor", [file]);

    if (!file) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
                No file specified
            </div>
        );
    }

    return <PopoutEditorViewport file={file} title={title} />;
}
