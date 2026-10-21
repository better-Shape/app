"use client";


import React, { useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { stripLeakedToolCode, stripOrphanThinkTags } from "./stream";
import { ChatMarkdown } from "./view";
import { syncSubagentsFromChunks } from "@/features/agent/subagents/store";

import {
    isRenderableWorkflowBlock,
    WORKFLOW_CHUNK_TYPES,
} from '../blocks/workflow';
import { TurnWorkflowSummary } from '../blocks/turn';
import { GeneratingIndicator } from '../blocks/generating';
import { PlanningBlock, PlanSavedBlock } from '../blocks/plan';
import type { DesignPreviewItem } from '../blocks/gallery';
import { GeneratedMediaCard } from '../blocks/generated-media';
import { SentFileCard } from '../blocks/sent-file';
import { ReviewDebatePanel } from '../blocks/debate';
import { PersonaReviewPanel } from '../blocks/persona-review';
import { BrowseChatCard } from '../blocks/browse-frame';
import { ChartBlock, InsightCard } from '../blocks/chart';
import { OpenUIBlock } from '../blocks/openui';
import { QuestionsCard, parseQuestionsPayload, type AgentQuestion, type QuestionAnswers } from '../blocks/questions';
import { hostnameOf } from '@/lib/ui/favicon';

function hostnameFromUrl(url: string): string {
    return hostnameOf(url);
}

function parseCardJson<T>(raw: string | undefined): T | null {
    const text = (raw || "").trim();
    if (!text) return null;
    try {
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
}

function decodeXml(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&amp;/g, "&");
}

const TERMINAL_STATUS_RANK: Record<string, number> = {
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
const EDIT_PENDING_STATUS_RANK: Record<string, number> = {
    pending: 1,
    cancelled: 2,
    rejected: 3,
    applied: 4,
};

const PLUGIN_STATUS_RANK: Record<string, number> = {
    pending: 1,
    rejected: 4,
    cancelled: 4,
    error: 4,
    ok: 5,
};

/** Keep one terminal_command / edit_pending block per id (or per command when pending). Prefer higher status. */
export function dedupeTerminalChunks(chunks: Chunk[]): Chunk[] {
    const skip = new Set<number>();

    const rank = (chunk: Chunk) => {
        if (chunk.type === 'edit_pending') return EDIT_PENDING_STATUS_RANK[chunk.commandStatus || ''] ?? 0;
        if (chunk.type === 'plugin_call') return PLUGIN_STATUS_RANK[chunk.commandStatus || ''] ?? 0;
        return TERMINAL_STATUS_RANK[chunk.commandStatus || ''] ?? 0;
    };

    const byId = new Map<string, number>();
    chunks.forEach((chunk, index) => {
        if ((chunk.type !== 'terminal_command' && chunk.type !== 'edit_pending' && chunk.type !== 'plugin_call') || !chunk.commandId) return;
        const key = `${chunk.type}:${chunk.commandId}`;
        const existing = byId.get(key);
        if (existing === undefined) {
            byId.set(key, index);
            return;
        }
        if (rank(chunk) >= rank(chunks[existing])) {
            skip.add(existing);
            byId.set(key, index);
        } else {
            skip.add(index);
        }
    });

    const byPendingCommand = new Map<string, number>();
    chunks.forEach((chunk, index) => {
        if (skip.has(index)) return;
        if (chunk.type !== 'terminal_command' || chunk.commandStatus !== 'pending') return;
        const cmd = chunk.command?.trim();
        if (!cmd) return;
        const existing = byPendingCommand.get(cmd);
        if (existing === undefined) {
            byPendingCommand.set(cmd, index);
            return;
        }
        skip.add(existing);
        byPendingCommand.set(cmd, index);
    });

    return chunks.filter((_, index) => !skip.has(index));
}

export type Chunk = {
    type: 'text' | 'openui' | 'edit' | 'edit_pending' | 'search' | 'grep' | 'status' | 'web_search' | 'think' | 'thought' | 'search_result' | 'web_result' | 'web_visit' | 'inspect_runtime' | 'terminal_command' | 'git_operation' | 'run' | 'ls' | 'cat' | 'create_file' | 'mkdir' | 'delete_file' | 'rename_file' | 'rename_chat' | 'tool_result' | 'plan' | 'plan_saved' | 'todos' | 'attached_image' | 'sent_file' | 'subagent' | 'subagent_ref' | 'design_previews' | 'review_debate' | 'persona_review' | 'question' | 'questions' | 'plugin_call' | 'generated_svg' | 'generated_image' | 'generated_audio' | 'browse_session' | 'chart' | 'insight_card';
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
    todos?: Array<{ id: string; label: string; status: "done" | "active" | "pending" | "cancelled" }>;
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
    openuiTruncated?: boolean;
    /** Source offset of the fence; stable across incremental renders of its generated DSL. */
    openuiSourceStart?: number;
    /** Stable offset in the original message used to key the rendered chunk. */
    sourceStart?: number;
};

const MAX_OPENUI_SOURCE_LENGTH = 32_000;
const MAX_OPENUI_BLOCKS_PER_MESSAGE = 3;

type OpenUIFence = {
    start: number;
    end: number;
    sourceStart: number;
    sourceEnd: number;
    closed: boolean;
};

type OpenUIFenceOverflow = { start: number; end: number };
type OpenUIFenceScan = { fences: OpenUIFence[]; overflow?: OpenUIFenceOverflow };

type PendingTag = {
    name: string;
    closing: boolean;
    quote: "\"" | "'" | null;
    lastNonWhitespace: string;
    readingName: boolean;
};

type ActiveOpenUIFence = {
    marker: string;
    length: number;
    openUI?: OpenUIFence;
    overflow?: boolean;
};

type OpenUIFenceScannerState = {
    fences: OpenUIFence[];
    activeFence: ActiveOpenUIFence | null;
    activeMessageTags: Map<string, number>;
    pendingMessageTag: PendingTag | null;
    overflow?: OpenUIFenceOverflow;
};

const MESSAGE_BLOCK_TAGS: Array<{ type: Chunk["type"]; start: string; end: string }> = [
    { type: 'edit', start: '<edit', end: '</edit>' },
    // Longer tag wins the same-index tie-break against '<edit'.
    { type: 'edit_pending', start: '<edit_pending', end: '</edit_pending>' },
    { type: 'design_previews', start: '<design_previews', end: '</design_previews>' },
    { type: 'review_debate', start: '<review_debate', end: '</review_debate>' },
    { type: 'persona_review', start: '<persona_review', end: '</persona_review>' },
    { type: 'questions', start: '<questions', end: '</questions>' },
    { type: 'question', start: '<question', end: '</question>' },
    { type: 'inspect_runtime', start: '<inspect_runtime', end: '</inspect_runtime>' },
    { type: 'search_result', start: '<search_result', end: '</search_result>' },
    { type: 'search', start: '<search', end: '</search>' },
    { type: 'grep', start: '<grep', end: '</grep>' },
    { type: 'web_search', start: '<web_search', end: '</web_search>' },
    { type: 'status', start: '<status', end: '</status>' },
    { type: 'think', start: '<think>', end: '</think>' },
    { type: 'think', start: '<think', end: '</think>' },
    { type: 'thought', start: '<thought', end: '</thought>' },
    { type: 'plan', start: '<plan', end: '</plan>' },
    { type: 'plan_saved', start: '<plan_saved', end: '</plan_saved>' },
    { type: 'todos', start: '<todos', end: '</todos>' },
    { type: 'web_result', start: '<web_result', end: '</web_result>' },
    { type: 'web_visit', start: '<web_visit', end: '</web_visit>' },
    { type: 'generated_svg', start: '<generated_svg', end: '</generated_svg>' },
    { type: 'generated_svg', start: '<recraft_svg', end: '</recraft_svg>' },
    { type: 'generated_image', start: '<generated_image', end: '</generated_image>' },
    { type: 'generated_audio', start: '<generated_audio', end: '</generated_audio>' },
    { type: 'plugin_call', start: '<plugin_call', end: '</plugin_call>' },
    { type: 'browse_session', start: '<browse_session', end: '</browse_session>' },
    { type: 'chart', start: '<chart', end: '</chart>' },
    { type: 'insight_card', start: '<insight_card', end: '</insight_card>' },
    { type: 'ls', start: '<ls', end: '</ls>' },
    { type: 'cat', start: '<cat', end: '</cat>' },
    { type: 'run', start: '<run', end: '</run>' },
    { type: 'create_file', start: '<create_file', end: '</create_file>' },
    { type: 'mkdir', start: '<mkdir', end: '</mkdir>' },
    { type: 'delete_file', start: '<delete_file', end: '</delete_file>' },
    { type: 'rename_file', start: '<rename_file', end: '</rename_file>' },
    { type: 'rename_chat', start: '<rename_chat', end: '</rename_chat>' },
    { type: 'subagent_ref', start: '<subagent_ref', end: '/>' },
    { type: 'subagent', start: '<subagent', end: '</subagent>' },
    { type: 'terminal_command', start: '<terminal_command', end: '</terminal_command>' },
    { type: 'git_operation', start: '<git_operation', end: '</git_operation>' },
    // Hidden tool/result scaffolding (BetterShape UI + cross-model leak grammars).
    // Defense-in-depth with stripLeakedToolCode — never render as prose.
    { type: 'tool_result', start: '<tool_result', end: '</tool_result>' },
    { type: 'tool_result', start: '<terminal_read', end: '</terminal_read>' },
    { type: 'tool_result', start: '<terminal_input', end: '</terminal_input>' },
    { type: 'tool_result', start: '<list_terminals', end: '</list_terminals>' },
    { type: 'tool_result', start: '<tool_code', end: '</tool_code>' },
    { type: 'tool_result', start: '<tool_call', end: '</tool_call>' },
    { type: 'tool_result', start: '<tool_calls', end: '</tool_calls>' },
    { type: 'tool_result', start: '<tool_response', end: '</tool_response>' },
    { type: 'tool_result', start: '<function_call', end: '</function_call>' },
    { type: 'tool_result', start: '<function_calls', end: '</function_calls>' },
    { type: 'tool_result', start: '<function_response', end: '</function_response>' },
    { type: 'tool_result', start: '<minimax:tool_call', end: '</minimax:tool_call>' },
    { type: 'tool_result', start: '<invoke', end: '</invoke>' },
    { type: 'tool_result', start: '<parameter', end: '</parameter>' },
    { type: 'tool_result', start: '<arg_key', end: '</arg_key>' },
    { type: 'tool_result', start: '<arg_value', end: '</arg_value>' },
    { type: 'tool_result', start: '<pre_dispatch_explanation', end: '</pre_dispatch_explanation>' },
    { type: 'tool_result', start: '<tools', end: '</tools>' },
    { type: 'tool_result', start: '<new_path', end: '</new_path>' },
    { type: 'tool_result', start: '<content', end: '</content>' },
    { type: 'tool_result', start: '<analysis', end: '</analysis>' },
    { type: 'tool_result', start: '<file_content', end: '</file_content>' },
    { type: 'attached_image', start: '<attached_image', end: '</attached_image>' },
    { type: 'sent_file', start: '<sent_file', end: '</sent_file>' },
];
const MESSAGE_BLOCK_TAG_NAMES = new Set(
    MESSAGE_BLOCK_TAGS.map(({ start }) => /^<([^\s>]+)/.exec(start)?.[1]).filter((name): name is string => Boolean(name)),
);
const MESSAGE_BLOCK_TAG_NAME_PREFIXES = new Set(
    Array.from(MESSAGE_BLOCK_TAG_NAMES).flatMap((name) =>
        Array.from({ length: name.length }, (_, index) => name.slice(0, index + 1)),
    ),
);
const MAX_TAG_NAME_LENGTH = 128;

/** Constrain the incremental tag scanner to XML-like name characters. */
const isTagNameCharacter = (character: string): boolean => {
    return /^[A-Za-z0-9:_-]$/.test(character);
};

/** Find a structural tag without accepting a longer unknown tag-name prefix. */
const structuralTagPatterns = new Map<string, RegExp>();
const findStructuralTagIndex = (text: string, from: number, marker: string): number => {
    let pattern = structuralTagPatterns.get(marker);
    if (!pattern) {
        const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        pattern = new RegExp(escapedMarker, "ig");
        structuralTagPatterns.set(marker, pattern);
    }
    pattern.lastIndex = from;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        const boundary = text[match.index + marker.length];
        if (marker.endsWith(">") || !boundary || !/[A-Za-z0-9:_-]/.test(boundary)) return match.index;
    }
    return -1;
};

/** Apply a completed structural tag to the active-tag depth map. */
const applyCompletedTag = (completed: PendingTag, activeTags: Map<string, number>): void => {
    const name = completed.name.toLowerCase();
    if (!MESSAGE_BLOCK_TAG_NAMES.has(name)) return;
    const count = activeTags.get(name) ?? 0;
    if (completed.closing) {
        if (count <= 1) activeTags.delete(name);
        else activeTags.set(name, count - 1);
    } else if (completed.lastNonWhitespace !== "/") {
        activeTags.set(name, count + 1);
    }
};

type PendingTagStep = { tag: PendingTag | null; consumed: boolean };

/** Consume one character of an unfinished tag while retaining quote and name state. */
const advancePendingTag = (
    character: string,
    tag: PendingTag,
    activeTags: Map<string, number>,
): PendingTagStep => {
    if (tag.readingName) {
        if (isTagNameCharacter(character)) {
            if (tag.name.length >= MAX_TAG_NAME_LENGTH) return { tag: null, consumed: true };
            const candidateName = (tag.name + character).toLowerCase();
            if (!MESSAGE_BLOCK_TAG_NAME_PREFIXES.has(candidateName)) return { tag: null, consumed: true };
            tag.name = candidateName;
            return { tag, consumed: true };
        }
        if (!tag.name || !MESSAGE_BLOCK_TAG_NAMES.has(tag.name)) return { tag: null, consumed: false };
        tag.readingName = false;
    }
    if (tag.quote) {
        if (character === tag.quote) tag.quote = null;
    } else if (character === "\"" || character === "'") {
        tag.quote = character;
    } else if (character === ">") {
        applyCompletedTag(tag, activeTags);
        return { tag: null, consumed: true };
    } else if (!/\s/.test(character)) {
        tag.lastNonWhitespace = character;
    }
    return { tag, consumed: true };
};

/** Update structural-block depth with a quote-aware, bounded-state tag scanner. */
const scanStructuralTags = (
    text: string,
    activeTags: Map<string, number>,
    pending: PendingTag | null,
): PendingTag | null => {
    let index = 0;
    let tag = pending;

    while (index < text.length) {
        if (tag) {
            const step = advancePendingTag(text[index] ?? "", tag, activeTags);
            tag = step.tag;
            if (step.consumed) index += 1;
            continue;
        }
        if (text[index] !== "<") {
            index += 1;
            continue;
        }
        const start = index + 1;
        const closing = text[start] === "/";
        const nameStart = closing ? start + 1 : start;
        const first = text[nameStart] ?? "";
        if (first && !/[A-Za-z]/.test(first)) {
            index += 1;
            continue;
        }
        tag = { name: "", closing, quote: null, lastNonWhitespace: "", readingName: true };
        index = nameStart;
    }
    if (tag?.readingName && tag.name) tag.readingName = false;
    return tag;
};

/** Count permitted indentation before a Markdown fence marker. */
const countFenceIndent = (line: string): number => {
    let spaces = 0;
    while (spaces < 3 && line[spaces] === " ") spaces += 1;
    return spaces;
};

/** Find the end of a contiguous run of identical fence marker characters. */
const findFenceMarkerEnd = (line: string, start: number, marker: string): number => {
    let end = start;
    while (line[end] === marker) end += 1;
    return end;
};

/** Read a marker run after optional indentation, rejecting non-fence characters. */
const readFenceMarker = (line: string): { marker: string; suffix: string } | null => {
    const start = countFenceIndent(line);
    const character = line[start];
    if (character !== "`" && character !== "~") return null;
    const markerEnd = findFenceMarkerEnd(line, start, character);
    if (markerEnd - start < 3) return null;
    return { marker: line.slice(start, markerEnd), suffix: line.slice(markerEnd) };
};

/** Read a top-level fence opener without a backtracking-prone regular expression. */
const parseFenceOpening = (line: string): { marker: string; info: string } | null => {
    const parsed = readFenceMarker(line);
    return parsed ? { marker: parsed.marker, info: parsed.suffix } : null;
};

/** Read a fence closer only when its suffix contains horizontal whitespace. */
const parseFenceClosing = (line: string): string | null => {
    const parsed = readFenceMarker(line);
    if (!parsed || !/^[ \t]*$/.test(parsed.suffix)) return null;
    return parsed.marker;
};

/** Close an active fence and report whether the overflow boundary has been reached. */
const closeFenceOnLine = (
    state: OpenUIFenceScannerState,
    text: string,
    line: string,
    lineStart: number,
    nextLineStart: number,
): boolean => {
    const active = state.activeFence;
    if (!active) return false;
    const closing = parseFenceClosing(line);
    if (!closing || closing[0] !== active.marker || closing.length < active.length) return false;

    let finishedOverflow = false;
    if (active.openUI) {
        let sourceEnd = lineStart;
        if (text.slice(sourceEnd - 2, sourceEnd) === "\r\n") sourceEnd -= 2;
        else if (text[sourceEnd - 1] === "\n") sourceEnd -= 1;
        state.fences.push({ ...active.openUI, end: nextLineStart, sourceEnd, closed: true });
    } else if (active.overflow && state.overflow) {
        state.overflow = { ...state.overflow, end: nextLineStart };
        finishedOverflow = true;
    }
    state.activeFence = null;
    return finishedOverflow;
};

/** Open top-level Markdown fences only when no opaque structural tag is active. */
const openFenceOnLine = (
    state: OpenUIFenceScannerState,
    line: string,
    lineStart: number,
    nextLineStart: number,
): void => {
    state.pendingMessageTag = scanStructuralTags(line, state.activeMessageTags, state.pendingMessageTag);
    if (state.activeMessageTags.size > 0 || state.pendingMessageTag !== null) return;

    const opening = parseFenceOpening(line);
    const marker = opening?.marker;
    const info = opening?.info ?? "";
    if (!marker || (marker[0] === "`" && info.includes("`"))) return;

    const language = info.trim().split(/\s+/, 1)[0]?.toLowerCase();
    const isOpenUI = language === "openui-lang";
    const isOverflow = isOpenUI && state.fences.length >= MAX_OPENUI_BLOCKS_PER_MESSAGE;
    if (isOverflow && !state.overflow) state.overflow = { start: lineStart, end: lineStart };
    const openUI = isOpenUI && !isOverflow
        ? { start: lineStart, end: nextLineStart, sourceStart: nextLineStart, sourceEnd: nextLineStart, closed: false }
        : undefined;
    state.activeFence = {
        marker: marker[0] ?? "`",
        length: marker.length,
        openUI,
        overflow: isOverflow,
    };
};

/** Find top-level Markdown fences, keeping examples inside opaque blocks as code. */
const findOpenUIFences = (text: string): OpenUIFenceScan => {
    const state: OpenUIFenceScannerState = {
        fences: [],
        activeFence: null,
        activeMessageTags: new Map<string, number>(),
        pendingMessageTag: null,
    };
    let lineStart = 0;

    while (lineStart < text.length) {
        const newline = text.indexOf("\n", lineStart);
        const lineEnd = newline === -1 ? text.length : newline;
        const nextLineStart = newline === -1 ? text.length : newline + 1;
        const line = text.slice(lineStart, lineEnd).replace(/\r$/, "");

        if (state.activeFence) {
            if (closeFenceOnLine(state, text, line, lineStart, nextLineStart)) {
                return { fences: state.fences, overflow: state.overflow };
            }
        } else {
            openFenceOnLine(state, line, lineStart, nextLineStart);
        }

        if (newline === -1) break;
        lineStart = nextLineStart;
    }

    if (state.activeFence?.openUI) {
        state.fences.push({
            ...state.activeFence.openUI,
            end: text.length,
            sourceEnd: text.length,
        });
    }
    if (state.overflow) state.overflow = { ...state.overflow, end: text.length };
    return { fences: state.fences, overflow: state.overflow };
};

/** Turn chart payloads into title and label/value rows when the rendered DOM is unavailable. */
function chartCopyText(raw: string | undefined): string {
    const parsed = parseCardJson<unknown>(raw);
    const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as { title?: unknown; points?: unknown }
        : null;
    const title = typeof record?.title === "string" ? record.title.trim() : "";
    const points = Array.isArray(parsed) ? parsed : Array.isArray(record?.points) ? record.points : [];
    const rows = points.flatMap((point) => {
        if (!point || typeof point !== "object") return [];
        const item = point as { label?: unknown; value?: unknown };
        const label = String(item.label ?? "").trim();
        const value = item.value;
        return label && (typeof value === "string" || typeof value === "number")
            ? [`${label}: ${value}`]
            : [];
    });
    return [title, ...rows].filter(Boolean).join("\n");
}

/** Preserve readable prompts and selected answers when a question card has no DOM text. */
function questionCopyText(chunk: Chunk): string {
    return (chunk.questions ?? []).map((question) => {
        const options = question.options.map(({ label }) => label).filter(Boolean).join(" / ");
        const answer = chunk.answers?.[question.id];
        const answerText = Array.isArray(answer) ? answer.join(", ") : answer;
        return [question.prompt, options, answerText ? `Answer: ${answerText}` : ""]
            .filter(Boolean)
            .join("\n");
    }).join("\n\n");
}

/** Provide a useful textual fallback for structured chunks that have no rendered DOM. */
function structuredChunkCopyText(chunk: Chunk): string {
    if (chunk.type === "question" || chunk.type === "questions") return questionCopyText(chunk);
    if (chunk.type === "chart") return chartCopyText(chunk.content);
    return chunk.content?.trim() ?? "";
}

/** Plain-text copy keeps prose and includes rendered visual text rather than raw OpenUI source. */
export const getMessageCopyText = (
    chunks: readonly Chunk[],
    openUIText: readonly string[] = [],
    renderedText?: string,
): string => {
    if (chunks.some((chunk) => chunk.type !== "text" && chunk.type !== "openui") && renderedText?.trim()) {
        return renderedText;
    }
    let visualIndex = 0;
    return chunks
        .map((chunk) => {
            if (chunk.type === "text") return chunk.content?.trim() ?? "";
            if (chunk.type === "openui") return openUIText[visualIndex++]?.trim() ?? "";
            return structuredChunkCopyText(chunk);
        })
        .filter(Boolean)
        .join("\n\n");
};

/** Read a quoted attribute from a structural tag without repeating capture boilerplate. */
const readTagAttribute = (source: string, name: string): string | undefined => {
    const match = source.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
    return match ? match[1] : undefined;
};

/** Extract the inner text for a well-formed or streaming structural tag. */
const getInnerTagContent = (block: string, tag: string) => {
    const startTag = `<${tag}>`;
    const endTag = `</${tag}>`;
    const start = block.indexOf(startTag);
    if (start === -1) return undefined;
    const end = block.indexOf(endTag, start);
    if (end === -1) return block.slice(start + startTag.length).replace(/^\n|\n$/g, '');
    return block.slice(start + startTag.length, end).replace(/^\n|\n$/g, '');
};

/** Convert an edit wrapper into a typed message chunk. */
const parseEditBlock = (block: string, isGenerating: boolean): Chunk => {
    const fileMatch = block.match(/<edit\s+file="([^"]*)"/);
    const file = fileMatch ? fileMatch[1] : undefined;
    return {
        type: 'edit',
        file,
        original: getInnerTagContent(block, 'original') || '',
        replacement: getInnerTagContent(block, 'replacement') || '',
        isGenerating,
    };
};

