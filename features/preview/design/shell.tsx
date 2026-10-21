"use client";

import { Alert20Regular } from "@fluentui/react-icons/headless/svg/alert";
import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";


import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import { detectDevCommand } from "@/features/detection/lib/lib";
import {
    ensureBackgroundRun,
    getBackgroundRunCwd,
    getLastPreviewReadyUrl,
    sameProjectPath,
    subscribePreviewReady,
} from "@/features/terminal/background-run";
import { commands } from "@/lib/backend";
import { insertCssVariableInContent } from "@/lib/ui/css-variables";
import { invalidateGlobalsCssCache, updateGlobalsCssCache, resolveGlobalsCss } from "@/lib/ui/css-variables-loader";
import { cn } from "@/lib/utils";
import { discoverDesignPages, type DesignPage } from "../lib/discover-routes";
import {
    getPreviewCurrentUrl,
    showPreviewUrl,
    inferPreviewUrlFromPerformance,
    isLocalPreviewUrl,
    navigatePreview,
    previewReload,
    recordPreviewLocation,
    resetPreviewState,
    setPreviewUrlBar,
    usePreviewStore,
} from "../store";
import {
    DESIGN_BRIDGE_SCRIPT,
    type DesignElementSnapshot,
    type DesignLayerSnapshot,
} from "./bridge";
import { DEFAULT_DEVICE, type DesignDevice } from "./devices";
import { guessSourceFromChunkUrl, isUserSourcePath, isUtilityClass } from "./library";
import { locateJsx, patchHtmlOpening, patchJsx, reorderJsx, isSafeDomAttribute } from "./jsx-source";
import { DesignStylePanel } from "./panel";
import type { ComponentOptionPatch } from "./panel/options";
import { DesignThemeContext } from "./panel/tokens";
import { DragEdge } from "./resize";
import { DesignToolbar, createBrowserTab, faviconFromUrl, pushTabUrl, tabTitleFromUrl, type BrowserTab } from "./toolbar";
import { DesignSelectionPrompt } from "./selection-prompt";
import type { DesignToolMode } from "./bottom-toolbar";
import { acceptsDesignMessage, authorizeDesignPreview, isCurrentDesignAuthorization, designMessageOrigin, scopeDesignBridge, type DesignAuthorization } from "./authorization";

type AuthorizedSelection = { element: DesignElementSnapshot; assertAuthorized: () => void };

type SourceTarget = {
    file: string;
    tag: string;
    openingStart: number;
    openingEnd: number;
    nodeStart: number;
    nodeEnd: number;
    line: number;
    confidence: number;
};

function CanvasLoadBar() {
    return <div role="progressbar" aria-label="Loading preview" className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 bg-accent animate-pulse" />;
}

function joinProjectPath(root: string, relative: string) {
    const separator = root.includes("\\") ? "\\" : "/";
    return `${root.replace(/(?<![/\\])[/\\]+$/, "")}${separator}${relative.replace(/[/\\]/g, separator)}`;
}

let persistQueue: Promise<void> = Promise.resolve();

function enqueuePersist<T>(work: () => Promise<T>): Promise<T> {
    const run = persistQueue.then(work, work);
    persistQueue = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}

function concatBytes(...chunks: Uint8Array[]) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

