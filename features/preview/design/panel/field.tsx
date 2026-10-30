"use client";

import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";


import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { type IconGlyph, Icon } from "@/components/ui/icon";

import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { Styles } from "./types";
import { isTokenProperty, TokenMenu } from "./tokens";

/** Inspector control height, keep in sync with panel rows; do not shrink. */
export const CONTROL = "h-8 min-h-8 text-sm leading-none";

export function Field({
    label,
    icon,
    value,
    property,
    onPreview,
    onCommit,
    className,
    suffix,
    mapValue = (next) => next,
}: {
    label?: string;
    icon?: IconGlyph;
    value?: string;
    property: string;
    onPreview: (styles: Styles) => void;
    onCommit: (styles: Styles) => void;
    className?: string;
    suffix?: string;
    mapValue?: (value: string) => string;
}) {
    const [draft, setDraft] = useState(value ?? "");
    const dragged = useRef(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const controls = useSettings().tailwindControls;
    // Scrub and wheel are both opt-out: users who scroll the inspector with the
    // pointer over a field should not nudge values by accident.
    const scrubbable = controls.enable && controls.numberScrubbing;
    // A number, optionally followed by a unit, written either adjacent (`12px`)
    // or spaced (`12 px`). The alternatives have disjoint prefixes, which is what
    // keeps this linear.
    const numeric = /^-?(?:\d+(?:\.\d+)?|\.\d+)\s*\S*$/.test(draft.trim());
    const [valueScope, setValueScope] = useState<readonly [typeof value] | null>(null);
    if (valueScope === null || !Object.is(valueScope[0], value)) {
        setValueScope([value]);
        setDraft(value ?? "");

    }
    const hasPrefix = Boolean(label || icon);
    const tokenable = hasPrefix && isTokenProperty(property);
    const stepBy = (delta: number, magnitude: number) => {
        const match = draft.trim().match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(.*)$/);
        if (!match) return;
        const unit = match[2] ?? "";
        const next = Math.round((Number.parseFloat(match[1] ?? "0") + delta) * magnitude) / magnitude;
        const text = `${next}${unit}`;
        setDraft(text);
        onPreview({ [property]: mapValue(text) });
        onCommit({ [property]: mapValue(text) });
    };
    const wheelEnabled = controls.enable && controls.wheelOnInputs;
    const stepRef = useRef(stepBy);
    useEffect(() => {
        stepRef.current = stepBy;
    });
    useEffect(() => {
        const input = inputRef.current;
        if (!input || !wheelEnabled) return;
        // React's onWheel is passive, so stepping needs its own non-passive listener.
        const onWheel = (event: WheelEvent) => {
            if (event.deltaY === 0) return;
            const direction = event.deltaY > 0 ? -1 : 1;
            event.preventDefault();
            stepRef.current(direction * (event.shiftKey ? 0.1 : 1), event.shiftKey ? 10 : 1);
        };
        input.addEventListener("wheel", onWheel, { passive: false });
        return () => input.removeEventListener("wheel", onWheel);
    }, [wheelEnabled]);
    const scrub = (event: React.PointerEvent<HTMLElement>) => {
        const match = (draft ?? "").trim().match(/^(-?\d*\.?\d+)(.*)$/);
        if (!match) return;
        const startX = event.clientX;
        const startValue = Number.parseFloat(match[1] ?? "0");
        const inferredLength =
            /^(left|right|top|bottom|width|height|gap|column-gap|row-gap|padding|font-size|line-height|letter-spacing|border|text-underline|filter|rotate|blur)/.test(
                property,
            );
        const unit = match[2] || (inferredLength ? "px" : "");
        const precision = event.shiftKey ? 0.1 : 1;
        let latest = draft;
        const target = event.currentTarget;
        const move = (pointer: PointerEvent) => {
            if (Math.abs(pointer.clientX - startX) <= 3) return;
            if (!dragged.current) {
                dragged.current = true;
                if (!tokenable) {
                    pointer.preventDefault();
                    target.setPointerCapture(pointer.pointerId);
                }
            }
            const next = Math.round((startValue + (pointer.clientX - startX) * precision) * 10) / 10;
            latest = `${next}${unit}`;
            setDraft(latest);
            onPreview({ [property]: mapValue(latest) });
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            if (dragged.current) onCommit({ [property]: mapValue(latest) });
        };
        if (!tokenable) {
            event.preventDefault();
            event.stopPropagation();
            target.setPointerCapture(event.pointerId);
        }
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up, { once: true });
    };
    const prefix = hasPrefix ? (
        <div
            role={tokenable ? "button" : "presentation"}
            tabIndex={tokenable ? 0 : undefined}
            aria-label={tokenable ? `Tokens for ${property}` : undefined}
            data-align="inline-start"
            onPointerDown={(event) => {
                dragged.current = false;
                if (!scrubbable) return;
                scrub(event);
            }}
            onClick={(event) => {
                if (dragged.current) event.preventDefault();
            }}
            className={cn(
                "order-first flex h-full shrink-0 items-center justify-center pl-2 text-text-muted",
                scrubbable && "cursor-ew-resize",
                scrubbable && controls.scrubDecorations && numeric && "border-b border-dashed border-border",
            )}
        >
            {icon ? (
                <Icon icon={icon} />
            ) : (
                <span className="text-sm font-medium leading-none">{label}</span>
            )}
        </div>
    ) : null;
    return (
        <div
            role="group"
            className={cn(
                "relative flex min-w-0 flex-1 items-center overflow-hidden rounded-md border border-border bg-panel-hover",
                "focus-within:border-border-focus focus-within:ring-1 focus-within:ring-border-focus",
                CONTROL,
                className,
            )}
        >
            {tokenable && prefix ? (
                <TokenMenu property={property}>{prefix}</TokenMenu>
            ) : (
                prefix
            )}
            <Input
                ref={inputRef}
                value={draft}
                onChange={(event) => {
                    setDraft(event.target.value);
                    onPreview({ [property]: mapValue(event.target.value) });
                }}
                onBlur={() => {
                    if (draft !== value) onCommit({ [property]: mapValue(draft) });
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                className={cn(
                    "h-full min-h-0 flex-1 rounded-none border-0 bg-transparent py-0 text-xs font-normal tabular-nums shadow-none ring-0 focus-visible:border-transparent focus-visible:ring-0",
                    hasPrefix ? "pl-1.5" : "pl-2",
                    suffix ? "pr-1" : "pr-2",
                    !suffix
                        && "[mask-image:linear-gradient(to_right,black_calc(100%-1.25rem),transparent)] [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-1.25rem),transparent)]",
                )}
                spellCheck={false}
                aria-label={property}
            />
            {suffix ? (
                <span className="flex h-full shrink-0 items-center pr-2 text-xs font-medium text-text-muted">
                    {suffix}
                </span>
            ) : null}
        </div>
    );
}

export function SelectField({
    value,
    options,
    onChange,
    className,
    label,
    icon,
}: {
    label?: string;
    icon?: IconGlyph;
    value: string;
    options: Array<string | readonly [string, string]>;
    onChange: (value: string) => void;
    className?: string;
}) {
    const display =
        options.find((option) => (Array.isArray(option) ? option[0] === value : option === value));
    const hasPrefix = Boolean(label || icon);
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="secondary"
                    size="xs"
                    className={cn(
                        CONTROL,
                        "min-w-0 flex-1 justify-start gap-0 border border-border bg-panel-hover px-0 text-text-primary hover:bg-[var(--btn-hover)]",
                        className,
                    )}
                >
                    {hasPrefix ? (
                        <span className="flex h-full shrink-0 items-center justify-center pl-2 text-text-muted">
                            {icon ? (
                                <Icon icon={icon} />
                            ) : (
                                <span className="text-sm font-medium leading-none">{label}</span>
                            )}
                        </span>
                    ) : null}
                    <span
                        className={cn(
                            "min-w-0 flex-1 truncate text-left text-xs font-normal",
                            hasPrefix ? "pl-1.5" : "pl-2",
                        )}
                    >
                        {Array.isArray(display) ? display[1] : display || value || "Auto"}
                    </span>
                    <Icon
                        icon={ChevronDown20Regular}
                        className="mr-1.5 shrink-0 text-text-muted"
                    />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
                {options.map((option) => {
                    const optionValue = Array.isArray(option) ? option[0] : option;
                    const optionLabel = Array.isArray(option) ? option[1] : option;
                    return (
                        <DropdownMenuItem key={optionValue} onClick={() => onChange(optionValue)}>
                            {optionLabel}
                        </DropdownMenuItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function IconButton({
    label,
    active,
    onClick,
    icon,
}: {
    label: string;
    active?: boolean;
    onClick?: () => void;
    icon: IconGlyph;
}) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            icon={icon}
            aria-label={label}
            title={label}
            onClick={onClick}
            selected={active}
        />
    );
}

export function Segment({
    items,
    value,
    onChange,
}: {
    items: Array<{ value: string; label?: string; icon?: IconGlyph; title: string }>;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div
            role="group"
            className={cn(
                CONTROL,
                "flex min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-panel-hover",
            )}
        >
            {items.map((item, index) => {
                const active = value === item.value;
                return (
                    <button
                        key={item.value}
                        type="button"
                        title={item.title}
                        aria-label={item.title}
                        aria-pressed={active}
                        onClick={() => onChange(item.value)}
                        className={cn(
                            "flex h-full min-w-0 flex-1 items-center justify-center gap-1 px-1.5 text-xs font-medium text-text-secondary transition-colors",
                            index > 0 && "border-l border-border",
                            active
                                ? "bg-[var(--btn-open)] hover:bg-[var(--btn-open-hover)] text-text-primary"
                                : "hover:bg-[var(--btn-hover)] hover:text-text-primary",
                            !item.label && "px-0",
                        )}
                    >
                        {item.icon ? <Icon icon={item.icon} /> : null}
                        {item.label ? <span className="truncate">{item.label}</span> : null}
                    </button>
                );
            })}
        </div>
    );
}

export function RangeField({
    value,
    property,
    onPreview,
    onCommit,
    max = 100,
}: {
    value?: string;
    property: string;
    onPreview: (styles: Styles) => void;
    onCommit: (styles: Styles) => void;
    max?: number;
}) {
    const numeric = Number.parseFloat(value ?? "") || 0;
    return (
        <div className="flex h-6 items-center gap-1">
            <Slider
                min={0}
                max={max}
                step={1}
                value={[Math.min(max, numeric)]}
                onValueChange={(next) => onPreview({ [property]: `${next[0] ?? numeric}px` })}
                onValueCommit={(next) => onCommit({ [property]: `${next[0] ?? numeric}px` })}
                className="min-w-0 flex-1"
                aria-label={property}
            />
            <Field
                value={value}
                property={property}
                onPreview={onPreview}
                onCommit={onCommit}
                className="max-w-20"
            />
        </div>
    );
}

export function TextContentField({
    value,
    onCommit,
}: {
    value: string;
    onCommit: (next: string) => void;
}) {
    const [draft, setDraft] = useState(value);
    const [valueScope, setValueScope] = useState<readonly [typeof value] | null>(null);
    if (valueScope === null || !Object.is(valueScope[0], value)) {
        setValueScope([value]);
        setDraft(value);

    }
    return (
        <textarea
            className={cn(
                "min-h-16 w-full resize-y rounded-md border border-border bg-panel-hover px-2 py-1.5 text-sm leading-snug text-text-primary",
            )}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
                if (draft !== value) onCommit(draft);
            }}
        />
    );
}
