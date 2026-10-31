"use client";

import * as React from "react";
import { DrawnCheck } from "@/components/ui/checkmark";
import { cn } from "@/lib/utils";

export type HoldButtonState = "idle" | "holding" | "armed" | "confirmed";

export type HoldConfirmResult = void | boolean | Promise<void | boolean>;

type NativeHoldButtonAttributes = Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "type" | "children"
>;

export interface HoldButtonProps extends NativeHoldButtonAttributes {
    onConfirm: () => HoldConfirmResult;
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
    onStateChange?: (state: HoldButtonState) => void;
}

const DEFAULT_HOLD_MS = 1100;
const QUICK_TAP_MAX_MS = 240;
const CONFIRMED_RESET_MS = 1200;
const CLICK_GUARD_RESET_MS = 64;

const assignForwardedRef = (
    forwardedRef: React.ForwardedRef<HTMLButtonElement>,
    node: HTMLButtonElement | null,
): void => {
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
};

const isOutsideElement = (
    element: HTMLElement | null,
    target: EventTarget | null,
): boolean => Boolean(element && target instanceof Node && !element.contains(target));

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

const isWithinRect = (
    rect: DOMRect,
    event: Pick<PointerEvent, "clientX" | "clientY">,
): boolean =>
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;

const isPointerEventInsideButton = (
    button: HTMLButtonElement | null,
    event: Pick<PointerEvent, "clientX" | "clientY" | "target">,
): boolean => {
    if (!button) return false;
    const rect = button.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
        return event.target instanceof Node && button.contains(event.target);
    }
    return isWithinRect(rect, event);
};

const shouldReleaseCapture = (element: Element, pointerId: number): boolean =>
    typeof element.hasPointerCapture !== "function" || element.hasPointerCapture(pointerId);

const releaseNodePointerCapture = (node: EventTarget | null, pointerId: number) => {
    if (!(node instanceof Element) || typeof node.releasePointerCapture !== "function") return;
    try {
        if (shouldReleaseCapture(node, pointerId)) node.releasePointerCapture(pointerId);
    } catch {
        // Synthetic pointer events in unit tests do not register active browser capture ids.
    }
};