function jpegToPdf(jpeg: Uint8Array, width: number, height: number) {
    const encoder = new TextEncoder();
    const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\n`;
    let body = encoder.encode("%PDF-1.4\n");
    const offsets: number[] = [];
    const push = (bytes: Uint8Array) => {
        offsets.push(body.length);
        body = concatBytes(body, bytes);
    };
    push(encoder.encode("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"));
    push(encoder.encode("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"));
    push(
        encoder.encode(
            `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >> endobj\n`,
        ),
    );
    push(encoder.encode(`4 0 obj << /Length ${content.length} >> stream\n${content}endstream\nendobj\n`));
    push(
        concatBytes(
            encoder.encode(
                `5 0 obj << /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >> stream\n`,
            ),
            jpeg,
            encoder.encode("\nendstream\nendobj\n"),
        ),
    );
    const xrefStart = body.length;
    let xref = `xref\n0 6\n0000000000 65535 f \n`;
    for (const offset of offsets) {
        xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    return concatBytes(
        body,
        encoder.encode(xref),
        encoder.encode(`trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`),
    );
}

function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Failed to decode export"));
        image.src = src;
    });
}

export function DesignStudio({
    onClose: _onClose,
    projectPath,
}: {
    onClose: () => void;
    projectPath: string;
}) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const authorizationRef = useRef<DesignAuthorization | null>(null);
    const projectPathRef = useRef(projectPath);
    useLayoutEffect(() => { projectPathRef.current = projectPath; }, [projectPath]);
    const { iframeSrc, reloadKey, urlBar } = usePreviewStore();
    const [bootRoot, setBootRoot] = useState(projectPath);
    const [designerRoot, setDesignerRoot] = useState(projectPath);
    const [, setFramework] = useState("");
    const [pages, setPages] = useState<DesignPage[]>([]);
    const [, setAssets] = useState<Array<{
        path: string;
        name: string;
        bytes: number;
        kind: "image" | "font" | "video" | "vector" | "style" | "component" | "code";
    }>>([]);
    const [, setLayers] = useState<DesignLayerSnapshot[]>([]);
    // Keep the originating grant with its snapshot; host-side clones must not
    // adopt a new grant merely because the server has since reconnected.
    const [selection, setSelectionState] = useState<AuthorizedSelection | null>(null);
    const selectionRevision = useRef(0);
    const [target, setTarget] = useState<SourceTarget | null>(null);
    const setSelection = useCallback((next: AuthorizedSelection | null) => {
        selectionRevision.current += 1;
        setSelectionState(next);
        setTarget(null);
    }, []);
    const selected = selection?.element ?? null;
    const selectedAuthorization = selection?.assertAuthorized;
    const updateSelected = useCallback((assertAuthorized: () => void, update: SetStateAction<DesignElementSnapshot | null>) => {
        setSelectionState(current => {
            if (current?.assertAuthorized !== assertAuthorized) return current;
            const element = typeof update === "function" ? update(current?.element ?? null) : update;
            return current && element ? { ...current, element } : null;
        });
    }, []);
    const documentEpoch = useRef(0);
    const [mappingError, setMappingError] = useState<string | null>(null);
    const [bootError, setBootError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [booting, setBooting] = useState(true);
    const [, setSaved] = useState(true);
    const [zoom, setZoom] = useState(100);
    const [toolMode, setToolMode] = useState<DesignToolMode>("normal");
    const [tabs, setTabs] = useState<BrowserTab[]>([]);
    const [activeTabId, setActiveTabId] = useState("tab-1");
    const [promptOpen, setPromptOpen] = useState(false);
    const [device, setDevice] = useState<DesignDevice>(DEFAULT_DEVICE);
    const [rightWidth, setRightWidth] = useState(300);
    const [themeTokens, setThemeTokens] = useState<Array<{ name: string; value: string }>>([]);
    const injectedBridge = useRef("");
    const toolModeRef = useRef(toolMode);
    const designerRootRef = useRef(designerRoot);
    useLayoutEffect(() => {
        toolModeRef.current = toolMode;
        designerRootRef.current = designerRoot;
    }, [toolMode, designerRoot]);
    useLayoutEffect(() => { authorizationRef.current = null; }, [projectPath, bootRoot]);

    const reportMappingError = useCallback((cause: unknown) => {
        setMappingError(cause instanceof Error ? cause.message : String(cause));
    }, []);
    const reportUnsavedPreviewEdit = useCallback((cause: unknown) => {
        const reason = cause instanceof Error ? cause.message : String(cause);
        setMappingError(`Preview changes were not saved. ${reason}`);
    }, []);
    const captureWriteAuthorization = useCallback(() => {
        const authorization = authorizationRef.current;
        const frame = iframeRef.current;
        const epoch = documentEpoch.current;
        const assertAuthorized = () => {
            if (!frame || iframeRef.current !== frame || documentEpoch.current !== epoch
                || authorizationRef.current !== authorization
                || projectPathRef.current !== projectPath || designerRootRef.current !== designerRoot
                || !isCurrentDesignAuthorization(authorization, designerRoot)) {
                throw new Error("The preview changed. Select the element again before editing its source.");
            }
        };
        assertAuthorized();
        return assertAuthorized;
    }, [designerRoot, projectPath]);
    const admitSelectionWrite = useCallback(() => {
        if (!selectedAuthorization) return null;
        try {
            selectedAuthorization();
            return selectedAuthorization;
        } catch (cause) {
            reportMappingError(cause);
            return null;
        }
    }, [reportMappingError, selectedAuthorization]);

    const [projectInputs, setProjectInputs] = useState<readonly unknown[] | null>(null);
    if (projectInputs === null || !Object.is(projectInputs[0], projectPath)) {
        setProjectInputs([projectPath]);
        setBootRoot(projectPath);
    }

    const currentUrl = getPreviewCurrentUrl() || iframeSrc || urlBar;
    const activePage = useMemo(() => {
        if (!currentUrl) return "/";
        try {
            return new URL(currentUrl).pathname || "/";
        } catch {
            return "/";
        }
    }, [currentUrl]);

    if (!tabs.length && (currentUrl || iframeSrc)) {
        const tab = createBrowserTab(currentUrl || iframeSrc || "", "tab-1");
        setTabs([tab]);
        setActiveTabId(tab.id);
    }

    const activeTabIdRef = useRef(activeTabId);
    useLayoutEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);

    const applyTabLocation = useCallback((raw: string, meta?: { title?: string; favicon?: string | null }) => {
        if (!raw || !isLocalPreviewUrl(raw)) return;
        recordPreviewLocation(raw);
        const id = activeTabIdRef.current;
        setTabs((prev) =>
            prev.map((tab) => {
                if (tab.id !== id) return tab;
                const next = pushTabUrl(tab, raw);
                return {
                    ...next,
                    title: meta?.title?.trim() || next.title || tabTitleFromUrl(raw),
                    favicon: meta?.favicon || next.favicon || faviconFromUrl(raw),
                };
            }),
        );
    }, []);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            // Only the canvas frame may report its own location; any other sender
            // (another frame in the app, or a page that opened one) is dropped.
            if (event.source !== iframeRef.current?.contentWindow) return;
            const data = event.data;
            if (!data || typeof data !== "object") return;
            if ((data as { type?: string }).type !== "bettershape-preview-navigate") return;
            const url = (data as { url?: string }).url;
            if (typeof url !== "string" || !url.trim()) return;
            applyTabLocation(url);
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [applyTabLocation]);

    useEffect(() => {
        if (typeof PerformanceObserver === "undefined") return;
        const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                const name = entry.name;
                if (!isLocalPreviewUrl(name)) continue;
                if (/\.(js|css|map|png|jpe?g|gif|svg|woff2?|ttf|ico)(\?|$)/i.test(name)) continue;
                const rt = entry as PerformanceResourceTiming;
                if (rt.initiatorType === "iframe" || rt.initiatorType === "other" || rt.initiatorType === "") {
                    applyTabLocation(name);
                }
            }
        });
        try {
            observer.observe({ type: "resource", buffered: true });
        } catch {
            try {
                observer.observe({ entryTypes: ["resource"] });
            } catch {
                /* unsupported */
            }
        }
        return () => observer.disconnect();
    }, [applyTabLocation]);

    const resolveElement = useCallback(
        async (element: DesignElementSnapshot) => {
            const files: string[] = [];
            const pushFile = (raw?: string | null) => {
                if (!raw) return;
                let fileName = raw;
                if (!isUserSourcePath(fileName)) {
                    const guessed = guessSourceFromChunkUrl(fileName, designerRoot);
                    if (!guessed) return;
                    fileName = guessed.fileName;
                }
                const normalized = fileName.replace(/\\/g, "/").replace(/^\.?\//, "");
                if (!normalized || !isUserSourcePath(normalized) || files.includes(normalized)) return;
                files.push(normalized);
            };
            pushFile(element.source?.fileName);
            const page = pages.find((item) => item.path === activePage);
            pushFile(page?.source);
            for (const item of pages) pushFile(item.source);

            const query = {
                tag: element.tag,
                classes: (element.classes || []).filter((name) => !isUtilityClass(name)).slice(0, 6),
                text: element.text || null,
                line: element.source?.lineNumber || null,
                column: element.source?.columnNumber || null,
            };
            if (!query.classes.length) query.classes = (element.classes || []).slice(0, 4);

            for (const file of files) {
                try {
                    const source = await commands.readFileFromDisk(joinProjectPath(designerRoot, file));
                    const hit = locateJsx(source, query);
                    if (!hit) continue;
                    const next = {
                        file,
                        tag: hit.tag,
                        openingStart: hit.openingStart,
                        openingEnd: hit.openingEnd,
                        nodeStart: hit.nodeStart,
                        nodeEnd: hit.nodeEnd,
                        line: hit.line,
                        confidence: 80,
                    };
                    return next;
                } catch {
                    /* try the next file */
                }
            }

            if (element.source?.fileName && isUserSourcePath(element.source.fileName)) {
                const matches = await commands.resolveDesignElement(designerRoot, {
                    tag: element.tag,
                    id: element.id,
                    classes: element.classes,
                    text: element.text || null,
                    sourceFile: element.source.fileName,
                    sourceLine: element.source.lineNumber,
                    sourceColumn: element.source.columnNumber,
                });
                const next = matches[0] ?? null;
                return next;
            }
            return null;
        },
        [activePage, designerRoot, pages],
    );

    const selectElement = useCallback((element: DesignElementSnapshot, assertAuthorized: () => void) => {
        setSelection({ element, assertAuthorized });
        const revision = selectionRevision.current;
        void resolveElement(element).then(resolved => {
            if (selectionRevision.current !== revision) return;
            assertAuthorized();
            setTarget(resolved);
        }).catch(cause => {
            if (selectionRevision.current === revision) reportMappingError(cause);
        });
    }, [reportMappingError, resolveElement, setSelection]);

    const resolveInstance = useCallback(
        async (element: DesignElementSnapshot) => {
            const tag = element.component?.tag;
            if (!tag) return null;
            const files: string[] = [];
            const pushFile = (raw?: string | null) => {
                if (!raw) return;
                let fileName = raw;
                if (!isUserSourcePath(fileName)) {
                    const guessed = guessSourceFromChunkUrl(fileName, designerRoot);
                    if (!guessed) return;
                    fileName = guessed.fileName;
                }
                const normalized = fileName.replace(/\\/g, "/").replace(/^\.?\//, "");
                if (!normalized || !isUserSourcePath(normalized) || files.includes(normalized)) return;
                files.push(normalized);
            };
            pushFile(element.component?.source?.fileName);
            const page = pages.find((item) => item.path === activePage);
            pushFile(page?.source);
            for (const item of pages) pushFile(item.source);
            const query = {
                tag,
                line: element.component?.source?.lineNumber || null,
                column: element.component?.source?.columnNumber || null,
            };
            for (const file of files) {
                try {
                    const source = await commands.readFileFromDisk(joinProjectPath(designerRoot, file));
                    const hit = locateJsx(source, query);
                    if (!hit || hit.tag !== tag) continue;
                    return {
                        file,
                        tag: hit.tag,
                        openingStart: hit.openingStart,
                        openingEnd: hit.openingEnd,
                        nodeStart: hit.nodeStart,
                        nodeEnd: hit.nodeEnd,
                        line: hit.line,
                        confidence: 90,
                    };
                } catch {
                    /* next file */
                }
            }
            return null;
        },
        [activePage, designerRoot, pages],
    );

    const persistJsx = useCallback(
        async (
            element: DesignElementSnapshot,
            patch: { styles?: Record<string, string>; text?: string | null; attributes?: Record<string, string> },
            assertAuthorized: () => void,
            opts?: { instance?: boolean },
        ) => {
            return enqueuePersist(async () => {
                assertAuthorized();
                const instance =
                    Boolean(opts?.instance) ||
                    Boolean(
                        patch.attributes &&
                            element.component &&
                            Object.keys(patch.attributes).some(
                                (name) => !isSafeDomAttribute(element.tag, name),
                            ),
                    );
                const resolved = instance
                    ? await resolveInstance(element)
                    : await resolveElement(element);
                if (!resolved) {
                    throw new Error("Could not find this element in the project source.");
                }
                if (!isUserSourcePath(resolved.file)) {
                    throw new Error("BetterShape will not edit third-party or generated files.");
                }
                const abs = joinProjectPath(designerRoot, resolved.file);
                if (resolved.file.replace(/\\/g, "/").toLowerCase().endsWith(".astro")) {
                    if (instance) {
                        throw new Error("Could not find this element in the project source.");
                    }
                    const before = await commands.readFileFromDisk(abs);
                    let after = before;
                    if (patch.styles && Object.keys(patch.styles).length) {
                        after = patchHtmlOpening(before, resolved.openingStart, resolved.openingEnd, patch.styles);
                    }
                    if (patch.text != null || patch.attributes) {
                        assertAuthorized();
                        await commands.applyDesignSourcePatch({
                            projectPath: designerRoot,
                            target: resolved,
                            text: patch.text,
                            attributes: patch.attributes,
                        });
                        commands.invalidateFileCache(abs);
                        return;
                    }
                    if (after === before) return;
                    assertAuthorized();
                    await commands.applyDesignSourcePatch({
                        projectPath: designerRoot,
                        target: resolved,
                        content: after,
                    });
                    commands.primeFileCache(abs, after);
                    return;
                }
                const before = await commands.readFileFromDisk(abs);
                const after = patchJsx(
                    before,
                    instance
                        ? {
                              tag: element.component?.tag || resolved.tag,
                              line: element.component?.source?.lineNumber || resolved.line,
                              column: element.component?.source?.columnNumber || null,
                          }
                        : {
                              tag: element.tag,
                              classes: element.classes,
                              text: element.text || null,
                              line: resolved.line || element.source?.lineNumber || null,
                              column: element.source?.columnNumber || null,
                          },
                    patch,
                );
                if (after === before) return;
                assertAuthorized();
                await commands.applyDesignSourcePatch({
                    projectPath: designerRoot,
                    target: resolved,
                    content: after,
                });
                commands.primeFileCache(abs, after);
            });
        },
        [designerRoot, resolveElement, resolveInstance],
    );

    /** Serialize structure mutations with every other whole-file edit, retaining the admitting grant. */
    const persistStructure = useCallback((
        element: DesignElementSnapshot,
        operation: "delete" | "duplicate",
        assertAuthorized: () => void,
    ) => enqueuePersist(async () => {
        assertAuthorized();
        const resolved = await resolveElement(element);
        if (!resolved) throw new Error("Could not map this element to a source file. Select it again, then retry.");
        assertAuthorized();
        await commands.applyDesignSourcePatch({ projectPath: designerRoot, target: resolved, operation });
        commands.invalidateFileCache(joinProjectPath(designerRoot, resolved.file));
        // No assertion after the patch: it is already committed to disk, so a grant revoked
        // while it was in flight cannot prevent it. Throwing here would report a failed
        // delete/duplicate for a change that exists, and the caller would skip its reload -
        // the checks that can prevent an unauthorized patch are the ones before the write.
    }), [designerRoot, resolveElement]);

    const persistReorder = useCallback(
        async (element: DesignElementSnapshot, before: DesignElementSnapshot | null, assertAuthorized: () => void) => {
            return enqueuePersist(async () => {
                assertAuthorized();
                const resolved = await resolveElement(element);
                if (!resolved) throw new Error("Could not find this element in the project source.");
                if (!isUserSourcePath(resolved.file)) {
                    throw new Error("BetterShape will not edit third-party or generated files.");
                }
                const abs = joinProjectPath(designerRoot, resolved.file);
                const source = await commands.readFileFromDisk(abs);
                const query = {
                    tag: element.tag,
                    classes: (element.classes || []).filter((name) => !isUtilityClass(name)).slice(0, 6),
                    text: element.text || null,
                    line: resolved.line || element.source?.lineNumber || null,
                    column: element.source?.columnNumber || null,
                };
                const beforeQuery = before
                    ? {
                          tag: before.tag,
                          classes: (before.classes || []).filter((name) => !isUtilityClass(name)).slice(0, 6),
                          text: before.text || null,
                          line: before.source?.lineNumber || null,
                          column: before.source?.columnNumber || null,
                      }
                    : null;
                const after = reorderJsx(source, query, beforeQuery);
                if (after === source) return;
                assertAuthorized();
                await commands.applyDesignSourcePatch({
                    projectPath: designerRoot,
                    target: resolved,
                    content: after,
                });
                commands.primeFileCache(abs, after);
            });
        },
        [designerRoot, resolveElement],
    );

    const [bootInputs, setBootInputs] = useState<readonly unknown[] | null>(null);
    if (bootInputs === null || !Object.is(bootInputs[0], bootRoot)) {
        setBootInputs([bootRoot]);
        setBooting(true);
        setReady(false);
        setBootError(null);
        setLayers([]);
        setSelectionState(null);
        setTarget(null);
        setThemeTokens([]);
    }

    useEffect(() => {
        let cancelled = false;
        let unsubscribeReady = () => {};
        let opened = false;
        let openedUrl: string | null = null;
        let startupFinished = false;
        const ownerAtBoot = projectPathRef.current;
        type Opening = { authorization: DesignAuthorization; url: string };
        let opening: Promise<boolean> | null = null;
        let openingRequest: Opening | null = null;
        let queuedOpening: Opening | null = null;
        authorizationRef.current = null;
        selectionRevision.current += 1;
        resetPreviewState();
        void (async () => {
            try {
                const info = await commands.inspectDesignProject(bootRoot);
                if (cancelled) return;
                setFramework(info.framework);
                setDesignerRoot(info.projectRoot);
                if (!info.supported) {
                    setBootError("Design mode supports React + Vite, Next.js, Astro, and Remix.");
                    setBooting(false);
                    return;
                }
                const [discovered, projectAssets] = await Promise.all([
                    discoverDesignPages(info.projectRoot),
                    commands.listDesignAssets(info.projectRoot),
                ]);
                if (cancelled) return;
                setPages(discovered);
                setAssets(projectAssets);
                const detected = await detectDevCommand(info.projectRoot);
                if (!detected) {
                    setBootError("No development command was found for this project.");
                    setBooting(false);
                    return;
                }
                const dev = detected;

                const openWhenReachable = (url: string): Promise<boolean> => {
                    if (cancelled || projectPathRef.current !== ownerAtBoot || !sameProjectPath(getBackgroundRunCwd() || "", info.projectRoot)) return Promise.resolve(false);
                    const authorization = authorizeDesignPreview(info.projectRoot, url);
                    if (!authorization) return Promise.resolve(false);
                    const targetUrl = new URL(url).href;
                    if (opening) {
                        // An in-flight open is about to replace what is on screen and has
                        // already reset readiness, so an already-open URL is queued rather
                        // than reported ready: the newest request must be the one that ends
                        // up displayed. Queued work collapses to this single slot.
                        const sameRequest = openingRequest?.url === targetUrl
                            && openingRequest.authorization.serviceId === authorization.serviceId
                            && openingRequest.authorization.origin === authorization.origin;
                        queuedOpening = sameRequest ? null : { authorization, url: targetUrl };
                        return opening;
                    }
                    if (opened && openedUrl === targetUrl && isCurrentDesignAuthorization(authorizationRef.current, info.projectRoot)) return Promise.resolve(true);
                    queuedOpening = { authorization, url: targetUrl };
                    // One worker and one replaceable slot: readiness bursts do not retain
                    // a promise chain or register every obsolete route in order.
                    opening = Promise.resolve().then(async () => {
                        try {
                            while (queuedOpening && !cancelled) {
                                const request: Opening = queuedOpening;
                                queuedOpening = null;
                                openingRequest = request;
                                if (projectPathRef.current !== ownerAtBoot || !isCurrentDesignAuthorization(request.authorization, info.projectRoot)) continue;
                                opened = false;
                                authorizationRef.current = null;
                                setReady(false);
                                setBooting(true);
                                setBootError(null);
                                setSelection(null);
                                setTarget(null);
                                setLayers([]);
                                setThemeTokens([]);
                                try {
                                    await commands.registerDesignBridge(scopeDesignBridge(DESIGN_BRIDGE_SCRIPT, request.authorization));
                                    if (cancelled || queuedOpening) continue;
                                    const reachable = await commands.probePreviewUrl(request.url);
                                    if (cancelled || queuedOpening || projectPathRef.current !== ownerAtBoot || !reachable
                                        || !isCurrentDesignAuthorization(request.authorization, info.projectRoot)) continue;
                                    authorizationRef.current = request.authorization;
                                    setBootError(null);
                                    opened = showPreviewUrl(request.url);
                                    openedUrl = opened ? request.url : null;
                                    if (!opened) authorizationRef.current = null;
                                } catch (cause) {
                                    if (!cancelled) setBootError(cause instanceof Error ? cause.message : "Could not connect to the project preview.");
                                }
                            }
                            return opened;
                        } finally {
                            // Release synchronously with the last queue check so an event
                            // cannot enqueue between worker completion and cleanup.
                            opening = null;
                            if (!cancelled && startupFinished && !opened && projectPathRef.current === ownerAtBoot
                                && isCurrentDesignAuthorization(openingRequest?.authorization ?? null, info.projectRoot)) {
                                setBooting(false);
                                setBootError(previous => previous ?? "Could not connect to the project preview.");
                            }
                            openingRequest = null;
                            queuedOpening = null;
                        }
                    });
                    return opening;
                };

                unsubscribeReady = subscribePreviewReady((url) => {
                    void openWhenReachable(url);
                });

                const runningHere =
                    Boolean(getBackgroundRunCwd())
                    && sameProjectPath(getBackgroundRunCwd()!, info.projectRoot);
                const existingUrl = runningHere ? getLastPreviewReadyUrl() : null;
                // Prefer the URL scraped from the terminal (actual bound port).
                if (existingUrl && (await openWhenReachable(existingUrl))) {
                    /* opened */
                } else {
                    await ensureBackgroundRun(dev.command, info.projectRoot);
                    for (let attempt = 0; attempt < 60 && !cancelled && !opened; attempt += 1) {
                        const announced = getLastPreviewReadyUrl();
                        if (announced && (await openWhenReachable(announced))) {
                            break;
                        }
                        await new Promise((resolve) => window.setTimeout(resolve, 500));
                    }
                }

                if (!cancelled && !opened) {
                    setBootError(`Could not start the preview at ${dev.urlHint}.`);
                    setBooting(false);
                }
            } catch (cause) {
                if (!cancelled) {
                    setBootError(cause instanceof Error ? cause.message : String(cause));
                    setBooting(false);
                }
            } finally {
                startupFinished = true;
            }
        })();
        return () => {
            cancelled = true;
            selectionRevision.current += 1;
            authorizationRef.current = null;
            unsubscribeReady();
        };
    }, [bootRoot, setSelection]);

    // Bridge registration only covers documents created afterwards, so every
    // registration in this shell happens before the preview document is loaded:
    // the open path registers first and then commits the URL with `reload: true`,
    // and a registration that replaces an earlier script reloads a live preview.
    useEffect(() => {
        if (!ready) return;
        const authorization = authorizationRef.current;
        if (!authorization || !isCurrentDesignAuthorization(authorization, designerRootRef.current)) return;
        if (injectedBridge.current === DESIGN_BRIDGE_SCRIPT) return;
        const first = injectedBridge.current === "";
        injectedBridge.current = DESIGN_BRIDGE_SCRIPT;
        void commands.registerDesignBridge(scopeDesignBridge(DESIGN_BRIDGE_SCRIPT, authorization)).then(() => {
            if (!first && authorizationRef.current === authorization) previewReload();
        }).catch((cause: unknown) => {
            if (authorizationRef.current === authorization) setBootError(cause instanceof Error ? cause.message : "Could not register the design bridge.");
        });
    }, [ready]);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (!acceptsDesignMessage(event, iframeRef.current, authorizationRef.current, designerRootRef.current)) return;
            if (!event.data || typeof event.data !== "object") return;
            let assertAuthorized: () => void;
            try { assertAuthorized = captureWriteAuthorization(); } catch { return; }
            const data = event.data as {
                type?: string;
                element?: DesignElementSnapshot;
                addToChat?: boolean;
                before?: DesignElementSnapshot | null;
                layers?: DesignLayerSnapshot[];
                styles?: Record<string, string>;
                text?: string;
                attributes?: Record<string, string>;
                themeTokens?: Array<{ name: string; value: string }>;
            };
            if (data.type === "bettershape-design-ready") {
                setReady(true);
                setBooting(false);
                if (Array.isArray(data.themeTokens)) setThemeTokens(data.themeTokens);
                iframeRef.current?.contentWindow?.postMessage(
                    { type: "bettershape-design-set-mode", mode: toolModeRef.current, projectRoot: designerRootRef.current },
                    designMessageOrigin(authorizationRef.current, designerRootRef.current),
                );
            } else if (data.type === "bettershape-design-tokens" && Array.isArray(data.themeTokens)) {
                setThemeTokens(data.themeTokens);
            } else if (data.type === "bettershape-design-tree" && Array.isArray(data.layers)) {
                setLayers(data.layers);
            } else if (data.type === "bettershape-design-selection") {
                if (data.element) {
                    selectElement(data.element, assertAuthorized);
                    setPromptOpen(false);
                    if (data.addToChat) {
                        const label = data.element.component?.name || data.element.component?.tag || data.element.tag;
                        window.dispatchEvent(
                            new CustomEvent("bettershape-composer-insert-mention", {
                                detail: { kind: "design", id: data.element.key, label },
                            }),
                        );
                        window.dispatchEvent(new Event("bettershape-chat-focus-input"));
                    }
                } else {
                    setSelection(null);
                    setTarget(null);
                    setPromptOpen(false);
                }
            } else if (data.type === "bettershape-design-commit-styles" && data.element && data.styles) {
                selectElement(data.element, assertAuthorized);
                void (async () => {
                    setSaved(false);
                    try {
                        await persistJsx(data.element!, { styles: data.styles }, assertAuthorized);
                        setMappingError(null);
                    } catch (cause) {
                        setMappingError(
                            cause instanceof Error ? cause.message : String(cause),
                        );
                    } finally {
                        setSaved(true);
                    }
                })();
            } else if (data.type === "bettershape-design-commit-text" && data.element) {
                void (async () => {
                    setSaved(false);
                    try {
                        await persistJsx(data.element!, { text: data.text ?? "" }, assertAuthorized);
                        setMappingError(null);
                    } catch (cause) {
                        setMappingError(
                            cause instanceof Error ? cause.message : String(cause),
                        );
                    } finally {
                        setSaved(true);
                    }
                })();
            } else if (data.type === "bettershape-design-commit-attr" && data.element && data.attributes) {
                void (async () => {
                    setSaved(false);
                    try {
                        await persistJsx(data.element!, { attributes: data.attributes }, assertAuthorized);
                        setMappingError(null);
                    } catch (cause) {
                        setMappingError(
                            cause instanceof Error ? cause.message : String(cause),
                        );
                    } finally {
                        setSaved(true);
                    }
                })();
            } else if (data.type === "bettershape-design-reorder" && data.element) {
                void (async () => {
                    setSaved(false);
                    try {
                        await persistReorder(data.element!, data.before ?? null, assertAuthorized);
                        setMappingError(null);
                    } catch (cause) {
                        setMappingError(
                            cause instanceof Error ? cause.message : String(cause),
                        );
                    } finally {
                        setSaved(true);
                    }
                })();
            } else if (
                (data.type === "bettershape-design-delete" || data.type === "bettershape-design-duplicate")
                && data.element
            ) {
                void (async () => {
                    setSaved(false);
                    try {
                        await persistStructure(data.element!, data.type === "bettershape-design-delete" ? "delete" : "duplicate", assertAuthorized);
                        setSelection(null);
                        setTarget(null);
                        setReady(false);
                        previewReload();
                    } catch (cause) {
                        reportMappingError(cause);
                    } finally {
                        setSaved(true);
                    }
                })();
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [captureWriteAuthorization, designerRoot, persistJsx, persistReorder, persistStructure, reportMappingError, selectElement, setSelection]);

    const previewStyles = useCallback((styles: Record<string, string>) => {
        const assertAuthorized = admitSelectionWrite();
        if (!assertAuthorized) return;
        const previewFrame = iframeRef.current;
        const frame = previewFrame?.contentWindow;
        const key = selected?.key;
        if (frame) {
            frame.postMessage(
                { type: "bettershape-design-apply-preview", styles, key },
                designMessageOrigin(authorizationRef.current, designerRootRef.current),
            );
        }
        updateSelected(assertAuthorized, (current) =>
            current ? { ...current, styles: { ...current.styles, ...styles } } : current,
        );
    }, [admitSelectionWrite, selected?.key, updateSelected]);

    useEffect(() => {
        iframeRef.current?.contentWindow?.postMessage(
            { type: "bettershape-design-set-mode", mode: toolMode, projectRoot: designerRoot },
            designMessageOrigin(authorizationRef.current, designerRootRef.current),
        );
    }, [toolMode, ready, iframeSrc, designerRoot]);

    useEffect(() => {
        if (!ready) return;
        iframeRef.current?.contentWindow?.postMessage(
            { type: "bettershape-design-config", projectRoot: designerRoot },
            designMessageOrigin(authorizationRef.current, designerRootRef.current),
        );
    }, [ready, designerRoot, iframeSrc]);

    const applyHistoryResult = useCallback(
        (result: { changed: boolean; file: string | null; content: string | null }) => {
            if (!result.changed) return;
            if (result.file && result.content != null) {
                commands.primeFileCache(result.file, result.content);
            }
            iframeRef.current?.contentWindow?.postMessage({ type: "bettershape-design-refresh" }, designMessageOrigin(authorizationRef.current, designerRootRef.current));
        },
        [],
    );

    const undoDesign = useCallback(() => {
        try {
            const assertAuthorized = captureWriteAuthorization();
            void enqueuePersist(async () => {
                assertAuthorized();
                // The step is committed once the command resolves, so a grant revoked while it
                // ran cannot reverse it. Asserting again would mark the undo failed and skip the
                // cache prime and preview refresh the committed history move still needs.
                const result = await commands.undoDesignSourcePatch();
                applyHistoryResult(result);
            }).catch(reportMappingError);
        } catch (cause) { reportMappingError(cause); }
    }, [applyHistoryResult, captureWriteAuthorization, reportMappingError]);

    const redoDesign = useCallback(() => {
        try {
            const assertAuthorized = captureWriteAuthorization();
            void enqueuePersist(async () => {
                assertAuthorized();
                // Same committed-step rule as undo: the history move is on disk, so its cache
                // prime and preview refresh must not be skipped by a later revocation.
                const result = await commands.redoDesignSourcePatch();
                applyHistoryResult(result);
            }).catch(reportMappingError);
        } catch (cause) { reportMappingError(cause); }
    }, [applyHistoryResult, captureWriteAuthorization, reportMappingError]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "d") {
                event.preventDefault();
                setToolMode((mode) => (mode === "normal" ? "select" : "normal"));
                return;
            }
            const key = event.key.toLowerCase();
            if (!(event.ctrlKey || event.metaKey) || (key !== "z" && key !== "y")) return;
            const target = event.target as HTMLElement | null;
            if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
            event.preventDefault();
            if (key === "y" || (key === "z" && event.shiftKey)) redoDesign();
            else undoDesign();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [redoDesign, undoDesign]);

    if (toolMode === "normal" && promptOpen) setPromptOpen(false);

    useEffect(() => {
        const onToggleInspect = () => {
            setToolMode((mode) => (mode === "normal" ? "select" : "normal"));
        };
        // Closing the folder / leaving design mode drops the inspector tool.
        const onExitDesign = () => {
            setToolMode("normal");
            setPromptOpen(false);
        };
        window.addEventListener("bettershape-toggle-browser-design-mode", onToggleInspect);
        window.addEventListener("bettershape-design-exit", onExitDesign);
        return () => {
            window.removeEventListener("bettershape-toggle-browser-design-mode", onToggleInspect);
            window.removeEventListener("bettershape-design-exit", onExitDesign);
        };
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "l") return;
            if (toolMode === "normal" || !selected) return;
            const targetEl = event.target as HTMLElement | null;
            if (targetEl && (targetEl.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(targetEl.tagName))) return;
            event.preventDefault();
            setPromptOpen(true);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [selected, toolMode]);

    const commitStyles = useCallback(
        async (styles: Record<string, string>) => {
            const current = selected;
            const assertAuthorized = admitSelectionWrite();
            if (!current || !assertAuthorized) return;
            // Keep the canvas updated even if source mapping fails.
            iframeRef.current?.contentWindow?.postMessage(
                { type: "bettershape-design-apply-preview", styles, key: current.key },
                designMessageOrigin(authorizationRef.current, designerRootRef.current),
            );
            setSaved(false);
            try {
                await persistJsx(current, { styles }, assertAuthorized);
                setMappingError(null);
            } catch (cause) {
                reportUnsavedPreviewEdit(cause);
            } finally {
                setSaved(true);
            }
        },
        [admitSelectionWrite, persistJsx, reportUnsavedPreviewEdit, selected],
    );

    const createToken = useCallback(
        async (name: string, value: string) => {
            try {
                const assertAuthorized = captureWriteAuthorization();
                await enqueuePersist(async () => {
                    assertAuthorized();
                    const resolved = await resolveGlobalsCss(designerRoot);
                    if (!resolved.path) {
                        throw new Error("Could not find a theme CSS file to store this token.");
                    }
                    const before = await commands.readFileFromDisk(resolved.path);
                    const next = insertCssVariableInContent(before, name, value);
                    assertAuthorized();
                    await commands.saveFile(resolved.path, next);
                    // The file is already saved. A replaced preview loses publication
                    // rights, not the successful write acknowledgement.
                    try { assertAuthorized(); } catch {
                        // A replaced preview owns its own bootstrap: it clears the
                        // token list when it opens and republishes what it reads, so
                        // the saved value is left to that fetch rather than pushed
                        // onto a token list that belongs to the old document.
                        invalidateGlobalsCssCache(designerRoot);
                        return;
                    }
                    updateGlobalsCssCache(designerRoot, resolved.path, next);
                    setThemeTokens((now) => {
                        const index = now.findIndex((token) => token.name === name);
                        if (index >= 0) {
                            return now.map((token, i) => (i === index ? { name, value } : token));
                        }
                        return [...now, { name, value }];
                    });
                });
            } catch (cause) { reportMappingError(cause); }
        },
        [captureWriteAuthorization, designerRoot, reportMappingError],
    );

    // Preserve failed text/attribute edits for retry, explicitly marked as unsaved
    // in the canvas banner rather than rolling back input typed by the user.
    const commitText = useCallback(
        async (text: string) => {
            const current = selected;
            const assertAuthorized = admitSelectionWrite();
            if (!current || !assertAuthorized) return;
            iframeRef.current?.contentWindow?.postMessage(
                { type: "bettershape-design-set-text", key: current.key, text, silent: true },
                designMessageOrigin(authorizationRef.current, designerRootRef.current),
            );
            updateSelected(assertAuthorized, { ...current, text });
            setSaved(false);
            try {
                await persistJsx(current, { text }, assertAuthorized);
                setMappingError(null);
            } catch (cause) {
                reportUnsavedPreviewEdit(cause);
            } finally {
                setSaved(true);
            }
        },
        [admitSelectionWrite, persistJsx, reportUnsavedPreviewEdit, selected, updateSelected],
    );

    const commitAttr = useCallback(
        async (name: string, value: string) => {
            const current = selected;
            const assertAuthorized = admitSelectionWrite();
            if (!current || !assertAuthorized) return;
            iframeRef.current?.contentWindow?.postMessage(
                { type: "bettershape-design-set-attr", key: current.key, name, value, silent: true },
                designMessageOrigin(authorizationRef.current, designerRootRef.current),
            );
            updateSelected(assertAuthorized, {
                ...current,
                attributes: { ...current.attributes, [name]: value },
            });
            setSaved(false);
            try {
                await persistJsx(current, { attributes: { [name]: value } }, assertAuthorized);
                setMappingError(null);
            } catch (cause) {
                reportUnsavedPreviewEdit(cause);
            } finally {
                setSaved(true);
            }
        },
        [admitSelectionWrite, persistJsx, reportUnsavedPreviewEdit, selected, updateSelected],
    );

    const patchComponent = useCallback((patch: ComponentOptionPatch) => {
        const previewFrame = iframeRef.current;
        const frame = previewFrame?.contentWindow;
        const current = selected;
        const assertAuthorized = admitSelectionWrite();
        if (!current?.component || !assertAuthorized) return;
        updateSelected(assertAuthorized, (now) => {
            if (!now?.component) return now;
            const properties = now.component.properties.map((property) => {
                if (patch.attr && property.attr !== patch.attr) return property;
                if (!patch.attr && property.kind === "text" && !property.attr && patch.field === "text") {
                    return { ...property, value: String(patch.value) };
                }
                if (patch.field === "attr" && property.attr === patch.attr) {
                    return { ...property, value: String(patch.value) };
                }
                return property;
            });
            return { ...now, component: { ...now.component, properties } };
        });
        if (patch.field === "text") {
            frame?.postMessage({ type: "bettershape-design-set-text", key: patch.key, text: String(patch.value), silent: true }, designMessageOrigin(authorizationRef.current, designerRootRef.current));
            void persistJsx(current, { text: String(patch.value) }, assertAuthorized, { instance: true })
                .then(() => setMappingError(null)).catch(reportUnsavedPreviewEdit);
            return;
        }
        if (patch.field === "attr" && patch.attr) {
            void persistJsx(current, { attributes: { [patch.attr]: String(patch.value) } }, assertAuthorized, { instance: true })
                .then(() => setMappingError(null)).catch(reportUnsavedPreviewEdit);
        }
    }, [admitSelectionWrite, persistJsx, reportUnsavedPreviewEdit, selected, updateSelected]);

    const openSource = useCallback(() => {
        if (!target) return;
        const fullPath = joinProjectPath(designerRoot, target.file);
        void commands.openFile(fullPath, target.file.split("/").pop() ?? target.file).then(_onClose);
    }, [designerRoot, _onClose, target]);

    const applyStructure = useCallback(
        async (operation: "delete" | "duplicate") => {
            const current = selected;
            const assertAuthorized = admitSelectionWrite();
            if (!current || !assertAuthorized) return;
            setSaved(false);
            try {
                await persistStructure(current, operation, assertAuthorized);
                setSelection(null);
                setTarget(null);
                setReady(false);
                previewReload();
            } catch (cause) {
                reportMappingError(cause);
            } finally {
                setSaved(true);
            }
        },
        [admitSelectionWrite, persistStructure, reportMappingError, selected, setSelection],
    );

    const exportSelection = useCallback(async (scale: number, format: string) => {
        const previewFrame = iframeRef.current;
        const frame = previewFrame?.contentWindow;
        const authorization = authorizationRef.current;
        if (!frame || !isCurrentDesignAuthorization(authorization, designerRootRef.current)) return;
        const isAuthorized = () => iframeRef.current === previewFrame
            && authorizationRef.current === authorization
            && isCurrentDesignAuthorization(authorization, designerRootRef.current);
        const requestId = crypto.randomUUID();
        const result = await new Promise<{ dataUrl?: string; width?: number; height?: number }>((resolve) => {
            const timer = window.setTimeout(() => {
                window.removeEventListener("message", onMessage);
                resolve({});
            }, 12_000);
            const onMessage = (event: MessageEvent) => {
                if (!isAuthorized() || event.source !== frame) return;
                if (!acceptsDesignMessage(event, previewFrame, authorization, designerRootRef.current)) return;
                if (!event.data || typeof event.data !== "object") return;
                const data = event.data as {
                    type?: string;
                    requestId?: string;
                    dataUrl?: string;
                    width?: number;
                    height?: number;
                };
                if (data.type !== "bettershape-design-export-result" || data.requestId !== requestId) return;
                window.clearTimeout(timer);
                window.removeEventListener("message", onMessage);
                resolve(data);
            };
            window.addEventListener("message", onMessage);
            frame.postMessage({ type: "bettershape-design-export", requestId, scale }, authorization.origin);
        });
        if (!result.dataUrl || !isAuthorized()) return;
        const image = await loadImage(result.dataUrl);
        if (!isAuthorized()) return;
        const canvas = document.createElement("canvas");
        canvas.width = result.width || image.width;
        canvas.height = result.height || image.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        if (format === "jpg" || format === "pdf") {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(image, 0, 0);
        const mime =
            format === "jpg"
                ? "image/jpeg"
                : format === "webp"
                  ? "image/webp"
                  : format === "avif"
                    ? "image/avif"
                    : "image/png";
        const blob =
            (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.92)))
            ?? (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png")));
        if (!blob) return;
        let bytes = new Uint8Array(await blob.arrayBuffer());
        let ext = format === "jpg" ? "jpg" : format === "avif" ? "avif" : format;
        if (format === "pdf") {
            const jpeg =
                (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92)));
            if (!jpeg) return;
            bytes = jpegToPdf(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height);
            ext = "pdf";
        } else if (blob.type === "image/png" && format !== "png") {
            ext = "png";
        }
        const { save } = await import("@tauri-apps/plugin-dialog");
        if (!isAuthorized()) return;
        const path = await save({
            defaultPath: `export.${ext}`,
            filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
        });
        if (typeof path !== "string" || !isAuthorized()) return;
        await commands.grantIpcPath(path).catch(() => undefined);
        if (!isAuthorized()) return;
        await commands.saveFileBytes(path, Array.from(bytes));
    }, []);

    const selectedKey = selected?.key ?? null;
    const canvasBusy = !bootError && (booting || !ready);

    const pickPackageJson = useCallback(async () => {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selectedPath = await open({
            multiple: false,
            defaultPath: bootRoot,
            filters: [{ name: "package.json", extensions: ["json"] }],
        });
        if (typeof selectedPath !== "string") return;
        const base = selectedPath.replace(/[/\\][^/\\]+$/, "");
        if (!base || base === selectedPath) {
            setBootError("Pick a package.json file for the web app you want to preview.");
            return;
        }
        const name = selectedPath.replace(/^.*[/\\]/, "").toLowerCase();
        if (name !== "package.json") {
            setBootError("Pick a package.json file for the web app you want to preview.");
            return;
        }
        setBootError(null);
        setBootRoot(base);
    }, [bootRoot]);

    const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

    return (
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-editor">
            <DesignToolbar
                tabs={tabs.length ? tabs : [createBrowserTab(currentUrl || "")]}
                activeTabId={activeTabId}
                onSelectTab={(id) => {
                    const tab = tabs.find((item) => item.id === id);
                    if (!tab) return;
                    setActiveTabId(id);
                    if (tab.url) void navigatePreview(tab.url, { replace: true });
                }}
                onCloseTab={(id) => {
                    setTabs((prev) => {
                        if (prev.length <= 1) return prev;
                        const next = prev.filter((tab) => tab.id !== id);
                        if (id === activeTabId) {
                            const fallback = next[next.length - 1];
                            if (fallback) {
                                setActiveTabId(fallback.id);
                                if (fallback.url) void navigatePreview(fallback.url, { replace: true });
                            }
                        }
                        return next;
                    });
                }}
                onNewTab={() => {
                    const url = currentUrl || iframeSrc || "http://localhost:3000";
                    const tab = createBrowserTab(url);
                    setTabs((prev) => [...prev, tab]);
                    setActiveTabId(tab.id);
                    if (url) void navigatePreview(url, { replace: true });
                }}
                url={urlBar || activeTab?.url || currentUrl || ""}
                onUrlChange={setPreviewUrlBar}
                onNavigate={(value) => {
                    void navigatePreview(value);
                    applyTabLocation(value);
                }}
                onReload={() => {
                    setReady(false);
                    previewReload();
                }}
                onBack={() => {
                    if (!activeTab || activeTab.index <= 0) return;
                    const index = activeTab.index - 1;
                    const url = activeTab.history[index];
                    if (!url) return;
                    setTabs((prev) =>
                        prev.map((tab) =>
                            tab.id === activeTab.id ? { ...tab, index, url } : tab,
                        ),
                    );
                    void navigatePreview(url, { replace: true });
                }}
                onForward={() => {
                    if (!activeTab || activeTab.index < 0 || activeTab.index >= activeTab.history.length - 1) return;
                    const index = activeTab.index + 1;
                    const url = activeTab.history[index];
                    if (!url) return;
                    setTabs((prev) =>
                        prev.map((tab) =>
                            tab.id === activeTab.id ? { ...tab, index, url } : tab,
                        ),
                    );
                    void navigatePreview(url, { replace: true });
                }}
                canBack={Boolean(activeTab && activeTab.index > 0)}
                canForward={Boolean(activeTab && activeTab.index >= 0 && activeTab.index < activeTab.history.length - 1)}
                onUndo={undoDesign}
                mode={toolMode}
                onModeChange={setToolMode}
            />
            <div className="flex min-h-0 flex-1">
                <main className={cn("relative min-h-0 min-w-0 flex-1 overflow-hidden", iframeSrc && "bg-white")}>
                    <div className="relative h-full overflow-hidden">
                            {iframeSrc ? (
                                <iframe
                                    key={`${activeTabId}::${iframeSrc}::${reloadKey}`}
                                    ref={iframeRef}
                                    src={iframeSrc}
                                    title="Browser"
                                    className="h-full w-full border-0 bg-white"
                                    sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
                                    referrerPolicy="no-referrer"
                                    onLoad={() => {
                                        documentEpoch.current += 1;
                                        setSelection(null);
                                        setTarget(null);
                                        window.setTimeout(() => {
                                            const target = designMessageOrigin(authorizationRef.current, designerRootRef.current);
                                            const frame = iframeRef.current?.contentWindow;
                                            frame?.postMessage(
                                                {
                                                    type: "bettershape-design-set-mode",
                                                    mode: toolModeRef.current,
                                                    projectRoot: designerRootRef.current,
                                                },
                                                target,
                                            );
                                            frame?.postMessage({ type: "bettershape-design-refresh" }, target);
                                            try {
                                                const href = frame?.location?.href;
                                                if (href && href !== "about:blank") {
                                                    const iconLink = frame.document.querySelector('link[rel*="icon"]') as HTMLLinkElement | null;
                                                    applyTabLocation(href, {
                                                        title: frame.document.title?.trim(),
                                                        favicon: iconLink?.href || faviconFromUrl(href),
                                                    });
                                                }
                                            } catch {
                                                const inferred = inferPreviewUrlFromPerformance();
                                                if (inferred) applyTabLocation(inferred);
                                            }
                                        }, 80);
                                    }}
                                />
                            ) : null}
                            {canvasBusy ? <CanvasLoadBar /> : null}
                            {bootError ? (
                                <div className="absolute inset-x-0 top-0.5 z-20 flex items-center gap-2 border-b border-border bg-surface-4 px-3 py-2 text-sm text-text-secondary">
                                    <Icon icon={Alert20Regular} className="text-warning" />
                                    <span className="min-w-0 flex-1 truncate">{bootError}</span>
                                    <Button variant="ghost" size="sm" onClick={() => void pickPackageJson()}>
                                        Choose package.json
                                    </Button>
                                </div>
                            ) : null}
                            {selected && toolMode !== "normal" ? (
                                <DesignSelectionPrompt
                                    selected={selected}
                                    file={target?.file}
                                    open={promptOpen}
                                    onOpen={() => setPromptOpen(true)}
                                    onClose={() => setPromptOpen(false)}
                                />
                            ) : null}
                    {mappingError ? (
                        <div className="absolute left-1/2 top-3 z-30 flex max-w-[min(520px,80%)] -translate-x-1/2 items-center gap-2 rounded-lg border border-border-secondary bg-surface-4/95 px-3 py-2 text-sm text-text-secondary shadow-lg backdrop-blur">
                            <Icon icon={Alert20Regular} className="text-warning" />
                            <span className="min-w-0 flex-1">{mappingError}</span>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Dismiss"
                                onClick={() => setMappingError(null)}
                            >
                                <Icon icon={Dismiss20Regular} />
                            </Button>
                        </div>
                    ) : null}
                    </div>
                </main>
                {toolMode !== "normal" ? (
                <div className="relative h-full shrink-0 border-l border-border" style={{ width: rightWidth }}>
                        <DesignThemeContext.Provider
                            value={{
                                tokens: themeTokens,
                                onPick: (property, cssValue) => {
                                    previewStyles({ [property]: cssValue });
                                    void commitStyles({ [property]: cssValue });
                                },
                            }}
                        >
                        <DesignStylePanel
                            key={selectedKey ?? "empty"}
                            element={selected}
                            source={target ? { file: target.file, line: target.line } : null}
                            previewUrl={iframeSrc}
                            zoom={zoom}
                            onZoomChange={setZoom}
                            device={device}
                            onDeviceChange={setDevice}
                            onUndo={undoDesign}
                            onRedo={redoDesign}
                            onPreview={previewStyles}
                            onCommit={(styles: Record<string, string>) => void commitStyles(styles)}
                            onCommitText={(text) => void commitText(text)}
                            onCommitAttr={(name, value) => void commitAttr(name, value)}
                            onCreateToken={(name, value) => void createToken(name, value)}
                            onOpenSource={openSource}
                            onAlign={(alignment: "center" | "center-x" | "center-y") =>
                                iframeRef.current?.contentWindow?.postMessage(
                                    { type: "bettershape-design-align", alignment },
                                    designMessageOrigin(authorizationRef.current, designerRootRef.current),
                                )
                            }
                            onDuplicate={() => void applyStructure("duplicate")}
                            onDelete={() => void applyStructure("delete")}
                            onExport={exportSelection}
                            themeTokens={themeTokens}
                            onComponentPatch={patchComponent}
                            chrome={false}
                            className="h-full w-full"
                        />
                        </DesignThemeContext.Provider>
                        <DragEdge
                            side="left"
                            onDrag={(start, dx) => setRightWidth(Math.min(480, Math.max(240, start - dx)))}
                        />
                    </div>
                ) : null}
            </div>
        </div>
    );
}
