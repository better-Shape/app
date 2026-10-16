"use client";

import { ArrowLeft20Regular } from "@fluentui/react-icons/headless/svg/arrow-left";
import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";


import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconGlyph } from "@/components/ui/icon";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AGENT_SIDEBAR_BACK_SLOT } from "../chrome";

/**
 * The slot the hosted shell mounts its back control into, or nothing while it is absent.
 *
 * The slot lives in the sidebar's header, which mounts a frame or two after this component,
 * so the read is repeated rather than done once; an element that has been unmounted reads as
 * absent too, since a detached node cannot be portalled into.
 */
const readBackSlot = () => {
    if (typeof document === "undefined") return null;
    const el = document.getElementById(AGENT_SIDEBAR_BACK_SLOT);
    return el?.isConnected ? el : null;
};

/** Close reads as leaving the hosted section, so its icon carries the same meaning. */
const backIcon = (closeIcon: boolean) => (closeIcon ? Dismiss20Regular : ArrowLeft20Regular);

/** The back control as it looks in the sidebar's header slot: one 28px icon button. */
const PortalBack = ({
    label,
    icon,
    onBack,
    slot,
}: {
    label: string;
    icon: IconGlyph;
    onBack: () => void;
    slot: HTMLElement;
}) =>
    createPortal(
        <Tooltip content={label} side="bottom" delayDuration={80}>
            <button
                type="button"
                onClick={onBack}
                aria-label={label}
                className="flex size-7 items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary"
            >
                <Icon icon={icon} />
            </button>
        </Tooltip>,
        slot,
    );

/** The back control on the collapsed rail: a 36px target under a right-hand tooltip. */
const CollapsedBack = ({
    label,
    icon,
    onBack,
}: {
    label: string;
    icon: IconGlyph;
    onBack: () => void;
}) => (
    <div className="flex h-10 shrink-0 items-center justify-center px-1.5">
        <Tooltip content={label} side="right" delayDuration={80}>
            <button
                type="button"
                onClick={onBack}
                aria-label={label}
                className="flex size-9 items-center justify-center rounded-md text-text-secondary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary"
            >
                <Icon icon={icon} />
            </button>
        </Tooltip>
    </div>
);

/** The back control in the open nav: the label is visible, so the row states it in text. */
const ExpandedBack = ({
    label,
    icon,
    onBack,
}: {
    label: string;
    icon: IconGlyph;
    onBack: () => void;
}) => (
    <div className="flex h-8 shrink-0 items-center px-2 mt-1.5 mb-2">
        <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            aria-label={label}
            className="gap-2 px-1.5!"
        >
            <Icon icon={icon} />
            <span className="min-w-0 truncate">{label}</span>
        </Button>
    </div>
);

/**
 * The back control in the shape the sidebar is in.
 *
 * Collapsed first: the rail shows its own 36px control whatever the header slot holds, so
 * only the two expanded shapes have to ask whether the slot exists.
 */
const BackControl = ({
    label,
    icon,
    onBack,
    collapsed,
    slot,
}: {
    label: string;
    icon: IconGlyph;
    onBack: () => void;
    collapsed?: boolean;
    slot: HTMLElement | null;
}) => {
    if (collapsed) return <CollapsedBack label={label} icon={icon} onBack={onBack} />;
    if (!slot) return <ExpandedBack label={label} icon={icon} onBack={onBack} />;
    return <PortalBack label={label} icon={icon} onBack={onBack} slot={slot} />;
};

/**
 * Back control at the top of hosted sidebar nav (settings / git).
 *
 * A hosted section replaces the sidebar's own nav, so its way out is mounted into the
 * header slot when there is one and rendered in place when there is not: the slot only
 * exists while the sidebar is expanded.
 */
export const HostedSidebarBack = ({
    label = "Back to app",
    onBack,
    collapsed,
    closeIcon = false,
}: {
    label?: string;
    onBack: () => void;
    collapsed?: boolean;
    closeIcon?: boolean;
}) => {
    const [slot, setSlot] = useState(readBackSlot);

    useEffect(() => {
        // The header mounts after this component, so the slot is read again on a short
        // interval rather than once: the first read usually finds nothing to portal into.
        const find = () => setSlot(readBackSlot());
        find();
        const timer = window.setInterval(find, 80);
        const stop = window.setTimeout(() => window.clearInterval(timer), 2000);
        return () => {
            window.clearInterval(timer);
            window.clearTimeout(stop);
        };
    }, [collapsed]);

    const icon = backIcon(closeIcon);

    return (
        <BackControl
            label={label}
            icon={icon}
            onBack={onBack}
            collapsed={collapsed}
            slot={slot}
        />
    );
};

/**
 * The shell a hosted section renders inside.
 *
 * It is a plain column: the hosted app supplies its own padding, and `items-center` is the
 * only thing the collapsed rail needs from it.
 */
export const HostedSidebarShell = ({
    collapsed,
    children,
    className,
}: {
    collapsed?: boolean;
    children: ReactNode;
    className?: string;
}) => (
    <div
        className={cn(
            "flex h-full min-h-0 w-full flex-col overflow-hidden",
            collapsed && "items-center",
            className,
        )}
    >
        {children}
    </div>
);
