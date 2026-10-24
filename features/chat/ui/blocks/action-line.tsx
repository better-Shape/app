"use client";

import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";

import { isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { Favicon } from "@/components/ui/favicon";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { SwapText } from "@/components/ui/swap";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { hostnameOf } from "@/lib/ui/favicon";
import {
    CHAT_EXPAND_FOR_FIND_EVENT,
    notifyTranscriptDisclosureToggle,
} from "../shell/find-bar";
import { Collapse } from "./collapse";

const MARK_LIMIT = 4;

function uniqueFaviconHosts(urls: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const url of urls) {
        const host = hostnameOf(url) || url.trim();
        if (!host || seen.has(host)) continue;
        seen.add(host);
        out.push(url);
    }
    return out;
}

/** First word of a sentence is the action; the rest is muted detail. */
export function splitActionLabel(sentence: string): { action: string; detail?: string } {
    const text = sentence.trim();
    const split = text.indexOf(" ");
    if (split === -1) return { action: text };
    return { action: text.slice(0, split), detail: text.slice(split + 1) };
}

function extractReactNodeText(node: ReactNode, depth = 0): string {
    if (depth > 6 || node == null || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) {
        return node.map((item) => extractReactNodeText(item, depth + 1)).join(" ");
    }
    if (isValidElement(node)) {
        const props = node.props as Record<string, unknown>;
        const parts: string[] = [];
        for (const key of ["text", "code", "content", "output", "title", "detail", "label"]) {
            if (typeof props[key] === "string") parts.push(props[key] as string);
        }
        if (props.children !== undefined) {
            parts.push(extractReactNodeText(props.children as ReactNode, depth + 1));
        }
        return parts.join(" ");
    }
    return "";
}

/**
 * One workflow row. The action word is the lighter lead; detail, counts,
 * site marks, secondary quick-action, and a collapse body are optional slots.
 */
