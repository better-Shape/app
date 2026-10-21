"use client";

import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";


import { Icon } from "./icon";
import { useState, useCallback, useId } from "react";
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

export function CollapsibleSection({
    title,
    children,
    defaultOpen = false,
    isFlex = false,
    className,
    headerActions,
    storageKey,
}: CollapsibleSectionProps) {
    const contentId = useId();
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
                "flex flex-col overflow-hidden transition-[flex] duration-[var(--transition-base)] ease-[var(--ease-out)]",
                isOpen ? (isFlex ? "flex-1 min-h-[40px]" : "shrink-0") : "shrink-0",
                className,
            )}
        >
            <div className="h-chrome group sticky top-0 z-10 flex shrink-0 items-center px-sm hover:bg-panel-hover">
                <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={contentId}
                    className="flex h-full min-w-0 flex-1 cursor-pointer items-center text-left outline-none focus-visible:z-10 focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-border-focus"
                    onClick={toggle}
                >
                    <span className="flex w-5 shrink-0 items-center justify-center">
                        <Icon
                            icon={ChevronRight20Regular}
                            className={cn(
                                "text-text-muted transition-transform duration-[var(--transition-fast)] ease-[var(--ease-out)] group-hover:text-text-primary",
                                isOpen && "rotate-90 text-text-primary",
                            )}
                        />
                    </span>
                    <span className="ml-1 truncate text-sm font-normal text-text-secondary group-hover:text-text-primary">
                        {title}
                    </span>
                </button>
                {headerActions ? (
                    <div className="ml-auto mr-1 flex items-center gap-0.5">{headerActions}</div>
                ) : null}
            </div>

            <div
                id={contentId}
                aria-hidden={!isOpen}
                inert={!isOpen}
                className={cn(
                    "grid min-h-0 flex-1 transition-[grid-template-rows,opacity] duration-[var(--transition-base)] ease-[var(--ease-out)]",
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}
            >
                <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
            </div>
        </section>
    );
}

