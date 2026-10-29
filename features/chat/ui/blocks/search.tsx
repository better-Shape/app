"use client";

import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { Globe20Regular } from "@fluentui/react-icons/headless/svg/globe";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Favicon } from "@/components/ui/favicon";
import { cn, createOccurrenceKeyer } from "@/lib/utils";
import { Collapse } from "./collapse";
import { hostnameOf } from "@/lib/ui/favicon";
import { splitActionLabel } from "./action-line";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { Tooltip } from "@/components/ui/tooltip";
import {
    parseWebResults,
    type WebSearchResultItem,
} from "@/lib/chat/transcript-search";
import {
    notifyTranscriptDisclosureToggle,
    useExpandForChatFind,
} from "../shell/find-bar";
import { GeneratingIndicator } from "./generating";

type WebSearchResult = WebSearchResultItem;

export const parseWebSearchHits = parseWebResults;

type Brand = {
    id: string;
    label: string;
    slug: string;
    color: string;
    invert?: boolean;
    posts?: boolean;
    test: RegExp;
};

const BRANDS: Brand[] = [
    { id: "reddit", label: "Reddit", slug: "reddit", color: "FF4500", posts: true, test: /(^|\.)reddit\.com|\breddit\b/i },
    { id: "x", label: "X", slug: "x", color: "000000", invert: true, posts: true, test: /(^|\.)(x|twitter)\.com|\bx\b|\btwitter\b/i },
    { id: "github", label: "GitHub", slug: "github", color: "181717", invert: true, test: /(^|\.)github\.com|\bgithub\b/i },
    { id: "linkedin", label: "LinkedIn", slug: "linkedin", color: "0A66C2", test: /(^|\.)linkedin\.com|\blinkedin\b/i },
    { id: "figma", label: "Figma", slug: "figma", color: "F24E1E", test: /(^|\.)figma\.com|\bfigma\b/i },
    { id: "notion", label: "Notion", slug: "notion", color: "000000", invert: true, test: /(^|\.)notion\.(so|com)|\bnotion\b/i },
    { id: "youtube", label: "YouTube", slug: "youtube", color: "FF0000", test: /(^|\.)(youtube\.com|youtu\.be)|\byoutube\b/i },
    { id: "stackoverflow", label: "Stack Overflow", slug: "stackoverflow", color: "F58025", test: /(^|\.)stackoverflow\.com/i },
    { id: "wikipedia", label: "Wikipedia", slug: "wikipedia", color: "000000", invert: true, test: /(^|\.)wikipedia\.org/i },
    { id: "hackernews", label: "Hacker News", slug: "ycombinator", color: "FF6600", posts: true, test: /(^|\.)news\.ycombinator\.com|\bhacker news\b/i },
];

/**
 * Module-level cache of CDN brand slugs that failed to load (e.g. offline/sandbox),
 * preventing broken `<img>` placeholders and repeated failed network requests.
 */
const failedBrandSlugs = new Set<string>();
const failedBrandListeners = new Set<(slug: string) => void>();
const hostMemo = new Map<string, string>();

/** Mark brand slug failed. */
const markBrandSlugFailed = (slug: string): void => {
    if (failedBrandSlugs.has(slug)) return;
    failedBrandSlugs.add(slug);
    for (const listener of failedBrandListeners) {
        listener(slug);
    }
};

/** Memoized hostname. */
const memoizedHostname = (url: string): string => {
    const key = url.trim();
    if (!key) return "";
    const cached = hostMemo.get(key);
    if (cached !== undefined) return cached;
    const computed = hostnameOf(key);
    if (hostMemo.size > 512) hostMemo.clear();
    hostMemo.set(key, computed);
    return computed;
};

function brandFromText(text: string): Brand | null {
    const value = text.trim();
    if (!value) return null;
    return BRANDS.find((brand) => brand.test.test(value)) ?? null;
}

/**
 * A result URL is whatever the search provider wrote after `URL: `, so it is
 * untrusted text, not a vetted link. Only `http:`/`https:` may become an href;
 * a `javascript:` URI would run in the app's own origin on click.
 */
