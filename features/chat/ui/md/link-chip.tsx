"use client";

import React from "react";
import { FileIcon } from "@/components/ui/file-icon";
import { Favicon } from "@/components/ui/favicon";
import { Tooltip } from "@/components/ui/tooltip";
import { commands } from "@/lib/backend";
import { classifyMarkdownHref } from "@/lib/chat/link-safety";
import { openProjectFile } from "@/lib/window/open-project-file";
import { cn } from "@/lib/utils";

export function ChatLinkChip({
    href,
    children,
    className,
}: {
    href?: string;
    children?: React.ReactNode;
    className?: string;
}) {
    const target = classifyMarkdownHref(href);

    if (target.kind === "blocked") {
        return <span className={cn("text-accent-text", className)}>{children}</span>;
    }

    if (target.kind === "anchor") {
        return (
            <a href={target.href} className={cn("chat-link-chip cursor-pointer", className)}>
                <span className="truncate">{children}</span>
            </a>
        );
    }

    if (target.kind === "workspace") {
        const name = target.path.split(/[\\/]/).pop() || target.path;
        return (
            <Tooltip content={`${target.path} · Click to open`}>
                <button
                    type="button"
                    className={cn(
                        "chat-link-chip cursor-pointer transition-[background-color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:transform-none motion-reduce:transition-none active:scale-[0.97]",
                        className,
                    )}
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void openProjectFile(target.path, name);
                    }}
                >
                    <span className="chat-link-favicon">
                        <FileIcon name={name} className="h-3 w-3" />
                    </span>
                    <span className="truncate">{children || name}</span>
                </button>
            </Tooltip>
        );
    }

    const isHttp = /^https?:\/\//i.test(target.href);
    return (
        <a
            href={target.href}
            rel="noopener noreferrer"
            className={cn("chat-link-chip cursor-pointer", className)}
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void commands.openUrlExternal(target.href);
            }}
        >
            {isHttp ? (
                <span className="chat-link-favicon">
                    <Favicon url={target.href} size={12} />
                </span>
            ) : null}
            <span className="truncate">{children}</span>
        </a>
    );
}
