"use client";

import { useState } from "react";
import { BetterShapeLogo } from "@/components/ui/bettershape-logo";
import { isBetterShapePluginMeta, pluginLetter, pluginLogoCandidates } from "@/lib/plugins/logos";
import { usePluginMarks } from "@/lib/plugins/use-plugin-marks";
import { cn } from "@/lib/utils";

/**
 * A plugin's logo: its bundled mark, else the logo the catalog lists when `logo` is passed, else
 * the first letter of its name. Drawing it asks no icon service.
 */
export function PluginLogo({
    toolkit,
    name,
    logo,
    size = 32,
    className,
    slug,
}: {
    toolkit: string;
    name: string;
    logo?: string | null;
    size?: number;
    className?: string;
    slug?: string;
}) {
    const marks = usePluginMarks();
    const [failedAt, setFailedAt] = useState(0);
    if (isBetterShapePluginMeta(toolkit, slug)) {
        return <BetterShapeLogo size={size} className={className} />;
    }
    const src = pluginLogoCandidates(toolkit, true, marks, logo).at(failedAt);
    if (!src) {
        return (
            <span
                aria-hidden
                className={cn(
                    "inline-flex shrink-0 items-center justify-center rounded-lg bg-surface-3 font-medium text-text-secondary",
                    className,
                )}
                style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.45)) }}
            >
                {pluginLetter(name || toolkit)}
            </span>
        );
    }
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={src}
            alt=""
            width={size}
            height={size}
            className={cn("shrink-0 rounded-lg object-contain", className)}
            style={{ width: size, height: size }}
            onError={() => setFailedAt((n) => n + 1)}
        />
    );
}