function safeHref(url: string): string | null {
    try {
        const parsed = new URL(url.trim());
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
    } catch {
        return null;
    }
}

/** Brand for step. */
const brandForStep = (query: string, sources: WebSearchResult[]): Brand | null => {
    const hosts = sources.map((source) => memoizedHostname(source.url)).filter(Boolean);
    if (hosts.length > 0) {
        const matched = hosts.map((host) => brandFromText(host));
        const first = matched[0];
        if (first && matched.every((brand) => brand?.id === first.id)) return first;
        return null;
    }
    return brandFromText(query);
};

/** Renders the SiteMark UI component. */
const SiteMark = ({ url, brand, size = 14 }: { url?: string; brand?: Brand | null; size?: number }) => {
    const resolved = brand ?? (url ? brandFromText(memoizedHostname(url)) : null);
    const slug = resolved?.slug ?? null;
    const [failedSlug, setFailedSlug] = useState<string | null>(() =>
        slug && failedBrandSlugs.has(slug) ? slug : null,
    );
    const failed = Boolean(slug && (failedSlug === slug || failedBrandSlugs.has(slug)));

    useEffect(() => {
        if (!slug || failed) return undefined;
        const onSlugFailed = (nextFailedSlug: string) => {
            if (nextFailedSlug === slug) setFailedSlug(slug);
        };
        failedBrandListeners.add(onSlugFailed);
        return () => {
            failedBrandListeners.delete(onSlugFailed);
        };
    }, [slug, failed]);

    if (resolved && !failed) {
        return (
            <span className={cn("inline-flex shrink-0", resolved.invert && "dark:invert")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={`https://cdn.simpleicons.org/${resolved.slug}/${resolved.color}`}
                    alt=""
                    width={size}
                    height={size}
                    className="shrink-0 object-contain"
                    style={{ width: size, height: size }}
                    draggable={false}
                    onError={() => {
                        markBrandSlugFailed(resolved.slug);
                        setFailedSlug(resolved.slug);
                    }}
                />
            </span>
        );
    }
    if (url) return <Favicon url={url} size={size} />;
    return <Icon icon={Globe20Regular} className="shrink-0 text-text-muted" />;
};

/** Renders the SourceRow UI component. */
const SourceRow = React.memo(function SourceRow({ result }: { result: WebSearchResult }) {
    const host = memoizedHostname(result.url);
    const href = safeHref(result.url);
    const snippet = result.snippet?.replace(/\s+/g, " ").trim() || "";
    const className =
        "group/line flex min-w-0 flex-col gap-0.5 rounded-md px-1 -mx-1 py-0.5 transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)]";
    const body = (
        <>
            <span className="flex min-w-0 items-center gap-2">
                <span className="flex size-4 shrink-0 items-center justify-center">
                    <SiteMark url={result.url} size={14} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-text-secondary group-hover/line:text-text-primary">
                    {result.title || host || "Source"}
                </span>
                {host ? (
                    <span className="max-w-[42%] shrink-0 truncate text-xs text-text-muted">
                        {host}
                    </span>
                ) : null}
            </span>
            {snippet ? (
                <span className="pl-6 line-clamp-1 text-xs text-text-muted/80">
                    {snippet}
                </span>
            ) : null}
        </>
    );
    if (!href) return <div className={className}>{body}</div>;
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
            {body}
        </a>
    );
});

const MARK_CAP = 6;

/** Renders the SourceStack UI component. */
const SourceStack = ({ sources }: { sources: WebSearchResult[] }) => {
    const shown = sources.slice(0, MARK_CAP);
    const rest = sources.length - shown.length;
    const keyFor = createOccurrenceKeyer();
    return (
        <span className="inline-flex items-center">
            {shown.map((source, pos) => {
                const host = memoizedHostname(source.url);
                const href = safeHref(source.url);
                const mark = (
                    <span
                        className="relative flex size-4 items-center justify-center rounded-full bg-surface-2 ring-2 ring-panel transition-transform duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:transform-none hover:z-20 hover:-translate-y-0.5"
                        style={{ marginLeft: pos === 0 ? 0 : -6, zIndex: shown.length - pos }}
                    >
                        <SiteMark url={source.url} size={12} />
                    </span>
                );
                return (
                    <Tooltip key={keyFor(source.url || source.title)} content={host ? `${source.title} · ${host}` : source.title}>
                        {href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="relative">
                                {mark}
                            </a>
                        ) : (
                            <span className="relative">{mark}</span>
                        )}
                    </Tooltip>
                );
            })}
            {rest > 0 ? <span className="ml-1.5 text-xs tabular-nums text-text-muted">+{rest}</span> : null}
        </span>
    );
};