const releaseImplicitPointerCapture = (event: React.PointerEvent<HTMLButtonElement>) => {
    releaseNodePointerCapture(event.target, event.pointerId);
    if (event.currentTarget !== event.target) {
        releaseNodePointerCapture(event.currentTarget, event.pointerId);
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

const isPromiseLike = (value: unknown): value is PromiseLike<void | boolean> =>
    Boolean(value && typeof (value as PromiseLike<void | boolean>).then === "function");

/** Registers synchronous Escape, outside-pointerdown, window-blur, and tab-hide listeners. */
const attachGlobalHoldDismiss = (
    button: HTMLButtonElement | null,
    getState: () => HoldButtonState,
    cancelHold: () => void,
    abortActiveHold: () => void,
): (() => void) => {
    const ownerDoc = button?.ownerDocument ?? document;
    const ownerWin = ownerDoc.defaultView ?? window;
    const handleDocumentPointerDown = (event: PointerEvent) => {
        if (getState() === "armed" && isOutsideElement(button, event.target)) {
            cancelHold();
        }
    };
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        const current = getState();
        if (current !== "holding" && current !== "armed") return;
        event.preventDefault();
        event.stopPropagation();
        abortActiveHold();
    };
    const handleVisibilityChange = () => {
        if (ownerDoc.visibilityState === "hidden") cancelHold();
    };
    ownerDoc.addEventListener("pointerdown", handleDocumentPointerDown, true);
    ownerDoc.addEventListener("keydown", handleDocumentKeyDown, true);
    ownerDoc.addEventListener("visibilitychange", handleVisibilityChange);
    ownerWin.addEventListener("blur", cancelHold);
    return () => {
        ownerDoc.removeEventListener("pointerdown", handleDocumentPointerDown, true);
        ownerDoc.removeEventListener("keydown", handleDocumentKeyDown, true);
        ownerDoc.removeEventListener("visibilitychange", handleVisibilityChange);
        ownerWin.removeEventListener("blur", cancelHold);
    };
};

type HoldStateOptions = {
    onConfirm: () => HoldConfirmResult;
    holdMs: number;
    disabled: boolean;
    buttonRef: React.RefObject<HTMLButtonElement | null>;
    onStateChange?: (state: HoldButtonState) => void;
};

/**
 * Owns the hold-to-confirm state machine:
 * - Continuous press (`pointerdown` or `Enter`/`Space` held for `holdMs`) charges `.t-hold__fill`
 *   linearly on the compositor and fires `onConfirm` on completion.
 * - Releasing after >= 240ms or dragging outside bounds aborts and snaps `.t-hold__fill` back.
 * - Quick tap (< 240ms) or assistive-tech `.click()` enters `armed` so keyboard, switch-access,
 *   and motor-impaired users can confirm with a second non-timed press (WCAG 2.2.1 & 2.5.2).
 */
const useHoldState = ({
    onConfirm,
    holdMs,
    disabled,
    buttonRef,
    onStateChange,
}: HoldStateOptions) => {
    const [state, setState] = React.useState<HoldButtonState>("idle");
    const [pending, setPending] = React.useState(false);
    const stateRef = React.useRef<HoldButtonState>("idle");
    const onConfirmRef = React.useRef(onConfirm);
    const onStateChangeRef = React.useRef(onStateChange);
    const disabledRef = React.useRef(disabled);
    const mountedRef = React.useRef(true);
    const confirmInFlightRef = React.useRef(false);
    const armedPressRef = React.useRef(false);
    const timersRef = React.useRef<HoldTimers>({ hold: null, reset: null, clickGuard: null });
    const startedAtRef = React.useRef(0);
    const sourceRef = React.useRef<"pointer" | "keyboard" | null>(null);
    const activeInputTokenRef = React.useRef<number | string | null>(null);
    const suppressClickRef = React.useRef(false);
    const pointerLeftBoundsRef = React.useRef(false);
    const pointerCleanupRef = React.useRef<(() => void) | null>(null);
    const dismissCleanupRef = React.useRef<(() => void) | null>(null);
    const confirmEpochRef = React.useRef(0);

    const isButtonDisabled = React.useCallback(
        () => disabledRef.current || Boolean(buttonRef.current?.disabled),
        [buttonRef],
    );

    const detachPointerListeners = React.useCallback(() => {
        if (!pointerCleanupRef.current) return;
        pointerCleanupRef.current();
        pointerCleanupRef.current = null;
    }, []);

    const detachDismissListeners = React.useCallback(() => {
        if (!dismissCleanupRef.current) return;
        dismissCleanupRef.current();
        dismissCleanupRef.current = null;
    }, []);

    React.useLayoutEffect(() => {
        onConfirmRef.current = onConfirm;
        onStateChangeRef.current = onStateChange;
    }, [onConfirm, onStateChange]);

    const writeState = React.useCallback((next: HoldButtonState) => {
        const changed = stateRef.current !== next;
        stateRef.current = next;
        setState(next);
        if (changed) onStateChangeRef.current?.(next);
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
        detachPointerListeners();
        detachDismissListeners();
        sourceRef.current = null;
        activeInputTokenRef.current = null;
        armedPressRef.current = false;
        startedAtRef.current = 0;
        pointerLeftBoundsRef.current = false;
        suppressClickRef.current = false;
        writeState("idle");
    }, [detachDismissListeners, detachPointerListeners, writeState]);

    const leavePointerBounds = React.useCallback(() => {
        pointerLeftBoundsRef.current = true;
        clearTimerSlot(timersRef.current, "hold");
        clearTimerSlot(timersRef.current, "reset");
        detachDismissListeners();
        sourceRef.current = null;
        activeInputTokenRef.current = null;
        armedPressRef.current = false;
        startedAtRef.current = 0;
        writeState("idle");
    }, [detachDismissListeners, writeState]);

    const abortActiveHold = React.useCallback(() => {
        if (sourceRef.current === "pointer") {
            leavePointerBounds();
            return;
        }
        cancelHold();
    }, [cancelHold, leavePointerBounds]);

    const ensureDismissListeners = React.useCallback(() => {
        if (dismissCleanupRef.current) return;
        dismissCleanupRef.current = attachGlobalHoldDismiss(
            buttonRef.current,
            () => stateRef.current,
            cancelHold,
            abortActiveHold,
        );
    }, [abortActiveHold, buttonRef, cancelHold]);

    const finishEscapedPointerUp = React.useCallback(
        (event: PointerEvent) => {
            pointerLeftBoundsRef.current = false;
            detachPointerListeners();
            if (isPointerEventInsideButton(buttonRef.current, event)) {
                scheduleClickGuardClear();
            } else {
                suppressClickRef.current = false;
            }
        },
        [buttonRef, detachPointerListeners, scheduleClickGuardClear],
    );

    const invalidateInFlightConfirm = React.useCallback(() => {
        confirmEpochRef.current += 1;
        if (!confirmInFlightRef.current) return;
        confirmInFlightRef.current = false;
        setPending(false);
    }, []);

    React.useLayoutEffect(() => {
        disabledRef.current = disabled;
        if (!disabled) return;
        invalidateInFlightConfirm();
        if (stateRef.current !== "idle" || armedPressRef.current) cancelHold();
    }, [disabled, cancelHold, invalidateInFlightConfirm]);

    React.useEffect(() => {
        const timers = timersRef.current;
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            detachPointerListeners();
            detachDismissListeners();
            clearAllTimers(timers);
        };
    }, [detachDismissListeners, detachPointerListeners]);

    const finishConfirmed = React.useCallback(() => {
        if (!mountedRef.current || isButtonDisabled()) {
            if (mountedRef.current) writeState("idle");
            return;
        }
        writeState("confirmed");
        timersRef.current.reset = window.setTimeout(() => {
            timersRef.current.reset = null;
            if (mountedRef.current) writeState("idle");
        }, CONFIRMED_RESET_MS);
    }, [isButtonDisabled, writeState]);

    const settleSyncConfirm = React.useCallback(
        (outcome: void | boolean) => {
            if (outcome === false || isButtonDisabled()) {
                if (mountedRef.current) writeState("idle");
                return;
            }
            finishConfirmed();
        },
        [finishConfirmed, isButtonDisabled, writeState],
    );

    const awaitAsyncConfirm = React.useCallback(
        (promise: PromiseLike<void | boolean>, epoch: number) => {
            if (confirmEpochRef.current !== epoch || isButtonDisabled()) {
                writeState("idle");
                return;
            }
            confirmInFlightRef.current = true;
            setPending(true);
            writeState("idle");
            Promise.resolve(promise)
                .then((outcome) => {
                    if (confirmEpochRef.current !== epoch) return;
                    confirmInFlightRef.current = false;
                    if (mountedRef.current) setPending(false);
                    settleSyncConfirm(outcome);
                })
                .catch(() => {
                    if (confirmEpochRef.current !== epoch) return;
                    confirmInFlightRef.current = false;
                    if (!mountedRef.current) return;
                    setPending(false);
                    writeState("idle");
                });
        },
        [isButtonDisabled, settleSyncConfirm, writeState],
    );

    const dispatchConfirmCallback = React.useCallback(() => {
        confirmEpochRef.current += 1;
        const callEpoch = confirmEpochRef.current;
        let result: HoldConfirmResult;
        try {
            result = onConfirmRef.current();
        } catch {
            writeState("idle");
            return;
        }
        if (isPromiseLike(result)) awaitAsyncConfirm(result, callEpoch);
        else settleSyncConfirm(result);
    }, [awaitAsyncConfirm, settleSyncConfirm, writeState]);

    const fireConfirm = React.useCallback(() => {
        if (isButtonDisabled()) {
            cancelHold();
            return;
        }
        if (confirmInFlightRef.current) return;
        clearTimerSlot(timersRef.current, "hold");
        clearTimerSlot(timersRef.current, "reset");
        detachPointerListeners();
        detachDismissListeners();
        sourceRef.current = null;
        activeInputTokenRef.current = null;
        armedPressRef.current = false;
        startedAtRef.current = 0;
        scheduleClickGuardClear();
        dispatchConfirmCallback();
    }, [
        cancelHold,
        detachDismissListeners,
        detachPointerListeners,
        dispatchConfirmCallback,
        isButtonDisabled,
        scheduleClickGuardClear,
    ]);

    const enterArmed = React.useCallback(() => {
        if (isButtonDisabled()) {
            cancelHold();
            return;
        }
        clearTimerSlot(timersRef.current, "hold");
        clearTimerSlot(timersRef.current, "reset");
        detachPointerListeners();
        sourceRef.current = null;
        activeInputTokenRef.current = null;
        armedPressRef.current = false;
        writeState("armed");
        ensureDismissListeners();
    }, [cancelHold, detachPointerListeners, ensureDismissListeners, isButtonDisabled, writeState]);

    const matchesActivePress = React.useCallback(
        (source: "pointer" | "keyboard", token: number | string) =>
            sourceRef.current === source && activeInputTokenRef.current === token,
        [],
    );

    const isPressBlocked = React.useCallback(
        () =>
            isButtonDisabled() ||
            confirmInFlightRef.current ||
            stateRef.current === "confirmed" ||
            sourceRef.current !== null,
        [isButtonDisabled],
    );

    const settleHoldingRelease = React.useCallback(() => {
        if (stateRef.current !== "holding") return;
        const elapsed = performance.now() - startedAtRef.current;
        if (elapsed < QUICK_TAP_MAX_MS) {
            enterArmed();
            return;
        }
        clearTimerSlot(timersRef.current, "hold");
        clearTimerSlot(timersRef.current, "reset");
        detachDismissListeners();
        startedAtRef.current = 0;
        writeState("idle");
    }, [detachDismissListeners, enterArmed, writeState]);

    const releasePress = React.useCallback(
        (source: "pointer" | "keyboard", token: number | string) => {
            if (!matchesActivePress(source, token)) return;
            detachPointerListeners();
            sourceRef.current = null;
            activeInputTokenRef.current = null;
            scheduleClickGuardClear();
            const wasArmedPress = armedPressRef.current && stateRef.current === "armed";
            armedPressRef.current = false;
            if (wasArmedPress) {
                fireConfirm();
                return;
            }
            settleHoldingRelease();
        },
        [
            detachPointerListeners,
            fireConfirm,
            matchesActivePress,
            scheduleClickGuardClear,
            settleHoldingRelease,
        ],
    );

    const attachPointerListeners = React.useCallback(
        (pointerId: number) => {
            detachPointerListeners();
            const ownerDoc = buttonRef.current?.ownerDocument ?? document;
            const handleDocMove = (event: PointerEvent) => {
                if (event.pointerId !== pointerId || pointerLeftBoundsRef.current) return;
                if (!isPointerEventInsideButton(buttonRef.current, event)) {
                    leavePointerBounds();
                }
            };
            const handleDocUp = (event: PointerEvent) => {
                if (event.pointerId !== pointerId) return;
                if (pointerLeftBoundsRef.current) {
                    finishEscapedPointerUp(event);
                    return;
                }
                if (!isPointerEventInsideButton(buttonRef.current, event)) cancelHold();
                else releasePress("pointer", event.pointerId);
            };
            const handleDocCancel = (event: PointerEvent) => {
                if (event.pointerId === pointerId) cancelHold();
            };
            ownerDoc.addEventListener("pointermove", handleDocMove, true);
            ownerDoc.addEventListener("pointerup", handleDocUp, true);
            ownerDoc.addEventListener("pointercancel", handleDocCancel, true);
            pointerCleanupRef.current = () => {
                ownerDoc.removeEventListener("pointermove", handleDocMove, true);
                ownerDoc.removeEventListener("pointerup", handleDocUp, true);
                ownerDoc.removeEventListener("pointercancel", handleDocCancel, true);
            };
        },
        [
            buttonRef,
            cancelHold,
            detachPointerListeners,
            finishEscapedPointerUp,
            leavePointerBounds,
            releasePress,
        ],
    );

    const beginPress = React.useCallback(
        (source: "pointer" | "keyboard", token: number | string) => {
            if (isPressBlocked()) return;
            detachPointerListeners();
            clearTimerSlot(timersRef.current, "clickGuard");
            pointerLeftBoundsRef.current = false;
            suppressClickRef.current = true;
            sourceRef.current = source;
            activeInputTokenRef.current = token;
            if (source === "pointer" && typeof token === "number") {
                attachPointerListeners(token);
            }
            if (stateRef.current === "armed") {
                armedPressRef.current = true;
                return;
            }
            clearTimerSlot(timersRef.current, "hold");
            clearTimerSlot(timersRef.current, "reset");
            startedAtRef.current = performance.now();
            writeState("holding");
            ensureDismissListeners();
            timersRef.current.hold = window.setTimeout(fireConfirm, holdMs);
        },
        [
            attachPointerListeners,
            detachPointerListeners,
            ensureDismissListeners,
            fireConfirm,
            holdMs,
            isPressBlocked,
            writeState,
        ],
    );

    const handlePointerMove = React.useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            if (!matchesActivePress("pointer", event.pointerId)) return;
            if (!isPointerEventInsideButton(event.currentTarget, event.nativeEvent)) {
                leavePointerBounds();
            }
        },
        [leavePointerBounds, matchesActivePress],
    );

    const handleBlur = React.useCallback(() => {
        // WebKit does not focus buttons on pointerdown, so ignore synthetic blur during pointer holds.
        if (sourceRef.current === "pointer" && (stateRef.current === "holding" || armedPressRef.current)) return;
        if (stateRef.current === "holding" || stateRef.current === "armed") cancelHold();
    }, [cancelHold]);

    const isClickIgnored = React.useCallback(
        () =>
            isButtonDisabled() ||
            confirmInFlightRef.current ||
            stateRef.current === "confirmed",
        [isButtonDisabled],
    );

    const handleClick = React.useCallback(() => {
        if (suppressClickRef.current) {
            clearTimerSlot(timersRef.current, "clickGuard");
            suppressClickRef.current = false;
            return;
        }
        if (isClickIgnored()) return;
        if (stateRef.current === "armed") fireConfirm();
        else enterArmed();
    }, [enterArmed, fireConfirm, isClickIgnored]);

    const handlePointerLeave = React.useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            if (!matchesActivePress("pointer", event.pointerId)) return;
            leavePointerBounds();
        },
        [leavePointerBounds, matchesActivePress],
    );

    const handlePointerCancel = React.useCallback(
        (event: React.PointerEvent<HTMLButtonElement>) => {
            if (!matchesActivePress("pointer", event.pointerId)) return;
            cancelHold();
        },
        [cancelHold, matchesActivePress],
    );

    return {
        state,
        pending,
        beginPress,
        releasePress,
        cancelHold,
        abortActiveHold,
        handlePointerMove,
        handlePointerLeave,
        handlePointerCancel,
        handleBlur,
        handleClick,
    };
};

