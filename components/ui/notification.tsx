"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Dismiss16Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import { Icon } from "@/components/ui/icon";
import {
    notificationStore,
    useNotifications,
    type Notification,
    type NotificationType,
} from "@/features/notifications";
import { commands } from "@/lib/backend";
import { errorDocsUrl } from "@/lib/errors/catalog";
import { useIsMounted } from "@/lib/ui/use-mounted";
import { cn } from "@/lib/utils";

export const TOAST_AUTO_HIDE_MS = 5500;
const TOAST_ACTION_OR_ALERT_MS = 7200;
const TOAST_EXIT_MS = 220;
export const TOAST_STACK_CLASS =
    "pointer-events-none fixed top-3 left-1/2 z-notification w-[min(392px,calc(100vw-24px))] -translate-x-1/2 outline-none";

const STATUS_DOT_CLASS: Record<NotificationType, string | null> = {
    success: "bg-success",
    error: "bg-error",
    warning: "bg-warning",
    info: null,
};

/**
 * Opens the catalog entry for a notification that carries an error code.
 */
const openNotificationTarget = (notification: Notification) => {
    if (notification.code != null) {
        commands.openUrlExternal(errorDocsUrl(notification.code)).catch(() => undefined);
    }
};

/** Only cards with an actual destination become interactive card surfaces. */
const isCardNavigable = (notification: Notification): boolean => notification.code != null;

/** How long a toast holds before it dismisses itself, or null when it waits for a person. */
const autoHideFor = (notification: Notification): number | null => {
    if (notification.autoHide === false) return null;
    if (typeof notification.durationMs === "number" && notification.durationMs > 0) {
        return notification.durationMs;
    }
    if (
        notification.action ||
        notification.type === "error" ||
        notification.type === "warning"
    ) {
        return TOAST_ACTION_OR_ALERT_MS;
    }
    return TOAST_AUTO_HIDE_MS;
};

const dataFlag = (on: boolean): "true" | undefined => (on ? "true" : undefined);

const liveMode = (type: Notification["type"]): "assertive" | "polite" =>
    type === "error" ? "assertive" : "polite";

const cardClasses = ({ clickable }: { clickable: boolean }) =>
    cn(
        "bettershape-toast pointer-events-auto relative w-full overflow-hidden rounded-xl border border-border-subtle bg-surface-3 px-3.5 py-2.5 text-left shadow-md",
        clickable && "cursor-pointer hover:border-border-secondary",
    );

const cardActivation = (notification: Notification, clickable: boolean) => ({
    onClick: clickable ? () => openNotificationTarget(notification) : undefined,
    onKeyDown: clickable
        ? (event: React.KeyboardEvent) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openNotificationTarget(notification);
              }
          }
        : undefined,
    tabIndex: clickable ? 0 : undefined,
});

const useToastEntered = (): boolean => {
    const [entered, setEntered] = React.useState(false);

    React.useEffect(() => {
        let inner = 0;
        const outer = window.requestAnimationFrame(() => {
            inner = window.requestAnimationFrame(() => {
                setEntered(true);
            });
        });
        return () => {
            window.cancelAnimationFrame(outer);
            if (inner) window.cancelAnimationFrame(inner);
        };
    }, []);

    return entered;
};

const ToastDescription = ({ text }: { text?: string }) =>
    text ? (
        <p className="mt-0.5 text-xs leading-[16px] text-text-secondary whitespace-pre-line break-words line-clamp-4">
            {text}
        </p>
    ) : null;

const AutoHideBar = ({
    ms,
    paused,
}: {
    ms: number | null;
    paused: boolean;
}) => {
    if (ms == null) return null;
    return (
        <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-left bg-accent motion-reduce:hidden"
            style={{
                animationName: "bettershape-toast-countdown",
                animationDuration: `${ms}ms`,
                animationTimingFunction: "linear",
                animationFillMode: "forwards",
                animationPlayState: paused ? "paused" : "running",
            }}
        />
    );
};

