"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

import { useIsMounted } from "@/lib/ui/use-mounted";

import { commands } from "@/lib/backend";
import type { BrowserPickedElement } from "@/lib/backend/types";
import { hostnameOf } from "@/lib/ui/favicon";
import { frameOrigin } from "./browser-frame";
import {
    BOOKMARKS_KEY,
    BOOKMARK_BAR_KEY,
    loadJson,
    saveJson,
    SCHEME_KEY,
    type Bookmark,
    type ColorScheme,
    type PageTab,
} from "./browser-storage";

/** A rect in the page's own coordinates, as the host script reports it. */
type ElementRect = { x: number; y: number; w: number; h: number };

/** What the pointer is over while the user is picking, and what to call it. */
export type HoverTarget = { label: string; rect: ElementRect };

/** Where the page asked for its host menu, in viewport coordinates. */
export type MenuPoint = { x: number; y: number };

/** The developer tools for one page: the URL they are served from, or the reason there are none. */
export type ToolsState = { url: string; src: string | null; error: string | null };

/** One message from the host script inside the frame. */
type FrameMessage = {
    type?: string;
    url?: string;
    title?: string;
    favicon?: string;
    x?: number;
    y?: number;
    tag?: string;
    label?: string;
    travel?: boolean;
    rect?: ElementRect;
};

/** Everything a frame message handler needs, which is the frame plus the window's setters. */
type FrameContext = {
    frame: HTMLIFrameElement;
    onNavigation: (url: string, title: string | undefined, error: string | null, travel: boolean, favicon?: string) => void;
    onHover: (target: HoverTarget | null) => void;
    onMenu: (point: MenuPoint) => void;
    onPick: (element: BrowserPickedElement) => void;
};

/** The page reported where it is, which is what moves the tab. */
const handlePageMessage = (ctx: FrameContext, data: FrameMessage) => {
    if (!data.url) return;
    ctx.onNavigation(data.url, data.title, null, Boolean(data.travel), data.favicon);
};

/** The page reported what the pointer is over, which is the outline the pick draws. */
const handleHoverMessage = (ctx: FrameContext, data: FrameMessage) => {
    if (!data.rect || !data.label) {
        ctx.onHover(null);
        return;
    }
    ctx.onHover({ label: data.label, rect: data.rect });
};

/** The page asked for its host menu, which the frame positions against its own box. */
const handleMenuMessage = (ctx: FrameContext, data: FrameMessage) => {
    const rect = ctx.frame.getBoundingClientRect();
    ctx.onMenu({ x: rect.left + (data.x || 0), y: rect.top + (data.y || 0) });
};

/** The page handed over the element the user picked, which the chat takes as a mention. */
const handlePickMessage = (ctx: FrameContext, data: FrameMessage) => {
    if (!data.tag) return;
    ctx.onPick(data as BrowserPickedElement);
};

/** The messages the host script can post, each with the one thing to do about it. */
const FRAME_HANDLERS: Record<string, (ctx: FrameContext, data: FrameMessage) => void> = {
    "bettershape-browser-page": handlePageMessage,
    "bettershape-browser-hover": handleHoverMessage,
    "bettershape-browser-menu": handleMenuMessage,
    "bettershape-browser-pick": handlePickMessage,
};

/** Routes one frame message to its handler, ignoring the types nothing listens for. */
const dispatchFrameMessage = (data: FrameMessage, ctx: FrameContext) => {
    if (typeof data.type !== "string") return;
    const handler = FRAME_HANDLERS[data.type];
    if (!handler) return;
    handler(ctx, data);
};

/** The origin the frame should be posting from, or null when its URL has none to speak of. */
const expectedOrigin = (url: string): string | null => {
    try {
        const origin = new URL(url).origin;
        return origin === "null" ? null : origin;
    } catch {
        return null;
    }
};

/**
 * Whether a message came from this frame, and from the page it is showing.
 *
 * `event.source` is the strong half of the check and does not depend on the origin being
 * parseable. The origin comparison is the second half: without it, any script on any page
 * that can reach the window could post to the host's own listener.
 */
