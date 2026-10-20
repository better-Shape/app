"use client";

import { Tooltip } from "@/components/ui/tooltip";
import React from "react";
import type { ProviderPreset } from "@/lib/ai/providers";

import { Add20Regular } from "@fluentui/react-icons/headless/svg/add";
import { Checkmark20Regular } from "@fluentui/react-icons/headless/svg/checkmark";
import { CheckmarkCircle20Regular } from "@fluentui/react-icons/headless/svg/checkmark-circle";
import { ErrorCircle20Regular } from "@fluentui/react-icons/headless/svg/error-circle";
import { Warning20Regular } from "@fluentui/react-icons/headless/svg/warning";
import { Copy20Regular } from "@fluentui/react-icons/headless/svg/copy";
import { Clipboard20Regular } from "@fluentui/react-icons/headless/svg/clipboard";
import { Eye20Regular } from "@fluentui/react-icons/headless/svg/eye";
import { EyeOff20Regular } from "@fluentui/react-icons/headless/svg/eye-off";
import { Link20Regular } from "@fluentui/react-icons/headless/svg/link";
import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import { DismissCircle20Regular } from "@fluentui/react-icons/headless/svg/dismiss-circle";
import { ArrowReset20Regular } from "@fluentui/react-icons/headless/svg/arrow-reset";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";
import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { ChevronUp20Regular } from "@fluentui/react-icons/headless/svg/chevron-up";
import { Search20Regular } from "@fluentui/react-icons/headless/svg/search";
import { Globe20Regular } from "@fluentui/react-icons/headless/svg/globe";
import { Sparkle20Regular } from "@fluentui/react-icons/headless/svg/sparkle";
import { Database20Regular } from "@fluentui/react-icons/headless/svg/database";
import { Shield20Regular } from "@fluentui/react-icons/headless/svg/shield";
import { Key20Regular } from "@fluentui/react-icons/headless/svg/key";
import { Info20Regular } from "@fluentui/react-icons/headless/svg/info";
import { Cloud20Regular } from "@fluentui/react-icons/headless/svg/cloud";
import { PlugConnected20Regular } from "@fluentui/react-icons/headless/svg/plug-connected";
import { Settings20Regular } from "@fluentui/react-icons/headless/svg/settings";
import { Code20Regular } from "@fluentui/react-icons/headless/svg/code";
import { Airplane20Regular } from "@fluentui/react-icons/headless/svg/airplane";
import { Bot20Regular } from "@fluentui/react-icons/headless/svg/bot";
import { People20Regular } from "@fluentui/react-icons/headless/svg/people";

export {
    Add20Regular,
    Checkmark20Regular,
    CheckmarkCircle20Regular,
    ErrorCircle20Regular,
    Warning20Regular,
    Copy20Regular,
    Clipboard20Regular,
    Eye20Regular,
    EyeOff20Regular,
    Link20Regular,
    Dismiss20Regular,
    DismissCircle20Regular,
    ArrowReset20Regular,
    ChevronRight20Regular,
    ChevronDown20Regular,
    ChevronUp20Regular,
    Search20Regular,
    Globe20Regular,
    Sparkle20Regular,
    Database20Regular,
    Shield20Regular,
    Key20Regular,
    Info20Regular,
    Cloud20Regular,
    PlugConnected20Regular,
    Settings20Regular,
    Code20Regular,
    Airplane20Regular,
    Bot20Regular,
    People20Regular,
};

/**
 * Provider connection health, used to pick the dot colour, label text, and
 * whether a card can be tested/checked.
 */
export type ConnectionStatus =
    | "off"
    | "unconfigured"
    | "ready"
    | "error"
    | "needs-url";

export type StatusStyle = {
    dot: string;
    glyph: React.ComponentType<{ className?: string }> | null;
    glyphClass?: string;
    label: string;
    description: string;
};

export function connectionStatusStyle(params: {
    enabled: boolean;
    hasKey: boolean;
    keyless: boolean;
    needsBaseUrl: boolean;
    hasBaseUrl: boolean;
    lastError?: string | null;
}): StatusStyle {
    if (!params.enabled) {
        return {
            dot: "bg-text-disabled",
            glyph: null,
            label: "Off",
            description: "Provider disabled — its models won't appear in chat pickers.",
        };
    }
    if (params.lastError) {
        return {
            dot: "bg-error",
            glyph: ErrorCircle20Regular,
            glyphClass: "text-error",
            label: "Error",
            description: params.lastError,
        };
    }
    if (params.needsBaseUrl && !params.hasBaseUrl) {
        return {
            dot: "bg-warning",
            glyph: Warning20Regular,
            glyphClass: "text-warning",
            label: "Needs endpoint",
            description: "Enter a base URL before this provider can route.",
        };
    }
    if (!params.hasKey && !params.keyless) {
        return {
            dot: "bg-text-muted",
            glyph: null,
            label: "Add a key",
            description: "Paste an API key to enable this provider.",
        };
    }
    if (params.keyless && !params.hasKey) {
        return {
            dot: "bg-success",
            glyph: CheckmarkCircle20Regular,
            glyphClass: "text-success",
            label: "No key needed",
            description: "Local or keyless endpoint — ready to use.",
        };
    }
    return {
        dot: "bg-success",
        glyph: CheckmarkCircle20Regular,
        glyphClass: "text-success",
        label: "Ready",
        description: "Key saved in the OS keychain and ready to route.",
    };
}

/** Small 6px status dot with an accessible tooltip. */
export function StatusDot({
    style,
    className = "",
}: {
    style: StatusStyle;
    className?: string;
}) {
    return (
        <Tooltip content={<span className="max-w-[240px]">{style.description}</span>} side="top">
            <span
                role="status"
                aria-label={`${style.label} — ${style.description}`}
                className={`relative inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${style.dot} ${className}`}
            />
        </Tooltip>
    );
}

/** Monochrome mark for a preset — two-letter monogram in a squircle tile. */
export function ProviderMonogram({ preset }: { preset: ProviderPreset }) {
    const initials = preset.label
        .split(/[\s()]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("");
    return (
        <div
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-3 text-[10px] font-semibold tracking-tight text-text-secondary squircle-md"
            aria-hidden
        >
            {initials}
        </div>
    );
}
