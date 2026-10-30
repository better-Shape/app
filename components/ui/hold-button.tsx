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
}

const DEFAULT_HOLD_MS = 1100;
const QUICK_TAP_MAX_MS = 240;
const ARMED_TIMEOUT_MS = 3600;
const CONFIRMED_RESET_MS = 1200;
const CLICK_GUARD_RESET_MS = 64;

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

const resolveAriaLabel = (
    state: HoldButtonState,
    ariaLabel: string,
    armedAriaLabel?: string,
): string => {
    if (state === "armed") return armedAriaLabel ?? `${ariaLabel} (press again to confirm)`;
    if (state === "confirmed") return `${ariaLabel} confirmed`;
    return ariaLabel;
};

const isPointerInsideTarget = (event: React.PointerEvent<HTMLButtonElement>): boolean => {
    const rect = event.currentTarget.getBoundingClientRect();
    return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
    );
};

const releaseImplicitPointerCapture = (event: React.PointerEvent<HTMLButtonElement>) => {
    const target = event.target;
    if (!(target instanceof Element) || typeof target.releasePointerCapture !== "function") return;
    try {
        if (typeof target.hasPointerCapture !== "function" || target.hasPointerCapture(event.pointerId)) {
            target.releasePointerCapture(event.pointerId);
        }
    } catch {
        // Synthetic pointer events in unit tests do not register active browser capture ids.
    }
};

/** Renders one visual layer (base or clipped destructive fill) so text and icon invert together. */
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
    clickGuard: number | null;
};

const clearTimerSlot = (timers: HoldTimers, key: keyof HoldTimers) => {
    const id = timers[key];
    if (id !== null) {
        window.clearTimeout(id);
        timers[key] = null;
    }
};

const clearAllTimers = (timers: HoldTimers) => {
    clearTimerSlot(timers, "hold");
    clearTimerSlot(timers, "reset");
    clearTimerSlot(timers, "clickGuard");
};

