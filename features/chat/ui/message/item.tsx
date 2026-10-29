import { ArrowShuffle24Regular } from "@fluentui/react-icons/headless/svg/arrow-shuffle";
import { BranchFork20Regular } from "@fluentui/react-icons/headless/svg/branch-fork";
import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { Clipboard20Regular } from "@fluentui/react-icons/headless/svg/clipboard";
import { SelectAllOn20Regular } from "@fluentui/react-icons/headless/svg/select-all-on";
import { Edit20Regular } from "@fluentui/react-icons/headless/svg/edit";
import { Folder20Filled } from "@fluentui/react-icons/headless/svg/folder";
import { MoreHorizontal20Regular } from "@fluentui/react-icons/headless/svg/more-horizontal";
import { TextQuote20Regular } from "@fluentui/react-icons/headless/svg/text-quote";

import React from "react";
import { useChatStreamGetters } from "@/features/chat/lib/chat-stream-store";
import type { ChatMessage } from "@/lib/backend";
import { cn, createOccurrenceKeyer } from "@/lib/utils";
import { toTimestampMs } from "@/lib/ui/timestamp";
import { MessageRenderer, parseMessageContent, getMessageCopyText, extractWebSearchResults } from "../md/renderer";
import { Icon } from "@/components/ui/icon";


import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuShortcut,
    ContextMenuTrigger,
} from "@/components/ui/context";
import { Tooltip } from "@/components/ui/tooltip";
import {
    formatMessageModelLabel,
    isAutoModelId,
    type MessageUsageStats,
} from "@/lib/chat/usage-display";
import { parseBetterShapeContinueAction } from "@/lib/chat/continue-action";
import { mentionRanges, mentionDisplayLabel } from "@/lib/chat/mentions";
import { slashCommandRanges } from "@/lib/chat/workflows";
import { useSettings } from "@/lib/settings";
import { openProjectFile } from "@/lib/window/open-project-file";
import { WebSourcesMenu } from "../blocks/search";
import { Button } from "@/components/ui/button";
import { DrawnCheck } from "@/components/ui/checkmark";
import { SwapText } from "@/components/ui/swap";
import { UserMessageCard } from "./bubble";
import { ContextChip, MentionChipIcon, WorkflowChipIcon } from "./context-chip";
import {
    dispatchChatQuote,
    extractCleanSelectionText,
    splitLeadingQuoteBlock,
} from "../quote-selection";
import { GeneratingIndicator } from "../blocks/generating";
import { parseUserAttachments } from "../../lib/user-attachments";
import type { ParsedUserAttachment } from "../../lib/user-attachments";
import { MessageAttachmentPill } from "../composer/attachments";
import { ContextWindowMenu, hasContextWindowData } from "./context-window";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ChatMessageItemProps = {
    role: string;
    content: string;
    timestamp: number;
    isGenerating?: boolean;
    activityLabel?: string | null;
    /** Override the role label shown in the header (e.g. "Task" for delegated subagent prompts). */
    roleLabel?: string;
    stats?: MessageUsageStats;
    model?: string;
    /** Index of this message in the full message list (for redo/restore). */
    index?: number;
    onRedo?: (index: number) => void;
    onRestore?: (index: number) => void;
    onFork?: (index: number) => void;
    isFileEditResolved?: (file: string, replacement?: string) => boolean;
    fullWidthBubbles?: boolean;
    /** Live transcript, read only when the usage menu opens. */
    messagesRef?: React.RefObject<ChatMessage[]>;
};

/** Renders an attached file or image thumbnail chip inside a sent user message. */
function SentAttachment({ att }: { att: ParsedUserAttachment }) {
    if (att.kind === "image" && att.dataUrl) {
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
                src={att.dataUrl}
                alt={att.name}
                className="max-h-44 max-w-56 rounded-lg border border-border-subtle object-contain"
            />
        );
    }
    return <MessageAttachmentPill name={att.name} />;
}

