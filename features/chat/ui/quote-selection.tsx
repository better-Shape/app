"use client";

import { TextQuote16Regular } from "@fluentui/react-icons/headless/svg/text-quote";
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export const MAX_QUOTE_CHARS = 1200;

export type QuotedExcerpt = {
    id: string;
    text: string;
};

const SKIP_SELECTOR =
    "button:not([data-quote-allow]), [data-quote-skip], [aria-hidden='true'], [role='status'], svg, script, style";

const BLOCK_TAGS = new Set([
    "P",
    "DIV",
    "LI",
    "PRE",
    "BLOCKQUOTE",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "TR",
]);

/**
 * Walk a Range inside `messageRoot` and collect user-visible text while skipping
 * toolbar buttons, status badges, and `[data-quote-skip]` chrome.
 */
export function extractCleanSelectionText(range: Range, messageRoot: HTMLElement): string {
    if (!messageRoot.contains(range.startContainer) || !messageRoot.contains(range.endContainer)) {
        return "";
    }
    const commonEl =
        range.commonAncestorContainer instanceof Element
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement;
    if (commonEl && messageRoot.contains(commonEl) && commonEl.closest(SKIP_SELECTOR)) {
        return "";
    }

    const fragment = range.cloneContents();
    const parts: string[] = [];

    const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            parts.push(node.textContent ?? "");
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as HTMLElement;
        if (el.matches(SKIP_SELECTOR)) return;
        if (el.tagName === "BR") {
            parts.push("\n");
            return;
        }
        const isTableCell = el.tagName === "TD" || el.tagName === "TH";
        if (
            isTableCell &&
            parts.length > 0 &&
            !parts[parts.length - 1]?.endsWith("\n") &&
            !parts[parts.length - 1]?.endsWith("\t")
        ) {
            parts.push("\t");
        }
        const isBlock = BLOCK_TAGS.has(el.tagName);
        if (isBlock && parts.length > 0 && !parts[parts.length - 1]?.endsWith("\n")) {
            parts.push("\n");
        }
        for (const child of Array.from(el.childNodes)) {
            walk(child);
        }
        if (isBlock && parts.length > 0 && !parts[parts.length - 1]?.endsWith("\n")) {
            parts.push("\n");
        }
    };

    for (const child of Array.from(fragment.childNodes)) {
        walk(child);
    }

    const cleaned = parts
        .join("")
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (!cleaned) return "";
    if (cleaned.length <= MAX_QUOTE_CHARS) return cleaned;
    return `${cleaned.slice(0, MAX_QUOTE_CHARS - 3).trimEnd()}...`;
}

/** Format pending composer quotes as clean Markdown blockquotes ahead of a prompt. */
export function formatQuotesPrefix(quotes: readonly QuotedExcerpt[]): string {
    if (quotes.length === 0) return "";
    return quotes
        .map((q) =>
            q.text
                .split("\n")
                .map((line) => (line.trim() ? `> ${line}` : ">"))
                .join("\n"),
        )
        .join("\n\n");
}

/**
 * Split leading Markdown blockquote groups out of a sent user message so they render
 * as structured quote callouts above the user's question rather than raw `>` markers.
 */
export function splitLeadingQuoteBlock(text: string): { quotes: string[]; rest: string } {
    if (!text.startsWith(">")) return { quotes: [], rest: text };
    const lines = text.split("\n");
    const quotes: string[] = [];
    let current: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i] ?? "";
        if (/^>\s?/.test(line)) {
            current.push(line.replace(/^>\s?/, ""));
            i++;
            continue;
        }
        if (line.trim() === "" && current.length > 0) {
            quotes.push(current.join("\n").trim());
            current = [];
            i++;
            // Continue only if another quote block immediately follows
            if (i < lines.length && /^>\s?/.test(lines[i] ?? "")) {
                continue;
            }
            break;
        }
        break;
    }

    if (current.length > 0) {
        quotes.push(current.join("\n").trim());
    }

    const rest = lines.slice(i).join("\n").trimStart();
    const cleanedQuotes = quotes.filter(Boolean);
    if (cleanedQuotes.length === 0) {
        return { quotes: [], rest: text };
    }
    return { quotes: cleanedQuotes, rest };
}

/** Dispatches a quoted excerpt to the active chat composer. */
export function dispatchChatQuote(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const capped =
        trimmed.length <= MAX_QUOTE_CHARS
            ? trimmed
            : `${trimmed.slice(0, MAX_QUOTE_CHARS - 3).trimEnd()}...`;
    window.dispatchEvent(
        new CustomEvent("bettershape-chat-quote-selection", {
            detail: { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: capped },
        }),
    );
}

/**
 * Floating "Quote" pill anchored to an active single-message selection inside `containerRef`.
 */
