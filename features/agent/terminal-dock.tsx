"use client";

import { useIsMounted } from "@/lib/ui/use-mounted";

import { lazy, Suspense, useCallback, useLayoutEffect, useEffect, useRef, useState } from "react";
import { useProjectState } from "@/lib/backend/project-state";
import { registerBoundTerminalTab } from "@/features/terminal/session";
import { cn } from "@/lib/utils";

const Terminal = lazy(() => import("@/features/terminal/ui/terminal"));

const MIN_H = 140;
const DEFAULT_H = 220;
const HEIGHT_KEY = "bettershape-agent-terminal-height";
const OPEN_KEY = "bettershape-agent-terminal-open";

function clearBodyResize() {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.body.classList.remove("resizing-vertical");
}

/** Normalizes a terminal AI action command into a concise code-point-safe tab title. */
export const formatAiTerminalTitle = (command?: string): string => {
    if (!command) return "Agent";
    const normalized = command.replace(/\s+/g, " ").trim();
    const cleaned = Array.from(normalized).slice(0, 48).join("");
    return cleaned ? cleaned : "Agent";
};

/** Resolves the workspace directory for a bound AI terminal session. */
const resolveAiTerminalCwd = (cwd: string | undefined, fallbackCwd: string | null): string => {
    const trimmed = cwd?.trim();
    if (trimmed) return trimmed;
    return fallbackCwd ? fallbackCwd : "global";
};

/** Builds the bound terminal tab descriptor for a `"start"` AI terminal event, or `null`. */
const resolveAiTabSpec = (
    payload: { type: string; command?: string; cwd?: string; sessionId?: number },
    fallbackCwd: string | null,
) => {
    if (payload.type !== "start") return null;
    if (payload.sessionId == null) return null;
    return {
        title: formatAiTerminalTitle(payload.command),
        cwd: resolveAiTerminalCwd(payload.cwd, fallbackCwd),
        boundPtyId: payload.sessionId,
    };
};

/** Reads persisted terminal dock height and open preference from `localStorage`. */
const readStoredTerminalDockPrefs = (): { height?: number; wasOpen: boolean } => {
    try {
        const storedHeight = Number(localStorage.getItem(HEIGHT_KEY));
        return {
            height: storedHeight >= MIN_H && storedHeight <= 800 ? storedHeight : undefined,
            wasOpen: localStorage.getItem(OPEN_KEY) === "true",
        };
    } catch {
        return { wasOpen: false };
    }
};

