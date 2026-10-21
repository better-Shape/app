"use client";

import { Clipboard20Regular } from "@fluentui/react-icons/headless/svg/clipboard";
import { TextWrap20Regular } from "@fluentui/react-icons/headless/svg/text-wrap";
import { TextWrapOff20Regular } from "@fluentui/react-icons/headless/svg/text-wrap-off";
import { WindowConsole20Regular } from "@fluentui/react-icons/headless/svg/window-console";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getBetterShapeSyntaxTheme } from "@/lib/ui/syntax-theme";
import { cn, createOccurrenceKeyer } from "@/lib/utils";
import { FileIcon } from "@/components/ui/file-icon";
import { openProjectFile } from "@/lib/window/open-project-file";
import { Icon } from "@/components/ui/icon";
import { DrawnCheck } from "@/components/ui/checkmark";
import { Tooltip } from "@/components/ui/tooltip";
import { insertCommandIntoWorkspaceTerminal } from "@/features/terminal/session";
import { notify } from "@/features/notifications";

import { preloadSyntaxHighlighter, SyntaxHighlighter } from "@/lib/ui/syntax-highlight";
import { looksLikeProseMarkdown, preprocessChatMarkdown } from "./stream";
import { ChatLinkChip } from "./link-chip";
import { Button } from "@/components/ui/button";
import { SwapText } from "@/components/ui/swap";
import { commands, getProjectPath } from "@/lib/backend";
import { resolveProjectFilePath } from "@/lib/path/utils";
import { ChatMermaid } from "./mermaid";
import { ChatKeyedRowsTable, MarkdownTableShell } from "./data-table";
import { parseKeyedRows, tableCellModelId } from "@/lib/chat/fence-tables";
import { hasUnclosedMarkdownFence, splitStreamingMarkdownBlocks } from "@/lib/chat/markdown-blocks";
import { providerIcon } from "@/lib/ui/provider-icon";

const REMARK_PLUGINS = [remarkGfm];

const PATH_IN_PROSE =
    /(?:^|(?<=\s))((?:\.{1,2}[\\/])?(?:[\w.-]+[\\/])+[\w.-]+\.[A-Za-z0-9]{1,12})(?=$|[\s,;:)\]"'`])/g;

const PATH_EXISTS_TTL_MS = 30_000;
const PATH_EXISTS_MAX_ENTRIES = 512;

type PathProbeEntry = {
    exists: boolean;
    expiresAt: number;
};

const pathExistsCache = new Map<string, PathProbeEntry>();
const pathExistsInflight = new Map<string, Promise<boolean>>();

/** Peek cached path exists. */
const peekCachedPathExists = (resolvedPath: string): boolean | null => {
    const hit = pathExistsCache.get(resolvedPath);
    if (!hit) return null;
    if (hit.expiresAt < Date.now()) {
        pathExistsCache.delete(resolvedPath);
        return null;
    }
    // Refresh LRU order.
    pathExistsCache.delete(resolvedPath);
    pathExistsCache.set(resolvedPath, hit);
    return hit.exists;
};

/** Store cached path exists. */
const storeCachedPathExists = (resolvedPath: string, exists: boolean): void => {
    if (pathExistsCache.has(resolvedPath)) {
        pathExistsCache.delete(resolvedPath);
    }
    pathExistsCache.set(resolvedPath, {
        exists,
        expiresAt: Date.now() + PATH_EXISTS_TTL_MS,
    });
    if (pathExistsCache.size > PATH_EXISTS_MAX_ENTRIES) {
        const oldest = pathExistsCache.keys().next().value;
        if (oldest !== undefined) pathExistsCache.delete(oldest);
    }
};

let pathExistsEpoch = 0;
const pathExistsEpochListeners = new Set<() => void>();

/** Trim trailing slashes. */
const trimTrailingSlashes = (value: string): string => {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
    return end === value.length ? value : value.slice(0, end);
};

