"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BetterShapeLogo } from "@/components/ui/bettershape-logo";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { GitMarkdown, type GitMarkdownCtx } from "@/features/git/ui/github/markdown";

/**
 * AI action as a compact trigger: first open runs generation, later opens
 * pop the result. Regenerate lives inside — never dumps a card into the layout.
 */
export function GitAiAction({
    label,
    title,
    content,
    loading,
    disabled,
    onRun,
    className,
    mdCtx,
    compact,
}: {
    label: string;
    title: string;
    content?: string | null;
    loading?: boolean;
    disabled?: boolean;
    onRun: () => void | Promise<void>;
    className?: string;
    mdCtx?: GitMarkdownCtx;
    compact?: boolean;
}) {
    const [open, setOpen] = useState(false);
    // "Open once the result arrives" is state, so it can be acted on during render.
    const [pendingOpen, setPendingOpen] = useState(false);
    const has = Boolean(content?.trim());

    if (pendingOpen && has && !loading) {
        setPendingOpen(false);
        setOpen(true);
    }

    const run = () => {
        setPendingOpen(true);
        void Promise.resolve(onRun());
    };

    return (
        <DropdownMenu
            modal={false}
            open={open}
            onOpenChange={(next) => {
                if (next) {
                    if (!has && !loading) {
                        setOpen(true);
                        run();
                        return;
                    }
                    setOpen(true);
                    return;
                }
                setOpen(false);
            }}
        >
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                        "gap-1.5",
                        compact ? "h-6 px-2 text-xs" : "h-chrome px-md",
                        className,
                    )}
                    disabled={disabled || loading}
                >
                    <BetterShapeLogo size={12} />
                    {loading ? "Working…" : label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                sideOffset={6}
                className="w-[min(24rem,calc(100vw-2rem))]"
                onCloseAutoFocus={(e) => e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-2 px-2 py-1.5">
                    <BetterShapeLogo size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                        {title}
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 shrink-0 px-2 text-xs"
                        disabled={loading}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            run();
                        }}
                    >
                        {loading ? "…" : "Regenerate"}
                    </Button>
                </div>
                <div className="max-h-[min(18rem,55vh)] overflow-y-auto px-3 py-2">
                    {loading && !has ? (
                        <p className="text-sm text-text-muted">Generating…</p>
                    ) : has ? (
                        <GitMarkdown content={content!} ctx={mdCtx} />
                    ) : (
                        <p className="text-sm text-text-muted">No result yet.</p>
                    )}
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
