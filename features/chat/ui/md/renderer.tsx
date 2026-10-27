"use client";

import React, { useEffect, useMemo } from "react";
import { cn, createOccurrenceKeyer } from "@/lib/utils";
import {
    appendInlineCodeSpansInRange,
    scanMarkdownCodeFences,
    stripLeakedToolCode,
    stripOrphanThinkTags,
} from "./stream";
import { ChatMarkdown } from "./view";
import { syncSubagentsFromChunks } from "@/features/agent/subagents/store";
import {
    isRenderableWorkflowBlock,
    WORKFLOW_CHUNK_TYPES,
} from "../blocks/workflow";
import { TurnWorkflowSummary } from "../blocks/turn";
import { GeneratingIndicator } from "../blocks/generating";
import { PlanningBlock, PlanSavedBlock } from "../blocks/plan";
import {
    DesignPreviewGallery,
    type DesignPreviewItem,
} from "../blocks/gallery";
import { GeneratedMediaCard } from "../blocks/generated-media";
import { SentFileCard } from "../blocks/sent-file";
import { ReviewDebatePanel } from "../blocks/debate";
import { PersonaReviewPanel } from "../blocks/persona-review";
import { BrowseChatCard } from "../blocks/browse-frame";
import { ChartBlock, InsightCard } from "../blocks/chart";
import {
    QuestionsCard,
    parseQuestionsPayload,
    type AgentQuestion,
    type QuestionAnswers,
} from "../blocks/questions";
import { hostnameOf } from "@/lib/ui/favicon";

export type Chunk = {
    type:
        | "text" | "edit" | "edit_pending" | "search" | "grep" | "status"
        | "web_search" | "think" | "thought" | "search_result" | "web_result"
        | "web_visit" | "inspect_runtime" | "terminal_command" | "git_operation"
        | "run" | "ls" | "cat" | "create_file" | "mkdir" | "delete_file"
        | "rename_file" | "rename_chat" | "tool_result" | "plan" | "plan_saved"
        | "todos" | "attached_image" | "sent_file" | "subagent" | "subagent_ref"
        | "design_previews" | "review_debate" | "persona_review" | "question"
        | "questions" | "plugin_call" | "generated_svg" | "generated_image"
        | "generated_audio" | "browse_session" | "chart" | "insight_card";
    content?: string;
    file?: string;
    query?: string;
    original?: string;
    replacement?: string;
    isGenerating?: boolean;
    command?: string;
    commandId?: string;
    commandStatus?: string;
    commandReason?: string;
    /** Terminal session id for live output correlation. */
    sessionId?: number;
    /** Exit code once a terminal command finished. */
    exitCode?: number;
    gitOp?: string;
    gitStatus?: string;
    catStartLine?: number;
    catEndLine?: number;
    designPreviews?: DesignPreviewItem[];
    selectedConcept?: string;
    /** Model id used for adversarial review (optional attr on the tag). */
    reviewModel?: string;
    /** Inline plan markdown when the saved file is not on disk yet. */
    planMarkdown?: string;
    todos?: Array<{
        id: string;
        label: string;
        status: "done" | "active" | "pending" | "cancelled";
    }>;
    visitUrl?: string;
    visitHost?: string;
    visitTitle?: string;
    inspectKind?: string;
    pluginToolkit?: string;
    pluginSlug?: string;
    pluginLabel?: string;
    mediaPrompt?: string;
    mediaCredits?: string;
    questions?: AgentQuestion[];
    answers?: QuestionAnswers | null;
};

export type WebSearchResultItem = {
    title: string;
    url: string;
    snippet: string;
};

type TodoStepStatus = "done" | "active" | "pending" | "cancelled";

type GeneratedMediaChunkType =
    | "generated_svg"
    | "generated_image"
    | "generated_audio";

type SearchTagSpec = {
    type: Chunk["type"];
    start: string;
    end: string;
};

type MatchedTagRange = {
    type: Chunk["type"];
    index: number;
    startTag: string;
    endTag: string;
};

type TagSliceContext = {
    type: Chunk["type"];
    tagHeader: string;
    fullBlock: string;
    content: string;
    isGenerating?: boolean;
    defaultTerminalStatus: "pending" | "completed";
};

type TagChunkBuilder = (ctx: TagSliceContext) => Chunk;

/**
 * A message is a chronological sequence of segments. A sentence between
 * tool runs splits the rail, so the line stops and starts again around it.
 */
type Segment =
    | { kind: "workflow"; blocks: Chunk[] }
    | { kind: "chunk"; chunk: Chunk };

type WorkflowSegment = Extract<Segment, { kind: "workflow" }>;

type ChunkRenderContext = {
    pos: number;
    lastBrowseIndex: number;
    isGenerating?: boolean;
    isLastSegment: boolean;
};

type ChunkViewRenderer = (
    chunk: Chunk,
    ctx: ChunkRenderContext,
) => React.ReactElement | null;

const TERMINAL_STATUS_RANK: Partial<Record<string, number>> = {
    pending: 1,
    blocked: 2,
    running: 3,
    background: 3,
    rejected: 4,
    error: 4,
    cancelled: 4,
    failed: 5,
    completed: 5,
};

/** Pending edit lifecycle rank: later states replace the pending card. */
const EDIT_PENDING_STATUS_RANK: Partial<Record<string, number>> = {
    pending: 1,
    cancelled: 2,
    rejected: 3,
    applied: 4,
};

const PLUGIN_STATUS_RANK: Partial<Record<string, number>> = {
    pending: 1,
    rejected: 4,
    cancelled: 4,
    error: 4,
    ok: 5,
};

const STATUS_RANK_BY_CHUNK_TYPE: Partial<
    Record<Chunk["type"], Partial<Record<string, number>>>
> = {
    edit_pending: EDIT_PENDING_STATUS_RANK,
    plugin_call: PLUGIN_STATUS_RANK,
    terminal_command: TERMINAL_STATUS_RANK,
};

const DEDUPABLE_COMMAND_TYPES = new Set<Chunk["type"]>([
    "terminal_command",
    "edit_pending",
    "plugin_call",
]);

const TODO_STATUS_MAP: Partial<Record<string, TodoStepStatus>> = {
    completed: "done",
    done: "done",
    complete: "done",
    in_progress: "active",
    active: "active",
    cancelled: "cancelled",
    canceled: "cancelled",
};

const PREVIEW_KIND_MAP: Partial<Record<string, DesignPreviewItem["kind"]>> = {
    html: "html",
    png: "png",
    react: "react",
};

const GENERATED_MEDIA_KINDS: Record<
    GeneratedMediaChunkType,
    "svg" | "audio" | "image"
> = {
    generated_svg: "svg",
    generated_audio: "audio",
    generated_image: "image",
};

/** Builds a paired `<tag ...>...</tag>` search spec whose `Chunk["type"]` equals `tag`. */
const buildDirectTagSpec = (tag: Chunk["type"]): SearchTagSpec => ({
    type: tag,
    start: `<${tag}`,
    end: `</${tag}>`,
});

/** Builds a paired `<tag ...>...</tag>` search spec mapped to hidden `tool_result`. */
const buildHiddenToolTagSpec = (tag: string): SearchTagSpec => ({
    type: "tool_result",
    start: `<${tag}`,
    end: `</${tag}>`,
});

const DIRECT_PAIRED_TAG_PREFIX = (
    "edit edit_pending design_previews review_debate persona_review questions question " +
    "inspect_runtime search_result search grep web_search status think thought plan " +
    "plan_saved todos web_result web_visit generated_svg"
).split(" ") as Array<Chunk["type"]>;

const DIRECT_PAIRED_TAG_MID = (
    "generated_image generated_audio plugin_call browse_session chart insight_card " +
    "ls cat run create_file mkdir delete_file rename_file rename_chat"
).split(" ") as Array<Chunk["type"]>;

const HIDDEN_TOOL_TAG_NAMES = (
    "tool_result terminal_read terminal_input list_terminals tool_code tool_call " +
    "tool_calls tool_response function_call function_calls function_response " +
    "minimax:tool_call invoke parameter arg_key arg_value pre_dispatch_explanation " +
    "tools new_path analysis file_content"
).split(" ");

const SEARCH_TAGS: SearchTagSpec[] = [
    ...DIRECT_PAIRED_TAG_PREFIX.map(buildDirectTagSpec),
    { type: "generated_svg", start: "<recraft_svg", end: "</recraft_svg>" },
    ...DIRECT_PAIRED_TAG_MID.map(buildDirectTagSpec),
    { type: "subagent_ref", start: "<subagent_ref", end: "/>" },
    buildDirectTagSpec("subagent"),
    buildDirectTagSpec("terminal_command"),
    buildDirectTagSpec("git_operation"),
    ...HIDDEN_TOOL_TAG_NAMES.map(buildHiddenToolTagSpec),
    buildDirectTagSpec("attached_image"),
    buildDirectTagSpec("sent_file"),
];

const SEARCH_TAG_BY_PREFIX: ReadonlyMap<string, SearchTagSpec> = new Map(
    SEARCH_TAGS.map((spec) => [spec.start, spec]),
);

/** Extracts the hostname from a URL string via the shared favicon helper. */
const hostnameFromUrl = (url: string): string => hostnameOf(url);

/** Parses optional JSON payload text for rich chat cards, returning `null` when empty or invalid. */
const parseCardJson = <T,>(raw: string | undefined): T | null => {
    const text = (raw ?? "").trim();
    if (!text) return null;
    try {
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
};

/** Decodes basic XML character entities (`&quot;`, `&lt;`, `&amp;`) inside card attributes. */
const decodeXml = (value: string): string =>
    value
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&amp;/g, "&");