/** Edit staged for user approval (require-edit-approval mode). */
const parseEditPendingBlock = (block: string, isGenerating: boolean): Chunk => {
    return {
        type: 'edit_pending',
        file: readTagAttribute(block, "file"),
        commandId: readTagAttribute(block, "id"),
        commandStatus: readTagAttribute(block, "status") ?? 'pending',
        original: getInnerTagContent(block, 'original') || '',
        replacement: getInnerTagContent(block, 'replacement') || '',
        isGenerating,
    };
};

/** Build a saved-plan chunk from its attributes and optional body. */
const parsePlanSavedBlock = (block: string, innerContent?: string): Chunk => {
    const pathMatch = block.match(/path="([^"]*)"/);
    const titleMatch = block.match(/title="([^"]*)"/);
    const body =
        innerContent?.trim()
        || getInnerTagContent(block, "plan_saved")
        || undefined;
    return {
        type: 'plan_saved',
        file: pathMatch ? pathMatch[1] : undefined,
        content: titleMatch ? titleMatch[1] : 'Implementation Plan',
        planMarkdown: body,
    };
};

/** Convert an implementation-plan wrapper into its display chunk. */
const parsePlanBlock = (block: string): Chunk => {
    const titleMatch = block.match(/<plan\s+title="([^"]*)"/);
    const title = titleMatch ? titleMatch[1] : 'Plan';
    return {
        type: 'plan',
        content: block,
        file: title,
    };
};

