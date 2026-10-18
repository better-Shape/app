"use client";

import { Color20Regular } from "@fluentui/react-icons/headless/svg/color";


import React from "react";
import { Icon } from "@/components/ui/icon";
import { GeneratingIndicator } from "./generating";


export function StyleAnalysis({ label, isActive }: { label: string; isActive?: boolean }) {
    return (
        <div className="flex flex-col gap-1 my-2" aria-busy={isActive || undefined}>
            <div className="flex items-center gap-2 py-1.5 text-xs text-text-muted transition-colors group w-full text-left">
                <div className="w-3.5 h-3.5 flex items-center justify-center">
                    <Icon icon={Color20Regular} />
                </div>
                {isActive ? (
                    <GeneratingIndicator label={`${label}...`} />
                ) : (
                    <span className="font-medium text-sm">Inacted {label.toLowerCase()}</span>
                )}
            </div>
        </div>
    );
}
