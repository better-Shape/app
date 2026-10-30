"use client";

import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import React, { useRef } from "react";
import { Icon, type IconGlyph } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";


import { loadCustomEditorFont } from "@/lib/editor/custom-fonts";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuCheckboxItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";

const InSettingCard = React.createContext(false);

interface SettingRowLabels {
    titleId: string;
    descriptionId?: string;
}

const SettingRowLabelContext = React.createContext<SettingRowLabels | null>(null);

const settingCardClass = "overflow-hidden squircle-[18px] bg-settings-card";

/** Shared chrome for settings action / select triggers. */
export const SETTING_CONTROL_BTN =
    "h-9 min-w-0 justify-between gap-1.5 border border-border bg-panel-hover px-3 font-normal text-text-primary hover:bg-white/12 [[data-theme=light]_&]:bg-black/6 [[data-theme=light]_&]:hover:bg-black/10";

export function SettingCard({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <InSettingCard.Provider value={true}>
            <div className={cn(settingCardClass, "flex flex-col divide-y divide-border-subtle", className)}>
                {children}
            </div>
        </InSettingCard.Provider>
    );
}

export function SettingVisualCard({
    title,
    subtitle,
    image,
}: {
    title: string;
    subtitle?: string;
    image: string;
}) {
    return (
        <div className="flex items-center gap-4 px-3.5 py-3">
            <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text-primary">{title}</div>
                {subtitle ? <p className="mt-0.5 text-xs leading-4 text-text-muted">{subtitle}</p> : null}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="" className="h-[88px] w-[148px] shrink-0 rounded-lg object-cover" />
        </div>
    );
}

export function SettingSection({
    id,
    title,
    description,
    action,
    children,
}: {
    id?: string;
    title: string;
    description?: string;
    /** Control aligned with the title (e.g. Save). */
    action?: React.ReactNode;
    /** Kept so existing callers compile. Rows are cards on their own. */
    card?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div id={id} className="mb-8 last:mb-0 scroll-mt-3">
            <div className="mb-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-1">
                <div className="min-w-[10rem] flex-1">
                    <h2 className="text-xs font-normal text-text-muted">{title}</h2>
                    {description ? <p className="mt-1 max-w-xl text-sm font-normal leading-4 text-text-muted">{description}</p> : null}
                </div>
                {action ? <div className="shrink-0">{action}</div> : null}
            </div>
            <div className="flex flex-col gap-2">{children}</div>
        </div>
    );
}

function SettingRowBody({
    title,
    description,
    icon,
    titleId,
    descriptionId,
    children,
}: {
    title: string;
    description?: string;
    icon?: IconGlyph;
    titleId: string;
    descriptionId?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
                {icon ? <Icon icon={icon} className="shrink-0 text-text-muted" /> : null}
                <div className="min-w-0">
                    <div id={titleId} className="text-sm font-medium text-text-primary">
                        {title}
                    </div>
                    {description ? (
                        <div id={descriptionId} className="mt-0.5 text-xs leading-4 font-normal text-text-muted">
                            {description}
                        </div>
                    ) : null}
                </div>
            </div>
            <div className="flex shrink-0 items-center">{children}</div>
        </div>
    );
}

export function SettingRow({
    title,
    description,
    icon,
    children,
    stack,
}: {
    title: string;
    description?: string;
    icon?: IconGlyph;
    children: React.ReactNode;
    stack?: boolean;
}) {
    const inCard = React.useContext(InSettingCard);
    const titleId = React.useId();
    const rawDescId = React.useId();
    const descriptionId = description ? rawDescId : undefined;
    const labels = React.useMemo(
        () => ({ titleId, descriptionId }),
        [titleId, descriptionId],
    );

    if (stack) {
        const stacked = (
            <SettingRowLabelContext.Provider value={labels}>
                <div className="space-y-2.5 px-3.5 py-3">
                    <div>
                        <div id={titleId} className="text-sm font-medium text-text-primary">
                            {title}
                        </div>
                        {description ? (
                            <div id={descriptionId} className="mt-0.5 text-xs leading-4 text-text-muted">
                                {description}
                            </div>
                        ) : null}
                    </div>
                    {children}
                </div>
            </SettingRowLabelContext.Provider>
        );
        return inCard ? stacked : <div className={settingCardClass}>{stacked}</div>;
    }

    const row = (
        <SettingRowLabelContext.Provider value={labels}>
            <SettingRowBody
                title={title}
                description={description}
                icon={icon}
                titleId={titleId}
                descriptionId={descriptionId}
            >
                {children}
            </SettingRowBody>
        </SettingRowLabelContext.Provider>
    );
    return inCard ? row : <div className={settingCardClass}>{row}</div>;
}

