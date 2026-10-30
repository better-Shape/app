"use client";

import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";


import { Icon } from "./icon";
import { Collapse } from "./collapse";
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

/**
 * The first read of the stored value.
 *
 * Called as the lazy initial state, so a reopened section paints open instead of flashing
 * shut for a frame. Storage is consulted only when a key is given: sections that are not
 * worth remembering stay open or closed per mount. The guard is per call rather than per
 * module, because this runs during the server render too, where there is no window.
 */
const readStoredOpen = (storageKey: string | undefined, defaultOpen: boolean) => {
    if (!storageKey || typeof window === "undefined") return defaultOpen;
    const raw = window.localStorage.getItem(storageKey);
    return raw === null ? defaultOpen : raw === "true";
};

/**
 * The section's own classes.
 *
 * An open row keeps its natural height unless the caller asks it to share the leftover
 * space, and a closed one never grows: both are needed because the row is also a flex
 * child of whatever panel it sits in.
 */
const sectionClass = (isOpen: boolean, isFlex: boolean, className: string | undefined) =>
    cn(
        "border-t border-border-subtle first:border-t-0",
        "flex flex-col overflow-hidden transition-[flex] duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
        isOpen ? (isFlex ? "flex-1 min-h-[40px]" : "shrink-0") : "shrink-0",
        className
    );

/** The chevron turns through the flick spring, the same curve the rail glyphs use. */
const chevronClass = (isOpen: boolean) =>
    cn(
        "transition-transform duration-[var(--spring-flick-dur)] ease-[var(--spring-flick)] text-text-muted",
        isOpen && "rotate-90 text-text-primary"
    );

/**
 * A section that remembers whether it is open.
 *
 * The first read is the lazy initial state rather than an effect, so a reopened section
 * paints open instead of flashing shut for a frame. Storage is consulted only when a key is
 * given: sections that are not worth remembering stay open or closed per mount.
 */
export const CollapsibleSection = ({
    title,
    children,
    defaultOpen = false,
    isFlex = false,
    className,
    headerActions,
    storageKey,
}: CollapsibleSectionProps) => {
    const contentId = useId();
    const [isOpen, setIsOpen] = useState(() => readStoredOpen(storageKey, defaultOpen));

    /** Writes inside the updater so the stored value cannot disagree with the one on
        screen, and swallows the write failure a private-mode browser raises. */
    const toggle = useCallback(() => {
        setIsOpen((prev) => {
            const next = !prev;
            if (storageKey) {
                try {
                    window.localStorage.setItem(storageKey, String(next));
                } catch {
                    /* The section still toggles; only the memory of it is lost. */
                }
            }
            return next;
        });
    }, [storageKey]);

    return (
        <section className={sectionClass(isOpen, isFlex, className)}>
            <div className="h-chrome group flex items-center px-sm hover:bg-[var(--row-hover)] text-text-secondary hover:text-text-primary shrink-0 sticky top-0 z-10 transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]">
                <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={contentId}
                    className="flex min-w-0 flex-1 items-center text-left outline-none focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-border-focus"
                    onClick={toggle}
                >
                    <div className="w-5 flex items-center justify-center">
                        <Icon icon={ChevronRight20Regular} className={chevronClass(isOpen)} />
                    </div>
                    <span className="ml-1 truncate text-sm font-normal">{title}</span>
                </button>
                {headerActions ? (
                    <div className="ml-auto mr-1 flex items-center gap-0.5">
                        {headerActions}
                    </div>
                ) : null}
            </div>

            <Collapse
                id={contentId}
                open={isOpen}
                variant="spring"
                className="flex-1 min-h-0"
                innerClassName="flex flex-col flex-1 h-full"
            >
                {children}
            </Collapse>
        </section>
    );
};
