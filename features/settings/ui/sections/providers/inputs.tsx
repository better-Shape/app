"use client";

import React from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { notify } from "@/features/notifications";
import { cn } from "@/lib/utils";
import {
    ArrowReset20Regular,
    Checkmark20Regular,
    Clipboard20Regular,
    Eye20Regular,
    EyeOff20Regular,
    Warning20Regular,
} from "./status";

const inputClass =
    "h-8 min-w-0 flex-1 rounded-md border border-border-secondary bg-transparent px-2 text-sm font-normal text-text-primary placeholder:text-text-disabled outline-none transition-colors duration-fast focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

/* ------------------------------------------------------------------------ */
/* Key field                                                                 */
/* ------------------------------------------------------------------------ */

export function KeyInput({
    value,
    placeholder,
    onChange,
    disabled,
    warning,
    /** When true, a key is stored in the OS keychain for this field even if
     *  the value is blanked in the UI. Renders a small "Saved" indicator. */
    savedInVault,
}: {
    value: string;
    placeholder: string;
    onChange: (next: string) => void;
    disabled?: boolean;
    warning?: string | null;
    savedInVault?: boolean;
}) {
    const [visible, setVisible] = React.useState(false);
    const [copied, setCopied] = React.useState(false);

    const pasteFromClipboard = async () => {
        try {
            if (!navigator.clipboard?.readText) {
                notify.warn(
                    "Clipboard unavailable",
                    "This browser blocks programmatic paste — press ⌘V / Ctrl+V instead.",
                );
                return;
            }
            const text = await navigator.clipboard.readText();
            if (text) onChange(text.trim());
        } catch (err) {
            const reason = err instanceof Error ? err.message : "Clipboard access denied";
            notify.warn("Clipboard access denied", `${reason} — paste manually with ⌘V / Ctrl+V.`);
        }
    };

    const copyKey = async () => {
        if (!value) return;
        try {
            await navigator.clipboard?.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            notify.warn("Couldn't copy", "Clipboard write was blocked by the browser.");
        }
    };

    return (
        <div className="flex w-full flex-col gap-1">
            <div className="flex w-full items-center gap-1.5">
                <div className="relative min-w-0 flex-1">
                    <input
                        type={visible ? "text" : "password"}
                        value={value}
                        placeholder={savedInVault && !value ? "•••••••• key saved in keychain" : placeholder}
                        disabled={disabled}
                        spellCheck={false}
                        autoComplete="off"
                        data-form-type="other"
                        onChange={(e) => onChange(e.target.value)}
                        className={cn(inputClass, savedInVault && !value && "pr-16 text-text-muted")}
                    />
                    {savedInVault && !value ? (
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-sm bg-success/15 px-1 py-px text-[10px] font-medium tracking-wide text-success">
                            Saved
                        </span>
                    ) : null}
                </div>
                {value ? (
                    <Tooltip content={copied ? "Copied" : "Copy key"} side="top">
                        <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 text-text-muted hover:text-text-primary"
                            aria-label="Copy key"
                            onClick={() => void copyKey()}
                        >
                            <Icon icon={copied ? Checkmark20Regular : Clipboard20Regular} />
                        </Button>
                    </Tooltip>
                ) : (
                    <Tooltip content="Paste from clipboard" side="top">
                        <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 text-text-muted hover:text-text-primary"
                            aria-label="Paste key"
                            onClick={() => void pasteFromClipboard()}
                        >
                            <Icon icon={Clipboard20Regular} />
                        </Button>
                    </Tooltip>
                )}
                <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-text-muted hover:text-text-primary"
                    aria-label={visible ? "Hide key" : "Show key"}
                    aria-pressed={visible}
                    onClick={() => setVisible((v) => !v)}
                >
                    <Icon icon={visible ? EyeOff20Regular : Eye20Regular} />
                </Button>
            </div>
            {warning ? (
                <div className="flex items-start gap-1 text-xs leading-4 text-warning">
                    <Icon icon={Warning20Regular} className="mt-px size-3.5 shrink-0" />
                    <span>{warning}</span>
                </div>
            ) : null}
        </div>
    );
}

/* ------------------------------------------------------------------------ */
/* Text field with optional reset                                            */
/* ------------------------------------------------------------------------ */

export function TextInput({
    value,
    placeholder,
    onChange,
    onReset,
    defaultValue,
    mono = false,
}: {
    value: string;
    placeholder: string;
    onChange: (next: string) => void;
    /** When provided, shows a reset × when the value differs from the default. */
    onReset?: () => void;
    /** Default value used to decide whether to show the reset button. */
    defaultValue?: string;
    mono?: boolean;
}) {
    const canReset = Boolean(onReset) && value !== (defaultValue ?? "");
    return (
        <div className="flex w-full items-center gap-1.5">
            <input
                type="text"
                value={value}
                placeholder={placeholder}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => onChange(e.target.value)}
                className={`${inputClass} ${mono ? "font-mono text-xs" : ""}`}
            />
            {canReset ? (
                <Tooltip content="Reset to default" side="top">
                    <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-text-muted hover:text-text-primary"
                        aria-label="Reset to default"
                        onClick={onReset}
                    >
                        <Icon icon={ArrowReset20Regular} />
                    </Button>
                </Tooltip>
            ) : null}
        </div>
    );
}