/** Unescapes XML character entities including `&gt;` in serialized preview markup. */
const unescapeXml = (value: string): string =>
    value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");

/** Decodes XML attribute entities including `&apos;` and `&gt;` in command tags. */
const decodeXmlAttr = (raw: string): string =>
    raw
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");

/** Checks whether `tagText[pos]` sits on an attribute-name boundary. */
const isAttrNameStartAt = (tagText: string, pos: number): boolean =>
    pos === 0 || !/[A-Za-z0-9_]/u.test(tagText[pos - 1]);

/** Reads a double-quoted XML attribute value (`name="..."`) from an opening tag string. */
const readAttr = (tagText: string, name: string): string => {
    const prefix = `${name}="`;
    let from = 0;
    while (from < tagText.length) {
        const hit = tagText.indexOf(prefix, from);
        if (hit === -1) return "";
        if (isAttrNameStartAt(tagText, hit)) {
            const valStart = hit + prefix.length;
            const valEnd = tagText.indexOf('"', valStart);
            return valEnd === -1 ? "" : tagText.slice(valStart, valEnd);
        }
        from = hit + 1;
    }
    return "";
};

/** Reads an optional non-empty XML attribute value, returning `undefined` when absent or blank. */
const readOptionalAttr = (tagText: string, name: string): string | undefined => {
    const value = readAttr(tagText, name);
    return value ? value : undefined;
};

/** Parses a positive integer attribute value or returns `fallback`. */
const parsePositiveIntOr = (raw: string, fallback: number): number => {
    const parsed = Number.parseInt(raw, 10);
    return parsed > 0 ? parsed : fallback;
};

/** Parses an optional integer attribute value, returning `undefined` when missing or NaN. */
const parseOptionalInt = (raw: string | undefined): number | undefined => {
    if (!raw) return undefined;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
};

/** Attaches `isGenerating` only when defined so self-closing chunk shapes stay exact. */
const withOptionalGenerating = (
    chunk: Chunk,
    isGenerating: boolean | undefined,
): Chunk => (isGenerating === undefined ? chunk : { ...chunk, isGenerating });

/** Computes the lifecycle rank for a deduplicable command, edit, or plugin chunk. */
const rankCommandChunk = (chunk: Chunk): number => {
    const table = STATUS_RANK_BY_CHUNK_TYPE[chunk.type];
    const status = chunk.commandStatus;
    if (!table || !status) return 0;
    return table[status] ?? 0;
};

/** Builds a deduplication key (`type:commandId`) when a chunk carries a command identifier. */
const commandDedupeKey = (chunk: Chunk): string | null => {
    if (!DEDUPABLE_COMMAND_TYPES.has(chunk.type) || !chunk.commandId) return null;
    return `${chunk.type}:${chunk.commandId}`;
};

/** Marks superseded command chunks in `skip` by comparing lifecycle ranks per `commandId`. */
const markSupersededByCommandId = (chunks: Chunk[], skip: Set<number>): void => {
    const byId = new Map<string, number>();
    for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const key = commandDedupeKey(chunk);
        if (!key) continue;
        const existing = byId.get(key);
        if (existing === undefined) {
            byId.set(key, index);
        } else if (rankCommandChunk(chunk) >= rankCommandChunk(chunks[existing])) {
            skip.add(existing);
            byId.set(key, index);
        } else {
            skip.add(index);
        }
    }
};

/** Extracts the trimmed pending terminal command key, or `null` when not applicable. */
const pendingTerminalCommandKey = (chunk: Chunk): string | null => {
    if (chunk.type !== "terminal_command" || chunk.commandStatus !== "pending") {
        return null;
    }
    const cmd = chunk.command?.trim();
    return cmd ? cmd : null;
};

/**
 * Collapses superseded pending `terminal_command` transcript blocks with identical command text
 * so only the latest pending entry renders; Rust `run_with_approval` blocks sequentially on one
 * pending command at a time, and interactive approval cards read from `agent-command-pending` IPC.
 */
const markDuplicatePendingCommands = (chunks: Chunk[], skip: Set<number>): void => {
    const byPendingCommand = new Map<string, number>();
    for (let index = 0; index < chunks.length; index += 1) {
        if (skip.has(index)) continue;
        const cmd = pendingTerminalCommandKey(chunks[index]);
        if (!cmd) continue;
        const existing = byPendingCommand.get(cmd);
        if (existing !== undefined) {
            skip.add(existing);
        }
        byPendingCommand.set(cmd, index);
    }
};

/** Keep one terminal_command / edit_pending block per id (or per command when pending). Prefer higher status. */
export const dedupeTerminalChunks = (chunks: Chunk[]): Chunk[] => {
    const skip = new Set<number>();
    markSupersededByCommandId(chunks, skip);
    markDuplicatePendingCommands(chunks, skip);
    return chunks.filter((_, index) => !skip.has(index));
};

/** Extracts inner tag content `<tag>...</tag>` from a serialized block string. */
const getInnerTagContent = (block: string, tag: string): string | undefined => {
    const startTag = `<${tag}>`;
    const start = block.indexOf(startTag);
    if (start === -1) return undefined;
    const end = block.indexOf(`</${tag}>`, start);
    const slice =
        end === -1
            ? block.slice(start + startTag.length)
            : block.slice(start + startTag.length, end);
    return slice.replace(/^\n|\n$/g, "");
};

/** Parses an `<edit>` diff block into a structured edit chunk. */
const parseEditBlock = (block: string, isGenerating: boolean): Chunk => ({
    type: "edit",
    file: block.match(/<edit\s+file="([^"]*)"/)?.[1],
    original: getInnerTagContent(block, "original") ?? "",
    replacement: getInnerTagContent(block, "replacement") ?? "",
    isGenerating,
});

/** Parses an `<edit_pending>` approval block into a structured pending-edit chunk. */
const parseEditPendingBlock = (
    tagHeader: string,
    block: string,
    isGenerating: boolean,
): Chunk => ({
    type: "edit_pending",
    file: readOptionalAttr(tagHeader, "file"),
    commandId: readOptionalAttr(tagHeader, "id"),
    commandStatus: readOptionalAttr(tagHeader, "status") ?? "pending",
    original: getInnerTagContent(block, "original") ?? "",
    replacement: getInnerTagContent(block, "replacement") ?? "",
    isGenerating,
});

/** Resolves inline markdown body for a `<plan_saved>` block when present. */
const resolvePlanSavedMarkdown = (
    block: string,
    innerContent?: string,
): string | undefined => {
    const trimmedInner = innerContent?.trim();
    if (trimmedInner) return trimmedInner;
    const fallback = getInnerTagContent(block, "plan_saved");
    return fallback ? fallback : undefined;
};

/** Parses a `<plan_saved>` tag into a saved-plan card chunk. */
const parsePlanSavedBlock = (
    tagHeader: string,
    block: string,
    innerContent?: string,
): Chunk => ({
    type: "plan_saved",
    file: readOptionalAttr(tagHeader, "path"),
    content: readOptionalAttr(tagHeader, "title") ?? "Implementation Plan",
    planMarkdown: resolvePlanSavedMarkdown(block, innerContent),
});

/** Parses a `<plan>` step-list tag into a plan chunk. */
const parsePlanBlock = (block: string): Chunk => ({
    type: "plan",
    content: block,
    file: block.match(/<plan\s+title="([^"]*)"/)?.[1] ?? "Plan",
});

/** Checks whether `code` is an ASCII single or double quote (`"` or `'`). */
const isAsciiQuoteCode = (code: number): boolean => code === 34 || code === 39;

/** Checks whether `text` begins a closing XML tag (`</`) at `idx`. */
const isClosingXmlTagStart = (text: string, idx: number): boolean =>
    text.charCodeAt(idx) === 60 && text.charCodeAt(idx + 1) === 47;

/** Checks whether `text` hits a newline or `</` closing tag before closing a quote. */
const isUnterminatedQuoteBreak = (
    text: string,
    idx: number,
    code: number,
): boolean => code === 10 || isClosingXmlTagStart(text, idx);

/** Checks whether `idx` sits on the unclosed `mcp=">` marker emitted by Rust MCP approvals. */
const isUnclosedMcpMarkerAt = (text: string, idx: number): boolean =>
    idx >= 4 && text.slice(idx - 4, idx + 2) === 'mcp=">';

/** Advances past a quoted XML attribute value starting at `openIdx` (`"` or `'`). */
const skipQuotedTagAttr = (
    text: string,
    openIdx: number,
    quoteCode: number,
): number => {
    let idx = openIdx + 1;
    while (idx < text.length) {
        const code = text.charCodeAt(idx);
        if (code === 92) {
            idx += 2;
            continue;
        }
        if (code === quoteCode) return idx + 1;
        if (isUnterminatedQuoteBreak(text, idx, code)) return -2;
        idx += 1;
    }
    return -1;
};

/** Resolves scanner continuation offset after a quoted attribute inside an opening tag. */
const resolveAfterQuotedAttr = (
    text: string,
    idx: number,
    code: number,
): { done: true; gtIndex: number } | { done: false; nextIdx: number } => {
    if (isUnclosedMcpMarkerAt(text, idx)) {
        return { done: true, gtIndex: idx + 1 };
    }
    const afterQuote = skipQuotedTagAttr(text, idx, code);
    if (afterQuote === -1) return { done: true, gtIndex: -1 };
    if (afterQuote === -2) {
        return { done: true, gtIndex: text.indexOf(">", idx + 1) };
    }
    return { done: false, nextIdx: afterQuote };
};

