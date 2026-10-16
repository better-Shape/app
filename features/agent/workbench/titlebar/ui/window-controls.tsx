"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { usePlatform } from "@/lib/platform";

/** The width Windows gives each control, which the spacer has to reserve for all three. */
const CONTROLS_WIDTH = 46 * 3;

/**
 * `document.body` never changes identity for the life of the document, so the subscription
 * React asks for here never fires and its cleanup has nothing to do.
 */
const subscribeNever = () => () => undefined;

/**
 * The portal host shared with Radix overlays.
 *
 * The controls have to outlive the panels: a blur or a modal effect that covers a panel
 * would cover controls mounted inside it, and a window the user cannot close is worse than
 * one they cannot blur.
 */
const getPortalHost = () => document.body;

/** The server snapshot: there is no body to portal into while the tree renders on a server. */
const getNoPortalHost = () => null;

/**
 * The window-control glyphs, drawn rather than imported.
 *
 * They sit on a 10-unit grid with a 1px stroke so they stay crisp at the size the platform
 * draws them, which no icon set in the project matches.
 */

/** Minimize: one hairline across the middle. */
export const IconMinimize = () => (
    <svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
        <path d="M0 5H10" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
);

/** Maximize: the frame, inset half a unit so the stroke lands inside the grid. */
export const IconMaximize = () => (
    <svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
        <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
);

/** Restore: the front frame offset over the back one, which is what tells it from maximize. */
export const IconRestore = () => (
    <svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
        <path d="M2.5 2.5V0.5H9.5V7.5H7.5" stroke="currentColor" strokeWidth="1" fill="none" />
        <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
);

/** Close: the two diagonals, meeting at the centre of the grid. */
export const IconClose = () => (
    <svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
        <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
);

/** Zoom: macOS's green light, drawn as the four corners of an expanding frame. */
export const IconZoom = () => (
    <svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
        <path
            d="M4 0.5H0.5V4M6 0.5H9.5V4M4 9.5H0.5V6M6 9.5H9.5V6"
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
        />
    </svg>
);

type WindowControlHandlers = {
    isMaximized: boolean;
    onMinimize: () => void;
    onToggleMaximize: () => void;
    onClose: () => void;
};

/**
 * Where the cluster sits, once the caller's omissions are filled in.
 *
 * Defaults are resolved here rather than in the props, because a default parameter is a branch
 * the complexity reading counts, and this component already owns the platform decision.
 */
type WindowControlPlacement = {
    surface?: "chrome" | "panel" | "sidebar";
    spacer?: boolean;
    floating?: boolean;
};

/** Unset means the panel surface, a reserved spacer and a floating cluster. */
const resolvePlacement = (
    placement: WindowControlPlacement,
): Required<WindowControlPlacement> => ({
    surface: placement.surface ?? "panel",
    spacer: placement.spacer ?? true,
    floating: placement.floating ?? true,
});

/**
 * One macOS traffic light.
 *
 * The dot is a button rather than a span: the glyph only appears once the pointer is over the
 * cluster, so the click target and the accessible name have to exist whether or not the
 * colour is visible.
 */
const TrafficLight = ({
    label,
    color,
    glyph,
    onClick,
}: {
    label: string;
    color: string;
    glyph: ReactNode;
    onClick: () => void;
}) => (
    <button
        type="button"
        aria-label={label}
        className="control-button group/mac relative flex size-4 cursor-default items-center justify-center rounded-full"
        onClick={onClick}
    >
        <span className={cn("absolute size-3 rounded-full", color)} />
        <span className="relative text-black/55 opacity-0 transition-opacity group-hover/mac:opacity-100">
            {glyph}
        </span>
    </button>
);

/** macOS traffic lights: close, minimize, zoom left to right, glyphs on group hover. */
const MacTrafficLights = ({
    isMaximized,
    onMinimize,
    onToggleMaximize,
    onClose,
}: WindowControlHandlers) => (
    <div className="flex shrink-0 items-center gap-1 pl-[13px] pr-2" data-no-drag>
        <TrafficLight label="Close" color="bg-[#ff5f57]" glyph={<IconClose />} onClick={onClose} />
        <TrafficLight
            label="Minimize"
            color="bg-[#febc2e]"
            glyph={<IconMinimize />}
            onClick={onMinimize}
        />
        <TrafficLight
            label={isMaximized ? "Restore" : "Zoom"}
            color="bg-[#28c840]"
            glyph={<IconZoom />}
            onClick={onToggleMaximize}
        />
    </div>
);