const isFrameMessage = (event: MessageEvent, frame: HTMLIFrameElement, url: string) => {
    if (event.source !== frame.contentWindow) return false;
    const expected = expectedOrigin(url);
    if (!expected) return true;
    return event.origin === expected;
};

/**
 * The messages the framed page posts to the host.
 *
 * The listener is on the window rather than the frame, because a cross-origin frame cannot be
 * given a listener directly; the source check above is what makes that safe.
 */
export const useFrameMessages = ({
    frameRef,
    urlRef,
    onNavigation,
    onHover,
    onMenu,
    onPick,
}: {
    frameRef: RefObject<HTMLIFrameElement | null>;
    urlRef: RefObject<string>;
    onNavigation: FrameContext["onNavigation"];
    onHover: (target: HoverTarget | null) => void;
    onMenu: (point: MenuPoint) => void;
    onPick: (element: BrowserPickedElement) => void;
}) => {
    useEffect(() => {
        /** Delivers one message to the handler for its type, if it is ours at all. */
        const onMessage = (event: MessageEvent) => {
            const frame = frameRef.current;
            if (!frame) return;
            if (!isFrameMessage(event, frame, urlRef.current)) return;
            const data = event.data as FrameMessage | null;
            if (!data) return;
            dispatchFrameMessage(data, { frame, onNavigation, onHover, onMenu, onPick });
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [frameRef, urlRef, onNavigation, onHover, onMenu, onPick]);
};

/**
 * The navigations the backend reports for a frame it drives itself.
 *
 * Windows drives the frame through WebView2, so the page never posts anything the host can
 * hear and the only report of where it went comes from Rust.
 */
export const useBrowserFrameEvents = ({
    travelUntil,
    onNavigation,
}: {
    travelUntil: RefObject<number>;
    onNavigation: FrameContext["onNavigation"];
}) => {
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        /** Subscribes to the backend's report; the import is dynamic because Rust may never send one. */
        const subscribe = async () => {
            const { listen } = await import("@tauri-apps/api/event");
            unlisten = await listen<{ url: string; ok: boolean; error: string }>(
                "browser-frame",
                (event) => {
                    const next = event.payload;
                    if (!next?.url) return;
                    const error = next.ok ? null : next.error || "This page can't be shown in the app.";
                    onNavigation(next.url, undefined, error, Date.now() < travelUntil.current);
                },
            );
        };
        subscribe().catch(() => undefined);
        return () => {
            if (unlisten) unlisten();
        };
    }, [travelUntil, onNavigation]);
};

/**
 * Tells the frame which scheme to render in, and reloads it when the scheme is a change.
 *
 * The reload is the second message rather than a different one: the page corrects its own
 * colours from the scheme it is handed, and the reload is only there for the pages whose
 * stylesheet was decided by a media query at load.
 */
const postScheme = (frame: HTMLIFrameElement | null, scheme: ColorScheme, changed: boolean) => {
    if (!frame) return;
    const target = frameOrigin(frame);
    frame.contentWindow?.postMessage({ type: "bettershape-browser-host", scheme }, target);
    if (!changed) return;
    frame.contentWindow?.postMessage({ type: "bettershape-browser-host", reload: true }, target);
};

/**
 * Whether this scheme is a change from the last one the frame was told about.
 *
 * A first run is a paint rather than a change: the frame has not been told anything yet, so
 * there is nothing on the page to correct and a reload would only make the first paint slower.
 */
const isSchemeChange = (seen: ColorScheme | null, scheme: ColorScheme) =>
    seen !== null && seen !== scheme;

