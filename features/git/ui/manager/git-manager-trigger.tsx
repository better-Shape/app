"use client";

import { Button } from "@/components/ui/button";
import { BetterShapeLogo } from "@/components/ui/bettershape-logo";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Logo-only control, opens the Git manager window. */
export function GitManagerTrigger({ className }: { className?: string }) {
    return (
        <Tooltip content="Git Manager">
            <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Open Git Manager"
                className={cn("text-text-primary hover:bg-[var(--btn-hover)]", className)}
                onClick={() => void import("@/lib/window/open-git-window").then(({ openGitWindow }) => openGitWindow())}
            >
                {/* Never max-h/w-full here, padded icon buttons shrink that to 0 and the logo vanishes. */}
                <BetterShapeLogo size={14} className="pointer-events-none" />
            </Button>
        </Tooltip>
    );
}
