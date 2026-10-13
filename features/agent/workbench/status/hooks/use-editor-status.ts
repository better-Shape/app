"use client";

import { useEffect, useState } from "react";
import { DEFAULT_EDITOR_STATUS, type EditorStatus } from "../types";

export function useEditorStatus() {
    const [editorStatus, setEditorStatus] = useState<EditorStatus>(DEFAULT_EDITOR_STATUS);
    const [typescriptVersion, setTypescriptVersion] = useState<string | null>(null);

    useEffect(() => {
        const onTs = (e: Event) => {
            const version = (e as CustomEvent<string>).detail;
            if (version) setTypescriptVersion(version);
        };
        window.addEventListener("bettershape-typescript-version", onTs as EventListener);
        return () => window.removeEventListener("bettershape-typescript-version", onTs as EventListener);
    }, []);

    useEffect(() => {
        const onUpdate = (event: Event) => {
            const detail = (event as CustomEvent<Partial<EditorStatus>>).detail;
            if (detail) setEditorStatus((prev) => ({ ...prev, ...detail }));
        };
        window.addEventListener("bettershape-editor-status", onUpdate as EventListener);
        return () => window.removeEventListener("bettershape-editor-status", onUpdate as EventListener);
    }, []);

    return { editorStatus, typescriptVersion };
}

export function dispatchEditorAction(action: string, detail?: Record<string, unknown>) {
    window.dispatchEvent(new CustomEvent("bettershape-editor-action", { detail: { action, ...detail } }));
}

export function openStatusPalette(
    placeholder: string,
    actions: { id: string; label: string; icon?: string; run: () => void }[],
) {
    // `mode` is load-bearing: the palette only adopts `detail.actions` when a
    // non-empty mode is present (cmd-palette.tsx drops them into `getAppCommands()`
    // otherwise). It also makes `isBrowseMode()` false, so the palette renders
    // exactly these rows instead of the agent/file/action pool.
    window.dispatchEvent(
        new CustomEvent("bettershape-command-palette", {
            detail: {
                mode: "status_actions",
                placeholder,
                actions: actions.map((action) => ({ ...action, shortcut: "" })),
            },
        }),
    );
}