/** Finds the closing `>` of an XML opening tag starting at `fromIndex`, ignoring quoted `>`. */
const findTagHeaderCloseIndex = (text: string, fromIndex: number): number => {
    let idx = fromIndex;
    while (idx < text.length) {
        const code = text.charCodeAt(idx);
        if (code === 62) return idx;
        if (isAsciiQuoteCode(code)) {
            const step = resolveAfterQuotedAttr(text, idx, code);
            if (step.done) return step.gtIndex;
            idx = step.nextIdx;
        } else {
            idx += 1;
        }
    }
    return -1;
};

type ChildXmlMatch = {
    attrs: string;
    body: string;
};

const XML_CHILD_BOUNDARY_CODES = new Set([9, 10, 13, 32, 47, 62]);

/** Reads body and closing tag of a non-self-closing child XML element after `gtIdx`. */
const readPairedChildXmlBody = (
    block: string,
    afterName: number,
    gtIdx: number,
    closeTag: string,
): { item: ChildXmlMatch | null; nextCursor: number } => {
    const closeIdx = block.indexOf(closeTag, gtIdx + 1);
    if (closeIdx === -1) return { item: null, nextCursor: block.length };
    return {
        item: {
            attrs: block.slice(afterName, gtIdx),
            body: block.slice(gtIdx + 1, closeIdx),
        },
        nextCursor: closeIdx + closeTag.length,
    };
};

/** Consumes one `<tagName ...>...</tagName>` or `<tagName .../>` at `openIdx`, or `null`. */
const readChildXmlElementAt = (
    block: string,
    openIdx: number,
    openPrefix: string,
    closeTag: string,
): { item: ChildXmlMatch | null; nextCursor: number } => {
    const afterName = openIdx + openPrefix.length;
    if (!XML_CHILD_BOUNDARY_CODES.has(block.charCodeAt(afterName))) {
        return { item: null, nextCursor: afterName };
    }
    const gtIdx = findTagHeaderCloseIndex(block, afterName);
    if (gtIdx === -1) return { item: null, nextCursor: block.length };
    if (block.charCodeAt(gtIdx - 1) === 47) {
        return {
            item: { attrs: block.slice(afterName, gtIdx - 1), body: "" },
            nextCursor: gtIdx + 1,
        };
    }
    return readPairedChildXmlBody(block, afterName, gtIdx, closeTag);
};

/** Scans all `<tagName ...>` child elements inside `block` in linear time without regexes. */
const scanChildXmlElements = (
    block: string,
    tagName: string,
    closeTag: string,
): ChildXmlMatch[] => {
    const openPrefix = `<${tagName}`;
    const results: ChildXmlMatch[] = [];
    let cursor = 0;
    while (cursor < block.length) {
        const openIdx = block.indexOf(openPrefix, cursor);
        if (openIdx === -1) break;
        const step = readChildXmlElementAt(block, openIdx, openPrefix, closeTag);
        if (step.item) results.push(step.item);
        cursor = step.nextCursor;
    }
    return results;
};

/** Parses a single `<todo ...>label</todo>` child element into a normalized todo item. */
const parseTodoEntry = (
    entry: ChildXmlMatch,
): { id: string; label: string; status: TodoStepStatus } => {
    const statusRaw = (
        readOptionalAttr(entry.attrs, "status") ?? "pending"
    ).toLowerCase();
    return {
        id: readAttr(entry.attrs, "id"),
        label: entry.body.trim(),
        status: TODO_STATUS_MAP[statusRaw] ?? "pending",
    };
};

/** Parses a `<todos>` block into a normalized todo-list chunk. */
const parseTodosBlock = (block: string): Chunk => {
    const title = block.match(/<todos\s+title="([^"]*)"/u)?.[1] ?? "Todos";
    const todoMatches = scanChildXmlElements(block, "todo", "</todo>");
    return {
        type: "todos",
        content: title,
        todos: todoMatches.map(parseTodoEntry),
    };
};

/** Resolves subagent name attribute (`agent` preferred over `name`). */
const resolveSubagentName = (tagFull: string): string => {
    const agent = readAttr(tagFull, "agent");
    return agent ? agent : readAttr(tagFull, "name");
};

/** Resolves status attribute with a streaming-aware fallback (`running` vs `done`). */
const resolveRunOrDoneStatus = (
    tagFull: string,
    isGenerating: boolean,
    doneLabel: string,
): string => {
    const explicit = readAttr(tagFull, "status");
    if (explicit) return explicit;
    return isGenerating ? "running" : doneLabel;
};

/** Parses a `<subagent>` block into a subagent transcript chunk. */
const parseSubagentBlock = (
    tagFull: string,
    inner: string,
    isGenerating: boolean,
): Chunk => ({
    type: "subagent",
    file: readAttr(tagFull, "id"),
    query: resolveSubagentName(tagFull),
    command: readAttr(tagFull, "model"),
    content: inner.trim(),
    commandStatus: resolveRunOrDoneStatus(tagFull, isGenerating, "done"),
    isGenerating,
});

/** Parses a self-closing `<subagent_ref ... />` tag into a subagent reference chunk. */
const parseSubagentRefBlock = (tagFull: string, isGenerating: boolean): Chunk => ({
    type: "subagent_ref",
    file: readAttr(tagFull, "id"),
    query: readAttr(tagFull, "agent"),
    command: readAttr(tagFull, "model"),
    content: readAttr(tagFull, "task"),
    commandStatus: resolveRunOrDoneStatus(tagFull, isGenerating, "done"),
    isGenerating,
});

/** Parses a `<git_operation>` tag into a git workflow chunk. */
const parseGitOperationBlock = (
    tagFull: string,
    content: string,
    isGenerating: boolean,
): Chunk => ({
    type: "git_operation",
    content,
    gitOp: readOptionalAttr(tagFull, "op"),
    gitStatus: resolveRunOrDoneStatus(tagFull, isGenerating, "completed"),
    isGenerating,
});

/** Resolves the first defined attribute from two candidate attribute names. */
const readAttrPair = (
    tagFull: string,
    primary: string,
    secondary: string,
): string | undefined =>
    readOptionalAttr(tagFull, primary) ?? readOptionalAttr(tagFull, secondary);

/** Parses a `<cat>` file-read block with optional line-range bounds. */
const parseCatBlock = (
    tagFull: string,
    content: string,
    isGenerating: boolean,
): Chunk => ({
    type: "cat",
    content: readOptionalAttr(tagFull, "path") ?? content.trim(),
    catStartLine: parseOptionalInt(readAttrPair(tagFull, "start", "startLine")),
    catEndLine: parseOptionalInt(readAttrPair(tagFull, "end", "endLine")),
    isGenerating,
});

/** Resolves inline source markup for a `<design_preview>` item when present. */
const resolvePreviewSource = (attrs: string, inner: string): string => {
    const fromInner = unescapeXml(inner).trim();
    return fromInner ? fromInner : unescapeXml(readAttr(attrs, "source")).trim();
};

/** Builds a `DesignPreviewItem` from tag attributes and inner text, or `null` when incomplete. */
const buildDesignPreviewItem = (
    attrs: string,
    inner: string,
): DesignPreviewItem | null => {
    const previewId = readAttr(attrs, "id");
    const path = readAttr(attrs, "path");
    const source = resolvePreviewSource(attrs, inner);
    if (!previewId.trim() || (!path.trim() && !source)) return null;
    return {
        id: previewId,
        name: readAttr(attrs, "name"),
        style: readAttr(attrs, "style"),
        path,
        source: source ? source : undefined,
        width: parsePositiveIntOr(readAttr(attrs, "width"), 1280),
        height: parsePositiveIntOr(readAttr(attrs, "height"), 800),
        renderMs: parseOptionalInt(readOptionalAttr(attrs, "render_ms")),
        kind: PREVIEW_KIND_MAP[readAttr(attrs, "kind")],
    };
};

/** Reads a regex capture group as a string, defaulting to `""`. */
const captureOrEmpty = (value: string | undefined): string => value ?? "";

/** Appends unique `<design_preview>` child elements from `block` into `previews`. */
const collectDesignPreviewElements = (block: string): DesignPreviewItem[] => {
    const previews: DesignPreviewItem[] = [];
    const seenIds = new Set<string>();
    for (const entry of scanChildXmlElements(
        block,
        "design_preview",
        "</design_preview>",
    )) {
        const item = buildDesignPreviewItem(entry.attrs, entry.body);
        if (item && !seenIds.has(item.id)) {
            seenIds.add(item.id);
            previews.push(item);
        }
    }
    return previews;
};

/** Parses a `<design_previews>` gallery block into a structured chunk. */
const parseDesignPreviewsBlock = (block: string): Chunk => {
    const openEnd = findTagHeaderCloseIndex(block, 0);
    const open = openEnd === -1 ? "" : block.slice(0, openEnd + 1);
    const previews = collectDesignPreviewElements(block);
    return {
        type: "design_previews",
        designPreviews: previews,
        selectedConcept: readAttr(open, "selected"),
        commandId: readOptionalAttr(open, "id"),
        commandStatus: readOptionalAttr(open, "status"),
    };
};

/** Parses a `<review_debate>` panel block. */
const parseReviewDebateBlock = (tagHeader: string, content: string): Chunk => ({
    type: "review_debate",
    content: content.trim(),
    reviewModel: readOptionalAttr(tagHeader, "model"),
});

