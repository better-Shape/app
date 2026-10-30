"use client";

import { ErrorCircle20Regular } from "@fluentui/react-icons/headless/svg/error-circle";
import * as React from "react";
import { Button } from "./button";
import { Icon, type IconGlyph } from "./icon";
import { cn } from "@/lib/utils";

export interface PanelStateMessageProps {
    title: string;
    detail?: string;
    icon?: IconGlyph;
    tone?: "default" | "error";
    actionLabel?: string;
    onAction?: () => void;
    actionDisabled?: boolean;
}

/** Dispatches the workspace event that opens or focuses the Files explorer tab. */
export const openWorkspaceFilesTab = (): void => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("bettershape-set-active-tab", { detail: "files" }));
};

/**
 * Shared empty, blocked, loading, and error state block for workspace panels.
 * Pairs a concise title and muted explanation with an optional inline recovery action.
 */
export const PanelStateMessage = ({
    title,
    detail,
    icon,
    tone = "default",
    actionLabel,
    onAction,
    actionDisabled = false,
}: PanelStateMessageProps) => {
    const resolvedIcon = icon ?? (tone === "error" ? ErrorCircle20Regular : undefined);

    return (
        <div
            role={tone === "error" ? "alert" : undefined}
            className="flex flex-col items-start gap-1.5 px-3 py-4"
        >
            <p className="flex items-center gap-1.5 text-sm text-text-primary">
                {resolvedIcon ? (
                    <Icon
                        icon={resolvedIcon}
                        className={cn("shrink-0", tone === "error" ? "text-error" : "text-text-muted")}
                    />
                ) : null}
                <span>{title}</span>
            </p>
            {detail ? <p className="text-xs leading-relaxed text-text-muted">{detail}</p> : null}
            {actionLabel && onAction ? (
                <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={onAction}
                    disabled={actionDisabled}
                    className="mt-1"
                >
                    {actionLabel}
                </Button>
            ) : null}
        </div>
    );
};
