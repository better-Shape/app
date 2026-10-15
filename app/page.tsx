"use client";

import { useCallback, useEffect, useState } from "react";

import { useProjectState } from "@/lib/backend";
import { openProject } from "@/features/agent";
import {
    WelcomeCloneDialog,
    WelcomeSshDialog,
} from "./welcome-dialogs";
import { WelcomeScreen, useRecentFolders } from "./welcome-screen";
import { loginGitHub } from "@/lib/github/store";
import { PreviewCrash } from "@/components/layout/error/preview-crash";

/**
 * Agent window home, welcome when idle.
 * Project open is owned by Main's ProjectOpenHost (always mounted).
 */
export default function Home() {
    const { project_path } = useProjectState();
    const [cloneOpen, setCloneOpen] = useState(false);
    const [sshOpen, setSshOpen] = useState(false);
    const recentFolders = useRecentFolders();
    // Restoring only lasts until Main's restore brings a project, or a short grace period
    // passes. Both are derived here rather than written from an effect.
    const [restoreTimedOut, setRestoreTimedOut] = useState(false);
    const restoringProject = !restoreTimedOut && !project_path;

    useEffect(() => {
        // Brief wait for Main's restore; then show welcome if still empty.
        const t = window.setTimeout(() => setRestoreTimedOut(true), 800);
        return () => window.clearTimeout(t);
    }, []);

    const handleOpen = useCallback((path: string) => {
        void openProject(path);
    }, []);

    const dialogs = (
        <>
            {/* Preview-only: `?crash=route` throws here so the route error boundary can
                be looked at without breaking the app on purpose. Inert in a real build. */}
            <PreviewCrash scope="route" />
            <WelcomeCloneDialog
                open={cloneOpen}
                onOpenChange={setCloneOpen}
                recentFolders={recentFolders}
                onCloned={handleOpen}
            />
            <WelcomeSshDialog open={sshOpen} onOpenChange={setSshOpen} />
        </>
    );

    if (restoringProject && !project_path) {
        return (
            <div className="flex h-full items-center justify-center bg-editor text-sm text-text-muted">
                Opening project…
            </div>
        );
    }

    // Keep mounted (dialogs) while project open so welcome dialogs still work.
    if (project_path) {
        return dialogs;
    }

    return (
        <>
            <WelcomeScreen
                recentFolders={recentFolders}
                onOpenProject={handleOpen}
                onPickFolder={() => window.dispatchEvent(new Event("bettershape-open-project-pick"))}
                onClone={() => setCloneOpen(true)}
                onSsh={() => setSshOpen(true)}
                onConnectGitHub={() => void loginGitHub()}
            />
            {dialogs}
        </>
    );
}
