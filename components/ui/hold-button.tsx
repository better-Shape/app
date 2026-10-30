"use client";

import * as React from "react";
import { DrawnCheck } from "@/components/ui/checkmark";
import { cn } from "@/lib/utils";

export type HoldButtonState = "idle" | "holding" | "armed" | "confirmed";

export interface HoldButtonProps {
    onConfirm: () => void | Promise<void>;
    ariaLabel: string;
    armedAriaLabel?: string;
    label?: React.ReactNode;
    armedLabel?: React.ReactNode;
    confirmedLabel?: React.ReactNode;
    icon?: React.ReactNode;
    holdMs?: number;
    size?: "icon" | "xs" | "sm";
    disabled?: boolean;
    className?: string;
    title?: string;
}

const DEFAULT_HOLD_MS = 1100;
const QUICK_TAP_MAX_MS = 240;
const ARMED_TIMEOUT_MS = 3600;
const CONFIRMED_RESET_MS = 1200;

const isActivationKey = (key: string): boolean => key === " " || key === "Enter";

const sizeClasses: Record<NonNullable<HoldButtonProps["size"]>, string> = {
    icon: "size-7 justify-center px-0",
    xs: "h-6 gap-1.5 px-2 text-xs",
    sm: "h-7 gap-1.5 px-2.5 text-sm",
};

const resolveFaceText = (
    state: HoldButtonState,
    label: React.ReactNode,
    armedLabel: React.ReactNode,
    confirmedLabel: React.ReactNode,
): React.ReactNode => {
    if (!label) return null;
    if (state === "confirmed") return confirmedLabel ?? "Done";
    if (state === "armed") return armedLabel ?? "Confirm";
    return label;
};

/** Renders one visual layer (base or clipped destructive fill) so text and icon invert seamlessly. */
const HoldButtonFace = ({
    state,
    icon,
    text,
}: {
    state: HoldButtonState;
    icon?: React.ReactNode;
    text: React.ReactNode;
}) => (
    <span className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
        {state === "confirmed" ? <DrawnCheck motion="compact" /> : icon}
        {text ? <span>{text}</span> : null}
    </span>
);

type HoldTimers = {
    hold: number | null;
    reset: number | null;
};

const clearHoldTimer = (timers: HoldTimers) => {
    if (timers.hold !== null) {
        window.clearTimeout(timers.hold);
        timers.hold = null;
    }
};

const clearResetTimer = (timers: HoldTimers) => {
    if (timers.reset !== null) {
        window.clearTimeout(timers.reset);
        timers.reset = null;
    }
};

/**
 * Owns the hold-to-confirm state machine:
 * - Continuous press (`pointerdown` or `Enter`/`Space` held for `holdMs`) charges `.t-hold__fill`
 *   linearly on the compositor and fires `onConfirm` on completion.
 * - Releasing after >= 240ms aborts and snaps `.t-hold__fill` back over `200ms var(--ease-out)`.
 * - Quick tap (< 240ms) or assistive-tech `.click()` enters `armed` so keyboard, switch-access,
 *   and motor-impaired users can confirm with a second non-timed press (WCAG 2.2.1 & 2.5.2).
 */