/** Listens for Tauri `bettershape-terminal-ai-action` events and opens bound AI PTY tabs. */
const useTerminalAiActionListener = (
    cwdRef: React.RefObject<string | null | undefined>,
    persistOpen: (next: boolean) => void,
) => {
    useEffect(() => {
        if (typeof window === "undefined") return undefined;
        const tauri = (
            window as unknown as {
                __TAURI_INTERNALS__?: { transformCallback?: unknown };
            }
        ).__TAURI_INTERNALS__;
        if (typeof tauri?.transformCallback !== "function") return undefined;

        let unlisten: (() => void) | undefined;
        let cancelled = false;
        import("@tauri-apps/api/event")
            .then(({ listen }) =>
                listen<{ type: string; command?: string; cwd?: string; sessionId?: number }>(
                    "bettershape-terminal-ai-action",
                    (event) => {
                        if (cancelled) return;
                        const spec = resolveAiTabSpec(event.payload, cwdRef.current ?? null);
                        if (!spec) return;
                        registerBoundTerminalTab({
                            title: spec.title,
                            cwd: spec.cwd,
                            shell: "ai",
                            boundPtyId: spec.boundPtyId,
                        });
                        window.dispatchEvent(
                            new CustomEvent("bettershape-layout-toggle", { detail: { id: "panel", value: true } }),
                        );
                        persistOpen(true);
                    },
                ).then((fn) => {
                    if (cancelled) fn();
                    else unlisten = fn;
                }),
            )
            .catch(() => {
                /* non-Tauri preview runtime */
            });
        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, [cwdRef, persistOpen]);
};

/** Checks whether a keyboard target owns editable text input focus. */
const isEditableKeyTarget = (target: EventTarget | null): boolean =>
    Boolean((target as HTMLElement | null)?.closest("textarea, input, [contenteditable='true']"));

/** Checks whether a keyboard event uses bare Ctrl/Cmd without Alt or Shift modifiers. */
const isBarePrimaryModifier = (e: KeyboardEvent): boolean =>
    (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;

/** Checks whether a keyboard event matches bare `Mod+J` outside editable text inputs. */
const isTerminalToggleShortcut = (e: KeyboardEvent, suppressed: boolean): boolean => {
    if (suppressed || isEditableKeyTarget(e.target)) return false;
    return isBarePrimaryModifier(e) && e.key.toLowerCase() === "j";
};

/** Subscribes layout toggle, shortcut, and Ctrl/Cmd+J keyboard events for the terminal dock. */
const useTerminalDockEvents = ({
    open,
    visibleOpen,
    suppressed,
    persistOpen,
}: {
    open: boolean;
    visibleOpen: boolean;
    suppressed: boolean;
    persistOpen: (next: boolean) => void;
}) => {
    useEffect(() => {
        /** Toggles or explicitly sets terminal dock visibility from layout events. */
        const onToggle = (e: Event) => {
            const detail = (e as CustomEvent<{ id?: string; value?: boolean } | null>).detail;
            if (!detail || (detail.id !== "panel" && detail.id !== "terminal")) return;
            persistOpen(typeof detail.value === "boolean" ? detail.value : !visibleOpen);
        };
        /** Opens the terminal dock on workspace terminal launch events. */
        const onOpen = () => persistOpen(true);
        /** Opens the terminal dock on global terminal shortcut actions. */
        const onShortcut = (e: Event) => {
            const action = (e as CustomEvent<{ action?: string } | null>).detail?.action;
            if (!action || action === "open" || action === "toggle") persistOpen(true);
        };
        /** Opens the terminal dock when the active tab channel targets `terminal`. */
        const onTab = (e: Event) => {
            if ((e as CustomEvent<string | null>).detail?.toLowerCase() === "terminal") persistOpen(true);
        };
        window.addEventListener("bettershape-layout-toggle", onToggle as EventListener);
        window.addEventListener("bettershape-open-workspace-terminal", onOpen);
        window.addEventListener("bettershape-terminal-shortcut", onShortcut as EventListener);
        window.addEventListener("bettershape-set-active-tab", onTab as EventListener);
        return () => {
            window.removeEventListener("bettershape-layout-toggle", onToggle as EventListener);
            window.removeEventListener("bettershape-open-workspace-terminal", onOpen);
            window.removeEventListener("bettershape-terminal-shortcut", onShortcut as EventListener);
            window.removeEventListener("bettershape-set-active-tab", onTab as EventListener);
        };
    }, [persistOpen, visibleOpen]);

    useEffect(() => {
        /** Toggles the terminal dock on Ctrl/Cmd+J outside editable fields. */
        const onKey = (e: KeyboardEvent) => {
            if (!isTerminalToggleShortcut(e, suppressed)) return;
            e.preventDefault();
            persistOpen(!open);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, persistOpen, suppressed]);
};

/** Handles drag-to-resize mouse tracking and terminal xterm refit scheduling. */
const useTerminalDockResizeAndRefit = ({
    draggingRef,
    heightRef,
    height,
    suppressed,
    visibleOpen,
    setHeight,
    setResizing,
}: {
    draggingRef: React.MutableRefObject<boolean>;
    heightRef: React.MutableRefObject<number>;
    height: number;
    suppressed: boolean;
    visibleOpen: boolean;
    setHeight: React.Dispatch<React.SetStateAction<number>>;
    setResizing: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
    useEffect(() => {
        if (!suppressed || !draggingRef.current) return;
        draggingRef.current = false;
        setResizing(false);
        clearBodyResize();
    }, [draggingRef, setResizing, suppressed]);

    useEffect(() => {
        /** Updates dock height during active top-edge resize drag. */
        const onMove = (e: MouseEvent) => {
            if (!draggingRef.current) return;
            const max = Math.floor(window.innerHeight * 0.55);
            const next = Math.min(max, Math.max(MIN_H, window.innerHeight - e.clientY - 8));
            heightRef.current = next;
            setHeight(next);
        };
        /** Commits dock height on mouseup and clears body resize cursor state. */
        const onUp = () => {
            draggingRef.current = false;
            setResizing(false);
            clearBodyResize();
            try {
                localStorage.setItem(HEIGHT_KEY, String(heightRef.current));
            } catch {
                /* ignore */
            }
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            clearBodyResize();
        };
    }, [draggingRef, heightRef, setHeight, setResizing]);

    useEffect(() => {
        if (!visibleOpen) return undefined;
        const refitTimer = window.setTimeout(() => {
            import("@/features/terminal/ui/terminal")
                .then((terminalMod) => terminalMod.refitAllTerminals().catch(() => undefined))
                .catch(() => undefined);
        }, 40);
        return () => window.clearTimeout(refitTimer);
    }, [visibleOpen, height]);
};

/** Restores saved terminal dock height and open state once client hydration completes. */
const useHydratedTerminalDockPrefs = (
    setHeight: React.Dispatch<React.SetStateAction<number>>,
    setOpen: React.Dispatch<React.SetStateAction<boolean>>,
    setMounted: React.Dispatch<React.SetStateAction<boolean>>,
) => {
    const hydrated = useIsMounted();
    const [restoredPreferences, setRestoredPreferences] = useState(false);
    if (!hydrated || restoredPreferences) return;
    setRestoredPreferences(true);
    const prefs = readStoredTerminalDockPrefs();
    if (prefs.height !== undefined) setHeight(prefs.height);
    setOpen(prefs.wasOpen);
    if (prefs.wasOpen) setMounted(true);
};

/** Computes CSS class and inline height presentation props for the terminal dock shell. */
const deriveTerminalDockChrome = (visibleOpen: boolean, height: number, freezeMotion: boolean) => ({
    visibilityClass: visibleOpen ? "m-3 visible" : "pointer-events-none invisible m-0",
    transitionGuard: freezeMotion ? "transition-none" : "",
    shellHeight: visibleOpen ? height + 10 : 0,
});

/** Renders the top-edge horizontal drag separator when the terminal dock is open. */
const TerminalDockResizeHandle = ({
    visibleOpen,
    onStartResize,
}: {
    visibleOpen: boolean;
    onStartResize: (e: React.MouseEvent) => void;
}) => {
    if (!visibleOpen) return null;
    return (
        <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize terminal"
            className="group absolute inset-x-0 top-0 z-10 h-2 cursor-row-resize"
            onMouseDown={onStartResize}
        />
    );
};

/** Resizable bottom terminal dock scoped to the active project surface. */
export const TerminalDock = ({ suppressed = false }: { suppressed?: boolean } = {}) => {
    const { project_path } = useProjectState();
    const cwdRef = useRef(project_path);
    useEffect(() => { cwdRef.current = project_path; }, [project_path]);
    const [open, setOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [height, setHeight] = useState(DEFAULT_H);
    const [resizing, setResizing] = useState(false);
    const heightRef = useRef(DEFAULT_H);
    useLayoutEffect(() => { heightRef.current = height; }, [height]);
    useEffect(() => { clearBodyResize(); }, []);
    const draggingRef = useRef(false);
    const visibleOpen = open && !suppressed;

    useHydratedTerminalDockPrefs(setHeight, setOpen, setMounted);

    const persistOpen = useCallback((next: boolean) => {
        if (!next) {
            draggingRef.current = false;
            setResizing(false);
            clearBodyResize();
            setOpen(false);
        } else {
            setMounted(true);
            requestAnimationFrame(() => setOpen(true));
        }
        try {
            localStorage.setItem(OPEN_KEY, String(next));
        } catch {
            /* ignore */
        }
        window.dispatchEvent(new CustomEvent("bettershape-terminal-open", { detail: { open: next } }));
    }, []);

    const startDockResize = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        draggingRef.current = true;
        setResizing(true);
        document.body.style.cursor = "row-resize";
        document.body.style.userSelect = "none";
        document.body.classList.add("resizing-vertical");
    }, []);

    useTerminalAiActionListener(cwdRef, persistOpen);
    useTerminalDockEvents({ open, visibleOpen, suppressed, persistOpen });
    useTerminalDockResizeAndRefit({
        draggingRef,
        heightRef,
        height,
        suppressed,
        visibleOpen,
        setHeight,
        setResizing,
    });

    if (!mounted) return null;

    const chrome = deriveTerminalDockChrome(visibleOpen, height, resizing || suppressed);
    const bodyClass = resizing ? "min-h-0 flex-1 overflow-hidden pointer-events-none" : "min-h-0 flex-1 overflow-hidden";

    return (
        <div
            data-terminal-dock=""
            data-terminal-open={String(visibleOpen)}
            className={cn(
                "relative z-20 shrink-0 overflow-hidden",
                "transition-[height,margin] duration-[var(--spring-panel-dur)] ease-[var(--spring-panel)] motion-reduce:transition-none",
                chrome.visibilityClass,
                chrome.transitionGuard,
            )}
            style={{ height: chrome.shellHeight }}
            aria-hidden={!visibleOpen}
            inert={!visibleOpen}
        >
            <div className="relative flex h-full flex-col overflow-hidden rounded-xl squircle-2xl border border-border bg-panel px-2 pb-2">
                <TerminalDockResizeHandle
                    visibleOpen={visibleOpen}
                    onStartResize={startDockResize}
                />
                <div className={bodyClass}>
                    <Suspense fallback={<div className="h-full w-full bg-panel" />}>
                        <Terminal terminalOnly isOpen={visibleOpen} onClose={() => persistOpen(false)} />
                    </Suspense>
                </div>
            </div>
        </div>
    );
};
