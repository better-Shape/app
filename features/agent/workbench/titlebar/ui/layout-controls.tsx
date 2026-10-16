"use client";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const titlebarIconButtonClass =
    "flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-text-secondary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary";

/**
 * One titlebar layout control: a 28px icon button whose tip names the panel it switches to.
 *
 * `data-no-drag` is not decoration: the bar around it is a Tauri drag region, so a control
 * without it lets the shell swallow the press. The pressed state keeps the full-strength text
 * colour under the pointer rather than sitting inert while it is already the active layout.
 */
export const TitlebarLayoutButton = ({
    label,
    active,
    onClick,
    children,
}: {
    label: string;
    active?: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) => (
    <Tooltip content={label} side="bottom">
        <button
            type="button"
            data-no-drag
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
            className={cn(titlebarIconButtonClass, active && "text-text-primary")}
        >
            {children}
        </button>
    </Tooltip>
);

export { titlebarIconButtonClass };