/** Parses a `<persona_review>` panel block. */
const parsePersonaReviewBlock = (tagHeader: string, content: string): Chunk => ({
    type: "persona_review",
    content: content.trim(),
    commandId: readOptionalAttr(tagHeader, "id"),
    commandStatus: readOptionalAttr(tagHeader, "status"),
    visitUrl: readOptionalAttr(tagHeader, "url"),
});

/** Parses a `<question>` or `<questions>` interactive prompt card block. */
const parseQuestionBlock = (tagHeader: string, content: string): Chunk => {
    const inner = content.trim();
    const { questions, answers } = parseQuestionsPayload(inner);
    return {
        type: "question",
        content: inner,
        commandId: readOptionalAttr(tagHeader, "id"),
        commandStatus: readOptionalAttr(tagHeader, "status"),
        questions,
        answers,
    };
};

/** Parses a `<plugin_call>` block into a plugin execution chunk. */
const parsePluginCallBlock = (
    tagFull: string,
    content: string,
    isGenerating: boolean,
): Chunk => ({
    type: "plugin_call",
    content,
    pluginToolkit: readOptionalAttr(tagFull, "toolkit"),
    pluginSlug: readOptionalAttr(tagFull, "slug"),
    pluginLabel: readOptionalAttr(tagFull, "label"),
    commandId: readOptionalAttr(tagFull, "id"),
    commandStatus: readOptionalAttr(tagFull, "status") ?? "ok",
    isGenerating,
});

/** Decodes an XML attribute when non-empty, returning `fallback` otherwise. */
const decodeAttrOr = (
    tagFull: string,
    name: string,
    fallback: string,
): string => {
    const decoded = decodeXml(readAttr(tagFull, name));
    return decoded ? decoded : fallback;
};

/** Decodes an optional XML attribute when non-empty, returning `undefined` otherwise. */
const decodeOptionalAttr = (
    tagFull: string,
    name: string,
): string | undefined => {
    const decoded = decodeXml(readAttr(tagFull, name));
    return decoded ? decoded : undefined;
};

/** Parses a `<sent_file>` attachment block into a sent-file card chunk. */
const parseSentFileBlock = (tagFull: string, content: string): Chunk => ({
    type: "sent_file",
    file: decodeAttrOr(tagFull, "name", "File"),
    query: readOptionalAttr(tagFull, "type") ?? "application/octet-stream",
    mediaPrompt: decodeOptionalAttr(tagFull, "title"),
    content: content.trim(),
});

/** Parses generated SVG, image, or audio blocks into a unified media chunk. */
const parseGeneratedMediaBlock = (
    type: GeneratedMediaChunkType,
    tagFull: string,
    content: string,
    isGenerating: boolean,
): Chunk => {
    const prompt = readOptionalAttr(tagFull, "prompt");
    return {
        type,
        content: content.trim(),
        mediaPrompt: prompt,
        mediaCredits: readOptionalAttr(tagFull, "credits"),
        query: prompt,
        isGenerating,
    };
};

/** Parses a rich card tag (`<browse_session>`, etc.) carrying optional URL/title/status metadata. */
const parseRichCard = (
    type: Chunk["type"],
    tagFull: string,
    content: string,
    isGenerating: boolean,
): Chunk => ({
    type,
    content,
    visitUrl: decodeOptionalAttr(tagFull, "url"),
    visitTitle: decodeOptionalAttr(tagFull, "title"),
    commandId: readOptionalAttr(tagFull, "id"),
    commandStatus: readOptionalAttr(tagFull, "status"),
    isGenerating,
});

/** Parses a `<web_visit>` citation block with host/title fallback derivation. */
const parseWebVisitBlock = (tagFull: string, isGenerating: boolean): Chunk => {
    const url = readAttr(tagFull, "url");
    const host = readOptionalAttr(tagFull, "host") ?? hostnameFromUrl(url);
    return {
        type: "web_visit",
        visitUrl: url,
        visitHost: host,
        visitTitle: readOptionalAttr(tagFull, "title") ?? host,
        content: host,
        isGenerating,
    };
};

/** Finds the index of the last non-blank line in `lines`, or `-1` when all lines are blank. */
const findLastNonEmptyLineIndex = (lines: string[]): number => {
    for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
        if ((lines[idx] ?? "").trim().length > 0) return idx;
    }
    return -1;
};

const APPROVAL_COMMAND_STATUSES = new Set(["pending", "blocked"]);

/** Reads the last non-blank line at `footerIdx`, or `""` when `footerIdx < 0`. */
const readLineAtOrEmpty = (lines: string[], idx: number): string =>
    idx >= 0 ? captureOrEmpty(lines[idx]) : "";

/** Extracts trailing approval/blocked footer metadata from a pending or blocked terminal block. */
const extractApprovalFooter = (
    rawLines: string[],
    commandStatus: string,
): { reasonIdx: number; footerReason?: string } => {
    if (!APPROVAL_COMMAND_STATUSES.has(commandStatus)) return { reasonIdx: -1 };
    const footerIdx = findLastNonEmptyLineIndex(rawLines);
    const footerLine = readLineAtOrEmpty(rawLines, footerIdx);
    if (!/^(?:Awaiting approval:|Blocked:)\s/.test(footerLine)) {
        return { reasonIdx: -1 };
    }
    return {
        reasonIdx: footerIdx,
        footerReason: footerLine
            .replace(/^(?:Awaiting approval:|Blocked:)\s*/, "")
            .trim(),
    };
};

/** Resolves the approval/blocked reason from `reason="..."` attribute or trailing footer line. */
const resolveTerminalCommandReason = (
    tagFull: string,
    footerReason: string | undefined,
): string | undefined => {
    const rawAttr = readOptionalAttr(tagFull, "reason");
    const fromAttr = rawAttr ? decodeXmlAttr(rawAttr).trim() : "";
    return fromAttr ? fromAttr : footerReason;
};

/** Collects leading backslash-continued shell lines from completed terminal block content. */
const collectCompletedShellCommand = (rawLines: string[]): string => {
    const nonEmptyStart = rawLines.findIndex((line) => line.trim().length > 0);
    if (nonEmptyStart === -1) return "";
    const collected: string[] = [];
    for (let idx = nonEmptyStart; idx < rawLines.length; idx += 1) {
        const line = rawLines[idx] ?? "";
        collected.push(line);
        if (!/\\\s*$/.test(line)) break;
    }
    return collected.join("\n").trim();
};

const FULL_BODY_COMMAND_STATUSES = new Set([
    "running",
    "rejected",
    "cancelled",
]);

/** Slices terminal command lines prior to an approval footer index when present. */
const sliceApprovalCommandLines = (
    rawLines: string[],
    reasonIdx: number,
): string => {
    const slice = reasonIdx === -1 ? rawLines : rawLines.slice(0, reasonIdx);
    return slice.join("\n").trim();
};

/** Extracts the shell command text from `<terminal_command>` attributes or body lines. */
const resolveParsedTerminalCommand = (
    tagFull: string,
    content: string,
    rawLines: string[],
    commandStatus: string,
    reasonIdx: number,
): string => {
    const cmdAttr = readOptionalAttr(tagFull, "command");
    if (cmdAttr) return decodeXmlAttr(cmdAttr).trim();
    if (APPROVAL_COMMAND_STATUSES.has(commandStatus)) {
        return sliceApprovalCommandLines(rawLines, reasonIdx);
    }
    if (FULL_BODY_COMMAND_STATUSES.has(commandStatus)) {
        return content.trim();
    }
    return collectCompletedShellCommand(rawLines);
};

/** Parses the exit code from `exit_code="..."` or `exit="..."` on `<terminal_command>`. */
const parseTerminalExitCode = (tagFull: string): number | undefined => {
    const raw = tagFull.match(/\b(?:exit_code|exit)="(-?\d+)"/)?.[1];
    return raw ? Number(raw) : undefined;
};

/** Parses a `<terminal_command>` block into a structured terminal chunk. */
const parseTerminalCommandBlock = (
    tagFull: string,
    content: string,
    defaultStatus: string,
    isGenerating?: boolean,
): Chunk => {
    const commandStatus = readOptionalAttr(tagFull, "status") ?? defaultStatus;
    const rawLines = content.split("\n");
    const { reasonIdx, footerReason } = extractApprovalFooter(
        rawLines,
        commandStatus,
    );
    const sessionRaw = tagFull.match(/\bsession="(\d+)"/)?.[1];
    return withOptionalGenerating(
        {
            type: "terminal_command",
            content,
            command: resolveParsedTerminalCommand(
                tagFull,
                content,
                rawLines,
                commandStatus,
                reasonIdx,
            ),
            commandId: readOptionalAttr(tagFull, "id"),
            commandStatus,
            commandReason: resolveTerminalCommandReason(tagFull, footerReason),
            sessionId: sessionRaw ? Number(sessionRaw) : undefined,
            exitCode: parseTerminalExitCode(tagFull),
        },
        isGenerating,
    );
};

/** Parses an `<inspect_runtime>` browser/runtime inspection block. */
const parseInspectRuntimeBlock = (
    tagFull: string,
    content: string,
    isGenerating: boolean,
): Chunk => ({
    type: "inspect_runtime",
    query: readAttr(tagFull, "url"),
    inspectKind: readAttr(tagFull, "kind"),
    content,
    isGenerating,
});

/** Parses `<web_result>`, `<search_result>`, and `<grep>` blocks with optional `query` attribute. */
const buildQueryResultChunk = (ctx: TagSliceContext): Chunk => {
    const rawQuery = readOptionalAttr(ctx.tagHeader, "query");
    return withOptionalGenerating(
        {
            type: ctx.type,
            content: ctx.content,
            query: rawQuery ? decodeXmlAttr(rawQuery) : undefined,
        },
        ctx.isGenerating,
    );
};

