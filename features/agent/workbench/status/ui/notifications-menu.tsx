"use client";

import { Alert20Filled, Alert20Regular } from "@fluentui/react-icons/headless/svg/alert";
import { CheckmarkCircle20Filled } from "@fluentui/react-icons/headless/svg/checkmark-circle";
import { DismissCircle20Filled } from "@fluentui/react-icons/headless/svg/dismiss-circle";
import { Info20Regular } from "@fluentui/react-icons/headless/svg/info";


import { Icon } from "@/components/ui/icon";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import {
    useNotifications,
    notificationStore,
    useUnreadNotificationCount,
} from "@/features/notifications";
import { cn, createOccurrenceKeyer } from "@/lib/utils";
import { CopyButton } from "./copy-button";

/** Renders the NotificationsMenu UI component. */
export const NotificationsMenu = () => {
    const { notifications } = useNotifications();
    const unreadCount = useUnreadNotificationCount();

    // Drop expired entries when the menu opens so the list doesn't grow forever.
    const handleOpenChange = (open: boolean) => {
        if (open) notificationStore.markViewed();
    };

    return (
        <DropdownMenu onOpenChange={handleOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    aria-label={
                        unreadCount > 0
                            ? `Notifications (${unreadCount} unread)`
                            : "Notifications"
                    }
                    className="relative h-full shrink-0 px-2 text-text-muted hover:text-text-primary"
                >
                    <Icon icon={Alert20Filled} />
                    {unreadCount > 0 && (
                        <span className="absolute top-1 right-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-accent px-1 text-2xs font-medium tabular-nums text-accent-fg">
                            {Math.min(unreadCount, 99)}
                        </span>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className="w-[360px] max-w-[calc(100vw-24px)]"
            >
                <DropdownMenuItem disabled className="text-sm text-text-muted">
                    Notifications
                </DropdownMenuItem>
                {notifications.length === 0 ? (
                    <DropdownMenuItem disabled>No notifications</DropdownMenuItem>
                ) : (
                    <div className="custom-scrollbar max-h-[320px] overflow-y-auto">
                    {[...notifications].reverse().slice(0, 20).map((notification) => (
                        <DropdownMenuItem
                            key={notification.id}
                            className="flex flex-col items-start gap-1 py-2 whitespace-normal"
                            onSelect={(e) => e.preventDefault()}
                        >
                            <div className="flex w-full items-start gap-2">
                                <Icon
                                    icon={
                                        notification.type === "error"
                                            ? DismissCircle20Filled
                                            : notification.type === "warning"
                                                ? Alert20Regular
                                                : notification.type === "success"
                                                    ? CheckmarkCircle20Filled
                                                    : Info20Regular
                                    }
                                    className={cn(
                                        "mt-0.5 shrink-0",
                                        notification.type === "error" && "text-error",
                                        notification.type === "warning" && "text-warning",
                                        notification.type === "success" && "text-success",
                                        notification.type === "info" && "text-info",
                                    )}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm text-text-primary">{notification.message}</div>
                                    {notification.description && (
                                        <div className="mt-0.5 space-y-0.5">
                                            {(() => {
                                                const keyFor = createOccurrenceKeyer();
                                                return notification.description.split(/\n/).map((line, pos) => (
                                                    <div
                                                        key={keyFor(line || "blank")}
                                                        className={cn(
                                                            "text-xs wrap-break-word",
                                                            pos === 0
                                                                ? "text-text-secondary"
                                                                : "text-text-muted line-clamp-2",
                                                        )}
                                                    >
                                                        {line}
                                                    </div>
                                                ));
                                            })()}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <CopyButton
                                text={[notification.message, notification.description]
                                    .filter(Boolean)
                                    .join("\n")}
                            />
                        </DropdownMenuItem>
                    ))}
                    </div>
                )}
                {notifications.length > 0 && (
                    <DropdownMenuItem onClick={() => notificationStore.clearAll()}>
                        Clear All
                    </DropdownMenuItem>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