/** Parse todo entries and normalize provider status names. */
const parseTodosBlock = (block: string): Chunk => {
    const titleMatch = block.match(/<todos\s+title="([^"]*)"/);
    const title = titleMatch ? titleMatch[1] : 'Todos';
    const todoMatches = [...block.matchAll(/<todo\s+([^>]*)>([\s\S]*?)<\/todo>/g)];
    const todos = todoMatches.map((m) => {
        const attrs = m[1] ?? '';
        const id = attrs.match(/id="([^"]*)"/)?.[1] ?? '';
        const statusRaw = (attrs.match(/status="([^"]*)"/)?.[1] ?? 'pending').toLowerCase();
        const status: "done" | "active" | "pending" | "cancelled" =
            statusRaw === 'completed' || statusRaw === 'done' || statusRaw === 'complete'
                ? 'done'
                : statusRaw === 'in_progress' || statusRaw === 'active'
                    ? 'active'
                    : statusRaw === 'cancelled' || statusRaw === 'canceled'
                        ? 'cancelled'
                        : 'pending';
        return { id, label: (m[2] ?? '').trim(), status };
    });
    return {
        type: 'todos',
        content: title,
        todos,
    };
};

/** Keep only the newest todo snapshot in a message chunk list. */
const pushOrReplaceTodos = (chunks: Chunk[], chunk: Chunk): void => {
    const idx = chunks.findIndex((c) => c.type === 'todos');
    if (idx >= 0) chunks[idx] = chunk;
    else chunks.push(chunk);
};

/** Parse a subagent result and its visible metadata. */
const parseSubagentBlock = (tagFull: string, inner: string, isGenerating: boolean): Chunk => {
    return {
        type: 'subagent',
        file: readTagAttribute(tagFull, 'id'),
        query: readTagAttribute(tagFull, 'agent') || readTagAttribute(tagFull, 'name'),
        command: readTagAttribute(tagFull, 'model'),
        content: inner.trim(),
        commandStatus: readTagAttribute(tagFull, 'status') || (isGenerating ? 'running' : 'done'),
        isGenerating,
    };
};

/** Parse a subagent reference without requiring a result body. */
const parseSubagentRefBlock = (tagFull: string, isGenerating: boolean): Chunk => {
    return {
        type: 'subagent_ref',
        file: readTagAttribute(tagFull, 'id'),
        query: readTagAttribute(tagFull, 'agent'),
        command: readTagAttribute(tagFull, 'model'),
        content: readTagAttribute(tagFull, 'task'),
        commandStatus: readTagAttribute(tagFull, 'status') || (isGenerating ? 'running' : 'done'),
        isGenerating,
    };
};

