"use client";

import { Eclipse } from "loading-dev";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { providerIcon } from "@/lib/ui/provider-icon";
import { formatMessageModelLabel, isAutoModelId } from "@/lib/chat/usage-display";

/** Model id used for Auto UI mark (backend still routes via MODEL_FAST). */
export const AUTO_DISPLAY_MODEL = "deepseek/deepseek-v4-flash";

/** Grey rounded card for user messages (no blue, no iMessage tail). */
export function UserMessageCard({
    className,
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div
            className={cn(
                "relative w-full max-w-none rounded-xl border border-border-subtle bg-surface-3 px-3.5 py-2.5 chat-text text-text-primary",
                className,
            )}
        >
            {children}
        </div>
    );
}

/** Circular spinner while the assistant is typing. */
export function TypingDots({ className }: { className?: string }) {
    return (
        <span className={className} role="status" aria-label="Typing">
            <Eclipse size={14} className="text-text-muted" />
        </span>
    );
}

/** Compact spinner for sidebar / chat tabs. */
export function WorkingDots({ className }: { className?: string }) {
    return (
        <Eclipse size={12} className={cn("text-text-muted", className)} aria-hidden />
    );
}

/** Stack of provider icons — Auto shows DeepSeek only (not a multi-grid). */
export function ModelAvatarStack({
    models,
    size = 16,
    className,
}: {
    models: string[];
    size?: number;
    className?: string;
}) {
    const raw = models.filter(Boolean);
    const isAuto = raw.length === 0 || raw.every((m) => isAutoModelId(m));
    const id = isAuto ? AUTO_DISPLAY_MODEL : raw[0]!;

    return (
        <Tooltip content={isAuto ? "Auto" : formatMessageModelLabel(id)}>
            <span
                className={cn(
                    "inline-flex shrink-0 items-center justify-center overflow-visible",
                    className,
                )}
            >
                {providerIcon(id, size)}
            </span>
        </Tooltip>
    );
}

/** Compact mention / tool pill. */
export function EntityPill({
    icon,
    label,
    className,
}: {
    icon?: React.ReactNode;
    label: string;
    className?: string;
}) {
    return (
        <span className={cn("inline-flex max-w-full items-center gap-1.5 chat-text text-text-muted", className)}>
            {icon ? <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span> : null}
            <span className="truncate">{label}</span>
        </span>
    );
}

/** @deprecated Use UserMessageCard */
export function MsgBubble({
    side,
    className,
    children,
}: {
    side: "sent" | "recv";
    hasTail?: boolean;
    className?: string;
    children: React.ReactNode;
}) {
    if (side === "sent") {
        return <UserMessageCard className={className}>{children}</UserMessageCard>;
    }
    return <div className={cn("chat-text! text-text-primary", className)}>{children}</div>;
}
