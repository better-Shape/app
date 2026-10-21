"use client";

import { TextFontSize20Regular } from "@fluentui/react-icons/headless/svg/text-font-size";


import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import { commands } from "@/lib/backend";
import { useProjectState } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { notify } from "@/features/notifications";
import { acceptsDesignMessage, authorizeDesignPreview, isCurrentDesignAuthorization, scopeDesignBridge, type DesignAuthorization } from "./authorization";
import {
    DESIGN_BRIDGE_SCRIPT,
    type DesignElementSnapshot,
} from "./bridge";
import { patchJsx } from "./jsx-source";
import { isUserSourcePath } from "./library";

type InspectionSelection = {
    element: DesignElementSnapshot;
    projectPath: string;
    authorization: DesignAuthorization;
    assertPersistAuthorized: () => void;
};
type PendingStyles = { selection: InspectionSelection; styles: Record<string, string> };

type Tab = "radius" | "padding" | "gap";

function parsePx(value: string | undefined): number {
    if (!value) return 0;
    const first = value.split(/\s+/)[0] ?? value;
    const n = Number.parseFloat(first);
    return Number.isFinite(n) ? Math.round(n) : 0;
}

function joinProjectPath(root: string, relative: string) {
    const separator = root.includes("\\") ? "\\" : "/";
    return `${root.replace(/(?<![/\\])[/\\]+$/, "")}${separator}${relative.replace(/[/\\]/g, separator)}`;
}

function IcoPath({ d }: { d: string }) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d={d} />
        </svg>
    );
}

