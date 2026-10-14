import { useSyncExternalStore } from "react";

export type Platform = "macos" | "windows" | "linux" | "unknown";

/** Cmd on macOS, Ctrl everywhere else. */
export type PrimaryModifier = "meta" | "ctrl";

const subscribeNoop = () => () => {};
const getUnknownPlatform = (): Platform => "unknown";

/** `navigator.userAgentData` is Chromium-only and is still absent from lib.dom.d.ts. */
type NavigatorWithUAData = Navigator & { userAgentData?: { platform?: string } | undefined };

/**
 * Raw platform signals, most authoritative first: `userAgentData.platform`
 * (Chromium), then the UA string used by WebKit and Firefox. Empty while prerendering, where `navigator` does not exist.
 */
function platformSignals(): string[] {
    if (typeof navigator === "undefined") return [];
    const signals = [
        (navigator as NavigatorWithUAData).userAgentData?.platform,
        navigator.userAgent,
    ];
    return signals.filter((value): value is string => typeof value === "string" && value !== "");
}

function classify(signals: string[]): Platform {
    for (const signal of signals) {
        const value = signal.toLowerCase();
        // `darwin` contains `win`, so Windows must match at a word start.
        if (value.includes("mac") || value.includes("darwin")) return "macos";
        if (/\bwin/.test(value)) return "windows";
        if (value.includes("linux") || value.includes("android")) return "linux";
    }
    return "unknown";
}

/** Not memoized — a stubbed `navigator` must still be read on every call. */
export function getPlatform(): Platform {
    return classify(platformSignals());
}

export function isMac(): boolean {
    return getPlatform() === "macos";
}

export function isWindows(): boolean {
    return getPlatform() === "windows";
}

export function isLinux(): boolean {
    return getPlatform() === "linux";
}

export function primaryModifier(): PrimaryModifier {
    return isMac() ? "meta" : "ctrl";
}

/** Spelled-out label for UI that teaches a shortcut. */
export function modKeyLabel(): string {
    return isMac() ? "Cmd" : "Ctrl";
}

/** Glyph form for tight slots (a trailing key hint on a button). */
export function modKeyGlyph(): string {
    return isMac() ? "⌘" : "Ctrl";
}

let snapshotKey: string | undefined;
let snapshotPlatform: Platform = "unknown";

/** Stable snapshot identity for `useSyncExternalStore`, recomputed only when a signal changes. */
function getPlatformSnapshot(): Platform {
    const signals = platformSignals();
    const key = signals.join("\u0000");
    if (key !== snapshotKey) {
        snapshotKey = key;
        snapshotPlatform = classify(signals);
    }
    return snapshotPlatform;
}

/**
 * Platform for rendering. Reads the server snapshot (`unknown`) while hydrating and
 * the real one after, so the prerendered shell matches and only the client corrects it.
 */
export function usePlatform(): Platform {
    return useSyncExternalStore(subscribeNoop, getPlatformSnapshot, getUnknownPlatform);
}