/** Parse a git operation and its lifecycle status. */
const parseGitOperationBlock = (tagFull: string, content: string, isGenerating: boolean): Chunk => {
    const opMatch = tagFull.match(/op="([^"]+)"/);
    const statusMatch = tagFull.match(/status="([^"]+)"/);
    return {
        type: 'git_operation',
        content,
        gitOp: opMatch ? opMatch[1] : undefined,
        gitStatus: statusMatch ? statusMatch[1] : (isGenerating ? 'running' : 'completed'),
        isGenerating,
    };
};

/** Parse a file-read chunk and its optional line range. */
const parseCatBlock = (tagFull: string, content: string, isGenerating: boolean): Chunk => {
    const path = readTagAttribute(tagFull, 'path') || content.trim();
    const start = readTagAttribute(tagFull, 'start') || readTagAttribute(tagFull, 'startLine');
    const end = readTagAttribute(tagFull, 'end') || readTagAttribute(tagFull, 'endLine');
    return {
        type: 'cat',
        content: path,
        catStartLine: start ? Number.parseInt(start, 10) : undefined,
        catEndLine: end ? Number.parseInt(end, 10) : undefined,
        isGenerating,
    };
};

/** Decode the XML entities supported by structural message attributes. */
const unescapeXml = (s: string): string => {
return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
};

/** Parse one preview's attributes and optional source into the UI data model. */
const parseDesignPreview = (attributes: string, inner: string): DesignPreviewItem | undefined => {
    const attribute = (name: string) => readTagAttribute(attributes, name) ?? "";
    const previewId = attribute("id");
    const path = attribute("path");
    const source = unescapeXml(inner).trim() || unescapeXml(attribute("source")).trim();
    if (!previewId.trim() || (!path.trim() && !source)) return undefined;

    const kindAttribute = attribute("kind");
    const kind = ["html", "png", "react"].includes(kindAttribute)
        ? kindAttribute as DesignPreviewItem["kind"]
        : undefined;
    return {
        id: previewId,
        name: attribute("name"),
        style: attribute("style"),
        path,
        source: source || undefined,
        width: Number.parseInt(attribute("width"), 10) || 1280,
        height: Number.parseInt(attribute("height"), 10) || 800,
        renderMs: Number.parseInt(attribute("render_ms"), 10) || undefined,
        kind,
    };
};

/** Add a parsed preview only when it has not already appeared in this payload. */
const appendUniquePreview = (previews: DesignPreviewItem[], preview: DesignPreviewItem | undefined): void => {
    if (!preview || previews.some((item) => item.id === preview.id)) return;
    previews.push(preview);
};

/** Parse and deduplicate the available design previews. */
const parseDesignPreviewsBlock = (block: string): Chunk => {
    const selected = block.match(/\bselected="([^"]*)"/)?.[1] ?? "";
    const id = block.match(/<design_previews\b[^>]*\bid="([^"]*)"/)?.[1];
    const status = block.match(/<design_previews\b[^>]*\bstatus="([^"]*)"/)?.[1];
    const previews: DesignPreviewItem[] = [];
    const paired = /<design_preview\s+([^>]*)>([\s\S]*?)<\/design_preview>/g;
    for (const match of block.matchAll(paired)) {
        appendUniquePreview(previews, parseDesignPreview(match[1] ?? "", match[2] ?? ""));
    }
    const selfClosing = /<design_preview\s+([^>]+)\/>/g;
    for (const match of block.matchAll(selfClosing)) {
        appendUniquePreview(previews, parseDesignPreview(match[1] ?? "", ""));
    }
    return {
        type: "design_previews",
        designPreviews: previews,
        selectedConcept: selected,
        commandId: id,
        commandStatus: status,
    };
};

/** Extract a review debate body and model label. */
const parseReviewDebateBlock = (block: string): Chunk => {
    const modelMatch = block.match(/<review_debate[^>]*\bmodel="([^"]*)"/i);
    const inner = block
        .replace(/^<review_debate[^>]*>\s*/i, "")
        .replace(/\s*<\/review_debate>$/i, "")
        .trim();
    return {
        type: "review_debate",
        content: inner,
        reviewModel: modelMatch?.[1],
    };
};

/** Extract a persona review body and its command metadata. */
const parsePersonaReviewBlock = (block: string): Chunk => {
    const open = block.match(/^<persona_review\b[^>]*>/i)?.[0] || "";
    const inner = block
        .replace(/^<persona_review[^>]*>\s*/i, "")
        .replace(/\s*<\/persona_review>$/i, "")
        .trim();
    return {
        type: "persona_review",
        content: inner,
        commandId: open.match(/\bid="([^"]*)"/)?.[1],
        commandStatus: open.match(/\bstatus="([^"]*)"/)?.[1],
        visitUrl: open.match(/\burl="([^"]*)"/)?.[1],
    };
};

/** Parse a question wrapper into prompts and submitted answers. */
const parseQuestionBlock = (block: string): Chunk => {
    const id = block.match(/\bid="([^"]*)"/)?.[1];
    const status = block.match(/\bstatus="([^"]*)"/)?.[1];
    const inner = block
        .replace(/^<questions?[^>]*>/i, "")
        .replace(/<\/questions?>\s*$/i, "")
        .trim();
    const { questions, answers } = parseQuestionsPayload(inner);
    return {
        type: "question",
        content: inner,
        commandId: id,
        commandStatus: status,
        questions,
        answers,
    };
};

/** Convert a plugin invocation wrapper into a display chunk. */
const parsePluginCallBlock = (tagFull: string, content: string, isGenerating: boolean): Chunk => {
    const status = readTagAttribute(tagFull, "status") || "ok";
    return {
        type: "plugin_call",
        content,
        pluginToolkit: readTagAttribute(tagFull, "toolkit"),
        pluginSlug: readTagAttribute(tagFull, "slug"),
        pluginLabel: readTagAttribute(tagFull, "label"),
        commandId: readTagAttribute(tagFull, "id"),
        commandStatus: status,
        isGenerating,
    };
};

/** Convert a sent-file wrapper into a display chunk. */
const parseSentFileBlock = (tagFull: string, content: string): Chunk => {
    return {
        type: "sent_file",
        file: decodeXml(readTagAttribute(tagFull, "name") ?? "") || "File",
        query: readTagAttribute(tagFull, "type") || "application/octet-stream",
        mediaPrompt: decodeXml(readTagAttribute(tagFull, "title") ?? "") || undefined,
        content: content.trim(),
    };
};

/** Convert generated media markup into a typed display chunk. */
const parseGeneratedMediaBlock = (
    type: "generated_svg" | "generated_image" | "generated_audio",
    tagFull: string,
    content: string,
    isGenerating: boolean,
): Chunk => {
    return {
        type,
        content: content.trim(),
        mediaPrompt: readTagAttribute(tagFull, "prompt"),
        mediaCredits: readTagAttribute(tagFull, "credits"),
        query: readTagAttribute(tagFull, "prompt"),
        isGenerating,
    };
};

/** Convert a rich-card wrapper and its attributes into a display chunk. */
const parseRichCard = (type: string, tagFull: string, content: string, isGenerating: boolean): Chunk => {
    return {
        type: type as Chunk["type"],
        content,
        visitUrl: decodeXml(readTagAttribute(tagFull, "url") ?? "") || undefined,
        visitTitle: decodeXml(readTagAttribute(tagFull, "title") ?? "") || undefined,
        commandId: readTagAttribute(tagFull, "id"),
        commandStatus: readTagAttribute(tagFull, "status"),
        isGenerating,
    };
};

/** Build a web-visit card from URL and status attributes. */
const parseWebVisitBlock = (tagFull: string, isGenerating: boolean): Chunk => {
    const url = readTagAttribute(tagFull, "url") ?? "";
    const host = readTagAttribute(tagFull, "host") || hostnameFromUrl(url);
    const title = readTagAttribute(tagFull, "title") || host;
    return {
        type: "web_visit",
        visitUrl: url,
        visitHost: host,
        visitTitle: title,
        content: host,
        isGenerating,
    };
};

/** Build a runtime-inspection card from its wrapper. */
const parseInspectRuntimeBlock = (tagFull: string, content: string, isGenerating: boolean): Chunk => {
    const url = tagFull.match(/\burl="([^"]*)"/)?.[1] ?? "";
    const kind = tagFull.match(/\bkind="([^"]*)"/)?.[1] ?? "";
    return {
        type: "inspect_runtime",
        query: url,
        inspectKind: kind,
        content,
        isGenerating,
    };
};


type MessageBlockMode = "selfClosing" | "streaming" | "complete";
type MessageBlockContext = {
    type: Chunk["type"];
    mode: MessageBlockMode;
    tagFull: string;
    block: string;
    content: string;
    isGenerating: boolean;
};
type MessageBlockParser = (context: MessageBlockContext) => Chunk;

/** Preserve the existing optional streaming flag consistently across tag parsers. */
const generationFields = (context: MessageBlockContext): { isGenerating?: boolean } =>
    context.mode === "selfClosing" ? {} : { isGenerating: context.isGenerating };

