"use client";

import { useIsMounted } from "@/lib/ui/use-mounted";

import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";


import * as React from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";

import { cn } from "@/lib/utils";
import { notificationStore, useNotifications, type Notification } from "@/features/notifications";
import { errorDocsUrl } from "@/lib/errors/catalog";
import { commands } from "@/lib/backend";
import { Button } from "./button";

export const TOAST_AUTO_HIDE_MS = 5500;
const TOAST_EXIT_MS = 220;
export const TOAST_STACK_CLASS =
    "pointer-events-none fixed top-3 left-1/2 z-notification w-[min(420px,calc(100vw-24px))] -translate-x-1/2 outline-none";

/**
 * Opens the catalog entry for a notification that carries an error code.
 *
 * The code is the catalog's key, so a notification without one is a plain message and has
 * nowhere to link. Opening the browser is best effort, and there is no second surface to
 * report a refusal on, so the outcome is not awaited anywhere.
 */
const openNotificationTarget = (notification: Notification) => {
    if (notification.code != null) {
        commands.openUrlExternal(errorDocsUrl(notification.code)).catch(() => {});
    }
};

/**
 * One toast, from entry to exit.
 *
 * It stays mounted while it leaves so the exit transition can play, which is why the stack
 * tracks a leaving id instead of unmounting the card on dismiss.
 */
function ToastCard({
    notification,
    leaving,
    onDismiss,
}: {
    notification: Notification;
    leaving: boolean;
    onDismiss: () => void;
}) {
    const autoHideMs = notification.autoHide === false ? null : TOAST_AUTO_HIDE_MS;
    const [entered, setEntered] = React.useState(false);
    const [barOn, setBarOn] = React.useState(false);

    React.useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                setEntered(true);
                setBarOn(true);
            });
        });
        return () => window.cancelAnimationFrame(frame);
    }, []);

    React.useEffect(() => {
        // `undefined` and not a bare return: the clear below is a value return.
        if (!autoHideMs) return undefined;
        const timer = window.setTimeout(onDismiss, autoHideMs);
        return () => window.clearTimeout(timer);
    }, [autoHideMs, onDismiss]);

    const clickable =
        notification.code != null ||
        notification.type === "error" ||
        notification.type === "warning";

    return (
        <div
            className={cn(
                "bettershape-toast pointer-events-auto relative w-full overflow-hidden squircle-2xl border border-border-subtle bg-surface-3 p-2 text-left shadow-lg",
                "transition-[opacity,transform,filter] duration-[var(--spring-panel-dur)] ease-[var(--spring-panel)]",
                entered && !leaving
                    ? "scale-100 opacity-100 blur-0"
                    : "scale-95 opacity-0 blur-[2px]",
                clickable && "cursor-pointer",
            )}
            data-mounted={entered ? "true" : undefined}
            data-leaving={leaving ? "true" : undefined}
            role="status"
            aria-live={notification.type === "error" ? "assertive" : "polite"}
            title={[notification.message, notification.description].filter(Boolean).join("\n")}
            onClick={clickable ? () => openNotificationTarget(notification) : undefined}
            onKeyDown={
                clickable
                    ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openNotificationTarget(notification);
                          }
                      }
                    : undefined
            }
            tabIndex={clickable ? 0 : undefined}
        >
            <div className="flex items-center gap-2 pr-8">
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text-primary">{notification.message}</p>
                    {notification.description ? (
                        <p className="text-sm text-text-muted">{notification.description}</p>
                    ) : null}
                </div>
                {notification.code != null ? (
                    <span className="shrink-0 text-sm text-text-muted">Error {notification.code}</span>
                ) : null}
            </div>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-1 right-1 size-7"
                onClick={(e) => {
                    e.stopPropagation();
                    onDismiss();
                }}
                aria-label="Dismiss notification"
            >
                <Icon icon={Dismiss20Regular} />
            </Button>
            {autoHideMs ? (
                <span
                    aria-hidden
                    className={cn(
                        "absolute inset-x-0 bottom-0 h-[3px] origin-left bg-accent",
                        "transition-transform ease-linear",
                        barOn ? "scale-x-0" : "scale-x-100",
                    )}
                    style={{ transitionDuration: `${autoHideMs}ms` }}
                />
            ) : null}
        </div>
    );
}

/**
 * The toast stack, portalled to the body so no pane can clip it.
 *
 * It renders nothing until the first client render: the store fills on the client, and a
 * server render would ship an empty stack for hydration to fill.
 */
export function NotificationToasts() {
    const { notifications, toastIds } = useNotifications();
    const mounted = useIsMounted();
    const [leavingId, setLeavingId] = React.useState<string | null>(null);


    const toasts = toastIds
        .map((id) => notifications.find((n) => n.id === id))
        .filter((n): n is Notification => Boolean(n));

    const dismiss = React.useCallback((id: string) => {
        setLeavingId(id);
        window.setTimeout(() => {
            notificationStore.dismissToast(id);
            setLeavingId((cur) => (cur === id ? null : cur));
        }, TOAST_EXIT_MS);
    }, []);

    if (!mounted || toasts.length === 0) return null;

    return createPortal(
        <div className={TOAST_STACK_CLASS} data-toast-stack="">
            <div className="flex flex-col gap-3">
                {toasts.map((notification) => (
                    <ToastCard
                        key={notification.id}
                        notification={notification}
                        leaving={leavingId === notification.id}
                        onDismiss={() => dismiss(notification.id)}
                    />
                ))}
            </div>
        </div>,
        document.body,
    );
}

/**
 * The seam the app tree wraps its children in: children first, the stack after them.
 *
 * The stack is last so a toast paints over the app, and the provider holds no state, which
 * is what lets any pane raise a toast without threading a context through it.
 */
export function NotificationProvider({ children }: { children: React.ReactNode }) {
    return (
        <>
            {children}
            <NotificationToasts />
        </>
    );
}