type HoldController = ReturnType<typeof useHoldState>;

/** Composes external button event handlers (such as Radix Slot props) with HoldButton logic. */
const composeHoldButtonEvents = (
    external: NativeHoldButtonAttributes,
    hold: HoldController,
    activeState: HoldButtonState,
): NativeHoldButtonAttributes => ({
    onContextMenu: (event) => {
        external.onContextMenu?.(event);
        event.preventDefault();
        event.stopPropagation();
    },
    onPointerDown: (event) => {
        external.onPointerDown?.(event);
        if (event.button !== 0) return;
        event.stopPropagation();
        releaseImplicitPointerCapture(event);
        hold.beginPress("pointer", event.pointerId);
    },
    onPointerMove: (event) => {
        external.onPointerMove?.(event);
        hold.handlePointerMove(event);
    },
    onPointerUp: (event) => {
        external.onPointerUp?.(event);
        hold.releasePress("pointer", event.pointerId);
    },
    onPointerLeave: (event) => {
        external.onPointerLeave?.(event);
        hold.handlePointerLeave(event);
    },
    onPointerCancel: (event) => {
        external.onPointerCancel?.(event);
        hold.handlePointerCancel(event);
    },
    onDragStart: (event) => {
        external.onDragStart?.(event);
        if (activeState !== "idle") hold.cancelHold();
    },
    onKeyDown: (event) => {
        external.onKeyDown?.(event);
        if (event.key === "Escape" && activeState !== "idle") {
            event.preventDefault();
            event.stopPropagation();
            hold.abortActiveHold();
            return;
        }
        if (!event.repeat && isActivationKey(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            hold.beginPress("keyboard", event.key);
        }
    },
    onKeyUp: (event) => {
        external.onKeyUp?.(event);
        if (isActivationKey(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            hold.releasePress("keyboard", event.key);
        }
    },
    onBlur: (event) => {
        external.onBlur?.(event);
        hold.handleBlur();
    },
    onClick: (event) => {
        external.onClick?.(event);
        event.stopPropagation();
        hold.handleClick();
    },
});

const resolveHoldStyle = (
    style: React.CSSProperties | undefined,
    holdMs: number,
): React.CSSProperties | undefined => {
    if (holdMs === DEFAULT_HOLD_MS) return style;
    return { ...style, "--hold-dur": `${holdMs}ms` } as React.CSSProperties;
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
            style,
            onStateChange,
            ...rest
        },
        ref,
    ) => {
        const buttonRef = React.useRef<HTMLButtonElement | null>(null);
        const setButtonNode = React.useCallback(
            (node: HTMLButtonElement | null) => {
                buttonRef.current = node;
                assignForwardedRef(ref, node);
            },
            [ref],
        );

        const hold = useHoldState({
            onConfirm,
            holdMs,
            disabled,
            buttonRef,
            onStateChange,
        });

        const activeState = disabled ? "idle" : hold.state;
        const isBusy = !disabled && hold.pending;
        const faceText = resolveFaceText(activeState, label, armedLabel, confirmedLabel);
        const computedAria = resolveAriaLabel(activeState, ariaLabel, armedAriaLabel);
        const composedEvents = composeHoldButtonEvents(rest, hold, activeState);

        return (
            <button
                {...rest}
                {...composedEvents}
                ref={setButtonNode}
                type="button"
                disabled={disabled}
                aria-busy={isBusy || undefined}
                data-state={activeState}
                aria-label={computedAria}
                style={resolveHoldStyle(style, holdMs)}
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
                <span
                    className="t-hold__fill inline-flex items-center justify-center px-[inherit]"
                    aria-hidden="true"
                >
                    <HoldButtonFace state={activeState} icon={icon} text={faceText} />
                </span>
            </button>
        );
    },
);

HoldButton.displayName = "HoldButton";
