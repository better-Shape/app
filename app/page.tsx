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
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";

/**
 * Agent window home, welcome when idle.
 * Project open is owned by Main's ProjectOpenHost (always mounted).
 */
const Home = () => {
    const { project_path } = useProjectState();
    const [cloneOpen, setCloneOpen] = useState(false);
    const [sshOpen, setSshOpen] = useState(false);
    const recentFolders = useRecentFolders();
    const showWelcome = useSettings().privacy.showWelcomeOnStartup;
    // Restoring only lasts until Main's restore brings a project, or a short grace period
    // passes. Both are derived here rather than written from an effect.
    const [restoreTimedOut, setRestoreTimedOut] = useState(false);
    const restoringProject = !restoreTimedOut && !project_path;

    useEffect(() => {
        // Brief wait for Main's restore; then show welcome if still empty.
        const timer = window.setTimeout(() => setRestoreTimedOut(true), 800);
        return () => window.clearTimeout(timer);
    }, []);

    const handleOpen = useCallback((path: string) => {
        // The welcome dialog closes on its own and the workspace appears when the store
        // updates, so the promise is ended here instead of returned to the caller.
        openProject(path).catch(() => undefined);
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

    // Settings -> Privacy -> Show welcome page on startup. Turning it off leaves a
    // quiet home instead of the marketing surface, but keeps a way in.
    if (!showWelcome) {
        return (
            <>
                <div className="flex h-full flex-col items-center justify-center gap-1 bg-editor">
                    <p className="text-base text-text-primary">No project open</p>
                    <p className="text-sm text-text-muted">Open a folder to start working.</p>
                    <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() =>
                            window.dispatchEvent(new Event("bettershape-open-project-pick"))
                        }
                    >
                        Open folder
                    </Button>
                </div>
                {dialogs}
            </>
        );
    }

    return (
        <>
            <WelcomeScreen
                recentFolders={recentFolders}
                onOpenProject={handleOpen}
                onPickFolder={() => window.dispatchEvent(new Event("bettershape-open-project-pick"))}
                onClone={() => setCloneOpen(true)}
                onSsh={() => setSshOpen(true)}
                onConnectGitHub={() => {
                    loginGitHub().catch(() => undefined);
                }}
            />
            {dialogs}
        </>
    );
}

export default Home;
