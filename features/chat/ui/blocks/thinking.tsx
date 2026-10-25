"use client";

import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { ChevronUp20Regular } from "@fluentui/react-icons/headless/svg/chevron-up";
import React, { useRef } from "react";
import { Icon } from "@/components/ui/icon";
import { cn, createOccurrenceKeyer } from "@/lib/utils";
import {
    notifyTranscriptDisclosureToggle,
    useExpandForChatFind,
} from "../shell/find-bar";
import { Collapse } from "./collapse";
import { GeneratingIndicator } from "./generating";

/** Renders the ThinkingBlock UI component. */
export const ThinkingBlock = ({ content, isActive }: { content: string; isActive?: boolean }) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const [isOpen, setIsOpen] = React.useState(true);

    const lines = content.split("\n").filter(Boolean);
    const showBottomCollapse = isOpen && lines.length >= 10;

    useExpandForChatFind({
        enabled: !isOpen,
        rootRef,
        getSearchText: () => content,
        onExpand: () => setIsOpen(true),
    });

    const handleToggle = () => {
        notifyTranscriptDisclosureToggle(rootRef.current);
        setIsOpen((prev) => !prev);
    };

    return (
        <div ref={rootRef} className="my-2 flex w-full flex-col">
            <button
                type="button"
                aria-expanded={isOpen}
                onClick={handleToggle}
                className="group flex w-full items-center gap-2 py-1.5 text-left text-sm text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:text-text-primary"
            >
                <Icon
                    icon={ChevronDown20Regular}
                    className={cn(
                        "text-text-muted transition-transform duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
                        !isOpen && "-rotate-90",
                    )}
                />
                {isActive ? (
                    <GeneratingIndicator label="Thinking" showTimer={false} />
                ) : (
                    <span className="text-sm font-medium">Thought for a moment</span>
                )}
            </button>

            <Collapse open={isOpen}>
                <div
                    aria-busy={isActive || undefined}
                    className="mt-1 flex w-full min-w-0 flex-col gap-1 pl-3.5 text-sm leading-relaxed text-text-muted"
                >
                    {(() => {
                        const keyFor = createOccurrenceKeyer();
                        return lines.map((line, pos) => (
                            <span
                                key={keyFor(line.slice(0, 24) || "blank")}
                                className={cn(
                                    "block",
                                    isActive && pos === lines.length - 1 && "text-text-secondary",
                                )}
                            >
                                {line}
                            </span>
                        ));
                    })()}
                    {showBottomCollapse ? (
                        <div className="pt-1">
                            <button
                                type="button"
                                onClick={handleToggle}
                                className="inline-flex min-h-[24px] items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary"
                            >
                                <Icon icon={ChevronUp20Regular} className="size-3.5" />
                                <span>Collapse reasoning</span>
                            </button>
                        </div>
                    ) : null}
                </div>
            </Collapse>
        </div>
    );
};
