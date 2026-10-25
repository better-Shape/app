"use client";

import { Color20Regular } from "@fluentui/react-icons/headless/svg/color";
import React from "react";
import { Icon } from "@/components/ui/icon";
import { ActionLine } from "./action-line";

/** Renders a style-audit tool call row with active shimmer feedback. */
export const StyleAnalysis = ({ label, isActive }: { label: string; isActive?: boolean }) => (
    <div className="my-1">
        <ActionLine
            action={isActive ? "Checking" : "Checked"}
            detail={label.toLowerCase()}
            icon={<Icon icon={Color20Regular} className="size-3.5 text-text-muted/80" />}
            busy={Boolean(isActive)}
        />
    </div>
);