/** Probe project path exists. */
const probeProjectPathExists = (resolvedPath: string): Promise<boolean> => {
    const cached = peekCachedPathExists(resolvedPath);
    if (cached !== null) return Promise.resolve(cached);
    const inflight = pathExistsInflight.get(resolvedPath);
    if (inflight) return inflight;

    const epochAtStart = pathExistsEpoch;
    const normalized = trimTrailingSlashes(resolvedPath.replace(/\\/g, "/"));
    const slashIdx = normalized.lastIndexOf("/");
    const parentDir = slashIdx > 0 ? normalized.slice(0, slashIdx) : slashIdx === 0 ? "/" : "";
    const baseName = slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized;

    const fallbackProbe = () =>
        commands
            .readFile(resolvedPath)
            .then(() => true)
            .catch(() =>
                commands
                    .lsDir(resolvedPath)
                    .then(() => true)
                    .catch(() => false),
            );

    const lowerBaseName = baseName.toLowerCase();
    const lowerNormalized = normalized.toLowerCase();
    const matchesDirEntries = (
        entries: Array<{ name?: string | null; path?: string | null }>,
    ): boolean | Promise<boolean> => {
        let hasCaseFoldedMatch = false;
        for (const entry of entries) {
            const entryPath = entry.path
                ? trimTrailingSlashes(entry.path.replace(/\\/g, "/"))
                : undefined;
            if (entry.name === baseName || entryPath === normalized) {
                return true;
            }
            if (
                entry.name?.toLowerCase() === lowerBaseName
                || entryPath?.toLowerCase() === lowerNormalized
            ) {
                hasCaseFoldedMatch = true;
            }
        }
        return hasCaseFoldedMatch ? fallbackProbe() : false;
    };

    const req = (
        parentDir && baseName
            ? commands
                  .lsDir(parentDir)
                  .then((entries) =>
                      Array.isArray(entries) ? matchesDirEntries(entries) : fallbackProbe(),
                  )
                  .catch(() => fallbackProbe())
            : fallbackProbe()
    ).then((exists) => {
        pathExistsInflight.delete(resolvedPath);
        if (pathExistsEpoch === epochAtStart) {
            storeCachedPathExists(resolvedPath, exists);
        }
        return exists;
    });

    pathExistsInflight.set(resolvedPath, req);
    return req;
};

if (typeof window !== "undefined") {
    window.addEventListener("bettershape-files-changed", () => {
        pathExistsEpoch += 1;
        pathExistsCache.clear();
        pathExistsInflight.clear();
        for (const listener of pathExistsEpochListeners) {
            listener();
        }
    });
}

/** Renders the ProjectPathLink UI component. */
const ProjectPathLink = ({ path }: { path: string }) => {
    const resolved = resolveProjectFilePath(path, getProjectPath());
    const [cacheRev, setCacheRev] = useState(0);
    const [probeResult, setProbeResult] = useState<{ resolved: string; exists: boolean | null }>(
        () => ({ resolved, exists: peekCachedPathExists(resolved) }),
    );
    const exists =
        probeResult.resolved === resolved
            ? probeResult.exists
            : peekCachedPathExists(resolved);

    useEffect(() => {
        const onInvalidate = () => setCacheRev((rev) => rev + 1);
        pathExistsEpochListeners.add(onInvalidate);
        return () => {
            pathExistsEpochListeners.delete(onInvalidate);
        };
    }, []);

    useEffect(() => {
        const cached = peekCachedPathExists(resolved);
        if (cached !== null) {
            if (probeResult.resolved !== resolved || probeResult.exists !== cached) {
                let cancelled = false;
                Promise.resolve()
                    .then(() => {
                        if (!cancelled) setProbeResult({ resolved, exists: cached });
                    })
                    .catch(() => {
                        /* Ignore cancelled microtask */
                    });
                return () => {
                    cancelled = true;
                };
            }
            return undefined;
        }
        let cancelled = false;
        probeProjectPathExists(resolved)
            .then((result) => {
                if (!cancelled) setProbeResult({ resolved, exists: result });
            })
            .catch(() => {
                /* Probe failure resolves to non-existent path */
            });
        return () => {
            cancelled = true;
        };
    }, [resolved, probeResult.resolved, probeResult.exists, cacheRev]);

    if (!exists) return path;
    return (
        <Tooltip content={path}>
            <button
                type="button"
                className="text-accent-text underline decoration-accent-text/40 underline-offset-2 transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:decoration-accent-text"
                onClick={() => {
                    openProjectFile(path).catch(() => undefined);
                }}
            >
                {path}
            </button>
        </Tooltip>
    );
};

/** Linkify text. */
const linkifyText = (text: string): React.ReactNode => {
    if (!text.includes(".") || (!text.includes("/") && !text.includes("\\"))) {
        return text;
    }
    PATH_IN_PROSE.lastIndex = 0;
    const nodes: React.ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    let i = 0;
    while ((match = PATH_IN_PROSE.exec(text)) !== null) {
        const full = match[1];
        if (!full || full.includes("://") || full.startsWith("http")) continue;
        const start = match.index + (match[0].startsWith(full) ? 0 : match[0].length - full.length);
        if (start > last) nodes.push(text.slice(last, start));
        nodes.push(<ProjectPathLink key={`p-${i++}-${start}`} path={full} />);
        last = start + full.length;
    }
    if (last === 0) return text;
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
};

