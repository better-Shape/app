"use client";

import { ArrowClockwise20Regular } from "@fluentui/react-icons/headless/svg/arrow-clockwise";
import { Stop20Regular } from "@fluentui/react-icons/headless/svg/stop";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useDevRunStatus, type DevRunStatus } from "@/features/preview/run-status";

const LABEL: Record<DevRunStatus, string> = {
    idle: "",
    starting: "Starting",
    running: "Running",
    error: "Run failed",
};

const DOT: Record<DevRunStatus, string> = {
    idle: "bg-text-muted",
    starting: "bg-warn",
    running: "bg-success",
    error: "bg-danger",
};

const stopRun = () => window.dispatchEvent(new Event("bettershape-terminal-run-stop"));
const restartRun = () => window.dispatchEvent(new Event("bettershape-terminal-run-restart"));

/**
 * Dev-server state in the status bar. The run lives in the background, so this
 * is the only surface that shows it or offers stop and restart while the
 * Terminal workspace tab is closed.
 */
export const DevRunStatusItem = () => {
    const run = useDevRunStatus();
    if (run.status === "idle") return null;

    const label = LABEL[run.status];
    const command = run.command ?? "";

    return (
        <div className="flex h-full min-w-0 items-center gap-0.5" role="group" aria-label="Dev server">
            <Tooltip content={command ? `${label}: ${command}` : label}>
                <div className="flex min-w-0 items-center gap-1.5 px-1.5 text-text-secondary">
                    <span className={cn("size-1.5 shrink-0 rounded-full", DOT[run.status])} aria-hidden />
                    <span className="max-w-40 truncate hover:text-text-primary">{label}</span>
                </div>
            </Tooltip>
            {run.alive ? (
                <Tooltip content="Stop dev server">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Stop dev server"
                        className="h-full min-h-0 rounded-none squircle-none px-1.5 text-text-secondary hover:bg-[var(--row-hover)] hover:text-text-primary"
                        onClick={stopRun}
                    >
                        <Icon icon={Stop20Regular} />
                    </Button>
                </Tooltip>
            ) : null}
            <Tooltip content="Restart dev server">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Restart dev server"
                    className="h-full min-h-0 rounded-none squircle-none px-1.5 text-text-secondary hover:bg-[var(--row-hover)] hover:text-text-primary"
                    onClick={restartRun}
                >
                    <Icon icon={ArrowClockwise20Regular} />
                </Button>
            </Tooltip>
        </div>
    );
};