/** Renders the SourcesBranch UI component. */
const SourcesBranch = ({ sources }: { sources: WebSearchResult[] }) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(true);
    const collapseId = React.useId();

    useExpandForChatFind({
        enabled: !open,
        rootRef,
        getSearchText: () => sources.map((s) => `${s.title} ${s.url} ${s.snippet}`).join(" "),
        onExpand: () => setOpen(true),
    });

    return (
        <div ref={rootRef} className="mt-1 w-full min-w-0">
            <button
                type="button"
                aria-expanded={open}
                aria-controls={collapseId}
                onClick={() => {
                    notifyTranscriptDisclosureToggle(rootRef.current);
                    setOpen((value) => !value);
                }}
                className="group/line flex w-fit max-w-full items-center gap-1.5 rounded-md px-1 -mx-1 py-0.5 text-left chat-text text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
            >
                <span className="text-text-secondary group-hover/line:text-text-primary">Sources</span>
                {open ? null : <SourceStack sources={sources} />}
                <Icon
                    icon={ChevronDown20Regular}
                    className={cn(
                        "text-text-muted opacity-50 transition-transform duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                        open && "rotate-180",
                    )}
                />
            </button>
            <Collapse id={collapseId} open={open}>
                <div className="mt-0.5 flex flex-col pl-3.5">
                    {(() => {
                        const keyFor = createOccurrenceKeyer();
                        return sources.map((result) => (
                            <SourceRow key={keyFor(result.url || result.title)} result={result} />
                        ));
                    })()}
                </div>
            </Collapse>
        </div>
    );
};

export type TrailBlock = {
    type: string;
    query?: string;
    content?: string;
    visitUrl?: string;
    visitHost?: string;
    visitTitle?: string;
};

type TrailStep = {
    kind: "search" | "visit";
    query: string;
    brand: Brand | null;
    sources: WebSearchResult[];
};

function stepQuery(block: TrailBlock): string {
    if (block.type === "web_search") return (block.query || block.content || "").trim();
    return (block.query || "").trim();
}

export function buildTrailSteps(blocks: TrailBlock[]): TrailStep[] {
    const steps: TrailStep[] = [];
    for (const block of blocks) {
        if (block.type === "web_visit") {
            const query = (block.visitTitle || block.visitHost || "page").trim();
            steps.push({
                kind: "visit",
                query,
                brand: brandFromText(block.visitHost || block.visitUrl || query),
                sources: [],
            });
            continue;
        }
        if (block.type === "web_search") {
            const query = stepQuery(block);
            if (!query) continue;
            steps.push({ kind: "search", query, brand: null, sources: [] });
            continue;
        }
        if (block.type === "web_result") {
            const hits = parseWebSearchHits(block.content || "");
            const query = stepQuery(block);
            const prev = [...steps].reverse().find((step) => step.kind === "search" && (!query || step.query === query));
            if (prev) {
                const seen = new Set(prev.sources.map((hit) => hit.url || hit.title));
                for (const hit of hits) {
                    const key = hit.url || hit.title;
                    if (!key || seen.has(key)) continue;
                    seen.add(key);
                    prev.sources.push(hit);
                }
                continue;
            }
            if (query || hits.length > 0) {
                steps.push({ kind: "search", query, brand: null, sources: hits });
            }
        }
    }
    for (const step of steps) {
        if (step.kind === "search") step.brand = brandForStep(step.query, step.sources);
    }
    return steps;
}