/** Parses a `<run>` command block, trimming command text when content is present. */
const buildRunChunk = (ctx: TagSliceContext): Chunk =>
    withOptionalGenerating(
        {
            type: "run",
            content: ctx.content,
            command: ctx.isGenerating === undefined ? "" : ctx.content.trim(),
        },
        ctx.isGenerating,
    );

/** Builds a generated media chunk from a `TagSliceContext`. */
const buildGeneratedMediaFromCtx = (ctx: TagSliceContext): Chunk =>
    parseGeneratedMediaBlock(
        ctx.type as GeneratedMediaChunkType,
        ctx.tagHeader,
        ctx.content,
        Boolean(ctx.isGenerating),
    );

const TAG_CHUNK_BUILDERS: Partial<Record<Chunk["type"], TagChunkBuilder>> = {
    edit: (ctx) => parseEditBlock(ctx.fullBlock, Boolean(ctx.isGenerating)),
    edit_pending: (ctx) =>
        parseEditPendingBlock(
            ctx.tagHeader,
            ctx.fullBlock,
            Boolean(ctx.isGenerating),
        ),
    plan: (ctx) => parsePlanBlock(ctx.fullBlock),
    plan_saved: (ctx) =>
        parsePlanSavedBlock(ctx.tagHeader, ctx.fullBlock, ctx.content),
    todos: (ctx) => parseTodosBlock(ctx.fullBlock),
    terminal_command: (ctx) =>
        parseTerminalCommandBlock(
            ctx.tagHeader,
            ctx.content,
            ctx.defaultTerminalStatus,
            ctx.isGenerating,
        ),
    git_operation: (ctx) =>
        parseGitOperationBlock(
            ctx.tagHeader,
            ctx.content,
            Boolean(ctx.isGenerating),
        ),
    cat: (ctx) =>
        parseCatBlock(ctx.tagHeader, ctx.content, Boolean(ctx.isGenerating)),
    subagent_ref: (ctx) =>
        parseSubagentRefBlock(ctx.tagHeader, Boolean(ctx.isGenerating)),
    subagent: (ctx) =>
        parseSubagentBlock(
            ctx.tagHeader,
            ctx.content,
            Boolean(ctx.isGenerating),
        ),
    design_previews: (ctx) => parseDesignPreviewsBlock(ctx.fullBlock),
    review_debate: (ctx) => parseReviewDebateBlock(ctx.tagHeader, ctx.content),
    persona_review: (ctx) => parsePersonaReviewBlock(ctx.tagHeader, ctx.content),
    question: (ctx) => parseQuestionBlock(ctx.tagHeader, ctx.content),
    questions: (ctx) => parseQuestionBlock(ctx.tagHeader, ctx.content),
    run: buildRunChunk,
    web_result: buildQueryResultChunk,
    search_result: buildQueryResultChunk,
    grep: buildQueryResultChunk,
    web_visit: (ctx) =>
        parseWebVisitBlock(ctx.tagHeader, Boolean(ctx.isGenerating)),
    inspect_runtime: (ctx) =>
        parseInspectRuntimeBlock(
            ctx.tagHeader,
            ctx.content,
            Boolean(ctx.isGenerating),
        ),
    browse_session: (ctx) =>
        parseRichCard(
            ctx.type,
            ctx.tagHeader,
            ctx.content,
            Boolean(ctx.isGenerating),
        ),
    plugin_call: (ctx) =>
        parsePluginCallBlock(
            ctx.tagHeader,
            ctx.content,
            Boolean(ctx.isGenerating),
        ),
    generated_svg: buildGeneratedMediaFromCtx,
    generated_image: buildGeneratedMediaFromCtx,
    generated_audio: buildGeneratedMediaFromCtx,
    sent_file: (ctx) => parseSentFileBlock(ctx.tagHeader, ctx.content),
};

/** Builds a `Chunk` from a matched tag slice using `TAG_CHUNK_BUILDERS` or generic fallback. */
const buildChunkFromSlice = (ctx: TagSliceContext): Chunk => {
    const builder = TAG_CHUNK_BUILDERS[ctx.type];
    if (builder) return builder(ctx);
    return withOptionalGenerating(
        {
            type: ctx.type,
            content: ctx.content,
        },
        ctx.isGenerating,
    );
};

/** Checks whether `ch` is a valid delimiter immediately following an open XML tag name. */
const isOpenTagNameDelimiter = (ch: string | undefined): boolean =>
    ch === undefined || ch === ">" || ch === "/" || ch === "=" || /\s/u.test(ch);

/** Checks whether UTF-16 code unit `code` can appear in a structured tag identifier (`a-z`, `_`, `:`). */
const isStructuredTagNameChar = (code: number): boolean =>
    (code >= 97 && code <= 122) || code === 95 || code === 58;

/** Scans contiguous structured-tag identifier characters starting at `start`. */
const readStructuredTagEnd = (text: string, start: number): number => {
    let cursor = start;
    while (
        cursor < text.length &&
        isStructuredTagNameChar(text.charCodeAt(cursor))
    ) {
        cursor += 1;
    }
    return cursor;
};

/** Attempts an $O(1)$ lookup for a structured open tag anchored at `<` (`ltIndex`). */
const matchStructuredTagAt = (
    text: string,
    ltIndex: number,
): MatchedTagRange | null => {
    const nameEnd = readStructuredTagEnd(text, ltIndex + 1);
    if (nameEnd === ltIndex + 1 || !isOpenTagNameDelimiter(text[nameEnd])) {
        return null;
    }
    const spec = SEARCH_TAG_BY_PREFIX.get(text.slice(ltIndex, nameEnd));
    if (!spec) return null;
    return {
        type: spec.type,
        index: ltIndex,
        startTag: spec.start,
        endTag: spec.end,
    };
};

/** Returns the end offset of a fenced code range containing `index` in amortized $O(1)$ via `fenceCursor`. */
const findContainingFenceEnd = (
    index: number,
    fenceRanges: ReadonlyArray<readonly [number, number]>,
    fenceCursor: { idx: number },
): number => {
    while (
        fenceCursor.idx < fenceRanges.length &&
        fenceRanges[fenceCursor.idx][1] <= index
    ) {
        fenceCursor.idx += 1;
    }
    if (fenceCursor.idx >= fenceRanges.length) return -1;
    const [start, end] = fenceRanges[fenceCursor.idx];
    return index >= start ? end : -1;
};

/** Finds the earliest structured XML tag outside `fenceRanges` in a single linear `<` pass. */
const findNextStructuredTag = (
    text: string,
    fromIndex: number,
    fenceRanges: ReadonlyArray<readonly [number, number]>,
    fenceCursor: { idx: number },
): MatchedTagRange | null => {
    let cursor = fromIndex;
    while (cursor < text.length) {
        const ltIndex = text.indexOf("<", cursor);
        if (ltIndex === -1) return null;
        const fenceEnd = findContainingFenceEnd(
            ltIndex,
            fenceRanges,
            fenceCursor,
        );
        if (fenceEnd !== -1) {
            cursor = fenceEnd;
        } else {
            const matched = matchStructuredTagAt(text, ltIndex);
            if (matched) return matched;
            cursor = ltIndex + 1;
        }
    }
    return null;
};

/** Appends a chunk to `chunks`, replacing any prior `todos` chunk in place. */
const pushParsedChunk = (chunks: Chunk[], chunk: Chunk): void => {
    if (chunk.type === "todos") {
        const existingIdx = chunks.findIndex((item) => item.type === "todos");
        if (existingIdx >= 0) {
            chunks[existingIdx] = chunk;
            return;
        }
    }
    chunks.push(chunk);
};

/** Appends sanitized plain-text segment between `start` and `end` when non-empty. */
const pushSanitizedTextSlice = (
    chunks: Chunk[],
    text: string,
    start: number,
    end?: number,
): void => {
    const cleaned = stripOrphanThinkTags(text.slice(start, end));
    if (cleaned) {
        chunks.push({ type: "text", content: cleaned });
    }
};

/** Collects sorted non-overlapping fenced and inline code ranges across `text`. */
const collectProtectedCodeRanges = (
    text: string,
): Array<readonly [number, number]> => {
    const fenceRanges = scanMarkdownCodeFences(text, 0).ranges;
    if (!text.includes("`")) return fenceRanges;
    const out: Array<[number, number]> = [];
    let cursor = 0;
    for (const [start, end] of fenceRanges) {
        if (start > cursor) {
            appendInlineCodeSpansInRange(text, cursor, start, out);
        }
        out.push([start, end]);
        cursor = end;
    }
    if (cursor < text.length) {
        appendInlineCodeSpansInRange(text, cursor, text.length, out);
    }
    return out;
};

/** Checks whether the opening tag ending at `gtIndex` is self-closing (`/>`). */
const isSelfClosingTagAt = (
    text: string,
    tagStartIndex: number,
    gtIndex: number,
): boolean => gtIndex > tagStartIndex && text[gtIndex - 1] === "/";

