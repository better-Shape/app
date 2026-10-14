"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const subscribeNoop = () => () => {};
const getDocumentBody = () => document.body;
const getNoBody = () => null;
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { usePlatform } from "@/lib/platform";

export function IconMinimize() {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 5H10" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
    );
}

export function IconMaximize() {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
    );
}

export function IconRestore() {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
            <path d="M2.5 2.5V0.5H9.5V7.5H7.5" stroke="currentColor" strokeWidth="1" fill="none" />
            <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
    );
}

export function IconClose() {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
            <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
    );
}

export function IconZoom() {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M4 0.5H0.5V4M6 0.5H9.5V4M4 9.5H0.5V6M6 9.5H9.5V6"
                stroke="currentColor"
                strokeWidth="1"
                fill="none"
            />
        </svg>
    );
}

type WindowControlHandlers = {
    isMaximized: boolean;
    onMinimize: () => void;
    onToggleMaximize: () => void;
    onClose: () => void;
};

/** macOS traffic lights: close, minimize, zoom left to right, glyphs on group hover. */
function MacTrafficLights({
    isMaximized,
    onMinimize,
    onToggleMaximize,
    onClose,
}: WindowControlHandlers) {
    const dot = (label: string, color: string, glyph: ReactNode, onClick: () => void) => (
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

    return (
        <div className="flex shrink-0 items-center gap-1 pl-[13px] pr-2" data-no-drag>
            {dot("Close", "bg-[#ff5f57]", <IconClose />, onClose)}
            {dot("Minimize", "bg-[#febc2e]", <IconMinimize />, onMinimize)}
            {dot(isMaximized ? "Restore" : "Zoom", "bg-[#28c840]", <IconZoom />, onToggleMaximize)}
        </div>
    );
}

const CONTROLS_WIDTH = 46 * 3;

function WindowControlButtons({
    isMaximized,
    onMinimize,
    onToggleMaximize,
    onClose,
}: {
    isMaximized: boolean;
    onMinimize: () => void;
    onToggleMaximize: () => void;
    onClose: () => void;
}) {
    return (
        <>
            <button
                type="button"
                aria-label="Minimize"
                className="control-button flex h-full w-[46px] cursor-default items-center justify-center transition-colors hover:bg-panel-hover active:bg-panel-active"
                onClick={onMinimize}
            >
                <IconMinimize />
            </button>
            <button
                type="button"
                aria-label={isMaximized ? "Restore" : "Maximize"}
                className="control-button flex h-full w-[46px] cursor-default items-center justify-center transition-colors hover:bg-panel-hover active:bg-panel-active"
                onClick={onToggleMaximize}
            >
                {isMaximized ? <IconRestore /> : <IconMaximize />}
            </button>
            <button
                type="button"
                aria-label="Close"
                className="control-button close-button flex h-full w-[46px] cursor-default items-center justify-center transition-colors hover:bg-[#e81123] hover:text-white active:bg-[#b00d1b]"
                onClick={onClose}
            >
                <IconClose />
            </button>
        </>
    );
}

export function WindowControlsSpacer() {
    return (
        <div
            className="h-full shrink-0"
            style={{ width: CONTROLS_WIDTH }}
            aria-hidden
        />
    );
}

export function WindowControls({
    isMaximized,
    onMinimize,
    onToggleMaximize,
    onClose,
    surface = "panel",
    spacer = true,
    floating = true,
}: WindowControlHandlers & {
    /** Match the panel the controls sit on. */
    surface?: "chrome" | "panel" | "sidebar";
    spacer?: boolean;
    floating?: boolean;
}) {
    const host = useSyncExternalStore(subscribeNoop, getDocumentBody, getNoBody);
    const isMac = usePlatform() === "macos";

    // macOS draws its own left-hand cluster, so nothing floats right and no
    // right-hand spacer is owed. In flow, the cluster reserves its own width.
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

    const buttons = (
        <WindowControlButtons
            isMaximized={isMaximized}
            onMinimize={onMinimize}
            onToggleMaximize={onToggleMaximize}
            onClose={onClose}
        />
    );

    const bg =
        surface === "sidebar" ? "bg-sidebar" : surface === "chrome" ? "bg-surface-3" : "bg-panel";

    /** Same layer as Radix overlays (document.body) so blur cannot cover these. */
    const floatingEl = floating ? (
        <div
            className={cn(
                "titlebar-window-controls pointer-events-auto fixed top-0 right-0 isolate z-titlebar-controls flex h-titlebar shrink-0 items-stretch",
                bg,
            )}
            data-no-drag
        >
            {buttons}
        </div>
    ) : null;

    return (
        <>
            {spacer ? <WindowControlsSpacer /> : null}
            {floatingEl ? (host ? createPortal(floatingEl, host) : floatingEl) : null}
        </>
    );
}