function resultMeta(step: TrailStep): string | null {
    const count = step.sources.length;
    if (count === 0) return null;
    const noun = step.brand?.posts ? (count === 1 ? "post" : "posts") : (count === 1 ? "result" : "results");
    return `${count} ${noun}`;
}

function TrailStepRow({ step }: { step: TrailStep }) {
    const meta = resultMeta(step);
    const verb = step.kind === "visit"
        ? "Opened"
        : step.brand
            ? `Searched ${step.brand.label} for`
            : "Searched";
    const sentence = step.query ? `${verb} ${step.query}` : verb;
    const parts = splitActionLabel(sentence);
    const icon = step.brand ? <SiteMark brand={step.brand} size={14} /> : null;
    return (
        <div className="py-0.5">
            <div className="flex w-full min-w-0 items-center gap-1.5 chat-text text-text-muted">
                {icon ? <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span> : null}
                <span className="min-w-0 flex-1 truncate">
                    <span className="text-text-secondary">{parts.action}</span>
                    {parts.detail ? <span className="text-text-muted"> {parts.detail}</span> : null}
                </span>
                {meta ? <span className="shrink-0 tabular-nums text-text-muted">{meta}</span> : null}
            </div>
            {step.sources.length > 0 ? <SourcesBranch sources={step.sources} /> : null}
        </div>
    );
}

/** Research trail: each query is a step, and a step with hits branches once into Sources. */
export const WebSearchTrail = ({
    blocks,
    isActive,
}: {
    blocks: TrailBlock[];
    isActive?: boolean;
}) => {
    const steps = useMemo(() => buildTrailSteps(blocks), [blocks]);
    const searches = steps.filter((step) => step.kind === "search").length;

    if (steps.length === 0) {
        if (!isActive) return null;
        return (
            <div className="flex items-center gap-1.5 py-0.5 chat-text text-text-muted">
                <GeneratingIndicator label="Searching" showTimer={false} />
            </div>
        );
    }

    const grouped = searches > 1;
    return (
        <div className="py-0.5">
            {grouped ? (
                <div className="flex items-center gap-1.5 chat-text text-text-muted">
                    <span>
                        <span className="text-text-secondary">Ran</span>
                        <span className="tabular-nums text-text-muted"> {searches} searches</span>
                    </span>
                </div>
            ) : null}
            {(() => {
                const keyFor = createOccurrenceKeyer();
                return steps.map((step) => (
                    <TrailStepRow key={keyFor(`${step.kind}:${step.query}`)} step={step} />
                ));
            })()}
            {isActive ? <GeneratingIndicator label="Searching" showTimer={false} /> : null}
        </div>
    );
};

/** Renders the WebSearchBlock UI component. */
export const WebSearchBlock = ({
    query,
    results,
    isActive,
}: {
    query?: string;
    results: WebSearchResult[];
    isActive?: boolean;
    searches?: number;
}) => {
    const hits = results
        .map((result) => `### ${result.title}\nURL: ${result.url}\n${result.snippet}`)
        .join("\n---\n");
    return (
        <WebSearchTrail
            isActive={isActive}
            blocks={[
                { type: "web_search", query: query || "", content: query || "" },
                ...(hits ? [{ type: "web_result", query: query || "", content: hits }] : []),
            ]}
        />
    );
};

/** Renders the WebSourcesMenu UI component. */
export const WebSourcesMenu = ({ results }: { results: WebSearchResult[] }) => {
    if (results.length === 0) return null;
    const keyFor = createOccurrenceKeyer();

    return (
        <DropdownMenu>
            <Tooltip content={`${results.length} sources`} side="bottom">
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        className="inline-flex size-[24px] items-center justify-center rounded-md text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-secondary"
                        aria-label={`${results.length} web sources`}
                    >
                        <Icon icon={Globe20Regular} />
                    </button>
                </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="start" className="w-80 p-1.5">
                <div className="px-1.5 py-1 text-xs font-medium text-text-muted">Sources</div>
                {results.map((result) => (
                    <SourceRow key={keyFor(result.url || result.title)} result={result} />
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