/** Tells the frame which colour scheme to render in, and reloads it when the answer changes. */
export const useSchemeBroadcast = ({
    frameRef,
    scheme,
    seenSchemeRef,
}: {
    frameRef: RefObject<HTMLIFrameElement | null>;
    scheme: ColorScheme;
    seenSchemeRef: RefObject<ColorScheme | null>;
}) => {
    useEffect(() => {
        let cancel = false;
        // Read and updated before the await, so a scheme that arrives mid-publish is still
        // measured against what the frame was actually told.
        const changed = isSchemeChange(seenSchemeRef.current, scheme);
        seenSchemeRef.current = scheme;
        /** Pushes the scheme into the frame once the backend has applied it to the surface. */
        const publish = async () => {
            await commands.browserSurfaceScheme(scheme);
            if (cancel) return;
            postScheme(frameRef.current, scheme, changed);
        };
        publish().catch(() => undefined);
        return () => {
            cancel = true;
        };
    }, [frameRef, scheme, seenSchemeRef]);
};

/** Points the frame at the active tab's URL, once per tab rather than once per render. */
export const useFrameSrcSync = ({
    frameRef,
    frameTabRef,
    active,
}: {
    frameRef: RefObject<HTMLIFrameElement | null>;
    frameTabRef: RefObject<string | null>;
    active: PageTab | null;
}) => {
    const id = active?.id;
    const url = active?.url ?? "";
    useEffect(() => {
        const frame = frameRef.current;
        if (!frame || !id) return;
        if (frameTabRef.current === id) return;
        frameTabRef.current = id;
        frame.src = /^https?:\/\//i.test(url) ? url : "about:blank";
    }, [frameRef, frameTabRef, id, url]);
};

/** Keeps the frame's pick mode in step with the button, including across a page load. */
export const usePickingBroadcast = ({
    frameRef,
    picking,
    frameSrc,
    showPage,
}: {
    frameRef: RefObject<HTMLIFrameElement | null>;
    picking: boolean;
    frameSrc: string;
    showPage: boolean;
}) => {
    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;
        /** Re-announces the mode on every load, because a new document knows nothing yet. */
        const send = () => {
            frame.contentWindow?.postMessage(
                { type: "bettershape-browser-host", pick: picking },
                frameOrigin(frame),
            );
        };
        send();
        frame.addEventListener("load", send);
        return () => frame.removeEventListener("load", send);
    }, [frameRef, picking, frameSrc, showPage]);
};

/**
 * The bookmarks this profile saved, and whether the bar showing them is out.
 *
 * Both are read after hydration rather than in the initial state, so the server and the first
 * client render agree on empty and the saved values arrive in the next commit. Reading storage
 * during render would make the prerender and the client disagree on every saved bookmark.
 */
export const useBookmarks = () => {
    const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
    const [bar, setBar] = useState(false);
    const hydrated = useIsMounted();
    const [restored, setRestored] = useState(false);
    if (hydrated && !restored) {
        setRestored(true);
        setBookmarks(loadJson<Bookmark[]>(BOOKMARKS_KEY, []));
        setBar(loadJson<boolean>(BOOKMARK_BAR_KEY, false));
    }

    /** Adds the page or removes it, which is what the star toggles between. */
    const toggle = useCallback((url: string, title: string) => {
        if (!url || url === "about:blank") return;
        setBookmarks((previous) => {
            const saved = previous.some((bookmark) => bookmark.url === url);
            const next = saved
                ? previous.filter((bookmark) => bookmark.url !== url)
                : [...previous, { url, title: title || hostnameOf(url) }];
            saveJson(BOOKMARKS_KEY, next);
            return next;
        });
    }, []);

    /** Shows or hides the bar, and remembers which. */
    const showBar = (next: boolean) => {
        setBar(next);
        saveJson(BOOKMARK_BAR_KEY, next);
    };

    return { bookmarks, bar, showBar, toggle };
};

/**
 * The colour scheme the framed page renders in.
 *
 * The saved value is read in the initial state rather than in an effect: the frame needs it on
 * its first render, and an effect would paint one scheme and then correct it.
 */
export const useColorScheme = () => {
    const [scheme, setScheme] = useState<ColorScheme>(() => {
        const saved = loadJson<ColorScheme>(SCHEME_KEY, "system");
        return saved === "light" || saved === "dark" ? saved : "system";
    });

    /** Applies a scheme and remembers it. */
    const choose = (next: ColorScheme) => {
        setScheme(next);
        saveJson(SCHEME_KEY, next);
    };

    return { scheme, choose };
};