/** Read the first non-empty command line unless the tag is self-closing. */
const terminalCommandText = (context: MessageBlockContext): string => {
    if (context.mode === "selfClosing") return "";
    return context.content.split("\n").filter(Boolean)[0]?.trim() || "";
};

/** Select the user-facing reason text from a terminal approval or blocked message. */
const terminalCommandReason = (context: MessageBlockContext): string | undefined => {
    if (context.mode === "selfClosing") return undefined;
    const reasonLine = context.content.split("\n").find((line) =>
        line.includes("Awaiting approval:") || line.includes("Blocked:"),
    );
    return reasonLine?.replace(/^.*?(Awaiting approval:|Blocked:)\s*/, "").trim();
};

/** Preserve the command's explicit status, falling back to its streaming state. */
const terminalCommandStatus = (status: string | undefined, isGenerating: boolean): string =>
    status || (isGenerating ? "pending" : "completed");

/** Extract the first regex capture when a tag attribute is present. */
const firstMatchGroup = (match: RegExpMatchArray | null): string | undefined =>
    match ? match[1] : undefined;

/** Parse an optional integer metadata capture without duplicating its conversion guard. */
const parseOptionalInteger = (match: RegExpMatchArray | null): number | undefined => {
    const value = firstMatchGroup(match);
    return value ? Number(value) : undefined;
};

/** Omit the reason key for self-closing terminal tags, matching the legacy chunk shape. */
const terminalReasonFields = (context: MessageBlockContext): { commandReason?: string } => {
    if (context.mode === "selfClosing") return {};
    return { commandReason: terminalCommandReason(context) };
};

/** Parse terminal metadata and command text consistently for complete and streaming tags. */
const parseTerminalCommandBlock = (context: MessageBlockContext): Chunk => {
    const statusMatch = context.tagFull.match(/status="([^"]+)"/);
    const idMatch = context.tagFull.match(/id="([^"]+)"/);
    const sessionMatch = context.tagFull.match(/session="(\d+)"/);
    const exitMatch = context.tagFull.match(/exit="(-?\d+)"/);
    return {
        type: "terminal_command",
        content: context.content,
        command: terminalCommandText(context),
        commandId: firstMatchGroup(idMatch),
        commandStatus: terminalCommandStatus(firstMatchGroup(statusMatch), context.isGenerating),
        ...terminalReasonFields(context),
        sessionId: parseOptionalInteger(sessionMatch),
        exitCode: parseOptionalInteger(exitMatch),
        ...generationFields(context),
    };
};

/** Parse search-result attributes without duplicating logic across tag completion states. */
const parseSearchResultBlock = (context: MessageBlockContext): Chunk => {
    const query = context.tagFull.match(/query="([^"]+)"/)?.[1];
    return {
        type: context.type === "web_result" ? "web_result" : "search_result",
        content: context.content,
        query,
        ...generationFields(context),
    };
};

/** Parse a running command tag while preserving the streaming command text. */
const parseRunBlock = (context: MessageBlockContext): Chunk => ({
    type: "run",
    content: context.content,
    command: context.mode === "selfClosing" ? "" : context.content.trim(),
    ...generationFields(context),
});

const MESSAGE_BLOCK_PARSERS: Partial<Record<Chunk["type"], MessageBlockParser>> = {
    edit: ({ block, isGenerating }) => parseEditBlock(block, isGenerating),
    edit_pending: ({ block, isGenerating }) => parseEditPendingBlock(block, isGenerating),
    plan: ({ block }) => parsePlanBlock(block),
    plan_saved: ({ block, content }) => parsePlanSavedBlock(block, content),
    todos: ({ block }) => parseTodosBlock(block),
    terminal_command: parseTerminalCommandBlock,
    git_operation: ({ tagFull, content, isGenerating }) => parseGitOperationBlock(tagFull, content, isGenerating),
    browse_session: ({ type, tagFull, content, isGenerating }) => parseRichCard(type, tagFull, content, isGenerating),
    cat: ({ tagFull, content, isGenerating }) => parseCatBlock(tagFull, content, isGenerating),
    subagent_ref: ({ tagFull, isGenerating }) => parseSubagentRefBlock(tagFull, isGenerating),
    subagent: ({ tagFull, content, isGenerating }) => parseSubagentBlock(tagFull, content, isGenerating),
    design_previews: ({ block }) => parseDesignPreviewsBlock(block),
    review_debate: ({ block }) => parseReviewDebateBlock(block),
    persona_review: ({ block }) => parsePersonaReviewBlock(block),
    question: ({ block }) => parseQuestionBlock(block),
    questions: ({ block }) => parseQuestionBlock(block),
    run: parseRunBlock,
    web_result: parseSearchResultBlock,
    search_result: parseSearchResultBlock,
    web_visit: ({ tagFull, isGenerating }) => parseWebVisitBlock(tagFull, isGenerating),
    inspect_runtime: ({ tagFull, content, isGenerating }) => parseInspectRuntimeBlock(tagFull, content, isGenerating),
    plugin_call: ({ tagFull, content, isGenerating }) => parsePluginCallBlock(tagFull, content, isGenerating),
    generated_svg: ({ tagFull, content, isGenerating }) =>
        parseGeneratedMediaBlock("generated_svg", tagFull, content, isGenerating),
    generated_image: ({ tagFull, content, isGenerating }) =>
        parseGeneratedMediaBlock("generated_image", tagFull, content, isGenerating),
    generated_audio: ({ tagFull, content, isGenerating }) =>
        parseGeneratedMediaBlock("generated_audio", tagFull, content, isGenerating),
    sent_file: ({ tagFull, content }) => parseSentFileBlock(tagFull, content),
};

/** Dispatch one structural wrapper to its shared parser, regardless of streaming state. */
const parseMessageBlock = (context: MessageBlockContext): Chunk => {
    const parse = MESSAGE_BLOCK_PARSERS[context.type];
    if (parse) return parse(context);
    return {
        type: context.type,
        content: context.content,
        ...generationFields(context),
    };
};

type MessageBlockMatch = { type: Chunk["type"]; index: number; startTag: string; endTag: string };
type MessageBlockSpan = { mode: MessageBlockMode; contentStart: number; endIndex: number };

/** Append a plain-text range after removing orphaned reasoning-control tags. */
const appendPlainTextRange = (
    chunks: Chunk[],
    text: string,
    start: number,
    end: number,
    sourceOffset: number,
): void => {
    if (end <= start) return;
    const content = stripOrphanThinkTags(text.slice(start, end));
    if (content) chunks.push({ type: "text", content, sourceStart: sourceOffset + start });
};

/** Prefer the earliest block marker, with the longer marker winning at a shared offset. */
const isEarlierMessageBlock = (candidate: MessageBlockMatch, current: MessageBlockMatch | null): boolean =>
    !current
    || candidate.index < current.index
    || (candidate.index === current.index && candidate.startTag.length > current.startTag.length);

/** Find the next recognized block wrapper without rescanning earlier message content. */
const findNextMessageBlock = (text: string, start: number): MessageBlockMatch | null => {
    let firstMatch: MessageBlockMatch | null = null;
    for (const tag of MESSAGE_BLOCK_TAGS) {
        const index = findStructuralTagIndex(text, start, tag.start);
        if (index === -1) continue;
        const candidate = { type: tag.type, index, startTag: tag.start, endTag: tag.end };
        if (isEarlierMessageBlock(candidate, firstMatch)) firstMatch = candidate;
    }
    return firstMatch;
};

/** Classify a wrapper as self-closing, complete, or still streaming. */
const findMessageBlockSpan = (text: string, match: MessageBlockMatch): MessageBlockSpan => {
    const tagEnd = text.indexOf(">", match.index);
    const contentStart = tagEnd === -1 ? text.length : tagEnd + 1;
    if (tagEnd === -1) return { mode: "streaming", contentStart, endIndex: -1 };
    if (tagEnd > match.index && text[tagEnd - 1] === "/") {
        return { mode: "selfClosing", contentStart, endIndex: -2 };
    }
    const endIndex = match.endTag.startsWith("<")
        ? findStructuralTagIndex(text, contentStart, match.endTag)
        : text.indexOf(match.endTag, contentStart);
    return endIndex === -1
        ? { mode: "streaming", contentStart, endIndex }
        : { mode: "complete", contentStart, endIndex };
};

/** Return the content region for a complete or still-streaming block. */
const messageBlockContent = (text: string, span: MessageBlockSpan): string => {
    if (span.mode === "selfClosing") return "";
    if (span.mode === "complete") return text.slice(span.contentStart, span.endIndex);
    return text.slice(span.contentStart);
};

/** Find the exclusive end of the full wrapper, including its closing marker. */
const messageBlockEnd = (text: string, match: MessageBlockMatch, span: MessageBlockSpan): number => {
    if (span.mode === "selfClosing") return span.contentStart;
    if (span.mode === "streaming") return text.length;
    return span.endIndex + match.endTag.length;
};

/** Build one parsed chunk while preserving the source range and streaming state. */
const parseMatchedMessageBlock = (
    text: string,
    sourceOffset: number,
    match: MessageBlockMatch,
): { chunk: Chunk; mode: MessageBlockMode; nextIndex: number } => {
    const span = findMessageBlockSpan(text, match);
    const blockEnd = messageBlockEnd(text, match, span);
    const chunk = parseMessageBlock({
        type: match.type,
        mode: span.mode,
        tagFull: text.slice(match.index, span.contentStart),
        block: text.slice(match.index, blockEnd),
        content: messageBlockContent(text, span),
        isGenerating: span.mode === "streaming",
    });
    chunk.sourceStart = sourceOffset + match.index;
    return { chunk, mode: span.mode, nextIndex: blockEnd };
};

