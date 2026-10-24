/* eslint-disable @next/next/no-img-element -- plain <img> is intentional: animated SVG mark in static export */
"use client";

import { memo } from "react";

export const ChatEmptyState = memo(function ChatEmptyState({
    onSelectMode: _onSelectMode,
}: {
    onSelectMode?: (mode: string) => void;
}) {
    return (
        <div className="relative flex h-16 w-full items-center justify-center">
            <img
                src="/logos/logo_animated.svg"
                alt=""
                aria-hidden="true"
                draggable={false}
                className="h-16 w-16 select-none opacity-15"
            />
        </div>
    );
});