/** Resolves a matched XML tag at `match` into a `TagSliceContext` and next scanner cursor. */
const consumeMatchedTagAt = (
    text: string,
    match: MatchedTagRange,
): { slice: TagSliceContext; nextIndex: number } => {
    const gtIndex = findTagHeaderCloseIndex(
        text,
        match.index + match.startTag.length,
    );
    if (gtIndex === -1) {
        const rawRest = text.slice(match.index);
        return {
            slice: {
                type: match.type,
                tagHeader: rawRest,
                fullBlock: rawRest,
                content: "",
                isGenerating: true,
                defaultTerminalStatus: "pending",
            },
            nextIndex: text.length,
        };
    }
    if (isSelfClosingTagAt(text, match.index, gtIndex)) {
        const selfTag = text.slice(match.index, gtIndex + 1);
        return {
            slice: {
                type: match.type,
                tagHeader: selfTag,
                fullBlock: selfTag,
                content: "",
                isGenerating: undefined,
                defaultTerminalStatus: "completed",
            },
            nextIndex: gtIndex + 1,
        };
    }
    const contentStart = gtIndex + 1;
    const tagHeader = text.slice(match.index, contentStart);
    const endIndex = text.indexOf(match.endTag, contentStart);
    if (endIndex === -1) {
        return {
            slice: {
                type: match.type,
                tagHeader,
                fullBlock: text.slice(match.index),
                content: text.slice(contentStart),
                isGenerating: true,
                defaultTerminalStatus: "pending",
            },
            nextIndex: text.length,
        };
    }
    const nextIndex = endIndex + match.endTag.length;
    return {
        slice: {
            type: match.type,
            tagHeader,
            fullBlock: text.slice(match.index, nextIndex),
            content: text.slice(contentStart, endIndex),
            isGenerating: false,
            defaultTerminalStatus: "completed",
        },
        nextIndex,
    };
};

const PARSE_CACHE_MAX_ENTRIES = 8;
const PARSE_CACHE_MAX_CHARS = 192_000;
const parseCache = new Map<string, Chunk[]>();
let parseCacheChars = 0;

/** Parses uncached message content into chronological prose, workflow, and rich card chunks. */
const parseMessageContentUncached = (rawText: string): Chunk[] => {
    const text = stripLeakedToolCode(rawText);
    const fenceRanges = collectProtectedCodeRanges(text);
    const fenceCursor = { idx: 0 };
    const chunks: Chunk[] = [];
    let currentIndex = 0;

    while (currentIndex < text.length) {
        const firstMatch = findNextStructuredTag(
            text,
            currentIndex,
            fenceRanges,
            fenceCursor,
        );
        if (!firstMatch) {
            pushSanitizedTextSlice(chunks, text, currentIndex);
            break;
        }
        if (firstMatch.index > currentIndex) {
            pushSanitizedTextSlice(chunks, text, currentIndex, firstMatch.index);
        }
        const { slice, nextIndex } = consumeMatchedTagAt(text, firstMatch);
        pushParsedChunk(chunks, buildChunkFromSlice(slice));
        currentIndex = nextIndex;
    }

    return dedupeTerminalChunks(chunks);
};

/** Checks whether the bounded LRU parse cache must evict its oldest entry. */
const shouldEvictParseCache = (): boolean =>
    parseCache.size > PARSE_CACHE_MAX_ENTRIES ||
    (parseCacheChars > PARSE_CACHE_MAX_CHARS && parseCache.size > 1);

/** Records `chunks` under `rawText` in the bounded LRU parse cache. */
const storeParsedMessageCache = (rawText: string, chunks: Chunk[]): void => {
    if (rawText.length > PARSE_CACHE_MAX_CHARS) return;
    parseCache.set(rawText, chunks);
    parseCacheChars += rawText.length;
    while (shouldEvictParseCache()) {
        const oldest = parseCache.keys().next().value;
        if (oldest === undefined) break;
        parseCache.delete(oldest);
        parseCacheChars -= oldest.length;
    }
};

/** Parse message content into chronological prose, workflow, and rich card chunks. */
export const parseMessageContent = (rawText: string): Chunk[] => {
    const cached = parseCache.get(rawText);
    if (cached) {
        parseCache.delete(rawText);
        parseCache.set(rawText, cached);
        return cached;
    }
    const chunks = parseMessageContentUncached(rawText);
    storeParsedMessageCache(rawText, chunks);
    return chunks;
};

/** Merges two adjacent plain-text chunks in place. */
const appendTextChunk = (prev: Chunk, next: Chunk): void => {
    prev.content = `${prev.content ?? ""}${next.content ?? ""}`;
    if (next.isGenerating) {
        prev.isGenerating = true;
    }
};

/** Merge consecutive plain-text segments so markdown renders as one block. */
const mergeAdjacentTextChunks = (chunks: Chunk[]): Chunk[] => {
    const merged: Chunk[] = [];
    for (const chunk of chunks) {
        const prev = merged.at(-1);
        if (chunk.type === "text" && prev?.type === "text") {
            appendTextChunk(prev, chunk);
        } else {
            merged.push({ ...chunk });
        }
    }
    return merged;
};