/**
 * One Windows window button.
 *
 * Close is the one control with a colour of its own: Windows paints it red under the pointer
 * so the destructive press is never the one the eye lands on first.
 */
const ControlButton = ({
    label,
    danger,
    onClick,
    children,
}: {
    label: string;
    danger?: boolean;
    onClick: () => void;
    children: ReactNode;
}) => (
    <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(
            "control-button flex h-full w-[46px] cursor-default items-center justify-center transition-colors",
            danger
                ? "close-button hover:bg-[#e81123] hover:text-white active:bg-[#b00d1b]"
                : "hover:bg-[var(--btn-hover)] active:bg-panel-active",
        )}
    >
        {children}
    </button>
);

/** The Windows cluster: minimize, maximize or restore, close. */
const WindowControlButtons = ({
    isMaximized,
    onMinimize,
    onToggleMaximize,
    onClose,
}: WindowControlHandlers) => (
    <>
        <ControlButton label="Minimize" onClick={onMinimize}>
            <IconMinimize />
        </ControlButton>
        <ControlButton
            label={isMaximized ? "Restore" : "Maximize"}
            onClick={onToggleMaximize}
        >
            {isMaximized ? <IconRestore /> : <IconMaximize />}
        </ControlButton>
        <ControlButton label="Close" danger onClick={onClose}>
            <IconClose />
        </ControlButton>
    </>
);

/** Reserves the cluster's width in the flow, for a titlebar that has no floating controls. */
export const WindowControlsSpacer = () => (
    <div className="h-full shrink-0" style={{ width: CONTROLS_WIDTH }} aria-hidden />
);

/** The floating cluster's own surface, matched to the panel it sits on. */
const controlsSurfaceClass = (surface: "chrome" | "panel" | "sidebar") => {
    if (surface === "sidebar") return "bg-sidebar";
    if (surface === "chrome") return "bg-surface-3";
    return "bg-panel";
};

/** Portals into the body once it exists, and renders in place while it does not. */
const PortalToBody = ({ host, children }: { host: HTMLElement | null; children: ReactNode }) =>
    host ? createPortal(children, host) : children;

/** The cluster once it is out of the panel's stacking context. */
const FloatingCluster = ({
    host,
    surface,
    children,
}: {
    host: HTMLElement | null;
    surface: "chrome" | "panel" | "sidebar";
    children: ReactNode;
}) => (
    <PortalToBody host={host}>
        <div
            className={cn(
                "titlebar-window-controls pointer-events-auto fixed top-0 right-0 isolate z-titlebar-controls flex h-titlebar shrink-0 items-stretch",
                controlsSurfaceClass(surface),
            )}
            data-no-drag
        >
            {children}
        </div>
    </PortalToBody>
);

/**
 * Where the cluster sits: a spacer in the flow, the cluster itself floating, or both.
 *
 * The two switches are separate on purpose. A window that draws the controls in flow wants the
 * width reserved and nothing floated; one that floats them wants both, so that a titlebar
 * rendered under them still ends where they begin.
 */
const PlacedControls = ({
    host,
    placement,
    children,
}: {
    host: HTMLElement | null;
    placement: Required<WindowControlPlacement>;
    children: ReactNode;
}) => (
    <>
        {placement.spacer ? <WindowControlsSpacer /> : null}
        {placement.floating ? (
            <FloatingCluster host={host} surface={placement.surface}>
                {children}
            </FloatingCluster>
        ) : null}
    </>
);

/**
 * The window's controls, in the shape the platform draws them.
 *
 * macOS gets the traffic lights on the left and owes no spacer; every other platform gets the
 * cluster on the right, floating above the panels unless the caller asks for it in flow.
 */
export const WindowControls = ({
    isMaximized,
    onMinimize,
    onToggleMaximize,
    onClose,
    surface,
    spacer,
    floating,
}: WindowControlHandlers & WindowControlPlacement) => {
    const host = useSyncExternalStore(subscribeNever, getPortalHost, getNoPortalHost);
    const isMac = usePlatform() === "macos";
    const placement = resolvePlacement({ surface, spacer, floating });

    if (isMac) {
        return (
            <MacTrafficLights
                isMaximized={isMaximized}
                onMinimize={onMinimize}
                onToggleMaximize={onToggleMaximize}
                onClose={onClose}
            />
        );
    }

    return (
        <PlacedControls host={host} placement={placement}>
            <WindowControlButtons
                isMaximized={isMaximized}
                onMinimize={onMinimize}
                onToggleMaximize={onToggleMaximize}
                onClose={onClose}
            />
        </PlacedControls>
    );
};