/** Parse structural tool wrappers and plain text in one forward pass. */
const parseStructuralMessageContent = (source: string, sourceOffset: number): Chunk[] => {
    const text = stripLeakedToolCode(source);
    const chunks: Chunk[] = [];
    let cursor = 0;
    while (cursor < text.length) {
        const match = findNextMessageBlock(text, cursor);
        if (!match) {
            appendPlainTextRange(chunks, text, cursor, text.length, sourceOffset);
            break;
        }
        appendPlainTextRange(chunks, text, cursor, match.index, sourceOffset);
        const parsed = parseMatchedMessageBlock(text, sourceOffset, match);
        if (parsed.chunk.type === "todos") pushOrReplaceTodos(chunks, parsed.chunk);
        else chunks.push(parsed.chunk);
        if (parsed.mode === "streaming") break;
        cursor = parsed.nextIndex;
    }
    return dedupeTerminalChunks(chunks);
};

/** Convert an accepted visual fence into a bounded, sanitized OpenUI chunk. */
const openUIFenceChunk = (text: string, fence: OpenUIFence, sourceOffset: number): Chunk => {
    const sourceLength = fence.sourceEnd - fence.sourceStart;
    const boundedSource = text.slice(
        fence.sourceStart,
        Math.min(fence.sourceEnd, fence.sourceStart + MAX_OPENUI_SOURCE_LENGTH),
    );
    // OpenUI source is executable DSL, not a code sample: scrub hidden control markup even inside Markdown fences.
    const content = stripLeakedToolCode(boundedSource, { includeFencedCode: true });
    return {
        type: "openui",
        content,
        isGenerating: !fence.closed,
        openuiTruncated: sourceLength > MAX_OPENUI_SOURCE_LENGTH,
        openuiSourceStart: sourceOffset + fence.start,
        sourceStart: sourceOffset + fence.start,
    };
};

/** Append an uncovered range after parsing it without starting another fence scan. */
const appendStructuralRange = (
    chunks: Chunk[],
    text: string,
    start: number,
    end: number,
    sourceOffset: number,
): void => {
    if (end > start) {
        chunks.push(...parseStructuralMessageContent(text.slice(start, end), sourceOffset + start));
    }
};

/** Keep over-budget visual source as sanitized Markdown rather than materializing more OpenUI nodes. */
const overflowFenceChunk = (text: string, overflow: OpenUIFenceOverflow, sourceOffset: number): Chunk => ({
    type: "text",
    content: stripLeakedToolCode(text.slice(overflow.start, overflow.end), { includeFencedCode: true }),
    sourceStart: sourceOffset + overflow.start,
});

/** Split scanned visual fences, parse intervening ranges, and preserve source offsets. */
const parseScannedOpenUIContent = (
    text: string,
    scan: OpenUIFenceScan,
    sourceOffset: number,
): Chunk[] => {
    const chunks: Chunk[] = [];
    let cursor = 0;
    for (const fence of scan.fences) {
        appendStructuralRange(chunks, text, cursor, fence.start, sourceOffset);
        chunks.push(openUIFenceChunk(text, fence, sourceOffset));
        cursor = fence.end;
    }
    if (scan.overflow) {
        appendStructuralRange(chunks, text, cursor, scan.overflow.start, sourceOffset);
        chunks.push(overflowFenceChunk(text, scan.overflow, sourceOffset));
        cursor = scan.overflow.end;
    }
    appendStructuralRange(chunks, text, cursor, text.length, sourceOffset);
    return mergeAdjacentTextChunks(chunks);
};

/** Split eligible visual fences before handing the remaining text to the structural parser. */
const parseMessageContentWithOpenUI = (text: string, detectOpenUI = true, sourceOffset = 0): Chunk[] => {
    const scan: OpenUIFenceScan = detectOpenUI ? findOpenUIFences(text) : { fences: [] };
    if (scan.fences.length > 0 || scan.overflow) {
        return parseScannedOpenUIContent(text, scan, sourceOffset);
    }
    return parseStructuralMessageContent(text, sourceOffset);
};

/** Parse assistant text into structural UI chunks and bounded OpenUI visual blocks. */
export const parseMessageContent = (text: string): Chunk[] => {
    return parseMessageContentWithOpenUI(text);
};


/** Merge consecutive plain-text segments so markdown renders as one block. */
function mergeAdjacentTextChunks(chunks: Chunk[]): Chunk[] {
    const merged: Chunk[] = [];
    for (const chunk of chunks) {
        const prev = merged[merged.length - 1];
        if (chunk.type === "text" && prev?.type === "text") {
            prev.content = `${prev.content || ""}${chunk.content || ""}`;
            if (chunk.isGenerating) prev.isGenerating = true;
        } else {
            merged.push({ ...chunk });
        }
    }
    return merged;
}

export type WebSearchResultItem = { title: string; url: string; snippet: string };

export function parseWebResults(blockContent: string): WebSearchResultItem[] {
    const results: WebSearchResultItem[] = [];
    const blocks = blockContent.split('---').filter(Boolean);
    blocks.forEach(block => {
        const titleMatch = block.match(/### (.*)/);
        const urlMatch = block.match(/URL: (.*)/);
        const text = block.replace(/### .*/, '').replace(/URL: .*/, '').trim();
        if (titleMatch || urlMatch) {
            results.push({
                title: titleMatch ? titleMatch[1].trim() : 'Result',
                url: urlMatch ? urlMatch[1].trim() : '',
                snippet: text
            });
        }
    });
    return results;
}

/** Collect unique web search/visit hit URLs from a message for the footer sources menu. */
export function extractWebSearchResults(content: string): WebSearchResultItem[] {
    const chunks = parseMessageContent(content);
    const results: WebSearchResultItem[] = [];
    const seen = new Set<string>();
    for (const item of chunks) {
        if (item.type === "web_visit") {
            const url = item.visitUrl || "";
            const key = url || item.visitHost || "";
            if (!key || seen.has(key)) continue;
            seen.add(key);
            results.push({
                title: item.visitTitle || item.visitHost || "Visited",
                url,
                snippet: item.visitHost ? `Visited ${item.visitHost}` : "Visited page",
            });
            continue;
        }
        if (item.type !== 'web_result' && item.type !== 'web_search') continue;
        if (item.type !== 'web_result') continue;
        for (const hit of parseWebResults(item.content || '')) {
            const key = hit.url || `${hit.title}:${hit.snippet}`;
            if (seen.has(key)) continue;
            seen.add(key);
            results.push(hit);
        }
    }
    return results;
}

/**
 * A message is a chronological sequence of segments. A sentence between
 * tool runs splits the rail, so the line stops and starts again around it.
 */
type Segment =
    | { kind: 'workflow'; blocks: Chunk[]; sourceStart: number }
    | { kind: 'chunk'; chunk: Chunk };

/** Add a workflow block to its adjacent rail segment or begin a new segment. */
const appendWorkflowChunk = (segments: Segment[], chunk: Chunk): void => {
    const previous = segments[segments.length - 1];
    if (previous?.kind === "workflow") {
        previous.blocks.push(chunk);
        return;
    }
    segments.push({ kind: "workflow", blocks: [chunk], sourceStart: chunk.sourceStart ?? 0 });
};

/** Ignore whitespace-only chunks because they do not create visible message content. */
const isWhitespaceOnlyText = (chunk: Chunk): boolean =>
    chunk.type === "text" && !(chunk.content || "").trim();

/** Group adjacent workflow blocks while preserving ordinary message chunks in sequence. */
const appendStandaloneChunk = (segments: Segment[], chunk: Chunk): void => {
    if (!isWhitespaceOnlyText(chunk)) segments.push({ kind: "chunk", chunk });
};

/** Group adjacent workflow blocks while preserving ordinary message chunks in sequence. */
const buildSegments = (chunks: Chunk[]): Segment[] => {
    const segments: Segment[] = [];
    for (const chunk of chunks) {
        if (WORKFLOW_CHUNK_TYPES.has(chunk.type)) appendWorkflowChunk(segments, chunk);
        else appendStandaloneChunk(segments, chunk);
    }
    return segments;
};


type MessageChunkRenderContext = {
    segmentKey: string;
    isGenerating?: boolean;
    isLastSegment: boolean;
    isLastBrowseSegment: boolean;
};
type MessageSegmentRenderContext = MessageChunkRenderContext & {
    segment: Segment;
    firstWorkflowSegment?: Segment;
    lastWorkflowSegment?: Segment;
    durationMs?: number;
    activityLabel?: string | null;
};
type MessageChunkRenderer = (chunk: Chunk, context: MessageChunkRenderContext) => React.ReactNode;

/** Render the stable wrapper key used by chronological message segments. */
const getSegmentKey = (segment: Segment): string => segment.kind === "workflow"
    ? `workflow-${segment.sourceStart}`
    : `${segment.chunk.type}-${segment.chunk.sourceStart ?? 0}`;

/** Render one bounded visual answer chunk. */
const renderOpenUIChunk: MessageChunkRenderer = (chunk, context) => (
    <OpenUIBlock
        key={`openui-${chunk.openuiSourceStart ?? 0}`}
        response={chunk.content || ""}
        isStreaming={Boolean(context.isGenerating && context.isLastSegment)}
        truncated={chunk.openuiTruncated}
    />
);

/** Render one prose chunk with the existing streaming animation and markdown behavior. */
const renderTextChunk: MessageChunkRenderer = (chunk, context) => {
    const text = chunk.content;
    if (!text?.trim()) return null;
    return (
        <div
            key={context.segmentKey}
            className={cn(
                "text-sm font-medium text-text-primary leading-[var(--conversation-line-height)] mb-0 w-full overflow-hidden prose-compact chat-markdown",
                context.isGenerating && context.isLastSegment && "animate-in fade-in duration-300",
            )}
        >
            <ChatMarkdown content={text} isGenerating={context.isGenerating} isLast={context.isLastSegment} />
        </div>
    );
};

/** Parse explicit plan-step tags into the planning card's compact data model. */
const parsePlanSteps = (content: string): Array<{ status: "done" | "active" | "pending" | "cancelled"; label: string }> =>
    [...content.matchAll(/<step\s+status="([^"]*)">([\s\S]*?)<\/step>/g)].map((match) => ({
        status: match[1] as "done" | "active" | "pending" | "cancelled",
        label: match[2].trim(),
    }));

