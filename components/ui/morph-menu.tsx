"use client";

import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
    type RefObject,
} from "react";
import { cn } from "@/lib/utils";

export type MorphMenuVariant = "default" | "morph";

/** The closed width used before the sizer has reported one. */
const CLOSED_WIDTH_FALLBACK = 96;
/** One squircle for both ends of the morph: a pill at either end is a second shape, not a state. */
const MORPH_RADIUS = 24;

/**
 * The closed width, measured from the natural width of the trigger.
 *
 * The sizer is observed rather than the trigger prop watched, because the trigger can
 * change while the element stays the same and the observer catches that too.
 */
const useClosedWidth = (
    active: boolean,
    measureRef: RefObject<HTMLSpanElement | null>,
    setClosedW: React.Dispatch<React.SetStateAction<number | null>>,
) => {
    useLayoutEffect(() => {
        const el = measureRef.current;
        // `undefined` and not a bare return: the cleanup below is a value return.
        if (!active || !el) return undefined;
        /**
         * Measured on the sizer and not on the button, which is the box being tweened:
         * reading it would return the width it is on its way to.
         */
        const measure = () => {
            const w = Math.ceil(el.getBoundingClientRect().width);
            if (w > 0) setClosedW((prev) => (prev === w ? prev : w));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => {
            ro.disconnect();
        };
    }, [active, measureRef, setClosedW]);
};

/** Escape and presses outside the menu close it, which is the only way out of it. */
const useDismissOnOutside = (
    open: boolean,
    ref: RefObject<HTMLDivElement | null>,
    setOpen: React.Dispatch<React.SetStateAction<boolean>>,
) => {
    useEffect(() => {
        // `undefined` and not a bare return, for the same reason as the measure effect.
        if (!open) return undefined;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open, ref, setOpen]);
};

/**
 * The box the morph tweens between, as the custom properties both ends read.
 *
 * The open size comes from the value locked when the menu opened rather than from the
 * props, so a content reflow mid-morph cannot move the box the pointer is watching.
 */
const morphGeometry = ({
    closedW,
    open,
    locked,
    openWidth,
    openHeight,
    closedHeight,
}: {
    closedW: number | null;
    open: boolean;
    locked: { w: number; h: number };
    openWidth: number;
    openHeight: number;
    closedHeight: number;
}) => ({
    ready: closedW != null,
    style: {
        "--morph-w-closed": `${closedW ?? CLOSED_WIDTH_FALLBACK}px`,
        "--morph-h-closed": `${closedHeight}px`,
        "--morph-w-open": `${open ? locked.w : openWidth}px`,
        "--morph-h-open": `${open ? locked.h : openHeight}px`,
        "--morph-r-closed": `${MORPH_RADIUS}px`,
        "--morph-r-open": `${MORPH_RADIUS}px`,
    } as CSSProperties,
});

/** The static pill and its absolute popover, for the variant that does not tween. */
const DefaultMenu = ({
    containerRef,
    trigger,
    children,
    open,
    onToggle,
    ariaLabel,
    align,
    className,
    openWidth,
    openHeight,
}: {
    containerRef: RefObject<HTMLDivElement | null>;
    trigger: ReactNode;
    children: ReactNode;
    open: boolean;
    onToggle: () => void;
    ariaLabel: string;
    align: "start" | "end";
    className?: string;
    openWidth: number;
    openHeight: number;
}) => (
    <div ref={containerRef} className={cn("relative", className)}>
        <button
            type="button"
            aria-expanded={open}
            aria-label={ariaLabel}
            onClick={onToggle}
            className={cn(
                "inline-flex h-8 items-center gap-1.5 squircle-2xl border border-border bg-surface-3/80 backdrop-blur-sm px-3 text-sm text-text-secondary",
                "hover:bg-[var(--btn-hover)] hover:text-text-primary",
                open && "bg-[var(--btn-open)] hover:bg-[var(--btn-open-hover)] text-text-primary",
            )}
        >
            {trigger}
        </button>
        {open ? (
            <div
                className={cn(
                    "absolute bottom-[calc(100%+8px)] z-50 overflow-hidden squircle-2xl border border-border bg-surface-3/80 backdrop-blur-sm shadow-md",
                    align === "end" ? "right-0" : "left-0",
                )}
                style={{ width: openWidth, maxHeight: openHeight }}
                role="menu"
            >
                <div className="custom-scrollbar max-h-full overflow-y-auto">{children}</div>
            </div>
        ) : null}
    </div>
);

/** The box the morph animates, sized by the custom properties `morphGeometry` returns. */
const MorphBox = ({
    boxRef,
    measureRef,
    className,
    trigger,
    children,
    open,
    ready,
    style,
    align,
    ariaLabel,
    onToggle,
}: {
    boxRef: RefObject<HTMLDivElement | null>;
    measureRef: RefObject<HTMLSpanElement | null>;
    className?: string;
    trigger: ReactNode;
    children: ReactNode;
    open: boolean;
    ready: boolean;
    style: CSSProperties;
    align: "start" | "end";
    ariaLabel: string;
    onToggle: (event: React.MouseEvent) => void;
}) => (
    <div className={cn("relative inline-flex items-end", className)}>
        {/* Natural-width sizer (not constrained by --morph-w-closed). */}
        <span
            ref={measureRef}
            aria-hidden
            className="pointer-events-none invisible absolute inline-flex h-8 items-center gap-1.5 whitespace-nowrap px-4 text-sm font-medium"
        >
            {trigger}
        </span>
        <div
            ref={boxRef}
            className="t-morph squircle-2xl bg-surface-3"
            data-open={String(open)}
            data-align={align}
            data-ready={String(ready)}
            style={style}
        >
            <div className="t-morph-menu custom-scrollbar" role="menu">
                {children}
            </div>
            <button
                type="button"
                className="t-morph-plus text-sm text-text-secondary"
                aria-expanded={open}
                aria-label={ariaLabel}
                onClick={onToggle}
            >
                {trigger}
            </button>
        </div>
    </div>
);

/**
 * Pill trigger → panel.
 *
 * - `variant="default"`, static pill + absolute popover (no size tween)
 * - `variant="morph"`, transitions.dev PlusMenu size/radius morph
 *
 * Same idea as `Button variant="ghost"`: opt in per instance.
 *
 * @example
 * <MorphMenu variant="morph" trigger={<>Changes</>}>
 *   …menu body…
 * </MorphMenu>
 */
export const MorphMenu = ({
    trigger,
    children,
    className,
    openWidth = 280,
    openHeight = 200,
    closedHeight = 32,
    align = "start",
    variant = "default",
    /** @deprecated use `variant="morph"` */
    morph = false,
    "aria-label": ariaLabel = "Open menu",
}: {
    trigger: ReactNode;
    children: ReactNode;
    className?: string;
    openWidth?: number;
    openHeight?: number;
    closedHeight?: number;
    align?: "start" | "end";
    variant?: MorphMenuVariant;
    /** @deprecated use `variant="morph"` */
    morph?: boolean;
    "aria-label"?: string;
}) => {
    const useMorph = variant === "morph" || morph;
    const ref = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLSpanElement>(null);
    const [open, setOpen] = useState(false);
    const [closedW, setClosedW] = useState<number | null>(null);
    // Open size is captured when the menu opens, so content reflow doesn't jump mid-morph.
    const [lockedOpen, setLockedOpen] = useState({ w: openWidth, h: openHeight });

    useClosedWidth(useMorph, measureRef, setClosedW);
    useDismissOnOutside(open, ref, setOpen);

    const toggle = () => {
        if (!open) setLockedOpen({ w: openWidth, h: openHeight });
        setOpen((v) => !v);
    };

    if (!useMorph) {
        return (
            <DefaultMenu
                containerRef={ref}
                trigger={trigger}
                open={open}
                onToggle={toggle}
                ariaLabel={ariaLabel}
                align={align}
                className={className}
                openWidth={openWidth}
                openHeight={openHeight}
            >
                {children}
            </DefaultMenu>
        );
    }

    const { ready, style } = morphGeometry({ closedW, open, locked: lockedOpen, openWidth, openHeight, closedHeight });

    return (
        <MorphBox
            boxRef={ref}
            measureRef={measureRef}
            className={className}
            trigger={trigger}
            open={open}
            ready={ready}
            style={style}
            align={align}
            ariaLabel={ariaLabel}
            onToggle={(event) => {
                event.stopPropagation();
                toggle();
            }}
        >
            {children}
        </MorphBox>
    );
};
