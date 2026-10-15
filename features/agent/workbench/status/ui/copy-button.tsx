"use client";

import { CopyButton as CopyAffordance } from "@/components/ui/copy-button";

/**
 * The commit card's copy control. Chrome lives here; the write, the confirmation
 * timing and the drawn mark come from the shared `CopyButton`, so this stays a
 * styling shell rather than a second copy implementation.
 */
export function CopyButton({ text }: { text: string }) {
    return (
        <CopyAffordance
            text={text}
            label="Copy"
            showLabel
            successDescription="Commit card copied to clipboard"
            className="mt-1.5 text-sm font-medium"
            boxClassName={[
                "gap-1 px-1.5 py-0.5 text-text-muted",
                "transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                "hover:bg-[var(--btn-hover)] hover:text-text-primary",
                "data-[copy-state=copied]:bg-success/15",
                "data-[copy-state=failed]:bg-error/10",
            ].join(" ")}
        />
    );
}
