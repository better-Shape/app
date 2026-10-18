"use client";

import { Chat20Regular } from "@fluentui/react-icons/headless/svg/chat";
import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import { ErrorCircle20Regular } from "@fluentui/react-icons/headless/svg/error-circle";
import { Warning20Regular } from "@fluentui/react-icons/headless/svg/warning";

import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/icon";
import { commands } from "@/lib/backend";
import type { TurnJournal } from "@/lib/backend/types";
import { toTimestampMs } from "@/lib/ui/timestamp";
import { formatTimeAgo } from "@/lib/workspace/repo-history";

/**
 * Surfaces the turn journals the backend already writes to disk.
 *
 * A journal still on disk means the session that wrote it never finished that
 * turn, so this is the only place the app tells the user a turn was lost.
 *
 * Two limits are visible in the copy rather than hidden: a journal stores a
 * conversation id and never the chat's title, and nothing in the frontend can
 * delete one, so a dismissal lasts until the app is closed.
 */

const DISMISSED_KEY = "bettershape:interrupted-turns-dismissed";
const ID_PREVIEW_CHARS = 8;

export type InterruptedTurnsState =
    | { kind: "checking" }
    | { kind: "failed"; message: string }
    | { kind: "open"; journals: TurnJournal[] };

export interface JournalSummary {
    /** "Chat 9f2c1ab4…" — the journal records an id, never the chat's title. */
    heading: string;
    age: string;
    /** Everything else the journal actually holds, or null when it holds nothing else. */
    detail: string | null;
}

/** Stable identity for one journal row: a conversation can hold several turns. */
export function journalKey(journal: TurnJournal): string {
    return `${journal.conversationId}|${journal.turnId}`;
}

export function journalHeading(journal: TurnJournal): string {
    const id = String(journal.conversationId ?? "").trim();
    if (!id) return "Chat (backend sent no id)";
    return id.length > ID_PREVIEW_CHARS ? `Chat ${id.slice(0, ID_PREVIEW_CHARS)}…` : `Chat ${id}`;
}

/**
 * `updated_at` is Unix epoch SECONDS (`SystemTime::as_secs_f64`), so it goes
 * through the same seconds-or-milliseconds normaliser as every other timestamp
 * in the app rather than being multiplied blindly.
 */
export function formatJournalAge(updatedAt: number): string {
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return "unknown time";
    return formatTimeAgo(toTimestampMs(updatedAt));
}

function projectFolder(projectPath: string | null): string | null {
    const parts = String(projectPath ?? "").trim().split(/[\\/]+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
}

function noteOf(note: string | null): string | null {
    const text = String(note ?? "").trim();
    return text || null;
}

export function describeJournal(journal: TurnJournal): JournalSummary {
    const subagentCount = Array.isArray(journal.subagentIds) ? journal.subagentIds.length : 0;
    const detail = [
        projectFolder(journal.projectPath),
        subagentCount > 0 ? `${subagentCount} subagent${subagentCount === 1 ? "" : "s"}` : null,
        noteOf(journal.note),
    ].filter((part): part is string => Boolean(part));
    return {
        heading: journalHeading(journal),
        age: formatJournalAge(journal.updatedAt),
        detail: detail.length ? detail.join(" · ") : null,
    };
}

function errorMessage(error: unknown): string {
    const text =
        typeof error === "string" ? error : error instanceof Error ? error.message : String(error ?? "");
    return text.trim() || "The backend returned no reason.";
}

function readDismissed(): Set<string> {
    if (typeof window === "undefined") return new Set();
    try {
        const parsed: unknown = JSON.parse(window.sessionStorage.getItem(DISMISSED_KEY) ?? "[]");
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
    } catch {
        return new Set();
    }
}

function writeDismissed(keys: ReadonlySet<string>) {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...keys]));
    } catch {
        /* private mode / quota: the row still hides for this render */
    }
}

/** Opens a chat the way the sidebar, the palette and the history list all do. */
export function openConversationById(id: string) {
    window.dispatchEvent(new CustomEvent("bettershape-chat-load", { detail: { id } }));
}