/** Parses a single `---`-delimited web search result section when a title or URL is present. */
const parseSingleWebResultSection = (
    block: string,
): WebSearchResultItem | null => {
    const titleMatch = block.match(/### (.*)/);
    const urlMatch = block.match(/URL: (.*)/);
    if (!titleMatch && !urlMatch) return null;
    return {
        title: titleMatch ? titleMatch[1].trim() : "Result",
        url: urlMatch ? urlMatch[1].trim() : "",
        snippet: block.replace(/### .*/, "").replace(/URL: .*/, "").trim(),
    };
};

/** Parses `<web_result>` markdown sections into structured citation items. */
export const parseWebResults = (blockContent: string): WebSearchResultItem[] => {
    const results: WebSearchResultItem[] = [];
    for (const block of blockContent.split("---")) {
        if (!block) continue;
        const parsed = parseSingleWebResultSection(block);
        if (parsed) results.push(parsed);
    }
    return results;
};

/** Formats a `WebSearchResultItem` from a `web_visit` chunk. */
const buildVisitedSearchItem = (
    item: Chunk,
    url: string,
    host: string,
): WebSearchResultItem => ({
    title: item.visitTitle ?? (host ? host : "Visited"),
    url,
    snippet: host ? `Visited ${host}` : "Visited page",
});

/** Appends a `web_visit` chunk to `results` if its URL/host key has not been seen yet. */
const collectWebVisitResult = (
    item: Chunk,
    seen: Set<string>,
    results: WebSearchResultItem[],
): void => {
    const url = captureOrEmpty(item.visitUrl);
    const host = captureOrEmpty(item.visitHost);
    const key = url ? url : host;
    if (!key || seen.has(key)) return;
    seen.add(key);
    results.push(buildVisitedSearchItem(item, url, host));
};

/** Appends unique parsed hits from a `web_result` chunk into `results`. */
const collectWebResultHits = (
    content: string,
    seen: Set<string>,
    results: WebSearchResultItem[],
): void => {
    for (const hit of parseWebResults(content)) {
        const key = hit.url ? hit.url : `${hit.title}:${hit.snippet}`;
        if (!seen.has(key)) {
            seen.add(key);
            results.push(hit);
        }
    }
};

/** Collect unique web search/visit hit URLs from a message for the footer sources menu. */
export const extractWebSearchResults = (
    content: string,
): WebSearchResultItem[] => {
    const results: WebSearchResultItem[] = [];
    const seen = new Set<string>();
    for (const item of parseMessageContent(content)) {
        if (item.type === "web_visit") {
            collectWebVisitResult(item, seen, results);
        } else if (item.type === "web_result") {
            collectWebResultHits(item.content ?? "", seen, results);
        }
    }
    return results;
};

/** Appends a workflow chunk to the trailing workflow segment or starts a new workflow segment. */
const pushWorkflowSegmentChunk = (segments: Segment[], chunk: Chunk): void => {
    const prev = segments.at(-1);
    if (prev?.kind === "workflow") {
        prev.blocks.push(chunk);
    } else {
        segments.push({ kind: "workflow", blocks: [chunk] });
    }
};

/** Checks whether a standalone chunk should be emitted as a non-empty content segment. */
const isNonEmptyContentChunk = (chunk: Chunk): boolean =>
    chunk.type !== "text" || Boolean(captureOrEmpty(chunk.content).trim());

/** Groups chronological chunks into alternating workflow rails and standalone content segments. */
const buildSegments = (chunks: Chunk[]): Segment[] => {
    const segments: Segment[] = [];
    for (const chunk of chunks) {
        if (WORKFLOW_CHUNK_TYPES.has(chunk.type)) {
            pushWorkflowSegmentChunk(segments, chunk);
        } else if (isNonEmptyContentChunk(chunk)) {
            segments.push({ kind: "chunk", chunk });
        }
    }
    return segments;
};

/** Checks whether a pending `edit_pending` chunk has already been applied in the workspace. */
const isPendingEditAlreadyApplied = (
    chunk: Chunk,
    isFileEditResolved?: (file: string, replacement?: string) => boolean,
): boolean =>
    chunk.type === "edit_pending" &&
    (chunk.commandStatus ?? "pending") === "pending" &&
    Boolean(chunk.file && isFileEditResolved?.(chunk.file, chunk.replacement));

/** Normalizes one parsed chunk for settled turn state and workspace-resolved edits. */
const finalizeSingleParsedChunk = (
    chunk: Chunk,
    isGenerating?: boolean,
    isFileEditResolved?: (file: string, replacement?: string) => boolean,
): Chunk => {
    let next = chunk;
    if (isPendingEditAlreadyApplied(next, isFileEditResolved)) {
        next = { ...next, commandStatus: "applied" };
    }
    if (!isGenerating && next.isGenerating) {
        next = { ...next, isGenerating: false };
    }
    return next;
};

/** Clears residual `isGenerating` flags and promotes workspace-applied edits on parsed chunks. */
const finalizeParsedChunks = (
    parsed: Chunk[],
    isGenerating?: boolean,
    isFileEditResolved?: (file: string, replacement?: string) => boolean,
): Chunk[] =>
    parsed.map((chunk) =>
        finalizeSingleParsedChunk(chunk, isGenerating, isFileEditResolved),
    );

/** Indexes the last array position of each `persona_review` chunk with a non-empty `commandId`. */
const collectLastPersonaReviewIndexById = (
    chunks: Chunk[],
): Map<string, number> => {
    const lastById = new Map<string, number>();
    for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        if (chunk.type === "persona_review" && chunk.commandId) {
            lastById.set(chunk.commandId, i);
        }
    }
    return lastById;
};

/** Checks whether a chunk is non-review, anonymous, or the final review for its `commandId`. */
const isRetainedPersonaReview = (
    chunk: Chunk,
    index: number,
    lastById: Map<string, number>,
): boolean => {
    if (chunk.type !== "persona_review" || !chunk.commandId) return true;
    return lastById.get(chunk.commandId) === index;
};

/** Retains only the final `persona_review` chunk for each non-empty `commandId` in linear time. */
export const dropSupersededPersonaReviews = (chunks: Chunk[]): Chunk[] => {
    const lastById = collectLastPersonaReviewIndexById(chunks);
    if (lastById.size === 0) return chunks;
    return chunks.filter((chunk, index) =>
        isRetainedPersonaReview(chunk, index, lastById),
    );
};

/** Decides whether a chunk should remain visible when constructing chronological segments. */
const isSegmentChunkVisible = (
    chunk: Chunk,
    browsing: boolean,
    isGenerating?: boolean,
): boolean => {
    if (browsing && (chunk.type === "think" || chunk.type === "thought")) {
        return false;
    }
    if (WORKFLOW_CHUNK_TYPES.has(chunk.type)) {
        return isRenderableWorkflowBlock(chunk, isGenerating);
    }
    return true;
};

/** Type-guards whether a `Segment` is a `WorkflowSegment`. */
const isWorkflowSegment = (segment: Segment): segment is WorkflowSegment =>
    segment.kind === "workflow";

/** Finds the last segment index matching `predicate`, or `-1` when absent. */
const findLastSegmentIndex = (
    segments: Segment[],
    predicate: (segment: Segment) => boolean,
): number => {
    for (let i = segments.length - 1; i >= 0; i -= 1) {
        if (predicate(segments[i])) return i;
    }
    return -1;
};

/** Checks whether a segment is a `browse_session` chunk segment. */
const isBrowseSessionSegment = (segment: Segment): boolean =>
    segment.kind === "chunk" && segment.chunk.type === "browse_session";

/** Checks whether the trailing segment is actively streaming non-empty prose. */
const isTrailingProseStreaming = (lastSegment: Segment | undefined): boolean => {
    if (lastSegment?.kind !== "chunk" || lastSegment.chunk.type !== "text") {
        return false;
    }
    return Boolean(lastSegment.chunk.content?.trim());
};

/** Checks whether a workflow block is awaiting user approval. */
const isPendingWorkflowApprovalBlock = (block: Chunk): boolean =>
    DEDUPABLE_COMMAND_TYPES.has(block.type) && block.commandStatus === "pending";

/** Checks whether any chunk of `targetType` in `chunks` is currently `"pending"`. */
const hasPendingChunkOfType = (
    chunks: Chunk[],
    targetType: Chunk["type"],
): boolean =>
    chunks.some(
        (chunk) => chunk.type === targetType && chunk.commandStatus === "pending",
    );

/** Resolves the pending approval label when any interactive gate is waiting on the user. */
const resolvePendingApprovalLabel = (
    workflowSegments: WorkflowSegment[],
    contentChunks: Chunk[],
): string | undefined => {
    if (hasPendingChunkOfType(contentChunks, "question")) {
        return "Waiting for your answers";
    }
    if (hasPendingChunkOfType(contentChunks, "design_previews")) {
        return "Waiting for you to pick a design";
    }
    const workflowPending = workflowSegments.some((seg) =>
        seg.blocks.some(isPendingWorkflowApprovalBlock),
    );
    return workflowPending ? "Waiting for approval" : undefined;
};

/** Checks whether a chunk represents a file edit (`edit` or `edit_pending`). */
const isEditChunk = (chunk: Chunk | undefined): boolean =>
    chunk?.type === "edit" || chunk?.type === "edit_pending";

/** Finds the basename of the latest edited file in the trailing workflow segment. */
const findLatestEditedBasename = (blocks: Chunk[] | undefined): string => {
    if (!blocks) return "file";
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
        const file = isEditChunk(blocks[i]) ? blocks[i].file : undefined;
        const name = file?.split(/[\\/]/).pop();
        if (name) return name;
    }
    return "file";
};

/** Checks whether the trailing workflow block is an active reasoning block. */
const isActivelyThinkingBlock = (
    lastBlock: Chunk | undefined,
    isGenerating?: boolean,
): boolean => {
    if (!isGenerating || !lastBlock?.isGenerating) return false;
    return lastBlock.type === "think" || lastBlock.type === "thought";
};

/** Resolves the fallback live status label when no approval or file-edit state applies. */
const resolveGeneralActivityLabel = (
    activityLabel: string | null | undefined,
    isThinking: boolean,
    hasWorkflows: boolean,
): string | undefined => {
    const trimmed = activityLabel?.trim();
    if (trimmed) return trimmed;
    if (isThinking) return "Thinking";
    return hasWorkflows ? "Working" : undefined;
};

/** Computes the live `GeneratingIndicator` status label for the current message state. */
const resolveLiveStatusLabel = (
    pendingLabel: string | undefined,
    workflowSegments: WorkflowSegment[],
    activityLabel: string | null | undefined,
    isGenerating?: boolean,
): string | undefined => {
    if (pendingLabel) return pendingLabel;
    const trailingBlocks = workflowSegments.at(-1)?.blocks;
    const lastWorkflowBlock = trailingBlocks?.at(-1);
    if (isEditChunk(lastWorkflowBlock) || /\bedit/i.test(activityLabel ?? "")) {
        return `Editing ${findLatestEditedBasename(trailingBlocks)}`;
    }
    return resolveGeneralActivityLabel(
        activityLabel,
        isActivelyThinkingBlock(lastWorkflowBlock, isGenerating),
        workflowSegments.length > 0,
    );
};

/** Renders a plain-text Markdown chunk segment. */
const renderTextChunkView: ChunkViewRenderer = (chunk, ctx) => {
    const text = chunk.content;
    if (!text?.trim()) return null;
    return (
        <div
            className={cn(
                "text-sm font-medium text-text-primary leading-[var(--conversation-line-height)] mb-0 w-full overflow-hidden prose-compact chat-markdown",
                ctx.isGenerating && ctx.isLastSegment && "t-step-enter",
            )}
        >
            <ChatMarkdown
                content={text}
                isGenerating={ctx.isGenerating}
                isLast={ctx.isLastSegment}
            />
        </div>
    );
};

/** Renders a saved implementation plan card chunk. */
const renderPlanSavedChunkView: ChunkViewRenderer = (chunk) => (
    <PlanSavedBlock
        title={chunk.content ?? "Implementation Plan"}
        path={chunk.file ?? ""}
        markdown={chunk.planMarkdown}
    />
);

/** Parses `<step status="...">...</step>` tags inside a `<plan>` chunk. */
/** Normalizes a `<step>` child element into `{ status, label }` for `PlanningBlock`. */
const normalizePlanStepEntry = (
    entry: ChildXmlMatch,
): { status: TodoStepStatus; label: string } => {
    const raw = (
        readOptionalAttr(entry.attrs, "status") ?? "pending"
    ).toLowerCase();
    return {
        status: TODO_STATUS_MAP[raw] ?? "pending",
        label: entry.body.trim(),
    };
};

/** Parses `<step status="...">...</step>` items inside a `<plan>` block. */
const parsePlanSteps = (
    blockContent: string,
): Array<{ status: TodoStepStatus; label: string }> =>
    scanChildXmlElements(blockContent, "step", "</step>").map(
        normalizePlanStepEntry,
    );

/** Renders a `<plan>` step-progress block. */
const renderPlanChunkView: ChunkViewRenderer = (chunk, ctx) => {
    const steps = parsePlanSteps(chunk.content ?? "");
    const completedCount = steps.filter((step) => step.status === "done").length;
    return (
        <PlanningBlock
            title={chunk.file ?? "Plan"}
            steps={steps}
            completedCount={completedCount}
            totalCount={steps.length}
            isGenerating={ctx.isGenerating}
        />
    );
};

/** Renders a `<todos>` checklist block when todo items are present. */
const renderTodosChunkView: ChunkViewRenderer = (chunk, ctx) => {
    if (!chunk.todos?.length) return null;
    const steps = chunk.todos.map((todo) => ({
        status: todo.status,
        label: todo.label,
    }));
    const completedCount = steps.filter((step) => step.status === "done").length;
    return (
        <PlanningBlock
            title={chunk.content ?? "Todos"}
            steps={steps}
            completedCount={completedCount}
            totalCount={steps.length}
            isGenerating={ctx.isGenerating}
        />
    );
};

