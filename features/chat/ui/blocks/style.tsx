"use client";

import { Color20Regular } from "@fluentui/react-icons/headless/svg/color";
import React from "react";
import { Icon } from "@/components/ui/icon";
import { ActionLine } from "./action-line";

export function StyleAnalysis({ label, isActive }: { label: string; isActive?: boolean }) {
    return (
        <div className="my-1">
            <ActionLine
                action={isActive ? "Checking" : "Checked"}
                detail={label.toLowerCase()}
                icon={<Icon icon={Color20Regular} className="size-3.5 text-text-muted/80" />}
                shimmer={Boolean(isActive)}
            />
        </div>
    );
}