export function ActionLine({
    action,
    detail,
    add = 0,
    del = 0,
    favicons,
    icon,
    extra,
    secondaryAction,
    tone = "default",
    onClick,
    children,
    open,
    defaultOpen = false,
    onOpenChange,
    shimmer = false,
    className,
    title,
}: {
    action: string;
    detail?: ReactNode;
    add?: number;
    del?: number;
    favicons?: string[];
    icon?: ReactNode;
    extra?: ReactNode;
    secondaryAction?: {
        label: string;
        icon: ReactNode;
        onClick: () => void;
    };
    tone?: "default" | "error" | "warning";
    onClick?: () => void;
    children?: ReactNode;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    shimmer?: boolean;
    className?: string;
    title?: string;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [uncontrolled, setUncontrolled] = useState(defaultOpen);
    const isOpen = open ?? uncontrolled;
    const collapsible = children != null && children !== false;
    const interactive = collapsible || Boolean(onClick);
    const marks = uniqueFaviconHosts(favicons ?? []).slice(0, MARK_LIMIT);

    const toggle = () => {
        notifyTranscriptDisclosureToggle(rootRef.current);
        const next = !isOpen;
        onOpenChange?.(next);
        if (open === undefined) setUncontrolled(next);
    };

    // Auto-open collapsed disclosures when Find in Chat targets this message.
    useEffect(() => {
        if (!collapsible || isOpen) return undefined;
        const onExpandForFind = (e: Event) => {
            const detailPayload = (
                e as CustomEvent<{
                    messageIndex?: number;
                    query?: string;
                    caseSensitive?: boolean;
                }>
            ).detail;
            const root = rootRef.current;
            if (!root || detailPayload?.messageIndex == null) return;
            const msgEl = root.closest<HTMLElement>("[data-chat-message-index]");
            if (!msgEl) return;
            if (Number(msgEl.getAttribute("data-chat-message-index")) !== detailPayload.messageIndex) {
                return;
            }
            const rawQuery = (detailPayload.query ?? "").trim();
            if (!rawQuery) return;
            const bodyText = `${root.textContent ?? ""} ${extractReactNodeText(children)}`;
            const matched = detailPayload.caseSensitive
                ? bodyText.includes(rawQuery)
                : bodyText.toLowerCase().includes(rawQuery.toLowerCase());
            if (!matched) return;
            onOpenChange?.(true);
            if (open === undefined) setUncontrolled(true);
        };
        window.addEventListener(CHAT_EXPAND_FOR_FIND_EVENT, onExpandForFind as EventListener);
        return () => {
            window.removeEventListener(CHAT_EXPAND_FOR_FIND_EVENT, onExpandForFind as EventListener);
        };
    }, [children, collapsible, isOpen, onOpenChange, open]);

    const Tag = interactive ? "button" : "div";

    const row = (
        <Tag
            type={interactive ? "button" : undefined}
            aria-expanded={collapsible ? isOpen : undefined}
            onClick={
                interactive
                    ? () => {
                          if (collapsible) toggle();
                          else onClick?.();
                      }
                    : undefined
            }
            className={cn(
                "group/line flex w-fit max-w-full items-center gap-1.5 rounded-md py-0.5 text-left chat-text font-normal text-text-muted",
                interactive &&
                    "cursor-pointer px-1 -mx-1 transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:transform-none hover:bg-[var(--row-hover)] active:scale-[0.985]",
                className,
            )}
        >
            {icon ? <span className="inline-flex shrink-0 items-center">{icon}</span> : null}
            <span className="min-w-0 truncate">
                <span
                    className={cn(
                        tone === "error"
                            ? "text-error"
                            : tone === "warning"
                              ? "text-warning"
                              : "text-text-secondary",
                        interactive && tone === "default" && "group-hover/line:text-text-primary",
                    )}
                >
                    <SwapText
                        value={action}
                        durationMs={160}
                        render={(val) => (shimmer ? <ShimmerText>{val}</ShimmerText> : val)}
                    />
                </span>
                {detail ? <span className="text-text-muted"> {detail}</span> : null}
            </span>
            {marks.length > 0 ? (
                <span className="inline-flex shrink-0 items-center -space-x-1.5">
                    {marks.map((url) => (
                        <span
                            key={url}
                            className="inline-flex size-4 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-panel"
                        >
                            <Favicon url={url} size={12} />
                        </span>
                    ))}
                </span>
            ) : null}
            {add > 0 || del > 0 ? (
                <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
                    {add > 0 ? <span className="text-success">+{add}</span> : null}
                    {del > 0 ? <span className="text-error">-{del}</span> : null}
                </span>
            ) : null}
            {extra}
            {collapsible ? (
                <Icon
                    icon={ChevronRight20Regular}
                    className={cn(
                        "shrink-0 text-text-muted icon-sm transition-transform duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                        isOpen && "rotate-90",
                    )}
                />
            ) : null}
        </Tag>
    );

    const headerRow = secondaryAction ? (
        <div className="group/action-wrap flex w-full min-w-0 items-center gap-1">
            {title ? <Tooltip content={title}>{row}</Tooltip> : row}
            <Tooltip content={secondaryAction.label} side="top">
                <button
                    type="button"
                    aria-label={secondaryAction.label}
                    onClick={secondaryAction.onClick}
                    className="inline-flex size-[24px] shrink-0 items-center justify-center rounded-md text-text-muted opacity-0 transition-[opacity,background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] group-hover/action-wrap:opacity-100 focus-visible:opacity-100 hover:bg-[var(--btn-hover)] hover:text-text-primary active:scale-[0.94]"
                >
                    {secondaryAction.icon}
                </button>
            </Tooltip>
        </div>
    ) : title ? (
        <Tooltip content={title}>{row}</Tooltip>
    ) : (
        row
    );

    return (
        <div ref={rootRef} className="w-full min-w-0">
            {headerRow}
            {collapsible ? <Collapse open={isOpen}>{children}</Collapse> : null}
        </div>
    );
}
