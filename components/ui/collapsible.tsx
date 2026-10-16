"use client";

import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";


import { Icon } from "./icon";
import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
    isFlex?: boolean;
    className?: string;
    headerActions?: React.ReactNode;
    /** When set, the open/closed state is persisted to localStorage under this key */
    storageKey?: string;
}

/**
 * A section that remembers whether it is open.
 *
 * The first read is the lazy initial state rather than an effect, so a reopened section
 * paints open instead of flashing shut for a frame. Storage is consulted only when a key is
 * given: sections that are not worth remembering stay open or closed per mount.
 */
export function CollapsibleSection({
    title,
    children,
    defaultOpen = false,
    isFlex = false,
    className,
    headerActions,
    storageKey,
}: CollapsibleSectionProps) {
    const [isOpen, setIsOpen] = useState(() => {
        if (storageKey && typeof window !== "undefined") {
            const raw = window.localStorage.getItem(storageKey);
            if (raw !== null) return raw === "true";
        }
        return defaultOpen;
    });

    const toggle = useCallback(() => {
        setIsOpen((prev) => {
            const next = !prev;
            if (storageKey) {
                try { window.localStorage.setItem(storageKey, String(next)); } catch { /* noop */ }
            }
            return next;
        });
    }, [storageKey]);

    return (
        <section
            className={cn(
                "border-t border-border-subtle first:border-t-0",
                "flex flex-col overflow-hidden transition-[flex] duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
                isOpen ? (isFlex ? "flex-1 min-h-[40px]" : "shrink-0") : "shrink-0",
                className
            )}
        >
            <div
                className="h-chrome group flex items-center px-sm hover:bg-[var(--row-hover)] cursor-pointer text-text-secondary hover:text-text-primary shrink-0 sticky top-0 z-10 transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]"
                onClick={toggle}
            >
                <div className="w-5 flex items-center justify-center transition-transform duration-100">
                    <Icon icon={ChevronRight20Regular}
                        
                        className={cn("transition-transform duration-[var(--spring-flick-dur)] ease-[var(--spring-flick)] text-text-muted", isOpen && "rotate-90 text-text-primary")}
                     />
                </div>
                <span className="ml-1 text-sm font-normal">{title}</span>
                {headerActions ? (
                    <div
                        className="ml-auto mr-1 flex items-center gap-0.5"
                        onClick={(event) => event.stopPropagation()}
                    >
                        {headerActions}
                    </div>
                ) : null}
            </div>

            <div
                className={cn(
                    "grid transition-[grid-template-rows,opacity] duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)] flex-1 min-h-0",
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                )}
            >
                <div className="overflow-hidden min-h-0 flex flex-col flex-1 h-full">{children}</div>
            </div>
        </section>
    );
}

