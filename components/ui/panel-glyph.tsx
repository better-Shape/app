"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

/** Which edge of the window the panel is docked to. */
export type PanelEdge = "left" | "right" | "bottom";

/** Kept for callers written before a bottom panel existed. */
export type PanelSide = PanelEdge;

/** The frame band is 1 unit wide, so a closed rail can never be thinner than that. */
const BAND = 1;

/**
 * Fluent's panel glyph is an outer rounded rect minus an inner hole; the strip left on one
 * edge is the rail. `free` is the rail's moving edge, `docked` the edge it stays welded to
 * and `span` its extent across the other axis, so the mask geometry is derived once and the
 * axis stays a parameter.
 */
interface PanelSpec {
    /** Fluent's filled glyph for this edge, reproduced verbatim. */
    silhouette: string;
    /** The coordinate the rail travels along: side panels hide horizontally, a bottom panel vertically. */
    axis: "x" | "y";
    /** The rail's free (moving) edge, in viewBox units. */
    free: number;
    /** The edge the rail stays docked to, in viewBox units. */
    docked: number;
    /** The rail's extent across the other axis, as [start, end] in viewBox units. */
    span: readonly [number, number];
}

/**
 * The three panel glyphs, reproduced from Fluent's 20-unit viewBox so a resting toggle
 * draws the pixels of the `Panel*20Filled` icon it replaces.
 */
const PANEL: Record<PanelEdge, PanelSpec> = {
    left: {
        silhouette:
            "M15 4a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM8.5 15H15a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H8.5z",
        axis: "x",
        free: 8.5,
        docked: 2,
        span: [5, 15],
    },
    right: {
        silhouette:
            "M15 3a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM5 4a2 2 0 0 0-2 2v7c0 1.1.9 2 2 2h6.5V4z",
        axis: "x",
        free: 11.5,
        docked: 18,
        span: [4, 15],
    },
    bottom: {
        silhouette:
            "M2 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3zm3-2a2 2 0 0 0-2 2v5h14V6a2 2 0 0 0-2-2z",
        axis: "y",
        free: 11,
        docked: 16,
        span: [3, 17],
    },
};

/**
 * One extent of the rail expressed along and across the panel's own axis.
 *
 * Every value in the mask is axis-relative, so the swap between x and y happens once here
 * instead of in five ternaries below it.
 */
const onAxis = (axis: "x" | "y", along: number, across: number): [number, number] =>
    axis === "x" ? [along, across] : [across, along];

/**
 * The mask that hides the rail's excess.
 *
 * Scaling this rect about the free edge keeps the animation on `transform` and leaves the
 * rail's docked corners untouched, which scaling the rail itself would distort.
 */
const hiddenRail = (edge: PanelEdge) => {
    const { axis, free, docked, span } = PANEL[edge];
    // The band edge nearest the free edge: the rail's landing place when hidden, reached
    // by stepping from the docked edge toward the free one.
    const band = docked + BAND * Math.sign(free - docked);
    const [across, acrossEnd] = span;
    const acrossMid = (across + acrossEnd) / 2;
    const [x, y] = onAxis(axis, Math.min(free, band), across);
    const [width, height] = onAxis(axis, Math.abs(free - docked) - BAND, acrossEnd - across);
    const [originX, originY] = onAxis(axis, free, acrossMid);
    return {
        x,
        y,
        width,
        height,
        /** Absolute viewBox units: a percentage would resolve against `transform-box`. */
        origin: `${originX}px ${originY}px`,
    };
};

const HIDDEN = {
    left: hiddenRail("left"),
    right: hiddenRail("right"),
    bottom: hiddenRail("bottom"),
} as const;

/**
 * Fluent fuses the rail into the frame path, so it can never move. Cropping it behind a
 * mask instead leaves the open state pixel-identical while `--panel-rail-hide` can retract
 * the rail. The host button drives the preview through `data-panel-toggle`.
 */
export const PanelGlyph = ({
    side,
    open,
    className,
}: {
    /** The edge the panel is docked to. */
    side: PanelEdge;
    /** Panel state the glyph describes: the rail is full when open, a hairline when closed. */
    open: boolean;
    className?: string;
}) => {
    // Unique per instance: several toggles can be on screen at once and each carries
    // its own `--panel-rail-hide`, so they cannot share a mask.
    const maskId = `bettershape-panel-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-${side}`;
    const hide = HIDDEN[side];

    return (
        <svg
            className={cn("bettershape-icon panel-glyph", side !== "left" && `panel-glyph--${side}`, className)}
            viewBox="0 0 20 20"
            data-open={open ? "true" : "false"}
            aria-hidden
            focusable="false"
        >
            <mask id={maskId} maskUnits="userSpaceOnUse" x={-1} y={-1} width={22} height={22}>
                {/* Keep everything, then hide the rail's excess. Both fills are
                    luminance, not theme color: see `.panel-glyph` in
                    `app/transitions.css`. */}
                <rect className="panel-glyph__keep" x={-1} y={-1} width={22} height={22} />
                <rect
                    className="panel-glyph__hide"
                    x={hide.x}
                    y={hide.y}
                    width={hide.width}
                    height={hide.height}
                    style={{ transformOrigin: hide.origin }}
                />
            </mask>
            <path d={PANEL[side].silhouette} mask={`url(#${maskId})`} />
        </svg>
    );
};
