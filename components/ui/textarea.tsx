"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, ...props }, ref) => {
        const localRef = React.useRef<HTMLTextAreaElement>(null);

        /** Two-step measure: the height is cleared and then re-read from the content, so
            a shrinking edit lowers the box instead of holding the height it already had. */
        const autosize = (el: HTMLTextAreaElement | null) => {
            if (!el) return;
            el.style.removeProperty("height");
            el.style.height = `${el.scrollHeight}px`;
        };

        /** Grows the box on the keystroke itself, then hands the event on unchanged. */
        const handleInput = (e: React.InputEvent<HTMLTextAreaElement>) => {
            autosize(localRef.current);
            props.onInput?.(e);
        };

        React.useEffect(() => {
            autosize(localRef.current);
        }, [props.value]);

        return (
            <textarea
                ref={(node) => {
                    localRef.current = node;
                    if (typeof ref === "function") {
                        ref(node);
                    } else if (ref) {
                        (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
                    }
                }}
                onInput={handleInput}
                className={cn(
                    "w-full squircle-2xl border border-border-secondary bg-input-bg px-sm py-xs text-sm text-text-primary",
                    "placeholder:text-input-placeholder outline-none ring-0 focus:ring-0 focus:border-border-focus",
                    "transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                    "resize-none overflow-hidden block custom-scrollbar",
                    className
                )}
                {...props}
            />
        );
    }
);

Textarea.displayName = "Textarea";