export function SettingActionRow({
    title,
    icon,
    onClick,
}: {
    title: string;
    icon: IconGlyph;
    onClick: () => void;
}) {
    const inCard = React.useContext(InSettingCard);
    const row = (
        <button
            type="button"
            onClick={onClick}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-normal text-text-primary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)]"
        >
            <Icon icon={icon} className="shrink-0 text-text-muted" />
            <span>{title}</span>
        </button>
    );
    return inCard ? row : <div className={settingCardClass}>{row}</div>;
}

export function SettingSelect<T extends string>({
    value,
    options,
    onChange,
    className,
    disabled,
    "aria-label": ariaLabel,
}: {
    value: T;
    options: { value: T; label: string }[];
    onChange: (v: T) => void;
    className?: string;
    disabled?: boolean;
    "aria-label"?: string;
}) {
    const label = options.find((o) => o.value === value)?.label ?? value;
    const rowLabels = React.useContext(SettingRowLabelContext);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    aria-label={ariaLabel}
                    aria-labelledby={!ariaLabel ? rowLabels?.titleId : undefined}
                    aria-describedby={rowLabels?.descriptionId}
                    className={cn(SETTING_CONTROL_BTN, className)}
                >
                    <span className="truncate">{label}</span>
                    <Icon icon={ChevronDown20Regular} className="shrink-0 text-text-muted" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[180px]">
                {options.map((opt) => (
                    <DropdownMenuCheckboxItem
                        key={opt.value}
                        checked={value === opt.value}
                        onCheckedChange={() => onChange(opt.value)}
                    >
                        {opt.label}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function SettingSwitch({
    checked,
    onChange,
    disabled,
    "aria-label": ariaLabel,
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
    "aria-label"?: string;
}) {
    const rowLabels = React.useContext(SettingRowLabelContext);
    return (
        <Switch
            checked={checked}
            onCheckedChange={onChange}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-labelledby={!ariaLabel ? rowLabels?.titleId : undefined}
            aria-describedby={rowLabels?.descriptionId}
            className="data-[state=checked]:bg-success data-[state=unchecked]:bg-white/20 [[data-theme=light]_&]:data-[state=unchecked]:bg-black/15"
        />
    );
}

export function SettingNumberSelect({
    value,
    options,
    onChange,
    formatLabel,
}: {
    value: number;
    options: number[];
    onChange: (v: number) => void;
    formatLabel?: (n: number) => string;
}) {
    const fmt = formatLabel ?? ((n: number) => String(n));
    const allValues = options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
    const selectOptions = allValues.map((n) => ({ value: String(n), label: fmt(n) }));

    return (
        <SettingSelect
            value={String(value)}
            options={selectOptions}
            onChange={(v) => onChange(Number(v))}
        />
    );
}

export const EDITOR_FONT_PRESETS = [
    { value: "'IBM Plex Mono', 'Cascadia Code', Consolas, monospace", label: "IBM Plex Mono" },
    { value: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace", label: "Cascadia Code" },
    { value: "'JetBrains Mono', Consolas, monospace", label: "JetBrains Mono" },
    { value: "'Fira Code', Consolas, monospace", label: "Fira Code" },
    { value: "Consolas, 'Courier New', monospace", label: "Consolas" },
    { value: "'Source Code Pro', Consolas, monospace", label: "Source Code Pro" },
] as const;

export const TERMINAL_FONT_PRESETS = [
    { value: "'IBM Plex Mono', Consolas, monospace", label: "IBM Plex Mono" },
    { value: "'Cascadia Mono', Consolas, monospace", label: "Cascadia Mono" },
    { value: "'JetBrains Mono', Consolas, monospace", label: "JetBrains Mono" },
    { value: "Consolas, 'Courier New', monospace", label: "Consolas" },
] as const;

export const FONT_SIZE_PRESETS = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24];
export const TAB_SIZE_PRESETS = [2, 4, 8];
export const SCROLLBACK_PRESETS = [1000, 3000, 5000, 10000, 25000, 50000];
export const AUTO_SAVE_DELAY_PRESETS = [500, 1000, 2000, 3000, 5000, 10000];
export const AUTO_FETCH_INTERVAL_PRESETS = [60, 180, 300, 600, 1800, 3600];
export const MAX_CONTEXT_PRESETS = [100, 200, 500, 1000, 1500, 2000];

export const COMMON_EXCLUDE_PATTERNS = [
    { pattern: "**/node_modules", label: "node_modules" },
    { pattern: "**/.git", label: ".git" },
    { pattern: "**/dist", label: "dist" },
    { pattern: "**/build", label: "build" },
    { pattern: "**/.next", label: ".next" },
    { pattern: "**/target", label: "target" },
    { pattern: "**/.vscode", label: ".vscode" },
    { pattern: "**/coverage", label: "coverage" },
] as const;

const CUSTOM_FONT_VALUE = "__custom__";

export function FontFamilySelect({
    value,
    presets,
    onChange,
}: {
    value: string;
    presets: readonly { value: string; label: string }[];
    onChange: (v: string) => void;
}) {
    const presetValues = presets.map((p) => p.value);
    const isCustom = !presetValues.includes(value);
    const selectValue = isCustom ? CUSTOM_FONT_VALUE : value;
    const fileInputRef = useRef<HTMLInputElement>(null);

    const options = [
        ...presets.map((p) => ({ value: p.value, label: p.label })),
        { value: CUSTOM_FONT_VALUE, label: "Upload Font…" },
    ];

    const handleFontFile = async (file: File | undefined) => {
        if (!file) return;
        try {
            const family = await loadCustomEditorFont(file);
            onChange(family);
        } catch (err) {
            console.error("Failed to load custom font:", err);
        }
    };

    return (
        <div className="flex flex-col items-start gap-2">
            <SettingSelect
                value={selectValue}
                options={options}
                onChange={(v) => {
                    if (v === CUSTOM_FONT_VALUE) {
                        fileInputRef.current?.click();
                    } else {
                        onChange(v);
                    }
                }}
            />
            <input
                ref={fileInputRef}
                type="file"
                accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
                className="hidden"
                onChange={(e) => {
                    void handleFontFile(e.target.files?.[0]);
                    e.target.value = "";
                }}
            />
            {isCustom && (
                <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted truncate max-w-[180px]">{value}</span>
                    <Button
                        variant="secondary"
                        size="sm"
                        className="h-7"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        Change
                    </Button>
                </div>
            )}
        </div>
    );
}

export function SettingMultiSelect({
    value,
    options,
    onChange,
    placeholder = "None selected",
    className,
}: {
    value: string[];
    options: { value: string; label: string }[];
    onChange: (values: string[]) => void;
    placeholder?: string;
    className?: string;
}) {
    const active = new Set(value);
    const selectedLabels = options.filter((o) => active.has(o.value)).map((o) => o.label);
    const summary =
        selectedLabels.length === 0
            ? placeholder
            : selectedLabels.length <= 2
              ? selectedLabels.join(", ")
              : `${selectedLabels.length} selected`;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="secondary"
                    size="sm"
                    className={cn("h-8 min-w-[200px] max-w-[280px] justify-between gap-2 border border-border bg-panel-hover px-3 font-normal text-text-primary hover:bg-white/12 [[data-theme=light]_&]:bg-black/6 [[data-theme=light]_&]:hover:bg-black/10", className)}
                >
                    <span className="truncate">{summary}</span>
                    <Icon icon={ChevronDown20Regular} className="shrink-0 text-text-muted" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[200px]">
                {options.map((opt) => (
                    <DropdownMenuCheckboxItem
                        key={opt.value}
                        checked={active.has(opt.value)}
                        onCheckedChange={(checked) => {
                            const next = new Set(active);
                            if (checked) next.add(opt.value);
                            else next.delete(opt.value);
                            onChange([...next]);
                        }}
                    >
                        {opt.label}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function ExcludePatternsSelect({
    value,
    onChange,
}: {
    value: string;
    onChange: (v: string) => void;
}) {
    const known = new Set<string>(COMMON_EXCLUDE_PATTERNS.map((c) => c.pattern));
    const active = value
        .split(",")
        .map((s) => s.trim())
        .filter((p) => p && known.has(p));

    return (
        <SettingMultiSelect
            value={active}
            placeholder="None excluded"
            options={COMMON_EXCLUDE_PATTERNS.map((c) => ({ value: c.pattern, label: c.label }))}
            onChange={(next) => onChange(next.join(","))}
        />
    );
}