const useHoldState = (
    onConfirm: () => void | Promise<void>,
    holdMs: number,
    disabled: boolean,
) => {
    const [state, setState] = React.useState<HoldButtonState>("idle");
    const stateRef = React.useRef<HoldButtonState>("idle");
    const onConfirmRef = React.useRef(onConfirm);
    const timersRef = React.useRef<HoldTimers>({ hold: null, reset: null });
    const startedAtRef = React.useRef(0);
    const sourceRef = React.useRef<"pointer" | "keyboard" | null>(null);
    const suppressClickRef = React.useRef(false);

    React.useEffect(() => {
        onConfirmRef.current = onConfirm;
    }, [onConfirm]);

    const writeState = React.useCallback((next: HoldButtonState) => {
        stateRef.current = next;
        setState(next);
    }, []);

    const abortToIdle = React.useCallback(() => {
        clearHoldTimer(timersRef.current);
        clearResetTimer(timersRef.current);
        sourceRef.current = null;
        startedAtRef.current = 0;
        writeState("idle");
    }, [writeState]);

    React.useEffect(() => () => {
        clearHoldTimer(timersRef.current);
        clearResetTimer(timersRef.current);
    }, []);

    const fireConfirm = React.useCallback(() => {
        clearHoldTimer(timersRef.current);
        clearResetTimer(timersRef.current);
        sourceRef.current = null;
        startedAtRef.current = 0;
        writeState("confirmed");
        void onConfirmRef.current();
        timersRef.current.reset = window.setTimeout(() => {
            timersRef.current.reset = null;
            writeState("idle");
        }, CONFIRMED_RESET_MS);
    }, [writeState]);

    const enterArmed = React.useCallback(() => {
        clearHoldTimer(timersRef.current);
        clearResetTimer(timersRef.current);
        sourceRef.current = null;
        writeState("armed");
        timersRef.current.reset = window.setTimeout(() => {
            timersRef.current.reset = null;
            writeState("idle");
        }, ARMED_TIMEOUT_MS);
    }, [writeState]);

    const beginPress = React.useCallback(
        (source: "pointer" | "keyboard") => {
            if (disabled || stateRef.current === "confirmed") return;
            suppressClickRef.current = true;
            if (stateRef.current === "armed") {
                fireConfirm();
                return;
            }
            clearHoldTimer(timersRef.current);
            clearResetTimer(timersRef.current);
            sourceRef.current = source;
            startedAtRef.current = performance.now();
            writeState("holding");
            timersRef.current.hold = window.setTimeout(fireConfirm, holdMs);
        },
        [disabled, fireConfirm, holdMs, writeState],
    );

    const releasePress = React.useCallback(() => {
        if (stateRef.current !== "holding") return;
        const elapsed = performance.now() - startedAtRef.current;
        if (elapsed < QUICK_TAP_MAX_MS) {
            enterArmed();
            return;
        }
        abortToIdle();
    }, [abortToIdle, enterArmed]);

    const handleBlur = React.useCallback(() => {
        // WebKit does not focus buttons on pointerdown, so ignore synthetic blur during pointer holds.
        if (sourceRef.current === "pointer" && stateRef.current === "holding") return;
        if (stateRef.current === "holding" || stateRef.current === "armed") abortToIdle();
    }, [abortToIdle]);

    const handleClick = React.useCallback(() => {
        if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
        }
        if (disabled || stateRef.current === "confirmed") return;
        if (stateRef.current === "armed") fireConfirm();
        else enterArmed();
    }, [disabled, enterArmed, fireConfirm]);

    return {
        state,
        beginPress,
        releasePress,
        abortToIdle,
        handleBlur,
        handleClick,
    };
};

/**
 * Destructive action button with compositor-driven hold-to-confirm fill and
 * a non-timed accessible two-step alternative.
 */
export const HoldButton = React.forwardRef<HTMLButtonElement, HoldButtonProps>(
    (
        {
            onConfirm,
            ariaLabel,
            armedAriaLabel,
            label,
            armedLabel,
            confirmedLabel,
            icon,
            holdMs = DEFAULT_HOLD_MS,
            size = "xs",
            disabled = false,
            className,
            title,
        },
        ref,
    ) => {
        const { state, beginPress, releasePress, abortToIdle, handleBlur, handleClick } =
            useHoldState(onConfirm, holdMs, disabled);

        const activeState = disabled && state !== "idle" ? "idle" : state;
        const faceText = resolveFaceText(activeState, label, armedLabel, confirmedLabel);
        const computedAria =
            activeState === "armed"
                ? (armedAriaLabel ?? `${ariaLabel} (press again to confirm)`)
                : ariaLabel;
        const customHoldVar =
            holdMs !== DEFAULT_HOLD_MS
                ? ({ "--hold-dur": `${holdMs}ms` } as React.CSSProperties)
                : undefined;

        return (
            <button
                ref={ref}
                type="button"
                disabled={disabled}
                data-state={activeState}
                aria-label={computedAria}
                title={activeState === "armed" ? "Press again to confirm" : (title ?? ariaLabel)}
                style={customHoldVar}
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                    if (event.button === 0) beginPress("pointer");
                }}
                onPointerUp={releasePress}
                onPointerLeave={() => {
                    if (activeState === "holding") abortToIdle();
                }}
                onPointerCancel={abortToIdle}
                onKeyDown={(event) => {
                    if (event.key === "Escape" && activeState !== "idle") {
                        event.preventDefault();
                        event.stopPropagation();
                        abortToIdle();
                        return;
                    }
                    if (!event.repeat && isActivationKey(event.key)) {
                        event.preventDefault();
                        beginPress("keyboard");
                    }
                }}
                onKeyUp={(event) => {
                    if (isActivationKey(event.key)) {
                        event.preventDefault();
                        releasePress();
                    }
                }}
                onBlur={handleBlur}
                onClick={handleClick}
                className={cn(
                    "t-hold inline-flex shrink-0 items-center rounded-md font-normal text-text-muted",
                    "hover:bg-[var(--btn-hover)] hover:text-text-primary",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus",
                    "disabled:pointer-events-none disabled:opacity-50",
                    sizeClasses[size],
                    className,
                )}
            >
                <HoldButtonFace state={activeState} icon={icon} text={faceText} />
                <span className="t-hold__fill inline-flex items-center justify-center px-[inherit]" aria-hidden="true">
                    <HoldButtonFace state={activeState} icon={icon} text={faceText} />
                </span>
            </button>
        );
    },
);

HoldButton.displayName = "HoldButton";