/** Renders ONLY the latest `<browse_session>` frame in a message with live follow active. */
const renderBrowseSessionChunkView: ChunkViewRenderer = (chunk, ctx) => {
    if (ctx.pos !== ctx.lastBrowseIndex) return null;
    const parsed = parseCardJson<{
        image?: string;
        x?: number;
        y?: number;
        console?: string[];
    }>(chunk.content);
    return (
        <BrowseChatCard
            url={chunk.visitUrl}
            title={chunk.visitTitle}
            status={chunk.commandStatus}
            image={parsed?.image ?? ""}
            x={parsed?.x}
            y={parsed?.y}
            consoleLines={parsed?.console}
            followLive
        />
    );
};

/** Renders a `<sent_file>` attachment card. */
const renderSentFileChunkView: ChunkViewRenderer = (chunk) => (
    <SentFileCard
        name={chunk.file ?? "File"}
        title={chunk.mediaPrompt}
        mime={chunk.query ?? ""}
        src={chunk.content ?? ""}
    />
);

/** Renders an inline `<attached_image>` preview when `src` is non-empty. */
const renderAttachedImageChunkView: ChunkViewRenderer = (chunk) => {
    const src = chunk.content?.trim() ?? "";
    if (!src) return null;
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={src}
            alt={chunk.file ?? ""}
            className="my-2 max-h-80 max-w-[420px] rounded-xl border border-border-subtle object-contain"
        />
    );
};

/** Renders an interactive `<design_previews>` gallery when at least one preview exists. */
const renderDesignPreviewsChunkView: ChunkViewRenderer = (chunk) => {
    const previews = chunk.designPreviews;
    if (!previews?.length) return null;
    return (
        <DesignPreviewGallery
            previews={previews}
            selectedId={chunk.selectedConcept}
            pickId={chunk.commandId}
            status={chunk.commandStatus}
        />
    );
};

/** Renders a generated SVG, image, or audio media card. */
const renderGeneratedMediaChunkView: ChunkViewRenderer = (chunk) => (
    <GeneratedMediaCard
        kind={GENERATED_MEDIA_KINDS[chunk.type as GeneratedMediaChunkType]}
        src={chunk.content}
        prompt={chunk.mediaPrompt ?? chunk.query}
        credits={chunk.mediaCredits}
        loading={Boolean(chunk.isGenerating) && !chunk.content?.trim()}
    />
);

/** Renders an adversarial `<review_debate>` panel. */
const renderReviewDebateChunkView: ChunkViewRenderer = (chunk) => (
    <ReviewDebatePanel
        content={chunk.content ?? ""}
        model={chunk.reviewModel}
    />
);

/** Renders a `<persona_review>` panel. */
const renderPersonaReviewChunkView: ChunkViewRenderer = (chunk) => (
    <PersonaReviewPanel
        reviewId={chunk.commandId}
        url={chunk.visitUrl}
        status={chunk.commandStatus}
        content={chunk.content ?? ""}
    />
);

/** Renders an interactive `<question>` / `<questions>` card. */
const renderQuestionChunkView: ChunkViewRenderer = (chunk) => (
    <QuestionsCard
        askId={chunk.commandId}
        status={chunk.commandStatus}
        questions={chunk.questions ?? []}
        answers={chunk.answers}
    />
);

const CHUNK_VIEW_RENDERERS: Partial<Record<Chunk["type"], ChunkViewRenderer>> = {
    text: renderTextChunkView,
    plan_saved: renderPlanSavedChunkView,
    plan: renderPlanChunkView,
    todos: renderTodosChunkView,
    chart: (chunk) => <ChartBlock content={chunk.content} />,
    insight_card: (chunk) => <InsightCard content={chunk.content} />,
    browse_session: renderBrowseSessionChunkView,
    sent_file: renderSentFileChunkView,
    attached_image: renderAttachedImageChunkView,
    design_previews: renderDesignPreviewsChunkView,
    generated_svg: renderGeneratedMediaChunkView,
    generated_image: renderGeneratedMediaChunkView,
    generated_audio: renderGeneratedMediaChunkView,
    review_debate: renderReviewDebateChunkView,
    persona_review: renderPersonaReviewChunkView,
    question: renderQuestionChunkView,
};

/** Resolves the fallback signature hint from a standalone chunk's path, URL, or content prefix. */
const resolveChunkSignatureHint = (chunk: Chunk): string => {
    const primary = chunk.file ?? chunk.visitUrl;
    return primary ?? Array.from(captureOrEmpty(chunk.content)).slice(0, 24).join("");
};

/** Derives a stable, collision-safe React key token for a chronological segment. */
const deriveSegmentSignature = (segment: Segment): string => {
    if (segment.kind === "workflow") {
        const first = segment.blocks[0];
        if (!first) return "wf:empty";
        return `wf:${first.type}:${first.commandId ?? resolveChunkSignatureHint(first)}`;
    }
    const { chunk } = segment;
    if (chunk.commandId) {
        return `${chunk.type}:${chunk.commandId}`;
    }
    return `${chunk.type}:${resolveChunkSignatureHint(chunk)}`;
};

/** Renders a workflow summary segment inside `MessageSegmentView`. */
const renderWorkflowSegmentElement = (
    blocks: Chunk[],
    pos: number,
    firstWorkflowIndex: number,
    lastWorkflowIndex: number,
    isGenerating?: boolean,
    durationMs?: number,
    activityLabel?: string | null,
): React.ReactElement => {
    const isLastWf = pos === lastWorkflowIndex;
    return (
        <TurnWorkflowSummary
            blocks={blocks}
            isActive={Boolean(isGenerating) && isLastWf}
            durationMs={pos === firstWorkflowIndex ? durationMs : undefined}
            activityLabel={isLastWf ? activityLabel : null}
        />
    );
};

/** Renders a single chronological workflow or standalone chunk segment. */
const MessageSegmentView = ({
    segment,
    pos,
    segmentsLength,
    firstWorkflowIndex,
    lastWorkflowIndex,
    lastBrowseIndex,
    isGenerating,
    durationMs,
    activityLabel,
}: {
    segment: Segment;
    pos: number;
    segmentsLength: number;
    firstWorkflowIndex: number;
    lastWorkflowIndex: number;
    lastBrowseIndex: number;
    isGenerating?: boolean;
    durationMs?: number;
    activityLabel?: string | null;
}): React.ReactElement | null => {
    if (segment.kind === "workflow") {
        return renderWorkflowSegmentElement(
            segment.blocks,
            pos,
            firstWorkflowIndex,
            lastWorkflowIndex,
            isGenerating,
            durationMs,
            activityLabel,
        );
    }
    const renderer = CHUNK_VIEW_RENDERERS[segment.chunk.type];
    if (!renderer) return null;
    return renderer(segment.chunk, {
        pos,
        lastBrowseIndex,
        isGenerating,
        isLastSegment: pos === segmentsLength - 1,
    });
};

/** Renders the MessageRenderer UI component. */
export const MessageRenderer = ({
    content,
    isGenerating,
    activityLabel,
    isFileEditResolved,
    durationMs,
    skipSubagentSync,
}: {
    content: string;
    isGenerating?: boolean;
    activityLabel?: string | null;
    isFileEditResolved?: (file: string, replacement?: string) => boolean;
    durationMs?: number;
    skipSubagentSync?: boolean;
}) => {
    const chunks = useMemo(
        () =>
            finalizeParsedChunks(
                parseMessageContent(content),
                isGenerating,
                isFileEditResolved,
            ),
        [content, isGenerating, isFileEditResolved],
    );

    useEffect(() => {
        if (!skipSubagentSync) {
            syncSubagentsFromChunks(chunks, Boolean(isGenerating));
        }
    }, [chunks, isGenerating, skipSubagentSync]);

    const contentChunks = useMemo(
        () => dropSupersededPersonaReviews(mergeAdjacentTextChunks(chunks)),
        [chunks],
    );

    const browsing = contentChunks.some((chunk) => chunk.type === "browse_session");

    const segments = useMemo(
        () =>
            buildSegments(
                contentChunks.filter((chunk) =>
                    isSegmentChunkVisible(chunk, browsing, isGenerating),
                ),
            ),
        [contentChunks, isGenerating, browsing],
    );

    const workflowSegments = segments.filter(isWorkflowSegment);
    const firstWorkflowIndex = segments.findIndex(isWorkflowSegment);
    const lastWorkflowIndex = findLastSegmentIndex(segments, isWorkflowSegment);
    const lastBrowseIndex = findLastSegmentIndex(segments, isBrowseSessionSegment);

    const pendingLabel = resolvePendingApprovalLabel(
        workflowSegments,
        contentChunks,
    );
    const statusLabel = resolveLiveStatusLabel(
        pendingLabel,
        workflowSegments,
        activityLabel,
        isGenerating,
    );
    const showStatusLine =
        Boolean(isGenerating) &&
        !isTrailingProseStreaming(segments.at(-1)) &&
        Boolean(statusLabel);

    const segmentKey = createOccurrenceKeyer();

    return (
        <div className="flex flex-col gap-0 overflow-hidden">
            {segments.map((segment, pos) => (
                <MessageSegmentView
                    key={segmentKey(deriveSegmentSignature(segment))}
                    segment={segment}
                    pos={pos}
                    segmentsLength={segments.length}
                    firstWorkflowIndex={firstWorkflowIndex}
                    lastWorkflowIndex={lastWorkflowIndex}
                    lastBrowseIndex={lastBrowseIndex}
                    isGenerating={isGenerating}
                    durationMs={durationMs}
                    activityLabel={activityLabel}
                />
            ))}
            {showStatusLine ? <GeneratingIndicator label={statusLabel} /> : null}
        </div>
    );
};

export { ChatMarkdown as StreamingMarkdown } from "./view";
