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
        commands.openUrlExternal(errorDocsUrl(notification.code)).catch(() => undefined);
    }
};

/** Whether a notification leads anywhere, which is what makes its card operable. */
const isClickable = (notification: Notification): boolean =>
    notification.code != null || notification.type === "error" || notification.type === "warning";

/** How long a toast holds before it dismisses itself, or null when it waits for a person. */
const autoHideFor = (notification: Notification): number | null =>
    notification.autoHide === false ? null : TOAST_AUTO_HIDE_MS;

/** A state flag as the string a data attribute takes: present while true, absent when false. */
const dataFlag = (on: boolean): "true" | undefined => (on ? "true" : undefined);

/** The live-region politeness of the card, assertive only where the message is a failure. */
const liveMode = (type: Notification["type"]): "assertive" | "polite" =>
    type === "error" ? "assertive" : "polite";

/** The entry and exit transition the card reads from its own state. */
const cardClasses = ({ entered, leaving, clickable }: { entered: boolean; leaving: boolean; clickable: boolean }) =>
    cn(
        "bettershape-toast pointer-events-auto relative w-full overflow-hidden squircle-2xl border border-border-subtle bg-surface-3 p-2 text-left shadow-lg",
        "transition-[opacity,transform,filter] duration-[var(--spring-panel-dur)] ease-[var(--spring-panel)]",
        entered && !leaving ? "scale-100 opacity-100 blur-0" : "scale-95 opacity-0 blur-[2px]",
        clickable && "cursor-pointer",
    );

/**
 * The click, keyboard and tab-stop props of a card that leads somewhere.
 *
 * All three come from the same answer, so a card that is only a message is not a focusable
 * control and a card that leads somewhere cannot be reached by the mouse alone.
 */
const cardActivation = (notification: Notification, clickable: boolean) => ({
    onClick: clickable ? () => openNotificationTarget(notification) : undefined,
    onKeyDown: clickable
        ? (event: React.KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openNotificationTarget(notification);
              }
          }
        : undefined,
    tabIndex: clickable ? 0 : undefined,
});

/**
 * The entry animation: two frames, so the browser has a mounted card to transition from.
 *
 * The bar turns at the same time, and it is one animation either way, which is why both
 * states belong to one hook.
 */
const useToastEntry = (): [boolean, boolean] => {
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

    return [entered, barOn];
};

/** The description line, which a notification either has or does not. */
const ToastDescription = ({ text }: { text?: string }) =>
    text ? <p className="text-sm text-text-muted">{text}</p> : null;

/** The code chip, which only a notification with a catalog entry carries. */
const ErrorCode = ({ code }: { code?: number | null }) =>
    code == null ? null : <span className="shrink-0 text-sm text-text-muted">Error {code}</span>;

/** The hairline that shows how much of the auto-hide delay is left, absent when there is none. */
const AutoHideBar = ({ ms, running }: { ms: number | null; running: boolean }) => {
    if (ms == null) return null;
    return (
        <span
            aria-hidden
            className={cn(
                "absolute inset-x-0 bottom-0 h-[3px] origin-left bg-accent",
                "transition-transform ease-linear",
                running ? "scale-x-0" : "scale-x-100",
            )}
            style={{ transitionDuration: `${ms}ms` }}
        />
    );
};

/**
 * One toast, from entry to exit.
 *
 * It stays mounted while it leaves so the exit transition can play, which is why the stack
 * tracks a leaving id instead of unmounting the card on dismiss.
 */
const ToastCard = ({
    notification,
    leaving,
    onDismiss,
}: {
    notification: Notification;
    leaving: boolean;
    onDismiss: () => void;
}) => {
    const autoHideMs = autoHideFor(notification);
    const [entered, barOn] = useToastEntry();

    React.useEffect(() => {
        // `undefined` and not a bare return: the clear below is a value return.
        if (!autoHideMs) return undefined;
        const timer = window.setTimeout(onDismiss, autoHideMs);
        return () => window.clearTimeout(timer);
    }, [autoHideMs, onDismiss]);

    const clickable = isClickable(notification);

    return (
        <div
            className={cardClasses({ entered, leaving, clickable })}
            data-mounted={dataFlag(entered)}
            data-leaving={dataFlag(leaving)}
            role="status"
            aria-live={liveMode(notification.type)}
            title={[notification.message, notification.description].filter(Boolean).join("\n")}
            {...cardActivation(notification, clickable)}
        >
            <div className="flex items-center gap-2 pr-8">
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text-primary">{notification.message}</p>
                    <ToastDescription text={notification.description} />
                </div>
                <ErrorCode code={notification.code} />
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
            <AutoHideBar ms={autoHideMs} running={barOn} />
        </div>
    );
};

/**
 * The toast stack, portalled to the body so no pane can clip it.
 *
 * It renders nothing until the first client render: the store fills on the client, and a
 * server render would ship an empty stack for hydration to fill.
 */
export const NotificationToasts = () => {
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
};

/**
 * The seam the app tree wraps its children in: children first, the stack after them.
 *
 * The stack is last so a toast paints over the app, and the provider holds no state, which
 * is what lets any pane raise a toast without threading a context through it.
 */
export const NotificationProvider = ({ children }: { children: React.ReactNode }) => (
    <>
        {children}
        <NotificationToasts />
    </>
);
