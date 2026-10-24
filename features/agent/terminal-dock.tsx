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

export function TerminalDock({ suppressed = false }: { suppressed?: boolean } = {}) {
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
    const dragging = useRef(false);
    const visibleOpen = open && !suppressed;

    const hydrated = useIsMounted();
    const [restoredPreferences, setRestoredPreferences] = useState(false);
    if (hydrated && !restoredPreferences) {
        setRestoredPreferences(true);
        try {
            const h = Number(localStorage.getItem(HEIGHT_KEY));
            if (h >= MIN_H && h <= 800) {
                setHeight(h);
            }
            const wasOpen = localStorage.getItem(OPEN_KEY) === "true";
            setOpen(wasOpen);
            if (wasOpen) setMounted(true);
        } catch {
            /* ignore */
        }

    }

    const persistOpen = useCallback((next: boolean) => {
        if (!next) {
            dragging.current = false;
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
        void import("@tauri-apps/api/event")
            .then(({ listen }) =>
                listen<{ type: string; command?: string; sessionId?: number }>(
                    "bettershape-terminal-ai-action",
                    (event) => {
                        if (cancelled) return;
                        if (event.payload.type !== "start" || event.payload.sessionId == null) return;
                        const cwd = cwdRef.current || "global";
                        const title =
                            (event.payload.command || "Agent").replace(/\s+/g, " ").trim().slice(0, 48) ||
                            "Agent";
                        registerBoundTerminalTab({
                            title,
                            cwd,
                            shell: "ai",
                            boundPtyId: event.payload.sessionId,
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
    }, [persistOpen]);

    useEffect(() => {
        const onToggle = (e: Event) => {
            const detail = (e as CustomEvent<{ id?: string; value?: boolean }>).detail;
            const id = detail?.id;
            if (id !== "panel" && id !== "terminal") return;
            if (detail?.value === false) persistOpen(false);
            else if (detail?.value === true) persistOpen(true);
            else persistOpen(!visibleOpen);
        };
        const onOpen = () => persistOpen(true);
        const onShortcut = (e: Event) => {
            const action = (e as CustomEvent<{ action?: string }>).detail?.action;
            if (action === "open" || action === "toggle" || !action) persistOpen(true);
        };
        const onTab = (e: Event) => {
            const tabId = (e as CustomEvent<string>).detail?.toLowerCase();
            if (tabId === "terminal") persistOpen(true);
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
        if (!suppressed || !dragging.current) return;
        dragging.current = false;
        setResizing(false);
        clearBodyResize();
    }, [suppressed]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (suppressed) return;
            const t = e.target as HTMLElement | null;
            if (t?.closest("textarea, input, [contenteditable='true']")) return;
            if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
            if (e.key.toLowerCase() !== "j") return;
            e.preventDefault();
            persistOpen(!open);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, persistOpen, suppressed]);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!dragging.current) return;
            const max = Math.floor(window.innerHeight * 0.55);
            const next = Math.min(max, Math.max(MIN_H, window.innerHeight - e.clientY - 8));
            heightRef.current = next;
            setHeight(next);
        };
        const onUp = () => {
            dragging.current = false;
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
    }, []);

    useEffect(() => {
        if (!visibleOpen) return;
        const t = window.setTimeout(() => {
            void import("@/features/terminal/ui/terminal").then((m) => {
                void m.refitAllTerminals();
            }).catch(() => {
                /* ignore */
            });
        }, 40);
        return () => window.clearTimeout(t);
    }, [visibleOpen, height]);

    if (!mounted) return null;

    return (
        <div
            data-terminal-dock=""
            data-terminal-open={visibleOpen ? "true" : "false"}
            className={cn(
                "relative z-20 shrink-0 overflow-hidden",
                "transition-[height,margin] duration-[var(--spring-panel-dur)] ease-[var(--spring-panel)] motion-reduce:transition-none",
                visibleOpen ? "m-3 visible" : "pointer-events-none invisible m-0",
                (resizing || suppressed) && "transition-none",
            )}
            style={{ height: visibleOpen ? height + 10 : 0 }}
            aria-hidden={!visibleOpen}
            inert={!visibleOpen}
        >
            <div
                className="relative flex h-full flex-col overflow-hidden rounded-xl squircle-2xl border border-border bg-panel px-2 pb-2"
            >
                {visibleOpen ? (
                    <div
                        role="separator"
                        aria-orientation="horizontal"
                        aria-label="Resize terminal"
                        className="group absolute inset-x-0 top-0 z-10 h-2 cursor-row-resize"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            dragging.current = true;
                            setResizing(true);
                            document.body.style.cursor = "row-resize";
                            document.body.style.userSelect = "none";
                            document.body.classList.add("resizing-vertical");
                        }}
                    />
                ) : null}
                <div className={cn("min-h-0 flex-1 overflow-hidden", resizing && "pointer-events-none")}>
                    <Suspense fallback={<div className="h-full w-full bg-panel" />}>
                        <Terminal terminalOnly isOpen={visibleOpen} onClose={() => persistOpen(false)} />
                    </Suspense>
                </div>
            </div>
        </div>
    );
}
