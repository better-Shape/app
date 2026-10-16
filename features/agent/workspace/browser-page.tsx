"use client";

import type { RefObject } from "react";
import { Globe20Regular } from "@fluentui/react-icons/headless/svg/globe";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { BrowseStage } from "@/features/chat/ui/blocks/browse-frame";
import type { BrowseFrame } from "@/features/agent/browser/session";
import { cn } from "@/lib/utils";
import type { PageTab } from "./browser-storage";
import type { HoverTarget, ToolsState } from "./browser-hooks";
import { NewTabPage } from "./browser-new-tab";

/**
 * The frame the page renders in.
 *
 * `allow-same-origin` is deliberate and is what makes the host script's origin check
 * meaningful, so the sandbox list is written out rather than an empty sandbox with the
 * features the page needs added back to it.
 */
const PageFrame = ({
    frameRef,
    active,
    hidden,
}: {
    frameRef: RefObject<HTMLIFrameElement | null>;
    active: PageTab | null;
    hidden: boolean;
}) => (
    <iframe
        ref={frameRef}
        name="bettershape-browser"
        title={active?.title || "Browser"}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
        className={cn("absolute inset-0 h-full w-full border-0 bg-panel", hidden ? "hidden" : "block")}
    />
);

/** The agent's own browser, which is a streamed image rather than a frame. */
const AgentStage = ({ frame }: { frame: BrowseFrame }) => (
    <div className="relative z-[1] flex h-full min-h-0 flex-col bg-panel">
        {frame.image ? (
            <BrowseStage frame={frame} interactive className="min-h-0 flex-1" />
        ) : (
            <div className="flex flex-1 items-center justify-center text-xs text-text-muted">
                {frame.status === "error" ? frame.error : "Opening…"}
            </div>
        )}
        {frame.console.length ? (
            <pre className="max-h-28 shrink-0 overflow-auto border-t border-border-subtle bg-surface-1 p-2 font-mono text-2xs text-text-secondary">
                {frame.console.join("\n")}
            </pre>
        ) : null}
    </div>
);

/** The outline over the element under the pointer while the user is picking one. */
const PickOutline = ({ hover }: { hover: HoverTarget }) => (
    <div
        className="pointer-events-none absolute z-10"
        style={{
            left: `${hover.rect.x}%`,
            top: `${hover.rect.y}%`,
            width: `${hover.rect.w}%`,
            height: `${hover.rect.h}%`,
        }}
    >
        <div className="h-full w-full rounded-sm border border-accent bg-accent/15" />
        <span className="absolute left-0 top-0 -translate-y-full rounded-md bg-accent px-1.5 py-0.5 font-mono text-2xs text-white">
            {hover.label}
        </span>
    </div>
);

/**
 * The page that could not be shown, with the two things the user can do about it.
 *
 * The reason is git's or the engine's own words rather than a status code, and the retry is
 * first because it is the one that works when the cause was transient.
 */
const PageError = ({
    reason,
    onReload,
    onOpenExternally,
}: {
    reason: string;
    onReload: () => void;
    onOpenExternally: () => void;
}) => (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-panel px-6 text-center">
        <Icon icon={Globe20Regular} className="text-text-muted" />
        <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text-primary">This page can&apos;t be shown</span>
            <span className="max-w-md text-xs text-text-secondary">{reason}</span>
        </div>
        <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onReload}>
                Try again
            </Button>
            <Button variant="secondary" size="sm" onClick={onOpenExternally}>
                Open externally
            </Button>
        </div>
    </div>
);

/** Renders the agent's stream when it is the view on screen. */
const AgentStageFor = ({ show, frame }: { show: boolean; frame: BrowseFrame | null }) => {
    if (!show || !frame) return null;
    return <AgentStage frame={frame} />;
};

/** Renders the new tab page while neither a page nor the agent's stream is on screen. */
const NewTabFor = ({
    show,
    onOpen,
    onUseTool,
}: {
    show: boolean;
    onOpen: (url: string) => void;
    onUseTool?: (kind: "files" | "graph" | "prs") => void;
}) => {
    if (!show) return null;
    return <NewTabPage onOpen={onOpen} onUseTool={onUseTool} />;
};

/** Renders the pick outline once the pointer is over an element worth outlining. */
const PickOutlineFor = ({ show, hover }: { show: boolean; hover: HoverTarget | null }) => {
    if (!show || !hover) return null;
    return <PickOutline hover={hover} />;
};

/** Renders the failure notice, which is only there for a page that failed to load. */
const PageErrorFor = ({
    show,
    active,
    onReload,
    onOpenExternally,
}: {
    show: boolean;
    active: PageTab | null;
    onReload: () => void;
    onOpenExternally: () => void;
}) => {
    if (!show || !active?.error) return null;
    return (
        <PageError reason={active.error} onReload={onReload} onOpenExternally={onOpenExternally} />
    );
};

/** The URL the developer tools are served from, or null while they are closed. */
const toolsSource = (tools: ToolsState | null) => tools?.src ?? null;

/** The reason the developer tools did not open, or null when there is nothing to report. */
const toolsReason = (tools: ToolsState | null) => tools?.error ?? null;

/** Renders the developer tools panel, or the reason they are not available for this page. */
const DevtoolsPanel = ({
    show,
    src,
    error,
}: {
    show: boolean;
    src: string | null;
    error: string | null;
}) => {
    if (!show) return null;
    if (src) {
        return (
            <iframe
                name="bettershape-devtools"
                title="Developer tools"
                src={src}
                className="h-full w-[min(440px,46%)] shrink-0 border-l border-border-subtle bg-panel"
            />
        );
    }
    if (!error) return null;
    return (
        <div className="flex h-full w-[min(440px,46%)] shrink-0 items-center border-l border-border-subtle bg-panel px-4">
            <p className="text-xs text-text-secondary">{error}</p>
        </div>
    );
};

/**
 * The page area: the frame, whatever is drawn over it, and the developer tools beside it.
 *
 * The frame stays mounted while a new tab page or the agent's stream is on screen, because
 * unmounting it would drop the page's own state and reload it when the user comes back.
 */
export const PageArea = ({
    frameRef,
    showPage,
    showAgent,
    agentFrame,
    active,
    picking,
    hover,
    tools,
    onReload,
    onOpenExternally,
    onOpen,
    onUseTool,
}: {
    frameRef: RefObject<HTMLIFrameElement | null>;
    showPage: boolean;
    showAgent: boolean;
    agentFrame: BrowseFrame | null;
    active: PageTab | null;
    picking: boolean;
    hover: HoverTarget | null;
    tools: ToolsState | null;
    onReload: () => void;
    onOpenExternally: () => void;
    onOpen: (url: string) => void;
    onUseTool?: (kind: "files" | "graph" | "prs") => void;
}) => (
    <div className="flex min-h-0 flex-1 bg-panel">
        <div className="relative min-h-0 min-w-0 flex-1">
            <PageFrame frameRef={frameRef} active={active} hidden={!showPage} />
            <AgentStageFor show={showAgent} frame={agentFrame} />
            <NewTabFor show={!showAgent && !showPage} onOpen={onOpen} onUseTool={onUseTool} />
            <PickOutlineFor show={showPage && picking} hover={hover} />
            <PageErrorFor
                show={showPage}
                active={active}
                onReload={onReload}
                onOpenExternally={onOpenExternally}
            />
        </div>
        <DevtoolsPanel show={showPage} src={toolsSource(tools)} error={toolsReason(tools)} />
    </div>
);