const ToastCard = ({
    notification,
    leaving,
    paused,
    onDismiss,
}: {
    notification: Notification;
    leaving: boolean;
    paused: boolean;
    onDismiss: () => void;
}) => {
    const autoHideMs = autoHideFor(notification);
    const entered = useToastEntered();
    const remainingRef = React.useRef<number | null>(autoHideMs);
    const startedAtRef = React.useRef<number>(0);
    const onDismissRef = React.useRef(onDismiss);

    React.useLayoutEffect(() => {
        onDismissRef.current = onDismiss;
    });

    React.useEffect(() => {
        remainingRef.current = autoHideMs;
    }, [autoHideMs]);

    React.useEffect(() => {
        if (autoHideMs == null || leaving) return undefined;
        if (paused) return undefined;

        const delay = Math.max(0, remainingRef.current ?? autoHideMs);
        startedAtRef.current = performance.now();
        const timer = window.setTimeout(() => {
            remainingRef.current = 0;
            onDismissRef.current();
        }, delay);

        return () => {
            window.clearTimeout(timer);
            const elapsed = Math.max(0, performance.now() - startedAtRef.current);
            remainingRef.current = Math.max(0, delay - elapsed);
        };
    }, [autoHideMs, leaving, paused]);

    const clickable = isCardNavigable(notification);
    const dotClass = STATUS_DOT_CLASS[notification.type];

    return (
        <div
            className={cardClasses({ clickable })}
            data-mounted={dataFlag(entered && !leaving)}
            data-leaving={dataFlag(leaving)}
            role="status"
            aria-live={liveMode(notification.type)}
            {...cardActivation(notification, clickable)}
        >
            <div className="flex items-start gap-2.5">
                {dotClass ? (
                    <span
                        aria-hidden
                        className={cn("mt-[6px] size-1.5 shrink-0 rounded-full", dotClass)}
                    />
                ) : null}

                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-[18px] text-text-primary break-words line-clamp-3">
                        {notification.message}
                    </p>
                    <ToastDescription text={notification.description} />
                    {notification.code != null ? (
                        <p className="mt-1 font-mono text-2xs tabular-nums text-text-muted">
                            Error {notification.code}
                        </p>
                    ) : null}
                </div>

                <div className="-mt-0.5 -mr-1 flex shrink-0 items-center gap-1">
                    {notification.action ? (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                notification.action?.onClick();
                                onDismiss();
                            }}
                            className="inline-flex h-[22px] shrink-0 items-center justify-center rounded-md border border-border-subtle bg-surface-2 px-2 text-xs font-medium text-text-primary transition-[background-color,border-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:border-border-secondary hover:bg-[var(--btn-hover)] active:scale-[0.97] motion-reduce:transform-none motion-reduce:transition-none"
                        >
                            {notification.action.label}
                        </button>
                    ) : null}

                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDismiss();
                        }}
                        aria-label="Dismiss notification"
                        className="flex size-[22px] shrink-0 items-center justify-center rounded-md text-text-muted transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary active:scale-[0.95] motion-reduce:transform-none motion-reduce:transition-none"
                    >
                        <Icon icon={Dismiss16Regular} className="size-3.5" />
                    </button>
                </div>
            </div>
            <AutoHideBar ms={autoHideMs} paused={paused} />
        </div>
    );
};

export const NotificationToasts = () => {
    const { notifications, toastIds } = useNotifications();
    const mounted = useIsMounted();
    const [leavingIds, setLeavingIds] = React.useState<ReadonlySet<string>>(() => new Set());
    const [hovered, setHovered] = React.useState(false);
    const [focusedWithin, setFocusedWithin] = React.useState(false);
    const [pageHidden, setPageHidden] = React.useState(false);

    React.useEffect(() => {
        if (typeof document === "undefined") return undefined;
        const onVisibility = () => setPageHidden(document.visibilityState === "hidden");
        onVisibility();
        document.addEventListener("visibilitychange", onVisibility);
        return () => document.removeEventListener("visibilitychange", onVisibility);
    }, []);

    const toasts = toastIds
        .map((id) => notifications.find((n) => n.id === id))
        .filter((n): n is Notification => Boolean(n));

    const dismiss = React.useCallback((id: string) => {
        setLeavingIds((prev) => {
            if (prev.has(id)) return prev;
            const next = new Set(prev);
            next.add(id);
            return next;
        });
        window.setTimeout(() => {
            notificationStore.dismissToast(id);
            setLeavingIds((prev) => {
                if (!prev.has(id)) return prev;
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }, TOAST_EXIT_MS);
    }, []);

    if (!mounted || toasts.length === 0) return null;

    const paused = hovered || focusedWithin || pageHidden;

    return createPortal(
        <div
            className={TOAST_STACK_CLASS}
            data-toast-stack=""
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocusCapture={() => setFocusedWithin(true)}
            onBlurCapture={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setFocusedWithin(false);
                }
            }}
        >
            <div className="flex flex-col gap-2">
                {toasts.map((notification) => (
                    <ToastCard
                        key={notification.id}
                        notification={notification}
                        leaving={leavingIds.has(notification.id)}
                        paused={paused}
                        onDismiss={() => dismiss(notification.id)}
                    />
                ))}
            </div>
        </div>,
        document.body,
    );
};

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => (
    <>
        {children}
        <NotificationToasts />
    </>
);
