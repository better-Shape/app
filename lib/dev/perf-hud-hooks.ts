"use client";

import { useEffect } from "react";
import { addInvokeListener } from "@/lib/backend/commands";
import { isPerfHudEnabled, perfHud } from "./perf-hud";

let invokeSamplingInstalled = false;

/** Wire IPC latency + the frame loop once, the first time a surface opts in. */
export function installPerfHudSampling(): void {
    if (invokeSamplingInstalled || typeof window === "undefined") return;
    if (!isPerfHudEnabled()) return;
    invokeSamplingInstalled = true;
    addInvokeListener((command, durationMs) => perfHud.recordInvoke(command, durationMs));
    perfHud.start();
}

/**
 * Count committed renders of the calling component while the HUD is enabled.
 * A no-op (one effect, one boolean check) in production builds.
 */
export function usePerfRenderCount(id: string): void {
    useEffect(() => {
        if (!isPerfHudEnabled()) return;
        installPerfHudSampling();
        perfHud.recordRender(id);
    });
}