function JournalRow({
    journal,
    onDismiss,
}: {
    journal: TurnJournal;
    onDismiss: (journal: TurnJournal) => void;
}) {
    const summary = describeJournal(journal);
    return (
        <li data-interrupted-turn={journalKey(journal)} className="flex items-center gap-2">
            <span className="shrink-0 text-warning">
                <Icon icon={Warning20Regular} className="icon-sm" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                        {summary.heading}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-text-muted">{summary.age}</span>
                </span>
                {summary.detail ? (
                    <span className="block truncate text-xs text-text-muted">{summary.detail}</span>
                ) : null}
            </span>
            <button
                type="button"
                onClick={() => openConversationById(journal.conversationId)}
                aria-label={`Open ${summary.heading}, last updated ${summary.age}`}
                className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-text-secondary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)] hover:text-text-primary"
            >
                <Icon icon={Chat20Regular} className="icon-sm" />
                Open
            </button>
            <button
                type="button"
                aria-label={`Dismiss ${summary.heading} until you quit the app`}
                onClick={() => onDismiss(journal)}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-primary"
            >
                <Icon icon={Dismiss20Regular} className="icon-sm" />
            </button>
        </li>
    );
}

export function InterruptedTurns() {
    const [state, setState] = useState<InterruptedTurnsState>({ kind: "checking" });
    // Read once, during the first render. Nothing renders from this set until the
    // journals land, so the prerender and the hydration paint both show nothing
    // and the stored keys cannot cause a mismatch.
    const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => readDismissed());
    const [attempt, setAttempt] = useState(0);
    /** One automatic check per mount; a retry clears it so it is never swallowed. */
    const ran = useRef(false);
    /** Highest issued check number, so a slow retry cannot be overwritten by the one before it. */
    const token = useRef(0);

    const check = useCallback(() => {
        const issued = token.current + 1;
        token.current = issued;
        setState({ kind: "checking" });
        void commands
            .getOpenTurnJournals()
            .then((journals) => {
                if (token.current !== issued) return;
                setState({ kind: "open", journals: Array.isArray(journals) ? journals : [] });
            })
            .catch((error: unknown) => {
                if (token.current !== issued) return;
                setState({ kind: "failed", message: errorMessage(error) });
            });
    }, []);

    // Deliberately no cleanup flag. React's StrictMode remount would run that
    // cleanup and strand the in-flight result, leaving the banner permanently
    // empty — the guard would cost the answer without ever protecting anything.
    useEffect(() => {
        if (ran.current) return;
        ran.current = true;
        check();
    }, [attempt, check]);

    const retry = useCallback(() => {
        ran.current = false;
        setAttempt((n) => n + 1);
    }, []);

    const dismiss = useCallback((journal: TurnJournal) => {
        setDismissed((current) => {
            const next = new Set(current);
            next.add(journalKey(journal));
            writeDismissed(next);
            return next;
        });
    }, []);

    if (state.kind === "checking") return null;

    if (state.kind === "failed") {
        return (
            <div
                role="status"
                aria-live="polite"
                data-interrupted-turns="failed"
                className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-3 px-3 py-1.5"
            >
                <span className="shrink-0 text-error">
                    <Icon icon={ErrorCircle20Regular} className="icon-sm" />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-text-primary">
                        Could not check for interrupted turns.
                    </span>
                    <span className="block truncate text-xs text-text-muted">{state.message}</span>
                </span>
                <button
                    type="button"
                    onClick={retry}
                    aria-label="Check again for interrupted turns"
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-text-secondary transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)] hover:text-text-primary"
                >
                    Check again
                </button>
            </div>
        );
    }

    const visible = state.journals.filter((journal) => !dismissed.has(journalKey(journal)));
    if (visible.length === 0) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            data-interrupted-turns=""
            className="flex shrink-0 flex-col gap-1 border-b border-border-subtle bg-surface-3 px-3 py-2"
        >
            <p className="text-xs text-text-primary">
                {visible.length === 1
                    ? "1 turn was left unfinished by the last session."
                    : `${visible.length} turns were left unfinished by the last session.`}
            </p>
            <p className="text-xs text-text-muted">
                Journal records carry the chat id, not its title. Dismissing a row hides it until you quit
                the app; the record stays on disk until that chat is deleted.
            </p>
            <ul className="flex flex-col gap-1" aria-label="Unfinished turns">
                {visible.map((journal) => (
                    <JournalRow key={journalKey(journal)} journal={journal} onDismiss={dismiss} />
                ))}
            </ul>
        </div>
    );
}