/**
 * Owns the hold-to-confirm state machine:
 * - Continuous press (`pointerdown` or `Enter`/`Space` held for `holdMs`) charges `.t-hold__fill`
 *   linearly on the compositor and fires `onConfirm` on completion.
 * - Releasing after >= 240ms or dragging outside bounds aborts and snaps `.t-hold__fill` back.
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
    const disabledRef = React.useRef(disabled);
    const timersRef = React.useRef<HoldTimers>({ hold: null, reset: null, clickGuard: null });
    const startedAtRef = React.useRef(0);
    const sourceRef = React.useRef<"pointer" | "keyboard" | null>(null);
    const activePointerIdRef = React.useRef<number | null>(null);
    const suppressClickRef = React.useRef(false);

    React.useEffect(() => {
        onConfirmRef.current = onConfirm;
    }, [onConfirm]);

    const writeState = React.useCallback((next: HoldButtonState) => {
        stateRef.current = next;
        setState(next);
    }, []);

    const scheduleClickGuardClear = React.useCallback(() => {
        clearTimerSlot(timersRef.current, "clickGuard");
        timersRef.current.clickGuard = window.setTimeout(() => {
            timersRef.current.clickGuard = null;
            suppressClickRef.current = false;
        }, CLICK_GUARD_RESET_MS);
    }, []);

    const cancelHold = React.useCallback(() => {
        clearAllTimers(timersRef.current);
        sourceRef.current = null;
        activePointerIdRef.current = null;
        startedAtRef.current = 0;
        suppressClickRef.current = false;
        writeState("idle");
    }, [writeState]);

    React.useEffect(() => {
        disabledRef.current = disabled;
        if (disabled && stateRef.current !== "idle") {
            cancelHold();
        }
    }, [disabled, cancelHold]);

    React.useEffect(() => () => clearAllTimers(timersRef.current), []);

    const fireConfirm = React.useCallback(() => {
        if (disabledRef.current) {
            cancelHold();
            return;
        }
        clearTimerSlot(timersRef.current, "hold");
        clearTimerSlot(timersRef.current, "reset");
        sourceRef.current = null;
        activePointerIdRef.current = null;
        startedAtRef.current = 0;
        scheduleClickGuardClear();
        writeState("confirmed");
        void onConfirmRef.current();
        timersRef.current.reset = window.setTimeout(() => {
            timersRef.current.reset = null;
            writeState("idle");
        }, CONFIRMED_RESET_MS);
    }, [cancelHold, scheduleClickGuardClear, writeState]);

    const enterArmed = React.useCallback(() => {
        clearTimerSlot(timersRef.current, "hold");
        clearTimerSlot(timersRef.current, "reset");
        sourceRef.current = null;
        activePointerIdRef.current = null;
        writeState("armed");
        timersRef.current.reset = window.setTimeout(() => {
            timersRef.current.reset = null;
            writeState("idle");
        }, ARMED_TIMEOUT_MS);
    }, [writeState]);

    const beginPress = React.useCallback(
        (source: "pointer" | "keyboard", pointerId: number | null = null) => {
            if (disabledRef.current || stateRef.current === "confirmed") return;
            if (source === "pointer" && activePointerIdRef.current !== null && activePointerIdRef.current !== pointerId) {
                return;
            }
            clearTimerSlot(timersRef.current, "clickGuard");
            suppressClickRef.current = true;
            if (stateRef.current === "armed") {
                fireConfirm();
                return;
            }
            clearTimerSlot(timersRef.current, "hold");
            clearTimerSlot(timersRef.current, "reset");
            sourceRef.current = source;
            activePointerIdRef.current = pointerId;
            startedAtRef.current = performance.now();
            writeState("holding");
            timersRef.current.hold = window.setTimeout(fireConfirm, holdMs);
        },
        [fireConfirm, holdMs, writeState],
    );

    const releasePress = React.useCallback(
        (pointerId: number | null = null) => {
            if (pointerId !== null && activePointerIdRef.current !== null && pointerId !== activePointerIdRef.current) {
                return;
            }
            activePointerIdRef.current = null;
            scheduleClickGuardClear();
            if (stateRef.current !== "holding") return;
            const elapsed = performance.now() - startedAtRef.current;
            if (elapsed < QUICK_TAP_MAX_MS) {
                enterArmed();
                return;
            }
            clearTimerSlot(timersRef.current, "hold");
            clearTimerSlot(timersRef.current, "reset");
            sourceRef.current = null;
            startedAtRef.current = 0;
            writeState("idle");
        },
        [enterArmed, scheduleClickGuardClear, writeState],
    );

    const handlePointerMove = React.useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            if (stateRef.current !== "holding" || sourceRef.current !== "pointer") return;
            if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) return;
            if (!isPointerInsideTarget(event)) cancelHold();
        },
        [cancelHold],
    );

    const handleBlur = React.useCallback(() => {
        // WebKit does not focus buttons on pointerdown, so ignore synthetic blur during pointer holds.
        if (sourceRef.current === "pointer" && stateRef.current === "holding") return;
        if (stateRef.current === "holding" || stateRef.current === "armed") cancelHold();
    }, [cancelHold]);

    const handleClick = React.useCallback(() => {
        if (suppressClickRef.current) {
            clearTimerSlot(timersRef.current, "clickGuard");
            suppressClickRef.current = false;
            return;
        }
        if (disabledRef.current || stateRef.current === "confirmed") return;
        if (stateRef.current === "armed") fireConfirm();
        else enterArmed();
    }, [enterArmed, fireConfirm]);

    const handlePointerLeave = React.useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) return;
            if (stateRef.current === "holding") cancelHold();
        },
        [cancelHold],
    );

    const handlePointerCancel = React.useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) return;
            cancelHold();
        },
        [cancelHold],
    );

    return {
        state,
        beginPress,
        releasePress,
        cancelHold,
        handlePointerMove,
        handlePointerLeave,
        handlePointerCancel,
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
        },
        ref,
    ) => {
        const {
            state,
            beginPress,
            releasePress,
            cancelHold,
            handlePointerMove,
            handlePointerLeave,
            handlePointerCancel,
            handleBlur,
            handleClick,
        } = useHoldState(onConfirm, holdMs, disabled);

        const activeState = disabled ? "idle" : state;
        const faceText = resolveFaceText(activeState, label, armedLabel, confirmedLabel);
        const computedAria = resolveAriaLabel(activeState, ariaLabel, armedAriaLabel);
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
                style={customHoldVar}
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    releaseImplicitPointerCapture(event);
                    beginPress("pointer", event.pointerId);
                }}
                onPointerMove={handlePointerMove}
                onPointerUp={(event) => releasePress(event.pointerId)}
                onPointerLeave={handlePointerLeave}
                onPointerCancel={handlePointerCancel}
                onKeyDown={(event) => {
                    if (event.key === "Escape" && activeState !== "idle") {
                        event.preventDefault();
                        event.stopPropagation();
                        cancelHold();
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