/** Linkify children. */
const linkifyChildren = (children: React.ReactNode): React.ReactNode => {
    return React.Children.map(children, (child) => {
        if (typeof child === "string") return linkifyText(child);
        return child;
    });
};

/** Renders the CodeBlock UI component. */
const CodeBlock = React.memo(function CodeBlock({
    language,
    code,
    streamingFence = false,
    ...rest
}: {
    language: string;
    code: string;
    streamingFence?: boolean;
    [k: string]: unknown;
}) {
    const [copied, setCopied] = useState(false);
    const [wrap, setWrap] = useState(false);
    const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (resetRef.current) clearTimeout(resetRef.current);
        };
    }, []);

    /** Copies the block; a denied clipboard leaves the label unchanged. */
    const copy = () => {
        navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            if (resetRef.current) clearTimeout(resetRef.current);
            resetRef.current = setTimeout(() => setCopied(false), 1400);
        }).catch(() => undefined);
    };

    const lineCount = React.useMemo(() => {
        if (!code) return 0;
        let lines = 1;
        for (let i = 0; i < code.length; i++) {
            if (code.charCodeAt(i) === 10) lines++;
        }
        return lines;
    }, [code]);

    // While the code fence is still open and actively streaming at 60fps, render
    // crisp monospace `<code>` inside the identical container (0ms AST/VDOM cost);
    // the instant the closing fence arrives, Prism highlights it once and React.memo freezes it.
    const usePlainFastPath = streamingFence;
    const isShellFence =
        !streamingFence &&
        code.trim().length > 0 &&
        /^(?:shell|sh|bash|zsh|console|fish|powershell|pwsh|cmd)$/i.test(language.trim());

    const handleInsertInTerminal = () => {
        if (insertCommandIntoWorkspaceTerminal(code)) {
            notify.info("Inserted in terminal", "Review the command and press Enter to run.");
        }
    };

    return (
        <div className="my-1.5 rounded-xl border border-border-subtle bg-surface-3">
            <div
                data-quote-skip
                data-find-skip
                className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-t-xl border-b border-border-subtle bg-surface-3 pl-3 pr-2 py-1.5 select-none"
            >
                <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs font-medium text-text-muted">
                        {language || "text"}
                    </span>
                    {lineCount >= 4 ? (
                        <span className="shrink-0 text-2xs tabular-nums text-text-muted/70">
                            {lineCount} lines
                        </span>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {isShellFence ? (
                        <Tooltip content="Insert in terminal">
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Insert in terminal"
                                onClick={handleInsertInTerminal}
                                className="size-[24px] text-text-muted hover:text-text-primary enabled:active:scale-[0.95] transition-[color,background-color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]"
                            >
                                <Icon icon={WindowConsole20Regular} className="size-3.5" />
                            </Button>
                        </Tooltip>
                    ) : null}
                    <Tooltip content={wrap ? "Disable line wrap" : "Wrap long lines"}>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label={wrap ? "Disable line wrap" : "Wrap long lines"}
                            aria-pressed={wrap}
                            onClick={() => setWrap((v) => !v)}
                            className={cn(
                                "size-[24px] text-text-muted hover:text-text-primary enabled:active:scale-[0.95] transition-[color,background-color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                                wrap && "bg-[var(--btn-open)] text-text-primary hover:bg-[var(--btn-open-hover)]",
                            )}
                        >
                            <Icon icon={wrap ? TextWrap20Regular : TextWrapOff20Regular} className="size-3.5" />
                        </Button>
                    </Tooltip>
                    <Tooltip content={copied ? "Copied" : "Copy code"}>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={copy}
                            aria-label={copied ? "Copied" : "Copy code"}
                            className={cn(
                                "size-[24px] text-text-muted hover:text-text-primary enabled:active:scale-[0.95] transition-[color,background-color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                                copied && "text-success hover:text-success",
                            )}
                        >
                            <SwapText
                                value={copied ? "Copied" : "Copy code"}
                                render={(label) =>
                                    label === "Copied" ? (
                                        <DrawnCheck motion="compact" />
                                    ) : (
                                        <Icon icon={Clipboard20Regular} className="size-3.5" />
                                    )
                                }
                            />
                        </Button>
                    </Tooltip>
                </div>
            </div>
            {usePlainFastPath ? (
                <pre
                    data-streaming-fence="true"
                    className="overflow-x-auto font-mono text-sm text-text-primary"
                    style={{
                        margin: 0,
                        padding: "0.625rem 0.75rem 0.75rem",
                        background: "transparent",
                        whiteSpace: wrap ? "pre-wrap" : "pre",
                        wordBreak: wrap ? "break-word" : "normal",
                    }}
                >
                    <code>{code}</code>
                </pre>
            ) : (
                <SyntaxHighlighter
                    style={getBetterShapeSyntaxTheme()}
                    language={language}
                    PreTag="div"
                    wrapLongLines={wrap}
                    customStyle={{
                        margin: 0,
                        padding: "0.625rem 0.75rem 0.75rem",
                        background: "transparent",
                        whiteSpace: wrap ? "pre-wrap" : "pre",
                        wordBreak: wrap ? "break-word" : "normal",
                    }}
                    {...rest}
                >
                    {code}
                </SyntaxHighlighter>
            )}
        </div>
    );
});