/** Preserve attachment identity across reordering while disambiguating exact duplicates. */
const withStableAttachmentKeys = (attachments: ParsedUserAttachment[]) => {
    const occurrences = new Map<string, number>();
    return attachments.map((attachment) => {
        const identity = JSON.stringify([
            attachment.kind,
            attachment.name,
            attachment.mimeType,
            attachment.size,
        ]);
        const occurrence = occurrences.get(identity) ?? 0;
        occurrences.set(identity, occurrence + 1);
        return { attachment, key: `${identity}:${occurrence}` };
    });
};

/** Renders the MentionRichText UI component. */
const MentionRichText = ({ text }: { text: string }) => {
    const workflows = useSettings().ai.workflows ?? [];
    const mentionRs = mentionRanges(text);
    const slashRs = slashCommandRanges(text, workflows);
    const ranges: (
        | { kind: "mention"; start: number; end: number; mention: (typeof mentionRs)[number]["mention"] }
        | { kind: "slash"; start: number; end: number; workflow?: (typeof slashRs)[number]["workflow"]; token: string }
    )[] = [
        ...mentionRs.map((r) => ({ kind: "mention" as const, ...r })),
        ...slashRs.map((r) => ({ kind: "slash" as const, ...r })),
    ].sort((a, b) => a.start - b.start);

    const merged: typeof ranges = [];
    for (const r of ranges) {
        const prev = merged[merged.length - 1];
        if (prev && r.start < prev.end) continue;
        merged.push(r);
    }

    /** Color backtick spans and bare paths even when there are no @mentions. */
    const paintPlain = (chunk: string, keyPrefix: string): React.ReactNode[] => {
        const out: React.ReactNode[] = [];
        const re = /(`[^`\n]+`)|((?<![\w.-])(?<![\w.-][\\/])(?:[A-Za-z]:)?(?:[\w.-]+[\\/])+[\w.-]+\.\w+)/g;
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(chunk)) !== null) {
            if (m.index > last) {
                out.push(
                    <span key={`${keyPrefix}-t-${last}`} className="whitespace-pre-wrap">
                        {chunk.slice(last, m.index)}
                    </span>,
                );
            }
            if (m[1]) {
                const inner = m[1].slice(1, -1);
                out.push(
                    <code
                        key={`${keyPrefix}-c-${m.index}`}
                        className="rounded bg-panel px-1 py-0.5 font-mono text-[0.9em] text-accent-text"
                    >
                        {inner}
                    </code>,
                );
            } else if (m[2]) {
                const path = m[2];
                const name = path.split(/[\\/]/).pop() || path;
                out.push(
                    <Tooltip key={`${keyPrefix}-p-${m.index}`} content={path}>
                        <button
                            type="button"
                            data-chat-find-text
                            data-quote-allow=""
                            onClick={() => { openProjectFile(path, name).catch(() => undefined); }}
                            className="inline cursor-pointer font-mono text-[0.9em] text-accent-text underline-offset-2 transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:underline"
                        >
                            {path}
                        </button>
                    </Tooltip>,
                );
            }
            last = m.index + m[0].length;
        }
        if (last < chunk.length) {
            out.push(
                <span key={`${keyPrefix}-t-end`} className="whitespace-pre-wrap">
                    {chunk.slice(last)}
                </span>,
            );
        }
        return out.length > 0 ? out : [<span key={`${keyPrefix}-all`} className="whitespace-pre-wrap">{chunk}</span>];
    };

    if (merged.length === 0) {
        return <span className="select-text">{paintPlain(text, "root")}</span>;
    }
    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    merged.forEach((range) => {
        if (range.start > cursor) {
            nodes.push(...paintPlain(text.slice(cursor, range.start), `pre-${range.start}`));
        }
        if (range.kind === "slash") {
            nodes.push(
                <ContextChip key={`s-${range.start}`} icon={<WorkflowChipIcon workflow={range.workflow} />}>
                    {range.token}
                </ContextChip>,
            );
        } else {
            const { mention } = range;
            const openable =
                (mention.kind === "file" || mention.kind === "folder") && Boolean(mention.path);
            const label = mentionDisplayLabel(mention);
            nodes.push(
                <ContextChip
                    key={`m-${range.start}`}
                    icon={<MentionChipIcon mention={mention} />}
                    onClick={
                        openable
                            ? () => {
                                  const base = mention.path ?? "";
                                  const path =
                                      mention.kind === "folder" && !base.endsWith("/")
                                          ? `${base}/`
                                          : base;
                                  openProjectFile(path, label).catch(() => undefined);
                              }
                            : undefined
                    }
                >
                    @{label}
                </ContextChip>,
            );
        }
        cursor = range.end;
    });
    if (cursor < text.length) {
        nodes.push(...paintPlain(text.slice(cursor), "end"));
    }
    return <span className="select-text">{nodes}</span>;
};

/** Selects all text inside a DOM element for quick copy or inspection. */
function selectNodeContents(el: HTMLElement | null) {
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
}

/** Decodes escaped XML attribute entities back into plain characters. */
function decodeXmlAttr(value: string): string {
    return value
        .replace(/&quot;/g, "\"")
        .replace(/&lt;/g, "<")
        .replace(/&amp;/g, "&");
}

/** Parses an inline `<chat_renamed>` system marker from message text. */
function parseChatRenamed(content: string): { from: string; rest: string } | null {
    const match = content.match(/^<chat_renamed\b([^>]*)\/>\s*/);
    if (!match) return null;
    const from = decodeXmlAttr(match[1]?.match(/\bfrom="([^"]*)"/)?.[1] ?? "the previous name");
    return { from, rest: content.slice(match[0].length) };
}

/** Formats a message timestamp as a short localized clock string (`HH:MM`). */
function formatSentClock(timestamp: number): string {
    return new Date(toTimestampMs(timestamp)).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
    });
}

/** Formats a message timestamp as a full localized date and time tooltip. */
function formatSentExact(timestamp: number): string {
    return new Date(toTimestampMs(timestamp)).toLocaleString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
    });
}

/** Renders a subtle message timestamp with full date-time details on hover. */
function MessageSentTime({ timestamp }: { timestamp: number }) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    return (
        <Tooltip content={formatSentExact(timestamp)} side="top" delayDuration={200}>
            <time
                dateTime={new Date(toTimestampMs(timestamp)).toISOString()}
                className="pointer-events-none cursor-default px-1 text-sm text-text-muted opacity-0 transition-opacity group-hover/msg:pointer-events-auto group-hover/msg:opacity-100"
            >
                {formatSentClock(timestamp)}
            </time>
        </Tooltip>
    );
}

/** Parses a `<forked_from>` lineage marker from the start of a conversation message. */
function parseForkedFrom(content: string): { id: string; title: string; rest: string } | null {
    const match = content.match(/^<forked_from\b([^>]*)\/>\s*/);
    if (!match) return null;
    const attrs = match[1] ?? "";
    const id = attrs.match(/\bid="([^"]*)"/)?.[1] ?? "";
    const title = attrs.match(/\btitle="([^"]*)"/)?.[1] ?? "previous chat";
    return { id, title, rest: content.slice(match[0].length) };
}

/** Extract display-only prefixes once so rendering and copying share the same message body. */
const extractPresentationMetadata = (content: string) => {
    let rest = content;
    let forked: ReturnType<typeof parseForkedFrom> = null;
    let renamed: ReturnType<typeof parseChatRenamed> = null;
    for (let index = 0; index < 2; index += 1) {
        const nextFork = parseForkedFrom(rest);
        if (nextFork) {
            forked = nextFork;
            rest = nextFork.rest;
            continue;
        }
        const nextRenamed = parseChatRenamed(rest);
        if (nextRenamed) {
            renamed = nextRenamed;
            rest = nextRenamed.rest;
            continue;
        }
        break;
    }
    return { content: rest, forked, renamed };
};

/** Formats user text and attachment names for the message copy action. */
const userMessageCopyText = (content: string): string => {
    const parts = parseUserAttachments(content);
    const names = parts.attachments.map((attachment) => attachment.name).join(", ");
    if (names && parts.text) return `${parts.text}\n\n[${names}]`;
    if (names) return `[${names}]`;
    return parts.text || content;
};

/** Checks whether rich assistant metadata or non-OpenUI blocks prefer live rendered DOM copy text. */
const shouldPreferRenderedAssistantCopy = (
    metadata: ReturnType<typeof extractPresentationMetadata>,
    chunks: ReturnType<typeof parseMessageContent>,
): boolean =>
    Boolean(metadata.forked || metadata.renamed) ||
    chunks.some((chunk) => chunk.type !== "text" && chunk.type !== "openui");

/** Copies rendered text for rich assistant chunks when its visible DOM is available. */
const assistantMessageCopyText = (
    content: string,
    body: HTMLDivElement | null,
): string => {
    const metadata = extractPresentationMetadata(content);
    const chunks = parseMessageContent(metadata.content);
    const renderedText = body?.innerText || body?.textContent || undefined;
    if (shouldPreferRenderedAssistantCopy(metadata, chunks) && renderedText?.trim()) {
        return renderedText;
    }
    const openUIText = Array.from(
        body?.querySelectorAll<HTMLElement>("[data-openui-block]") ?? [],
        (element) => element.innerText || element.textContent || "",
    );
    return getMessageCopyText(chunks, openUIText, renderedText);
};

/** Selects the role-specific text fallback used by clipboard and context-menu actions. */
const messageCopyText = (
    role: string,
    content: string,
    body: HTMLDivElement | null,
): string =>
    role === "user"
        ? userMessageCopyText(content)
        : assistantMessageCopyText(content, body);

/** Render the user or assistant message body and its available actions. */
const ChatMessageItemInner = ({
    role,
    content,
    timestamp,
    isGenerating,
    activityLabel,
    roleLabel: _roleLabel,
    stats,
    model,
    index = -1,
    onRedo,
    onRestore,
    onFork,
    isFileEditResolved,
}: ChatMessageItemProps) => {
    const { getViewedMessages } = useChatStreamGetters();
    const [expanded, setExpanded] = React.useState(false);
    const [copied, setCopied] = React.useState(false);
    const copyResetRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [forkOpen, setForkOpen] = React.useState(false);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const [menuStats, setMenuStats] = React.useState<typeof stats>();
    const [menuModel, setMenuModel] = React.useState<typeof model>();
    const [advanced, setAdvanced] = React.useState(false);
    const [contextVeil, setContextVeil] = React.useState(true);
    const contextWindowId = React.useId();
    const bodyRef = React.useRef<HTMLDivElement>(null);
    const shownStats = menuStats ?? stats;
    const shownModel = menuModel ?? model;

    React.useEffect(() => {
        return () => {
            if (copyResetRef.current) clearTimeout(copyResetRef.current);
        };
    }, []);

    const [messageScope, setMessageScope] = React.useState<readonly [typeof stats, typeof model] | null>(null);
    if (messageScope === null || !Object.is(messageScope[0], stats) || !Object.is(messageScope[1], model)) {
        setMessageScope([stats, model]);
        setMenuStats(stats);
        setMenuModel(model);

    }

    /** Resolve a role-aware clipboard fallback from the current rendered message. */
    const getCopyText = () => messageCopyText(role, content, bodyRef.current);

    const markCopied = () => {
        setCopied(true);
        if (copyResetRef.current) clearTimeout(copyResetRef.current);
        copyResetRef.current = setTimeout(() => setCopied(false), 1400);
    };

    const selectionContainedInBody = (sel: Selection | null): boolean => {
        const root = bodyRef.current;
        if (!sel || !root || sel.rangeCount === 0) return false;
        const range = sel.getRangeAt(0);
        return root.contains(range.startContainer) && root.contains(range.endContainer);
    };

    /** Prefer an explicit in-message selection; otherwise copy the normalized rendered message. */
    const handleCopy = (): void => {
        const sel = window.getSelection();
        const selected = sel?.toString() ?? "";
        const targetText = selected && selectionContainedInBody(sel) ? selected : getCopyText();
        navigator.clipboard?.writeText(targetText).then(markCopied).catch(() => undefined);
    };

    const handleQuoteMessage = () => {
        const sel = window.getSelection();
        const root = bodyRef.current;
        if (sel && !sel.isCollapsed && sel.rangeCount > 0 && root && selectionContainedInBody(sel)) {
            const cleanSelected = extractCleanSelectionText(sel.getRangeAt(0), root).trim();
            if (cleanSelected) {
                dispatchChatQuote(cleanSelected);
                sel.removeAllRanges();
                return;
            }
        }
        const full = getCopyText().trim();
        if (full) dispatchChatQuote(full);
    };

    /** Select only the text rendered in this message body. */
    const handleSelectAll = () => {
        selectNodeContents(bodyRef.current);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!(e.metaKey || e.ctrlKey)) return;
        const key = e.key.toLowerCase();
        if (key === "a") {
            e.preventDefault();
            e.stopPropagation();
            handleSelectAll();
        } else if (key === "c") {
            // Let the browser copy the selection when present; otherwise copy full message.
            const sel = window.getSelection();
            const selected = sel?.toString() ?? "";
            if (!selected || !bodyRef.current?.contains(sel?.anchorNode ?? null)) {
                e.preventDefault();
                e.stopPropagation();
                navigator.clipboard.writeText(getCopyText()).catch(() => undefined);
            }
        }
    };

    const isUser = role === "user";

    const userParts = React.useMemo(
        () => (isUser ? parseUserAttachments(content) : null),
        [isUser, content],
    );
    const keyedAttachments = React.useMemo(
        () => withStableAttachmentKeys(userParts?.attachments ?? []),
        [userParts],
    );

    const continueAction = React.useMemo(
        () => (isUser ? parseBetterShapeContinueAction(userParts?.text ?? content) : null),
        [isUser, userParts?.text, content],
    );

    const webSources = React.useMemo(
        () => (!isUser ? extractWebSearchResults(content) : []),
        [isUser, content],
    );


    if (role === "user" && userParts) {
        const rawDisplayText = continueAction?.action
            ? continueAction.displayText
            : userParts.text;
        const { quotes: userQuotes, rest: displayText } = splitLeadingQuoteBlock(rawDisplayText);
        const LONG_CHARS = 280;
        const isLong = displayText.length > LONG_CHARS || displayText.split("\n").length > 5;
        return (
            <ContextMenu>
            <ContextMenuTrigger asChild>
            <div
                role="group"
                aria-label="Message"
                className="group/msg relative mb-2 flex w-full select-text"
                tabIndex={-1}
                onKeyDown={handleKeyDown}
            >
                <div className="group flex w-full min-w-0 items-start">
                    <div className="flex w-full min-w-0 flex-col gap-1">
                        <UserMessageCard>
                            <div
                                ref={bodyRef}
                                data-chat-message-body
                                className="min-w-0 wrap-break-word select-text"
                            >
                                {userParts.attachments.length > 0 && (
                                    <div className="mb-2 flex flex-wrap items-end gap-1.5">
                                        {keyedAttachments.map(({ attachment, key }) => (
                                            <SentAttachment key={key} att={attachment} />
                                        ))}
                                    </div>
                                )}
                                {userQuotes.length > 0 ? (
                                    <div className={cn("flex flex-col gap-1.5", displayText && "mb-2")}>
                                        {(() => {
                                            const quoteKey = createOccurrenceKeyer();
                                            return userQuotes.map((qText) => (
                                                <blockquote
                                                    key={quoteKey(qText.slice(0, 24))}
                                                    className="flex items-start gap-2 rounded-xl border border-border-subtle bg-surface-2 px-3 py-2 text-xs leading-relaxed text-text-secondary whitespace-pre-wrap"
                                                >
                                                <Icon
                                                    icon={TextQuote20Regular}
                                                    className="mt-0.5 size-3.5 shrink-0 text-text-muted"
                                                />
                                                <span className="min-w-0 flex-1 break-words line-clamp-6">
                                                    {qText}
                                                </span>
                                            </blockquote>
                                            ));
                                        })()}
                                    </div>
                                ) : null}
                                {displayText || userQuotes.length === 0 ? (
                                    <div className={cn(isLong && !expanded && "chat-message-fade-clamp")}>
                                        <MentionRichText text={displayText} />
                                    </div>
                                ) : null}
                                {isLong ? (
                                    <button
                                        type="button"
                                        data-quote-skip
                                        aria-expanded={expanded}
                                        onClick={() => setExpanded((v) => !v)}
                                        className="mt-1.5 inline-flex items-center gap-1 rounded-md px-1 py-0.5 -ml-1 text-xs font-medium text-text-muted transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:transform-none motion-reduce:transition-none hover:bg-[var(--btn-hover)] hover:text-text-primary active:scale-[0.97] select-none"
                                    >
                                        <span>{expanded ? "Show less" : "Show more"}</span>
                                        <Icon
                                            icon={ChevronDown20Regular}
                                            className={cn(
                                                "icon-xs transition-transform duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)] motion-reduce:transition-none",
                                                expanded && "rotate-180",
                                            )}
                                        />
                                    </button>
                                ) : null}
                            </div>
                        </UserMessageCard>
                        <div className="flex w-fit items-center gap-0.5 self-end select-none opacity-0 transition-opacity duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] group-hover:opacity-100 focus-within:opacity-100">
                            <MessageSentTime timestamp={timestamp} />
                            <Tooltip content={copied ? "Copied" : "Copy message"} side="top">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={copied ? "Copied" : "Copy message"}
                                    onClick={handleCopy}
                                    className={cn(
                                        "enabled:active:scale-[0.95] transition-[color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                                        copied && "text-success",
                                    )}
                                >
                                    <SwapText
                                        value={copied ? "Copied" : "Copy"}
                                        render={(face) =>
                                            face === "Copied" ? (
                                                <DrawnCheck motion="compact" />
                                            ) : (
                                                <Icon icon={Clipboard20Regular} className="icon-md" />
                                            )
                                        }
                                    />
                                </Button>
                            </Tooltip>
                            {index >= 0 && onRestore ? (
                                <Tooltip content="Restore to this checkpoint" side="top">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label="Restore to this checkpoint"
                                        onClick={() => onRestore(index)}
                                        className="enabled:active:scale-[0.95] transition-transform duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]"
                                    >
                                        <Icon icon={ArrowShuffle24Regular} className="icon-md" />
                                    </Button>
                                </Tooltip>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onClick={handleCopy}>
                    <Icon icon={Clipboard20Regular} />
                    Copy
                    <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={handleQuoteMessage}>
                    <Icon icon={TextQuote20Regular} />
                    Quote in reply
                    <ContextMenuShortcut>Ctrl+Shift+.</ContextMenuShortcut>
                </ContextMenuItem>
                {index >= 0 && onRestore ? (
                    <ContextMenuItem onClick={() => onRestore(index)}>
                        <Icon icon={ArrowShuffle24Regular} />
                        Restore to this checkpoint
                    </ContextMenuItem>
                ) : null}
                <ContextMenuSeparator />
                <ContextMenuItem onClick={handleSelectAll}>
                    <Icon icon={SelectAllOn20Regular} />
                    Select All
                    <ContextMenuShortcut>Ctrl+A</ContextMenuShortcut>
                </ContextMenuItem>
            </ContextMenuContent>
            </ContextMenu>
        );
    }

    const showTypingOnly = Boolean(isGenerating && !content.trim());
    const presentation = role === "assistant"
        ? extractPresentationMetadata(content)
        : { content, forked: null, renamed: null };
    const renderContent = presentation.content;
    const forked = presentation.forked;
    const renamed = presentation.renamed;

    return (
        <>
        <ContextMenu>
        <ContextMenuTrigger asChild>
        <div
            role="group"
            aria-label="Message"
            className="group/msg group relative z-10 mb-2 flex w-full select-text flex-col gap-1"
            tabIndex={-1}
            onKeyDown={handleKeyDown}
        >
            <div className="flex min-w-0 flex-col gap-1 pr-6">
                <div
                    ref={bodyRef}
                    data-chat-message-body
                    data-chat-streaming={isGenerating ? "true" : undefined}
                    className="min-w-0 select-text overflow-visible chat-text text-text-primary"
                >
                    {showTypingOnly ? (
                        <GeneratingIndicator label={activityLabel || "Thinking"} />
                    ) : (
                        <div className="chat-markdown prose-compact max-w-none min-w-0 wrap-break-word select-text">
                            {renamed ? (
                                <div className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-text-muted">
                                    <Icon icon={Edit20Regular} className="size-3.5 shrink-0" />
                                    <span>Renamed from</span>
                                    <span className="min-w-0 truncate font-medium text-text-secondary">{renamed.from}</span>
                                </div>
                            ) : null}
                            {forked ? (
                                <button
                                    type="button"
                                    className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-text-muted hover:bg-[var(--row-hover)] hover:text-text-primary"
                                    onClick={() => {
                                        if (!forked.id) return;
                                        window.dispatchEvent(
                                            new CustomEvent("bettershape-chat-load", { detail: { id: forked.id } }),
                                        );
                                    }}
                                >
                                    <Icon icon={BranchFork20Regular} className="size-3.5 shrink-0" />
                                    <span>Forked from</span>
                                    <Icon icon={Folder20Filled} className="size-3.5 shrink-0 text-text-muted" />
                                    <span className="min-w-0 truncate font-medium text-text-secondary">{forked.title}</span>
                                </button>
                            ) : null}
                            <MessageRenderer
                                content={renderContent}
                                isGenerating={isGenerating}
                                activityLabel={activityLabel}
                                isFileEditResolved={isFileEditResolved}
                                durationMs={stats?.timeMs}
                            />
                        </div>
                    )}
                </div>
            </div>
            {!isGenerating && (
                <div className="flex w-fit items-center gap-0.5 self-start select-none">
                    <Tooltip content={copied ? "Copied" : "Copy message"} side="bottom">
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label={copied ? "Copied" : "Copy message"}
                            onClick={handleCopy}
                            className={cn(
                                "enabled:active:scale-[0.95] transition-[color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)]",
                                copied && "text-success",
                            )}
                        >
                            <SwapText
                                value={copied ? "Copied" : "Copy"}
                                render={(face) =>
                                    face === "Copied" ? (
                                        <DrawnCheck motion="compact" />
                                    ) : (
                                        <Icon icon={Clipboard20Regular} />
                                    )
                                }
                            />
                        </Button>
                    </Tooltip>
                    {role === "assistant" ? <WebSourcesMenu results={webSources} /> : null}
                    {role === "assistant" ? (
                    <DropdownMenu
                    open={menuOpen}
                    onOpenChange={(open) => {
                        setMenuOpen(open);
                        if (!open) {
                            setAdvanced(false);
                            setContextVeil(true);
                            setMenuStats(() => undefined);
                            setMenuModel(() => undefined);
                            return;
                        }
                        if (index < 0) return;
                        const msg = getViewedMessages()[index];
                        if (msg && msg.role === "assistant") {
                            if (msg.stats) setMenuStats(msg.stats);
                            if (msg.model) setMenuModel(msg.model);
                        }
                    }}
                    >
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Message actions"
                                className="enabled:active:scale-[0.95] data-[state=open]:bg-[var(--btn-open)] data-[state=open]:hover:bg-[var(--btn-open-hover)]"
                            >
                                <Icon icon={MoreHorizontal20Regular} />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-72 overflow-hidden p-0">
                            {index >= 0 ? (
                                <>
                                    <DropdownMenuItem
                                        className="text-md font-medium"
                                        onClick={() => onRedo?.(index)}
                                    >
                                        Regenerate
                                    </DropdownMenuItem>
                                    <DropdownMenuItem className="text-md font-medium" onClick={() => setForkOpen(true)}>
                                        Fork chat
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                </>
                            ) : null}
                            <div className="relative overflow-hidden">
                                <div className="flex flex-col gap-2 p-1 chat-text">
                                {formatMessageModelLabel(shownModel, shownStats) ? (
                                    <DetailRow label="Model" value={formatMessageModelLabel(shownModel, shownStats)} />
                                ) : null}
                                {shownStats || shownModel ? (
                                    <DetailRow
                                        label="Routing"
                                        value={
                                            shownStats?.usedAuto || isAutoModelId(shownModel)
                                                ? "Auto"
                                                : "Explicit"
                                        }
                                    />
                                ) : null}
                                {shownStats?.mode ? <DetailRow label="Mode" value={shownStats.mode} /> : null}
                                {shownStats?.reasoningEffort ? (
                                    <DetailRow
                                        label="Reasoning"
                                        value={
                                            shownStats.reasoningEffort.charAt(0).toUpperCase()
                                            + shownStats.reasoningEffort.slice(1)
                                        }
                                    />
                                ) : null}
                                {shownStats?.timeMs != null ? (
                                    <DetailRow
                                        label="Elapsed"
                                        value={
                                            shownStats.timeMs < 1000
                                                ? `${Math.round(shownStats.timeMs)}ms`
                                                : `${(shownStats.timeMs / 1000).toFixed(1)}s`
                                        }
                                    />
                                ) : null}
                                </div>
                                {hasContextWindowData(shownStats?.contextBreakdown, shownStats?.inputTokens, shownStats?.outputTokens) ? (
                                    <>
                                        <div
                                            id={contextWindowId}
                                            aria-hidden={!advanced}
                                            inert={!advanced}
                                            className="grid transition-[grid-template-rows] duration-[var(--spring-panel-dur)] ease-[var(--spring-panel)] motion-reduce:transition-none"
                                            style={{ gridTemplateRows: advanced ? "1fr" : "0fr" }}
                                        >
                                            <div className="min-h-0 overflow-hidden px-2 pt-1 pb-1">
                                                <ContextWindowMenu
                                                    breakdown={shownStats?.contextBreakdown}
                                                    inputTokens={shownStats?.inputTokens}
                                                    outputTokens={shownStats?.outputTokens}
                                                />
                                            </div>
                                        </div>
                                        <div
                                            className={cn(
                                                "pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-30 bg-linear-to-t from-surface-4 to-transparent transition-opacity duration-[var(--spring-quick-dur)] ease-[var(--spring-quick)]",
                                                contextVeil && !advanced ? "opacity-100" : "opacity-0",
                                            )}
                                            aria-hidden
                                        />
                                        {!advanced ? (
                                            <button
                                                type="button"
                                                aria-expanded={advanced}
                                                aria-controls={contextWindowId}
                                                className="relative z-10 mx-auto flex w-35 items-center justify-center gap-1 rounded-lg bg-panel-hover px-1.5 py-1 text-md font-medium text-text-secondary transition-[color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:text-text-primary active:scale-[0.97]"
                                                onClick={() => {
                                                    setAdvanced(true);
                                                    setContextVeil(false);
                                                }}
                                            >
                                                Advanced
                                                <Icon icon={ChevronDown20Regular} />
                                            </button>
                                        ) : null}
                                    </>
                                ) : null}
                            </div>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    ) : null}
                    <MessageSentTime timestamp={timestamp} />
                </div>
            )}
        </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
            <ContextMenuItem onClick={handleCopy}>
                <Icon icon={Clipboard20Regular} />
                Copy
                <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={handleQuoteMessage}>
                <Icon icon={TextQuote20Regular} />
                Quote in reply
                <ContextMenuShortcut>Ctrl+Shift+.</ContextMenuShortcut>
            </ContextMenuItem>
            {!isGenerating && index >= 0 && onFork ? (
                <ContextMenuItem onClick={() => setForkOpen(true)}>
                    <Icon icon={BranchFork20Regular} />
                    Fork chat from here
                </ContextMenuItem>
            ) : null}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleSelectAll}>
                <Icon icon={SelectAllOn20Regular} />
                Select All
                <ContextMenuShortcut>Ctrl+A</ContextMenuShortcut>
            </ContextMenuItem>
        </ContextMenuContent>
        </ContextMenu>
        <AlertDialog open={forkOpen} onOpenChange={setForkOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Fork this chat?</AlertDialogTitle>
                    <AlertDialogDescription>
                        A new chat starts from this message. Earlier turns stay as context for the AI but are not shown in the thread. The original chat is unchanged.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={() => {
                            setForkOpen(false);
                            onFork?.(index);
                        }}
                    >
                        Fork chat
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        </>
    );
};

/** Renders a key-value metadata row inside message inspection popovers. */
function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-4 px-1">
            <span className="shrink-0 text-text-primary">{label}</span>
            <span className="min-w-0 truncate text-right font-medium text-text-muted">{value}</span>
        </div>
    );
}

/**
 * Memoized: during streaming only the last message's `content` changes, so
 * earlier messages skip re-parsing/re-rendering on every token. Callers must
 * keep handler props referentially stable for this to pay off.
 */
export const ChatMessageItem = React.memo(ChatMessageItemInner);
