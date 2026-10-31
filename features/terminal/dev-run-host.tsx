"use client";

import { useEffect, useRef } from "react";
import { useDevRunStatus } from "@/features/preview/run-status";
import { notify } from "@/features/notifications";
import {
    ensureBackgroundRun,
    sameDevCommand,
    stopBackgroundRun,
} from "@/features/terminal/background-run";

/**
 * Always-mounted: Run works even when the Terminal workspace tab is closed.
 * Delegates to module-level `ensureBackgroundRun` so listeners survive remounts
 * and Design Mode shares the same PTY.
 */
export function DevRunHost() {
    const run = useDevRunStatus();
    const runRef = useRef(run);

    useEffect(() => {
        runRef.current = run;
    }, [run]);

    useEffect(() => {
        const onRun = (e: Event) => {
            const detail = (e as CustomEvent<{ command?: string; background?: boolean }>).detail;
            const command = detail?.command?.trim();
            if (!command) return;

            const current = runRef.current;
            if (
                (current.status === "starting" || current.status === "running")
                && current.command
                && sameDevCommand(current.command, command)
                && current.ptyId != null
            ) {
                // Already running — only open Terminal if the user clicked Play
                // (Design Mode passes background: true and stays put).
                if (!detail?.background) {
                    window.dispatchEvent(new CustomEvent("bettershape-open-workspace-terminal"));
                }
                return;
            }

            void ensureBackgroundRun(command).catch(() => {
                notify.error("Could not start the run", "Check the command and try again.");
            });
            // Do not force-open Terminal on first start — it keeps running in the
            // background; opening Terminal later shows the bound tab + Rust buffer.
        };

        const onStop = () => {
            void stopBackgroundRun().catch(() => {
                notify.error("Could not stop the run", "The preview process is still running. Try again.");
            });
        };

        const onRestart = (e: Event) => {
            const detail = (e as CustomEvent<{ command?: string }>).detail;
            const command = detail?.command?.trim() || runRef.current.command;
            void (async () => {
                try {
                    await stopBackgroundRun();
                } catch {
                    // Starting a replacement now would leave the old server running unowned.
                    notify.error("Could not stop the run", "The preview process is still running. Try again.");
                    return;
                }
                if (!command) return;
                try {
                    await ensureBackgroundRun(command);
                } catch {
                    notify.error("Could not start the run", "Check the command and try again.");
                }
            })();
        };

        window.addEventListener("bettershape-terminal-run", onRun as EventListener);
        window.addEventListener("bettershape-terminal-run-stop", onStop);
        window.addEventListener("bettershape-terminal-run-restart", onRestart as EventListener);
        return () => {
            window.removeEventListener("bettershape-terminal-run", onRun as EventListener);
            window.removeEventListener("bettershape-terminal-run-stop", onStop);
            window.removeEventListener("bettershape-terminal-run-restart", onRestart as EventListener);
            // Do NOT kill the PTY on remount — module-level runtime owns it.
        };
    }, []);

    return null;
}