export function ChatSelectionQuoteToolbar({
    containerRef,
}: {
    containerRef: React.RefObject<HTMLElement | null>;
}) {
    const [active, setActive] = useState<{
        text: string;
        anchorTop: number;
        anchorBottom: number;
        anchorCenterX: number;
    } | null>(null);
    const pillRef = useRef<HTMLButtonElement | null>(null);

    const clearSelectionState = useCallback(() => {
        setActive(null);
    }, []);

    const evaluateSelection = useCallback(() => {
        const container = containerRef.current;
        const sel = typeof window !== "undefined" ? window.getSelection() : null;
        if (!container || !sel || sel.isCollapsed || sel.rangeCount === 0) {
            clearSelectionState();
            return;
        }
        const anchorEl =
            sel.anchorNode instanceof HTMLElement
                ? sel.anchorNode
                : sel.anchorNode?.parentElement ?? null;
        const focusEl =
            sel.focusNode instanceof HTMLElement
                ? sel.focusNode
                : sel.focusNode?.parentElement ?? null;
        if (!anchorEl || !focusEl) {
            clearSelectionState();
            return;
        }
        if (
            anchorEl.closest("textarea, input, [contenteditable='true']") ||
            focusEl.closest("textarea, input, [contenteditable='true']")
        ) {
            clearSelectionState();
            return;
        }
        const startBody = anchorEl.closest<HTMLElement>("[data-chat-message-body]");
        const endBody = focusEl.closest<HTMLElement>("[data-chat-message-body]");
        if (!startBody || startBody !== endBody || !container.contains(startBody)) {
            clearSelectionState();
            return;
        }
        if (startBody.getAttribute("data-chat-streaming") === "true") {
            clearSelectionState();
            return;
        }
        const range = sel.getRangeAt(0);
        const text = extractCleanSelectionText(range, startBody);
        if (!text || text.length < 2) {
            clearSelectionState();
            return;
        }
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
            clearSelectionState();
            return;
        }
        setActive({
            text,
            anchorTop: rect.top,
            anchorBottom: rect.bottom,
            anchorCenterX: rect.left + rect.width / 2,
        });
    }, [containerRef, clearSelectionState]);

    useEffect(() => {
        let isPointerDown = false;
        let settleTimer: number | null = null;
        let evalRaf = 0;

        const clearSettle = () => {
            if (settleTimer !== null) {
                window.clearTimeout(settleTimer);
                settleTimer = null;
            }
            if (evalRaf) {
                window.cancelAnimationFrame(evalRaf);
                evalRaf = 0;
            }
        };

        const onMouseDown = () => {
            isPointerDown = true;
            clearSettle();
        };
        const onMouseUp = () => {
            isPointerDown = false;
            clearSettle();
            evalRaf = window.requestAnimationFrame(() => {
                evalRaf = 0;
                evaluateSelection();
            });
        };
        const onSelectionChange = () => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed) {
                clearSettle();
                clearSelectionState();
                return;
            }
            if (!isPointerDown) {
                clearSettle();
                settleTimer = window.setTimeout(evaluateSelection, 90);
            }
        };
        const onScroll = () => {
            if (active) clearSelectionState();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === ".") {
                const container = containerRef.current;
                const sel = window.getSelection();
                if (!container || !sel || sel.isCollapsed || sel.rangeCount === 0) return;
                const anchorEl =
                    sel.anchorNode instanceof HTMLElement
                        ? sel.anchorNode
                        : sel.anchorNode?.parentElement ?? null;
                const focusEl =
                    sel.focusNode instanceof HTMLElement
                        ? sel.focusNode
                        : sel.focusNode?.parentElement ?? null;
                const body = anchorEl?.closest<HTMLElement>("[data-chat-message-body]");
                const endBody = focusEl?.closest<HTMLElement>("[data-chat-message-body]");
                if (
                    !body ||
                    body !== endBody ||
                    !container.contains(body) ||
                    body.getAttribute("data-chat-streaming") === "true"
                ) {
                    return;
                }
                const text = extractCleanSelectionText(sel.getRangeAt(0), body);
                if (!text) return;
                e.preventDefault();
                dispatchChatQuote(text);
                sel.removeAllRanges();
                clearSelectionState();
                return;
            }
            if (e.key === "Escape" && active) {
                clearSelectionState();
            }
        };

        document.addEventListener("mousedown", onMouseDown);
        document.addEventListener("mouseup", onMouseUp);
        document.addEventListener("keyup", onMouseUp);
        document.addEventListener("selectionchange", onSelectionChange);
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            clearSettle();
            document.removeEventListener("mousedown", onMouseDown);
            document.removeEventListener("mouseup", onMouseUp);
            document.removeEventListener("keyup", onMouseUp);
            document.removeEventListener("selectionchange", onSelectionChange);
            window.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("keydown", onKeyDown, true);
        };
    }, [active, containerRef, evaluateSelection, clearSelectionState]);

    useLayoutEffect(() => {
        const el = pillRef.current;
        if (!active || !el) return;
        const vw = window.innerWidth || 1024;
        const vh = window.innerHeight || 768;
        const w = el.offsetWidth || 96;
        const h = el.offsetHeight || 28;
        const left = Math.max(8, Math.min(Math.round(active.anchorCenterX - w / 2), vw - w - 8));
        const aboveTop = Math.round(active.anchorTop - h - 8);
        const belowTop = Math.round(active.anchorBottom + 8);
        const top =
            aboveTop >= 8
                ? aboveTop
                : belowTop + h <= vh - 8
                  ? belowTop
                  : Math.max(8, Math.min(aboveTop, vh - h - 8));
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.visibility = "visible";
    }, [active]);

    if (!active || typeof document === "undefined") return null;

    return createPortal(
        <button
            ref={pillRef}
            type="button"
            data-quote-skip
            aria-label="Quote selection in reply"
            onMouseDown={(e) => {
                // Prevent collapsing the selection before onClick commits it
                e.preventDefault();
                e.stopPropagation();
            }}
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dispatchChatQuote(active.text);
                window.getSelection()?.removeAllRanges();
                clearSelectionState();
            }}
            style={{ left: -9999, top: -9999, visibility: "hidden" }}
            className={cn(
                "fixed z-dropdown inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-secondary bg-surface-3 px-2.5 text-xs font-medium text-text-primary shadow-md select-none",
                "transition-[background-color,border-color,transform,opacity] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:transform-none motion-reduce:transition-none",
                "hover:bg-[var(--btn-hover)] active:scale-[0.96]",
            )}
        >
            <Icon icon={TextQuote16Regular} className="size-3.5 text-text-muted" />
            <span>Quote</span>
        </button>,
        document.body,
    );
}
