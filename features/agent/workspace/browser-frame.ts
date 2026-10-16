"use client";

import { isWindows } from "@/lib/platform";

/** The origin of a frame's window, or null when the handle cannot answer for it. */
const windowOrigin = (frame: HTMLIFrameElement | null | undefined): string | null => {
    if (!frame) return null;
    if (!frame.contentWindow) return null;
    try {
        return frame.contentWindow.origin;
    } catch {
        return null;
    }
};

/** The origin named by the frame's current `src`, or `"*"` when there is nothing to read. */
const srcOrigin = (frame: HTMLIFrameElement | null | undefined): string => {
    try {
        return new URL(frame ? frame.src : "").origin;
    } catch {
        return "*";
    }
};

/**
 * The origin the frame is on right now.
 *
 * The frame browses arbitrary origins with its real origin intact (`allow-same-origin`), so
 * host messages are pinned to whatever it is on at the moment of the send. Reading the live
 * origin is what keeps redirects and in-page navigation in sync. A window that reports the
 * string `"null"` is a sandboxed one with no origin to speak of, so it falls back to the URL
 * the frame was pointed at, and `"*"` is the last resort for a frame with no URL yet.
 */
export const frameOrigin = (frame: HTMLIFrameElement | null | undefined): string => {
    const live = windowOrigin(frame);
    if (live && live !== "null") return live;
    return srcOrigin(frame);
};

/** Reloads a frame in place, and answers whether its window was there to reload. */
const reloadFrame = (frame: HTMLIFrameElement): boolean => {
    const target = frame.contentWindow;
    if (!target) return false;
    target.location.reload();
    return true;
};

/** Points a frame at a URL, which is how a cross-origin navigation is driven from here. */
const gotoFrame = (frame: HTMLIFrameElement, url?: string) => {
    frame.src = url ?? "";
};

/**
 * Drives the framed page from here, and answers whether it could.
 *
 * The framed page only answers `bettershape-browser-host` where the host can inject into it.
 * Windows does that through the WebView2 API; on macOS and Linux nothing reaches the page, so
 * the frame is driven directly instead: `Location.reload` is callable cross-origin and the
 * element is ours either way.
 */
export const steerFrame = (
    frame: HTMLIFrameElement | null | undefined,
    action: "reload" | "goto",
    url?: string,
): boolean => {
    if (isWindows() || !frame) return false;
    try {
        if (action === "reload") return reloadFrame(frame);
        gotoFrame(frame, url);
        return true;
    } catch {
        return false;
    }
};