/** Fast catch-up typewriter over the raw markdown string (survives re-parses, respects reduced motion). */
const useRevealText = (full: string, live: boolean) => {
    const reducedMotion =
        typeof window !== "undefined"
        && typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const len = full.length;
    const [shown, setShown] = useState(() => (live && !reducedMotion ? Math.min(24, len) : len));
    const shownRef = useRef(shown);
    const wasLive = useRef(live);
    useLayoutEffect(() => {
        shownRef.current = shown;
        if (live) wasLive.current = true;
    }, [shown, live]);
    const moreToShow = !reducedMotion && shown < len;

    useEffect(() => {
        if (reducedMotion) return undefined;
        // Finished message that never streamed in this mount, show fully.
        if (!live && !wasLive.current) {
            setShown(len);
            return undefined;
        }
        if (shownRef.current > len) {
            setShown(len);
            return undefined;
        }
        if (shownRef.current >= len) return undefined;

        let raf = 0;
        let last = performance.now();
        const tick = (now: number) => {
            const cur = shownRef.current;
            if (cur >= len) return;
            const dt = Math.min(64, Math.max(8, now - last));
            last = now;
            const behind = len - cur;
            // Sprint on dumps; cruise smoothly near the tip. Stay under ~0.35s on bursts.
            let cps: number;
            if (behind > 800) cps = 2600;
            else if (behind > 300) cps = 1400;
            else if (behind > 80) cps = 640;
            else cps = live ? 220 : 420;
            const step = Math.max(1, Math.ceil((cps * dt) / 1000));
            const next = Math.min(len, cur + step);
            setShown(next);
            if (next < len) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [len, live, moreToShow, reducedMotion]);

    return reducedMotion ? full : full.slice(0, shown);
};

/** Renders the MarkdownSegment UI component. */
const MarkdownSegment = React.memo(function MarkdownSegment({
    content,
    components,
}: {
    content: string;
    components: ReturnType<typeof createMarkdownComponents>;
}) {
    if (!content) return null;
    return (
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
            {content}
        </ReactMarkdown>
    );
});

/** Renders the ChatMarkdown UI component. */
export const ChatMarkdown = React.memo(({
    content,
    nested,
    isGenerating,
    isLast,
}: {
    content: string;
    nested?: boolean;
    isGenerating?: boolean;
    isLast?: boolean;
}) => {
    const hasCodeFence = content.includes("```") || content.includes("~~~");
    useEffect(() => {
        if (hasCodeFence) {
            preloadSyntaxHighlighter();
        }
    }, [hasCodeFence]);

    // Keep revealing briefly after generation ends so a late dump still types in. The hold
    // latches on during render, and only the release is timed, so the effect never sets state
    // synchronously and the reveal does not lose a frame at the start of generation.
    const [hold, setHold] = useState(false);
    const holding = Boolean(isGenerating) && Boolean(isLast);
    if (holding && !hold) setHold(true);
    useEffect(() => {
        if (holding || !hold) return undefined;
        const t = window.setTimeout(() => setHold(false), 700);
        return () => window.clearTimeout(t);
    }, [holding, hold]);

    const live = !nested && Boolean(isLast) && (Boolean(isGenerating) || hold);
    const visible = useRevealText(content, live);
    // Parsing markdown is the expensive half of a streamed frame. Hand React a
    // deferred slice so it can drop intermediate typewriter frames instead of
    // building a full AST for every one; the settled text is never deferred.
    const deferred = React.useDeferredValue(visible);
    const renderedText = live ? deferred : visible;

    const settledComponents = React.useMemo(
        () => createMarkdownComponents({ nested, streamingFence: false }),
        [nested],
    );

    const rawHasOpenFence = React.useMemo(
        () => (live ? hasUnclosedMarkdownFence(visible) : false),
        [live, visible],
    );

    const tailComponents = React.useMemo(
        () =>
            rawHasOpenFence
                ? createMarkdownComponents({ nested, streamingFence: true })
                : settledComponents,
        [nested, rawHasOpenFence, settledComponents],
    );

    // Split BEFORE fence balancing on the raw visible slice when safe, or split on the
    // preprocessed output so every settled block is frozen via `React.memo(MarkdownSegment)`.
    const { settled, tail } = React.useMemo(() => {
        if (!live) {
            return {
                settled: [] as string[],
                tail: preprocessChatMarkdown(renderedText, { streaming: false, trim: true }),
            };
        }
        const normalized = preprocessChatMarkdown(renderedText, { streaming: true, trim: false });
        return splitStreamingMarkdownBlocks(normalized);
    }, [renderedText, live]);

    return (
        <div className="font-sans chat-markdown-body">
            {(() => {
                const blockKey = createOccurrenceKeyer();
                return settled.map((block) => (
                    <MarkdownSegment
                        key={blockKey(block.slice(0, 32))}
                        content={block}
                        components={settledComponents}
                    />
                ));
            })()}
            {tail ? (
                <MarkdownSegment
                    key={`tail-${settled.length}`}
                    content={tail}
                    components={tailComponents}
                />
            ) : null}
        </div>
    );
});

/** createMarkdownComponents helper. */
function createMarkdownComponents(options?: { nested?: boolean; streamingFence?: boolean }) {
    const nested = options?.nested;
    const streamingFence = Boolean(options?.streamingFence);

    return {
        pre: ({ children }: { children?: React.ReactNode }) => children,
        code(props: { className?: string; children?: React.ReactNode }) {
            const { className, children, ...rest } = props;
            const match = /language-([a-z0-9-]+)/i.exec(className || "");
            const codeContent = String(children).replace(/\n$/, "");
            if (codeContent === "undefined") return null;

            if (match) {
                const language = (match[1] ?? "").toLowerCase();
                if (language === "mermaid") {
                    return <ChatMermaid source={codeContent} />;
                }
                if (language === "filter-table" || language === "records") {
                    const rows = parseKeyedRows(codeContent);
                    if (!rows) {
                        return (
                            <CodeBlock
                                language={language}
                                code={codeContent}
                                streamingFence={streamingFence}
                                {...rest}
                            />
                        );
                    }
                    return <ChatKeyedRowsTable rows={rows} />;
                }
                if (language === "chart" || language === "insight" || language === "stats") return null;
                return (
                    <CodeBlock
                        language={language}
                        code={codeContent}
                        streamingFence={streamingFence}
                        {...rest}
                    />
                );
            }

            const isBlock = codeContent.includes("\n");
            if (isBlock && !nested && looksLikeProseMarkdown(codeContent)) {
                return <ChatMarkdown content={codeContent} nested />;
            }

            if (isBlock) {
                return (
                    <pre className="my-1 overflow-x-auto rounded-xl border border-border-subtle bg-surface-3 p-3 chat-text font-mono leading-relaxed">
                        <code className="block whitespace-pre-wrap text-text-primary" {...rest}>
                            {children}
                        </code>
                    </pre>
                );
            }

            const isFilePath =
                typeof children === "string"
                && !children.includes("\n")
                && !children.includes(" ")
                && !children.includes("://")
                && !children.includes("(")
                && (children.includes("/")
                    || children.includes("\\")
                    || /^(?:dockerfile|makefile)(?:\.[a-z0-9_-]+)?$/i.test(children)
                    || /\.(?:tsx?|jsx?|mjs|cjs|jsonc?|mdx?|scss|css|less|html?|vue|svelte|astro|rs|toml|ya?ml|py|go|rb|php|java|kt|swift|cpp|cc|csv|cs|c|hpp|h|bash|zsh|sh|ps1|sql|graphql|gql|proto|svg|png|jpe?g|webp|gif|ico|pdf|lock|env|gitignore|dockerfile|makefile|txt|log)$/i.test(children));

            if (isFilePath) {
                const fullPath = children as string;
                const name = fullPath.split(/[\\/]/).pop() || fullPath;
                return (
                    <Tooltip content={fullPath}>
                        <button
                            type="button"
                            className="mx-0.5 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-panel-hover px-2 py-0.5 align-middle font-sans chat-text text-text-primary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)]"
                            onClick={() => {
                                openProjectFile(fullPath, name).catch(() => undefined);
                            }}
                        >
                            <FileIcon name={name} className="h-4 w-4" />
                            {name}
                        </button>
                    </Tooltip>
                );
            }

            return (
                <code
                    className="rounded-md bg-panel-hover px-1.5 py-0.5 font-mono chat-text text-accent-text"
                    {...rest}
                >
                    {children}
                </code>
            );
        },
        p: ({ children }: { children?: React.ReactNode }) => (
            <p className="mb-2 font-sans chat-text font-medium text-text-primary last:mb-0">{linkifyChildren(children)}</p>
        ),
        ul: ({ children }: { children?: React.ReactNode }) => (
            <ul className="mb-2 ml-4 list-outside list-disc space-y-1 font-sans chat-text">{children}</ul>
        ),
        ol: ({ children }: { children?: React.ReactNode }) => (
            <ol className="mb-2 ml-4 list-outside list-decimal space-y-1 font-sans chat-text">{children}</ol>
        ),
        li: ({ children }: { children?: React.ReactNode }) => (
            <li className="pl-0.5 font-sans chat-text font-normal leading-relaxed">{linkifyChildren(children)}</li>
        ),
        h1: ({ children }: { children?: React.ReactNode }) => (
            <h1 className="mb-2 mt-4 font-sans chat-text font-medium text-text-primary">{linkifyChildren(children)}</h1>
        ),
        h2: ({ children }: { children?: React.ReactNode }) => (
            <h2 className="mb-1.5 mt-3 font-sans chat-text font-medium text-text-primary">{linkifyChildren(children)}</h2>
        ),
        h3: ({ children }: { children?: React.ReactNode }) => (
            <h3 className="mb-1 mt-2 font-sans chat-text font-medium text-text-primary">{linkifyChildren(children)}</h3>
        ),
        strong: ({ children }: { children?: React.ReactNode }) => (
            <strong className="chat-text font-medium text-text-primary">{children}</strong>
        ),
        em: ({ children }: { children?: React.ReactNode }) => <em>{children}</em>,
        del: ({ children }: { children?: React.ReactNode }) => (
            <del className="text-text-muted">{children}</del>
        ),
        hr: () => <hr className="my-3 border-border-subtle" />,
        a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
            <ChatLinkChip href={href}>{children}</ChatLinkChip>
        ),
        blockquote: ({ children }: { children?: React.ReactNode }) => (
            <blockquote className="rounded-r border-l-2 border-base/50 bg-panel/30 pl-3 font-sans chat-text font-normal italic text-text-muted">
                {children}
            </blockquote>
        ),
        table: ({ children }: { children?: React.ReactNode }) => (
            <MarkdownTableShell>
                <table className="w-full min-w-50 border-collapse text-left">{children}</table>
            </MarkdownTableShell>
        ),
        thead: ({ children }: { children?: React.ReactNode }) => (
            <thead>{children}</thead>
        ),
        th: ({ children }: { children?: React.ReactNode }) => (
            <th className="px-2.5 py-1.5 font-sans chat-text font-medium text-text-primary">{children}</th>
        ),
        td: ({ children }: { children?: React.ReactNode }) => {
            const text = React.Children.toArray(children)
                .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : ""))
                .join("");
            const modelId = tableCellModelId(text);
            return (
                <td className="px-2.5 py-1.5 font-sans chat-text text-text-secondary">
                    {modelId ? (
                        <span className="inline-flex items-center gap-1.5">
                            {providerIcon(modelId, 14)}
                            {children}
                        </span>
                    ) : (
                        children
                    )}
                </td>
            );
        },
        input: (props: React.InputHTMLAttributes<HTMLInputElement>) => {
            if (props.type !== "checkbox") return <input {...props} />;
            return (
                <input
                    {...props}
                    readOnly
                    className="mr-2 align-middle accent-accent"
                />
            );
        },
    };
}

ChatMarkdown.displayName = "ChatMarkdown";

/** @deprecated Use ChatMarkdown */
export const StreamingMarkdown = ChatMarkdown;