/** Count completed planning steps without coupling count logic to the renderer. */
const countCompletedSteps = (steps: Array<{ status: string }>): number =>
    steps.filter((step) => step.status === "done").length;

/** Render the saved plan summary card. */
const renderSavedPlanChunk: MessageChunkRenderer = (chunk, context) => (
    <PlanSavedBlock
        key={context.segmentKey}
        title={chunk.content || "Implementation Plan"}
        path={chunk.file || ""}
        markdown={chunk.planMarkdown}
    />
);

/** Render an in-progress plan with parsed step completion data. */
const renderPlanChunk: MessageChunkRenderer = (chunk, context) => {
    const steps = parsePlanSteps(chunk.content || "");
    return (
        <PlanningBlock
            key={context.segmentKey}
            title={chunk.file || "Plan"}
            steps={steps}
            completedCount={countCompletedSteps(steps)}
            totalCount={steps.length}
            isGenerating={context.isGenerating}
        />
    );
};

/** Render a todo checklist through the same planning card as explicit plan steps. */
const renderTodosChunk: MessageChunkRenderer = (chunk, context) => {
    const todos = chunk.todos || [];
    if (todos.length === 0) return null;
    const steps = todos.map((todo) => ({ status: todo.status, label: todo.label }));
    return (
        <PlanningBlock
            key={context.segmentKey}
            title={chunk.content || "Todos"}
            steps={steps}
            completedCount={countCompletedSteps(steps)}
            totalCount={steps.length}
            isGenerating={context.isGenerating}
        />
    );
};

/** Render a browser visit only for the newest visit segment in the message. */
const renderBrowseChunk: MessageChunkRenderer = (chunk, context) => {
    if (!context.isLastBrowseSegment) return null;
    const parsed = parseCardJson<{ image?: string; x?: number; y?: number; console?: string[] }>(chunk.content);
    return (
        <BrowseChatCard
            key={context.segmentKey}
            url={chunk.visitUrl}
            title={chunk.visitTitle}
            status={chunk.commandStatus}
            image={parsed?.image || ""}
            x={parsed?.x}
            y={parsed?.y}
            consoleLines={parsed?.console}
            followLive
        />
    );
};

/** Render a generated file card without exposing raw file content in the message body. */
const renderSentFileChunk: MessageChunkRenderer = (chunk, context) => (
    <SentFileCard
        key={context.segmentKey}
        name={chunk.file || "File"}
        title={chunk.mediaPrompt}
        mime={chunk.query || ""}
        src={chunk.content || ""}
    />
);

/** Render an attached image only when it has a usable source URL. */
const renderAttachedImageChunk: MessageChunkRenderer = (chunk, context) => {
    const source = chunk.content?.trim() || "";
    if (!source) return null;
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            key={context.segmentKey}
            src={source}
            alt={chunk.file || ""}
            className="my-2 max-h-80 max-w-[420px] rounded-xl border border-border-subtle object-contain"
        />
    );
};

/** Render a concise label for available design concepts. */
const renderDesignPreviewsChunk: MessageChunkRenderer = (chunk, context) => {
    const previewCount = chunk.designPreviews?.length ?? 0;
    if (previewCount === 0) return null;
    const names = (chunk.designPreviews || []).map((preview) => preview.name).filter(Boolean).join(" · ");
    return (
        <p key={context.segmentKey} className="my-1 text-sm text-text-muted">
            {names || `${previewCount} design concept${previewCount === 1 ? "" : "s"}`}
        </p>
    );
};

/** Resolve the card kind for one generated media chunk. */
const generatedMediaKind = (type: Chunk["type"]): "svg" | "audio" | "image" =>
    type === "generated_svg" ? "svg" : type === "generated_audio" ? "audio" : "image";

/** Render generated media with its original prompt and generation state. */
const renderGeneratedMediaChunk: MessageChunkRenderer = (chunk, context) => (
    <GeneratedMediaCard
        key={context.segmentKey}
        kind={generatedMediaKind(chunk.type)}
        src={chunk.content}
        prompt={chunk.mediaPrompt || chunk.query}
        credits={chunk.mediaCredits}
        loading={Boolean(chunk.isGenerating && !chunk.content?.trim())}
    />
);

/** Render a compact adversarial-review summary. */
const renderReviewDebateChunk: MessageChunkRenderer = (chunk, context) => (
    <ReviewDebatePanel key={context.segmentKey} content={chunk.content || ""} model={chunk.reviewModel} />
);

/** Render a persona-review result with its lifecycle metadata. */
const renderPersonaReviewChunk: MessageChunkRenderer = (chunk, context) => (
    <PersonaReviewPanel
        key={context.segmentKey}
        reviewId={chunk.commandId}
        url={chunk.visitUrl}
        status={chunk.commandStatus}
        content={chunk.content || ""}
    />
);

/** Render questions and any answers already attached to the chunk. */
const renderQuestionChunk: MessageChunkRenderer = (chunk, context) => (
    <QuestionsCard
        key={context.segmentKey}
        askId={chunk.commandId}
        status={chunk.commandStatus}
        questions={chunk.questions || []}
        answers={chunk.answers}
    />
);

const MESSAGE_CHUNK_RENDERERS: Partial<Record<Chunk["type"], MessageChunkRenderer>> = {
    openui: renderOpenUIChunk,
    text: renderTextChunk,
    plan_saved: renderSavedPlanChunk,
    plan: renderPlanChunk,
    todos: renderTodosChunk,
    chart: (chunk, context) => <ChartBlock key={context.segmentKey} content={chunk.content} />,
    insight_card: (chunk, context) => <InsightCard key={context.segmentKey} content={chunk.content} />,
    browse_session: renderBrowseChunk,
    sent_file: renderSentFileChunk,
    attached_image: renderAttachedImageChunk,
    design_previews: renderDesignPreviewsChunk,
    generated_svg: renderGeneratedMediaChunk,
    generated_image: renderGeneratedMediaChunk,
    generated_audio: renderGeneratedMediaChunk,
    review_debate: renderReviewDebateChunk,
    persona_review: renderPersonaReviewChunk,
    question: renderQuestionChunk,
};

/** Render one non-workflow chunk via the small renderer registered for its type. */
const renderMessageChunk = (chunk: Chunk, context: MessageChunkRenderContext): React.ReactNode =>
    MESSAGE_CHUNK_RENDERERS[chunk.type]?.(chunk, context) ?? null;

/** Render one workflow segment and preserve first/last segment metadata. */
const renderWorkflowSegment = (context: MessageSegmentRenderContext): React.ReactNode => {
    const segment = context.segment;
    if (segment.kind !== "workflow") return null;
    const isFirst = segment === context.firstWorkflowSegment;
    const isLast = segment === context.lastWorkflowSegment;
    return (
        <TurnWorkflowSummary
            key={context.segmentKey}
            blocks={segment.blocks}
            isActive={Boolean(context.isGenerating && isLast)}
            durationMs={isFirst ? context.durationMs : undefined}
            activityLabel={isLast ? context.activityLabel : null}
        />
    );
};

/** Render the workflow rail or its corresponding typed message chunk. */
const renderMessageSegment = (context: MessageSegmentRenderContext): React.ReactNode => {
    if (context.segment.kind === "workflow") return renderWorkflowSegment(context);
    const chunkContext: MessageChunkRenderContext = {
        segmentKey: context.segmentKey,
        isGenerating: context.isGenerating,
        isLastSegment: context.isLastSegment,
        isLastBrowseSegment: context.isLastBrowseSegment,
    };
    return renderMessageChunk(context.segment.chunk, chunkContext);
};


type MessageStatusContext = {
    contentChunks: Chunk[];
    workflowSegments: Extract<Segment, { kind: "workflow" }>[];
    isGenerating?: boolean;
    activityLabel?: string | null;
};
const THINKING_CHUNK_TYPES = new Set<Chunk["type"]>(["think", "thought"]);
const EDIT_CHUNK_TYPES = new Set<Chunk["type"]>(["edit", "edit_pending"]);
const APPROVAL_CHUNK_TYPES = new Set<Chunk["type"]>(["terminal_command", "edit_pending", "plugin_call"]);