export function DesignInspectOverlay({
    iframeRef,
    enabled,
    onToggle,
}: {
    iframeRef: React.RefObject<HTMLIFrameElement | null>;
    enabled: boolean;
    onToggle: () => void;
}) {
    const { project_path } = useProjectState();
    const authorizationRef = useRef<DesignAuthorization | null>(null);
    const inspectionTarget = useRef<{ window: Window; origin: string } | null>(null);
    const stopInspection = useCallback(() => {
        const target = inspectionTarget.current;
        inspectionTarget.current = null;
        // Revocation blocks edits, but must still release the frame's click capture.
        target?.window.postMessage({ type: "bettershape-design-set-mode", mode: "normal" }, target.origin);
    }, []);
    const activated = useRef(false);
    const projectPathRef = useRef(project_path ?? "");
    useLayoutEffect(() => { projectPathRef.current = project_path ?? ""; }, [project_path]);
    const selectAuthorizedFrame = useCallback((authorization: DesignAuthorization | null) => {
        if (!isCurrentDesignAuthorization(authorization, projectPathRef.current)) return;
        const target = iframeRef.current?.contentWindow;
        if (!target) return;
        const previous = inspectionTarget.current;
        if (previous && (previous.window !== target || previous.origin !== authorization.origin)) stopInspection();
        inspectionTarget.current = { window: target, origin: authorization.origin };
        target.postMessage(
            { type: "bettershape-design-set-mode", mode: "select", projectRoot: projectPathRef.current },
            authorization.origin,
        );
    }, [iframeRef, stopInspection]);
    const [selection, setSelection] = useState<InspectionSelection | null>(null);
    const selected = selection?.element ?? null;
    const documentEpoch = useRef(0);
    const [frameSize, setFrameSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
    const [tab, setTab] = useState<Tab>("radius");
    const [radius, setRadius] = useState(8);
    const [padding, setPadding] = useState(12);
    const [gap, setGap] = useState(8);
    const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const pendingStyles = useRef<PendingStyles | null>(null);
    const persistQueue = useRef(Promise.resolve());
    const flushStyles = useCallback(() => {
        if (persistTimer.current) clearTimeout(persistTimer.current);
        persistTimer.current = null;
        const pending = pendingStyles.current;
        pendingStyles.current = null;
        if (!pending) return;
        const { selection: owner, styles } = pending;
        persistQueue.current = persistQueue.current.then(() => persistStyles(
            owner.projectPath, owner.element, styles, owner.assertPersistAuthorized,
        ));
    }, []);

    // Turning inspection off stops admission, not an already accepted edit.
    // Project changes, unmounts and document loads still revoke pending writes.
    useLayoutEffect(() => {
        const frame = iframeRef.current;
        const onLoad = () => { documentEpoch.current += 1; setSelection(null); };
        frame?.addEventListener("load", onLoad);
        return () => frame?.removeEventListener("load", onLoad);
    });
    useLayoutEffect(() => () => {
        documentEpoch.current += 1;
        if (persistTimer.current) clearTimeout(persistTimer.current);
        pendingStyles.current = null;
        stopInspection();
        authorizationRef.current = null;
    }, [project_path, iframeRef, stopInspection]);

    // Turning design mode off clears the selection (adjusting state during render, no effect).
    const [seenEnabled, setSeenEnabled] = useState(enabled);
    if (enabled !== seenEnabled) {
        setSeenEnabled(enabled);
        if (!enabled) setSelection(null);
    }

    useEffect(() => {
        if (!enabled) {
            flushStyles();
            stopInspection();
            activated.current = false;
            authorizationRef.current = null;
            return;
        }
        // Only explicit activation grants access. A project switch or a frame
        // navigation must not silently authorize an unrelated localhost page.
        if (!activated.current) {
            activated.current = true;
            authorizationRef.current = authorizeDesignPreview(projectPathRef.current, iframeRef.current?.src ?? "");
        }
        const authorization = authorizationRef.current;
        if (!authorization || !isCurrentDesignAuthorization(authorization, projectPathRef.current)) {
            stopInspection();
            authorizationRef.current = null;
            setSelection(null);
            return;
        }
        let cancelled = false;
        void commands.registerDesignBridge(scopeDesignBridge(DESIGN_BRIDGE_SCRIPT, authorization)).then(() => {
            if (cancelled || authorizationRef.current !== authorization || !isCurrentDesignAuthorization(authorization, projectPathRef.current)) return;
            selectAuthorizedFrame(authorization);
        }).catch(() => {
            if (!cancelled && authorizationRef.current === authorization) {
                // A failed (re-)registration means no bridge is answering, but the frame may
                // still be armed from the previous activation: release its click capture
                // before dropping authority, or the canvas keeps swallowing clicks while the
                // UI reports design mode off.
                stopInspection();
                authorizationRef.current = null;
                setSelection(null);
                notify.error("Could not start design inspection");
            }
        });
        return () => { cancelled = true; };
    }, [enabled, flushStyles, iframeRef, project_path, selectAuthorizedFrame, stopInspection]);

    useEffect(() => {
        if (!enabled) return;
        const onMessage = (event: MessageEvent) => {
            // A selection is about to be written to disk by `apply`, so it must come
            // from the loopback canvas frame and nowhere else.
            if (!acceptsDesignMessage(event, iframeRef.current, authorizationRef.current, projectPathRef.current)) return;
            const data = event.data;
            if (!data || typeof data !== "object") return;
            if (data.type === "bettershape-design-ready") {
                selectAuthorizedFrame(authorizationRef.current);
                return;
            }
            if (data.type !== "bettershape-design-selection") return;
            const el = data.element as DesignElementSnapshot | null;
            const authorization = authorizationRef.current;
            const ownerFrame = iframeRef.current;
            const projectPath = projectPathRef.current;
            const epoch = documentEpoch.current;
            if (!el || !authorization || !ownerFrame) { setSelection(null); return; }
            const assertPersistAuthorized = () => {
                if (iframeRef.current !== ownerFrame || documentEpoch.current !== epoch
                    || !isCurrentDesignAuthorization(authorization, projectPathRef.current)) {
                    throw new Error("The preview changed before the design edit could be saved.");
                }
            };
            setSelection({ element: el, authorization, projectPath, assertPersistAuthorized });
            // Remember the frame size at selection time, so the bar can be kept inside it.
            const frame = iframeRef.current;
            setFrameSize({ w: frame?.clientWidth ?? 0, h: frame?.clientHeight ?? 0 });
            if (el?.styles) {
                setRadius(parsePx(el.styles.borderRadius || el.styles.borderTopLeftRadius));
                setPadding(parsePx(el.styles.padding || el.styles.paddingTop));
                setGap(parsePx(el.styles.gap || el.styles.rowGap));
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [enabled, iframeRef, project_path, selectAuthorizedFrame]);

    const apply = useCallback(
        (styles: Record<string, string>) => {
            if (!selection || authorizationRef.current !== selection.authorization) return;
            try { selection.assertPersistAuthorized(); } catch { return; }
            const key = selection.element.key;
            if (!key) return;
            iframeRef.current?.contentWindow?.postMessage(
                { type: "bettershape-design-apply-preview", styles, key },
                selection.authorization.origin,
            );
            if (pendingStyles.current && pendingStyles.current.selection !== selection) flushStyles();
            pendingStyles.current = {
                selection,
                styles: { ...pendingStyles.current?.styles, ...styles },
            };
            if (persistTimer.current) clearTimeout(persistTimer.current);
            persistTimer.current = setTimeout(flushStyles, 420);
        },
        [flushStyles, iframeRef, selection],
    );

    if (!enabled || !selected) return null;

    // A selection only arrives from the iframe, so its rect is already frame-relative.
    const rect = selected.rect;
    const BAR_W = 320;
    const BAR_H = 44;
    const EDGE = 8;
    // Keep the bar inside the frame: clamp on both sides, and flip above the element when
    // there is no room below it. A zero frame size (not measured yet) skips the clamp.
    const maxLeft = frameSize.w > 0 ? frameSize.w - BAR_W - EDGE : Infinity;
    const left = Math.min(Math.max(EDGE, rect.x + rect.width / 2 - BAR_W / 2), maxLeft);
    const belowTop = rect.y + rect.height + EDGE;
    const fitsBelow = frameSize.h <= 0 || belowTop + BAR_H <= frameSize.h - EDGE;
    const top = fitsBelow ? belowTop : Math.max(EDGE, rect.y - BAR_H - EDGE);

    return (
        <div
            className="pointer-events-auto absolute z-20"
            style={{ top, left, width: "min(340px, calc(100% - 16px))" }}
        >
            <div className="flex items-center gap-1 rounded-full border border-border-subtle bg-surface-1 px-1.5 py-1 shadow-[0_8px_28px_rgba(0,0,0,0.18)]">
                <button
                    type="button"
                    onClick={onToggle}
                    className="mr-0.5 flex size-7 items-center justify-center rounded-full text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-primary"
                    aria-label="Exit design mode"
                >
                    ←
                </button>
                <TabBtn active={tab === "radius"} onClick={() => setTab("radius")} label="Radius">
                    <IcoPath d="M4 20V10a6 6 0 0 1 6-6h10" />
                </TabBtn>
                <TabBtn active={tab === "padding"} onClick={() => setTab("padding")} label="Padding">
                    <Icon icon={TextFontSize20Regular} />
                </TabBtn>
                <TabBtn active={tab === "gap"} onClick={() => setTab("gap")} label="Gap">
                    <IcoPath d="M8 6v12M16 6v12" />
                </TabBtn>
                <div className="mx-1 h-4 w-px bg-border-subtle" />
                <input
                    type="range"
                    min={0}
                    max={tab === "padding" ? 48 : 32}
                    value={tab === "radius" ? radius : tab === "padding" ? padding : gap}
                    onChange={(e) => {
                        const n = Number(e.target.value);
                        if (tab === "radius") {
                            setRadius(n);
                            apply({ borderRadius: `${n}px` });
                        } else if (tab === "padding") {
                            setPadding(n);
                            apply({ padding: `${n}px` });
                        } else {
                            setGap(n);
                            apply({ gap: `${n}px` });
                        }
                    }}
                    className="h-1 w-24 accent-[var(--accent)]"
                />
            </div>
        </div>
    );
}

function TabBtn({
    active,
    onClick,
    label,
    children,
}: {
    active: boolean;
    onClick: () => void;
    label: string;
    children: React.ReactNode;
}) {
    return (
        <Button
            type="button"
            variant={active ? "secondary" : "ghost"}
            size="sm"
            className={cn("h-7 gap-1 rounded-full px-2.5 text-xs", active && "bg-surface-3")}
            onClick={onClick}
        >
            {children}
            {label}
        </Button>
    );
}

async function persistStyles(
    root: string | null | undefined,
    element: DesignElementSnapshot | null,
    styles: Record<string, string>,
    assertAuthorized: () => void,
) {
    try {
        assertAuthorized();
        if (!root || !element?.source?.fileName || !isUserSourcePath(element.source.fileName)) {
            throw new Error("Could not map this element to an editable project source file.");
        }
        const abs = joinProjectPath(root, element.source.fileName);
        const before = await commands.readFileFromDisk(abs);
        const after = patchJsx(
            before,
            {
                tag: element.tag,
                classes: element.classes,
                text: element.text || null,
                line: element.source.lineNumber,
                column: element.source.columnNumber,
            },
            { styles },
        );
        if (after === before) return;
        assertAuthorized();
        await commands.saveFile(abs, after);
        commands.primeFileCache(abs, after);
    } catch {
        notify.error("Could not save design changes. Select the element again and retry.");
    }
}
