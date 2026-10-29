"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, ...props }, ref) => (
        <input
            ref={ref}
            className={cn(
                "h-chrome w-full squircle-2xl border border-input-border bg-input-bg px-2.5 text-sm text-text-primary",
                "placeholder:text-input-placeholder outline-none",
                "transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                "focus-visible:border-border-focus focus-visible:ring-1 focus-visible:ring-border-focus",
                "disabled:cursor-not-allowed disabled:opacity-50",
                className,
            )}
            {...props}
        />
    ),
);

Input.displayName = "Input";