/** Clear stale streaming flags when the assistant turn is no longer active. */
const normalizeChunkGeneration = (chunks: Chunk[], isGenerating?: boolean): Chunk[] => {
    if (isGenerating) return chunks;
    return chunks.map((chunk) => (chunk.isGenerating ? { ...chunk, isGenerating: false } : chunk));
};

/** Remove in-progress persona reviews that have a later final result with the same id. */
const removeSupersededPersonaReviews = (chunks: Chunk[]): Chunk[] =>
    chunks.filter((chunk, index) =>
        chunk.type !== "persona_review"
        || !chunks.some((later, laterIndex) =>
            laterIndex > index && later.type === "persona_review" && later.commandId === chunk.commandId,
        ),
    );

/** Keep thought-only chunks out of browsing sessions and filter hidden workflow blocks. */
const isVisibleMessageChunk = (chunk: Chunk, browsing: boolean, isGenerating?: boolean): boolean => {
    if (browsing && THINKING_CHUNK_TYPES.has(chunk.type)) return false;
    if (WORKFLOW_CHUNK_TYPES.has(chunk.type)) return isRenderableWorkflowBlock(chunk, isGenerating);
    return true;
};

/** Detect a pending workflow approval without coupling the test to status rendering. */
const hasPendingWorkflowApproval = (segments: Extract<Segment, { kind: "workflow" }>[]): boolean =>
    segments.some((segment) => segment.blocks.some((block) =>
        APPROVAL_CHUNK_TYPES.has(block.type) && block.commandStatus === "pending",
    ));

/** Detect an unanswered question among the visible chunks. */
const hasPendingQuestion = (chunks: Chunk[]): boolean =>
    chunks.some((chunk) => chunk.type === "question" && chunk.commandStatus === "pending");

/** Detect a design-choice prompt that still needs a selection. */
const hasPendingDesignChoice = (chunks: Chunk[]): boolean =>
    chunks.some((chunk) => chunk.type === "design_previews" && chunk.commandStatus === "pending");

/** Combine workflow and interactive prompts into one pending-approval indicator. */
const hasPendingApproval = (segments: Extract<Segment, { kind: "workflow" }>[], chunks: Chunk[]): boolean =>
    hasPendingWorkflowApproval(segments) || hasPendingQuestion(chunks) || hasPendingDesignChoice(chunks);

/** Find the latest changed file referenced by the final workflow segment. */
const latestEditedFileName = (segments: Extract<Segment, { kind: "workflow" }>[]): string | undefined => {
    const blocks = segments.at(-1)?.blocks ?? [];
    return [...blocks].reverse()
        .find((block) => EDIT_CHUNK_TYPES.has(block.type))
        ?.file?.split(/[\\/]/).pop();
};

/** Prefer the most actionable label for a pending approval or answer request. */
const pendingApprovalLabel = (chunks: Chunk[]): string => {
    if (hasPendingQuestion(chunks)) return "Waiting for your answers";
    if (hasPendingDesignChoice(chunks)) return "Waiting for you to pick a design";
    return "Waiting for approval";
};

/** Detect whether the final workflow block is an active reasoning step. */
const isThinkingBlock = (block: Chunk | undefined, isGenerating?: boolean): boolean =>
    Boolean(isGenerating && block && THINKING_CHUNK_TYPES.has(block.type) && block.isGenerating);

/** Detect an active or recent edit from either its block or status text. */
const isEditingMessage = (block: Chunk | undefined, activityLabel?: string | null): boolean =>
    Boolean((block && EDIT_CHUNK_TYPES.has(block.type)) || /\bedit/i.test(activityLabel ?? ""));

/** Select a useful non-interactive status when no approval is waiting. */
const defaultMessageStatus = (
    activityLabel: string | null | undefined,
    isThinking: boolean,
    hasWorkflow: boolean,
): string | undefined => {
    if (activityLabel?.trim()) return activityLabel.trim();
    if (isThinking) return "Thinking";
    if (hasWorkflow) return "Working";
    return undefined;
};

/** Resolve the best status label for the current assistant turn. */
const messageStatusLabel = (context: MessageStatusContext): string | undefined => {
    const { contentChunks, workflowSegments, isGenerating, activityLabel } = context;
    const lastWorkflowBlock = workflowSegments.at(-1)?.blocks.at(-1);
    const isThinking = isThinkingBlock(lastWorkflowBlock, isGenerating);
    const isEditing = isEditingMessage(lastWorkflowBlock, activityLabel);
    if (hasPendingApproval(workflowSegments, contentChunks)) return pendingApprovalLabel(contentChunks);
    if (isEditing) return `Editing ${latestEditedFileName(workflowSegments) || "file"}`;
    return defaultMessageStatus(activityLabel, isThinking, workflowSegments.length > 0);
};

/** Check whether generated status should remain visible below the final segment. */
const shouldShowStatusLine = (
    isGenerating: boolean | undefined,
    proseIsStreaming: boolean,
    statusLabel: string | undefined,
    hasPending: boolean,
): boolean => Boolean(isGenerating && !proseIsStreaming && (hasPending || statusLabel));

/** Find the newest browse segment without coupling lookup to the component body. */
const latestBrowseSegment = (segments: Segment[]): Segment | undefined =>
    [...segments].reverse().find((segment) =>
        segment.kind === "chunk" && segment.chunk.type === "browse_session",
    );

/** Identify a final prose chunk that is still receiving streamed content. */
const isStreamingProseSegment = (segment: Segment | undefined): boolean =>
    segment?.kind === "chunk"
    && segment.chunk.type === "text"
    && Boolean(segment.chunk.content?.trim());

type MessageRendererProps = {
    content: string;
    isGenerating?: boolean;
    activityLabel?: string | null;
    isFileEditResolved?: (file: string, replacement?: string) => boolean;
    durationMs?: number;
    skipSubagentSync?: boolean;
};

/** Limit full-message streaming rescans to ten per second; completed text is parsed immediately. */
const STREAMING_PARSE_INTERVAL_MS = 100;

/** Render parsed assistant chunks with their workflow rails and streaming status. */
export const MessageRenderer = ({
    content,
    isGenerating,
    activityLabel,
    durationMs,
    skipSubagentSync,
}: MessageRendererProps) => {
    const [parsedContent, setParsedContent] = React.useState(content);
    const latestContent = React.useRef(content);
    useEffect(() => {
        latestContent.current = content;
    }, [content]);
    useEffect(() => {
        const updateParsedContent = () => setParsedContent(latestContent.current);
        if (!isGenerating) {
            const timeout = globalThis.setTimeout(updateParsedContent, 0);
            return () => globalThis.clearTimeout(timeout);
        }
        const interval = globalThis.setInterval(updateParsedContent, STREAMING_PARSE_INTERVAL_MS);
        return () => globalThis.clearInterval(interval);
    }, [isGenerating]);
    const contentToParse = isGenerating ? parsedContent : content;
    const chunks = useMemo(
        () => normalizeChunkGeneration(parseMessageContent(contentToParse), isGenerating),
        [contentToParse, isGenerating],
    );

    useEffect(() => {
        if (skipSubagentSync) return;
        syncSubagentsFromChunks(chunks, Boolean(isGenerating));
    }, [chunks, isGenerating, skipSubagentSync]);

    const contentChunks = useMemo(
        () => removeSupersededPersonaReviews(mergeAdjacentTextChunks(chunks)),
        [chunks],
    );
    const browsing = contentChunks.some((chunk) => chunk.type === "browse_session");
    const segments = useMemo(
        () => buildSegments(contentChunks.filter((chunk) => isVisibleMessageChunk(chunk, browsing, isGenerating))),
        [contentChunks, isGenerating, browsing],
    );

    const workflowSegments = segments.filter(
        (segment): segment is Extract<Segment, { kind: "workflow" }> => segment.kind === "workflow",
    );
    const firstWorkflowSegment = workflowSegments[0];
    const lastWorkflowSegment = workflowSegments.at(-1);
    const lastBrowseSegment = latestBrowseSegment(segments);
    const lastSegment = segments.at(-1);
    const proseIsStreaming = isStreamingProseSegment(lastSegment);
    const hasPending = hasPendingApproval(workflowSegments, contentChunks);
    const statusLabel = messageStatusLabel({ contentChunks, workflowSegments, isGenerating, activityLabel });
    const showStatusLine = shouldShowStatusLine(isGenerating, proseIsStreaming, statusLabel, hasPending);

    const renderedSegments = segments.map((segment) => renderMessageSegment({
        segment,
        segmentKey: getSegmentKey(segment),
        isGenerating,
        isLastSegment: segment === lastSegment,
        isLastBrowseSegment: segment === lastBrowseSegment,
        firstWorkflowSegment,
        lastWorkflowSegment,
        durationMs,
        activityLabel,
    }));

    return (
        <div className="flex flex-col gap-0 overflow-hidden">
            {renderedSegments}
            {showStatusLine && (
                <GeneratingIndicator label={statusLabel} />
            )}
        </div>
    );
};

export { ChatMarkdown as StreamingMarkdown } from "./view";
