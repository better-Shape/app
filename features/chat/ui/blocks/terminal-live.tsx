"use client";

import { Checkmark20Regular } from "@fluentui/react-icons/headless/svg/checkmark";
import { ChevronDown20Regular } from "@fluentui/react-icons/headless/svg/chevron-down";
import { ErrorCircle20Regular } from "@fluentui/react-icons/headless/svg/error-circle";
import { Info20Regular } from "@fluentui/react-icons/headless/svg/info";
import { MoreHorizontal20Regular } from "@fluentui/react-icons/headless/svg/more-horizontal";
import { WindowConsole20Regular } from "@fluentui/react-icons/headless/svg/window-console";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { cn, createOccurrenceKeyer } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { commands } from "@/lib/backend/commands";
import {
    useSettings,
    updateSettingSection,
    type AutoRunModeSetting,
} from "@/lib/settings";
import type { Chunk } from "../md/renderer";
import { ActionLine, splitActionLabel } from "./action-line";
import { ApprovalCard } from "./approval";

const OUTPUT_CAP = 16_000;

const LIVE_COMMAND_STATUSES = new Set(["pending", "running", "background"]);

const AUTO_RUN_OPTIONS: Array<{
    value: AutoRunModeSetting;
    label: string;
    description: string;
}> = [
    {
        value: "ask",
        label: "Ask every time",
        description: "Approve each command before it runs.",
    },
    {
        value: "auto",
        label: "Auto-review",
        description: "Run commands Auto-review marks as safe.",
    },
    {
        value: "always",
        label: "Run everything",
        description: "Run all commands without asking.",
    },
];

type StreamPhase = "idle" | "running" | "background" | "finished";

type StreamState = {
    phase: StreamPhase;
    output: string;
    exitCode: number | null;
    sessionId: number | null;
    cancelled: boolean;
    waitingForInput: boolean;
};

type AgentTerminalEvent = {
    commandId?: string;
    sessionId?: number;
    kind?: string;
    data?: string;
    exitCode?: number;
    cancelled?: boolean;
};

/** Advances an index while `predicate` holds on `input.charCodeAt(cursor)`. */
const advanceWhileCharCode = (
    input: string,
    start: number,
    predicate: (code: number) => boolean,
): number => {
    let cursor = start;
    while (cursor < input.length && predicate(input.charCodeAt(cursor))) {
        cursor += 1;
    }
    return cursor;
};

/** Returns true when `code` belongs to an ECMA-48 CSI parameter byte (`0x30`..`0x3F`). */
const isCsiParameterByte = (code: number): boolean =>
    code >= 0x30 && code <= 0x3f;

/** Returns true when `code` belongs to an ECMA-48 CSI intermediate byte (`0x20`..`0x2F`). */
const isCsiIntermediateByte = (code: number): boolean =>
    code >= 0x20 && code <= 0x2f;

/** Returns true when `code` is neither BEL (`0x07`) nor ESC (`0x1B`). */
const isOscPayloadByte = (code: number): boolean =>
    code !== 0x07 && code !== 0x1b;

/** Skips an ANSI CSI sequence (`ESC [` ... `@-~`), falling back to `start` if unterminated. */
const skipCsiSequence = (input: string, start: number): number => {
    const afterParams = advanceWhileCharCode(input, start, isCsiParameterByte);
    const afterIntermediates = advanceWhileCharCode(
        input,
        afterParams,
        isCsiIntermediateByte,
    );
    const finalCode = input.charCodeAt(afterIntermediates);
    return finalCode >= 0x40 && finalCode <= 0x7e
        ? afterIntermediates + 1
        : start;
};

/** Skips an ANSI OSC sequence (`ESC ]` ... `BEL` or `ESC \\`), falling back to `start` if unterminated. */
const skipOscSequence = (input: string, start: number): number => {
    const end = advanceWhileCharCode(input, start, isOscPayloadByte);
    if (input.charCodeAt(end) === 0x07) return end + 1;
    if (input.charCodeAt(end) === 0x1b && input.charCodeAt(end + 1) === 0x5c) {
        return end + 2;
    }
    return start;
};

/** Checks whether a CSI sequence starting at `start` (`after ESC [`) is still open at EOF. */
const isIncompleteCsiAtEnd = (input: string, start: number): boolean => {
    const afterParams = advanceWhileCharCode(input, start, isCsiParameterByte);
    const afterIntermediates = advanceWhileCharCode(
        input,
        afterParams,
        isCsiIntermediateByte,
    );
    return afterIntermediates === input.length;
};

/** Checks whether an OSC sequence starting at `start` (`after ESC ]`) is still open at EOF. */
const isIncompleteOscAtEnd = (input: string, start: number): boolean => {
    if (input.length - start > 256) return false;
    const end = advanceWhileCharCode(input, start, isOscPayloadByte);
    if (end === input.length) return true;
    return end === input.length - 1 && input.charCodeAt(end) === 0x1b;
};

/** Checks whether an ANSI escape starting at `escIndex` is split across the end of `input`. */
const isIncompleteAnsiAtEnd = (input: string, escIndex: number): boolean => {
    if (escIndex === input.length - 1) return true;
    const next = input[escIndex + 1];
    if (next === "[") return isIncompleteCsiAtEnd(input, escIndex + 2);
    if (next === "]") return isIncompleteOscAtEnd(input, escIndex + 2);
    return false;
};

/** Returns true when `ch` is undefined or a line-break character (`\n` / `\r`). */
const isLineBreakOrEmpty = (ch: string | undefined): boolean =>
    !ch || ch === "\n" || ch === "\r";

/** Returns the index immediately after an ANSI escape sequence starting at `escIndex`. */
const advanceAnsiEscape = (input: string, escIndex: number): number => {
    const next = input[escIndex + 1];
    if (isLineBreakOrEmpty(next)) return escIndex + 1;
    if (next === "]") return skipOscSequence(input, escIndex + 2);
    if (next === "[") return skipCsiSequence(input, escIndex + 2);
    return escIndex + 2;
};

/** Strips ANSI CSI/OSC/two-byte escape sequences while preserving `\r` and `\n` control characters. */
const stripAnsiSequences = (input: string): string => {
    const escChar = String.fromCharCode(0x1b);
    if (!input.includes(escChar)) return input;
    let output = "";
    let cursor = 0;
    let escIndex = input.indexOf(escChar, cursor);
    while (escIndex !== -1) {
        output += input.slice(cursor, escIndex);
        cursor = advanceAnsiEscape(input, escIndex);
        escIndex = input.indexOf(escChar, cursor);
    }
    return output + input.slice(cursor);
};

/** Returns true when `code` is ASCII carriage return (`0x0D`). */
const isCarriageReturnCode = (code: number): boolean => code === 0x0d;

/** Resolves the replacement token after a `\r+` run ending at `nextChar`. */
const resolveCarriageRunToken = (nextChar: string | undefined): string => {
    if (!nextChar || nextChar === "\n") return "";
    return "\r";
};

/** Normalizes CRLF sequences and trailing carriage returns so remaining `\r` bytes represent in-place rewinds. */
const normalizeCarriageReturnRuns = (input: string): string => {
    if (!input.includes("\r")) return input;
    let result = "";
    let cursor = 0;
    let crIndex = input.indexOf("\r", cursor);
    while (crIndex !== -1) {
        result += input.slice(cursor, crIndex);
        cursor = advanceWhileCharCode(input, crIndex, isCarriageReturnCode);
        result += resolveCarriageRunToken(input[cursor]);
        crIndex = input.indexOf("\r", cursor);
    }
    return result + input.slice(cursor);
};

/** Rewinds `output` back to the start of its current line (immediately after the last `\n`). */
const rewindCurrentTerminalLine = (output: string): string => {
    const lastNewline = output.lastIndexOf("\n");
    return lastNewline === -1 ? "" : output.slice(0, lastNewline + 1);
};

/** Applies `incoming` text onto `baseOutput`, rewinding the active line on standalone `\r` progress updates. */
const applyTerminalCarriageReturns = (
    baseOutput: string,
    incoming: string,
): string => {
    const normalized = normalizeCarriageReturnRuns(incoming);
    if (!normalized.includes("\r")) return baseOutput + normalized;
    const segments = normalized.split("\r");
    let output = baseOutput + (segments[0] ?? "");
    for (let index = 1; index < segments.length; index += 1) {
        output = rewindCurrentTerminalLine(output) + (segments[index] ?? "");
    }
    return output;
};

/** Strip ANSI CSI/OSC escapes and collapse in-place `\r` progress redraws for readable chat output. */
export const stripAnsi = (input: string): string =>
    applyTerminalCarriageReturns("", stripAnsiSequences(input));

export type TerminalStreamBuffer = {
    output: string;
    carry: string;
};

/** Splits any trailing `\r` run off `text` so split `\r\n` or `\r\x1b[2K` across PTY chunks stays intact. */
const splitTrailingCarriageReturns = (
    text: string,
): { body: string; trailingCr: string } => {
    let end = text.length;
    while (end > 0 && text.charCodeAt(end - 1) === 0x0d) {
        end -= 1;
    }
    return end === text.length
        ? { body: text, trailingCr: "" }
        : { body: text.slice(0, end), trailingCr: "\r" };
};

/** Strips complete ANSI escapes from `combined` while holding split trailing escapes or `\r` in `carry`. */
const consumeStreamingAnsi = (
    combined: string,
    flush: boolean,
): { stripped: string; carry: string } => {
    if (flush) return { stripped: stripAnsiSequences(combined), carry: "" };
    const escChar = String.fromCharCode(0x1b);
    let output = "";
    let ansiCarry = "";
    if (!combined.includes(escChar)) {
        output = combined;
    } else {
        let cursor = 0;
        let escIndex = combined.indexOf(escChar, cursor);
        while (escIndex !== -1) {
            output += combined.slice(cursor, escIndex);
            if (isIncompleteAnsiAtEnd(combined, escIndex)) {
                ansiCarry = combined.slice(escIndex);
                cursor = combined.length;
                break;
            }
            cursor = advanceAnsiEscape(combined, escIndex);
            escIndex = combined.indexOf(escChar, cursor);
        }
        output += combined.slice(cursor);
    }
    const { body, trailingCr } = splitTrailingCarriageReturns(output);
    return { stripped: body, carry: trailingCr + ansiCarry };
};

/** Segments `text` into user-perceived grapheme clusters (or Unicode code points as fallback). */
const splitGraphemeUnits = (text: string): string[] => {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
        const segmenter = new Intl.Segmenter(undefined, {
            granularity: "grapheme",
        });
        return Array.from(segmenter.segment(text), (entry) => entry.segment);
    }
    return Array.from(text);
};

/** Truncates a shell command onto one line without splitting UTF-16 surrogates or emoji graphemes. */
export const commandSummary = (command: string, max = 56): string => {
    const one = command.replace(/\s+/gu, " ").trim();
    if (!one) return "";
    const units = splitGraphemeUnits(one);
    if (units.length <= max) return one;
    return `${units.slice(0, Math.max(1, max - 3)).join("")}...`;
};

/** Strips `command` when it occupies whole leading line(s) of `trimmed`. */
const stripCommandPrefix = (trimmed: string, command: string): string => {
    if (!command || !trimmed.startsWith(command)) return trimmed;
    const rest = trimmed.slice(command.length);
    return /^[ \t]*(?:\n|$)/.test(rest) ? rest.trim() : trimmed;
};

/** Output portion of a persisted terminal chunk (body minus the command lines). */
const stripTerminalChunkOutput = (block: Chunk): string => {
    const trimmed = stripAnsi(block.content ?? "")
        .replace(/\r\n/g, "\n")
        .trim();
    const command = stripAnsi(block.command ?? "")
        .replace(/\r\n/g, "\n")
        .trim();
    return stripCommandPrefix(trimmed, command);
};

/** Subscribes to a Tauri event while safely falling back to a no-op outside the desktop bridge. */
const safeListen = <T,>(
    eventName: string,
    handler: (event: { payload: T }) => void,
): Promise<() => void> =>
    Promise.resolve()
        .then(() => listen<T>(eventName, handler))
        .catch(() => () => undefined);

/** Appends a PTY chunk onto `buffer`, carrying split ANSI escapes and applying `\r` line rewinds. */
export const appendStreamAnsiChunk = (
    buffer: TerminalStreamBuffer,
    chunk: string | undefined,
    flush = false,
): TerminalStreamBuffer => {
    if (!chunk && !(flush && buffer.carry)) return buffer;
    const { stripped, carry } = consumeStreamingAnsi(
        buffer.carry + (chunk ?? ""),
        flush,
    );
    return {
        output: applyTerminalCarriageReturns(buffer.output, stripped).slice(
            -OUTPUT_CAP,
        ),
        carry,
    };
};

/** Promotes `"idle"` stream phase to `"running"` when live output or input wait arrives. */
const activeOrCurrentPhase = (phase: StreamPhase): StreamPhase =>
    phase === "idle" ? "running" : phase;

/** Reduces a `"start"` terminal event into a fresh running `StreamState`. */
const reduceStreamStartEvent = (
    payload: AgentTerminalEvent,
    bufferRef: React.MutableRefObject<TerminalStreamBuffer>,
): StreamState => {
    bufferRef.current = { output: "", carry: "" };
    return {
        phase: "running",
        output: "",
        exitCode: null,
        sessionId: payload.sessionId ?? null,
        cancelled: false,
        waitingForInput: false,
    };
};

/** Reduces a `"data"` terminal event into the updated `StreamState`. */
const reduceStreamDataEvent = (
    prev: StreamState,
    payload: AgentTerminalEvent,
    output: string,
): StreamState => ({
    ...prev,
    phase: activeOrCurrentPhase(prev.phase),
    output,
    sessionId: payload.sessionId ?? prev.sessionId,
    waitingForInput: false,
});

/** Reduces an `"exit"` terminal event into the finished `StreamState`, preserving prior cancellation when omitted. */
const reduceStreamExitEvent = (
    prev: StreamState,
    payload: AgentTerminalEvent,
    output: string,
): StreamState => ({
    ...prev,
    phase: "finished",
    output,
    exitCode: payload.exitCode ?? -1,
    cancelled: payload.cancelled ?? prev.cancelled,
    waitingForInput: false,
});

type TerminalEventKindHandler = (
    payload: AgentTerminalEvent,
    bufferRef: React.MutableRefObject<TerminalStreamBuffer>,
    setState: React.Dispatch<React.SetStateAction<StreamState>>,
) => void;

const TERMINAL_EVENT_HANDLERS: Partial<
    Record<string, TerminalEventKindHandler>
> = {
    start: (payload, bufferRef, setState) => {
        setState(reduceStreamStartEvent(payload, bufferRef));
    },
    data: (payload, bufferRef, setState) => {
        if (!payload.data) return;
        bufferRef.current = appendStreamAnsiChunk(
            bufferRef.current,
            payload.data,
            false,
        );
        const output = bufferRef.current.output;
        setState((prev) => reduceStreamDataEvent(prev, payload, output));
    },
    waiting_for_input: (payload, _bufferRef, setState) => {
        setState((prev) => ({
            ...prev,
            phase: activeOrCurrentPhase(prev.phase),
            sessionId: payload.sessionId ?? prev.sessionId,
            waitingForInput: true,
        }));
    },
    background: (_payload, _bufferRef, setState) => {
        setState((prev) => ({ ...prev, phase: "background" }));
    },
    exit: (payload, bufferRef, setState) => {
        bufferRef.current = appendStreamAnsiChunk(
            bufferRef.current,
            payload.data,
            true,
        );
        const output = bufferRef.current.output;
        setState((prev) => reduceStreamExitEvent(prev, payload, output));
    },
};

/** Applies one correlated `AgentTerminalEvent` onto `bufferRef` and `setState`. */
const dispatchTerminalStreamPayload = (
    payload: AgentTerminalEvent,
    bufferRef: React.MutableRefObject<TerminalStreamBuffer>,
    setState: React.Dispatch<React.SetStateAction<StreamState>>,
): void => {
    const handler = payload.kind
        ? TERMINAL_EVENT_HANDLERS[payload.kind]
        : undefined;
    handler?.(payload, bufferRef, setState);
};

/** Resolves `{ exitCode, cancelled }` for a fallback `pty-exit` event based on numeric `exitCode`. */
const resolvePtyExitOutcome = (
    prev: StreamState,
    exitCode: number | null | undefined,
): { exitCode: number; cancelled: boolean } => {
    if (typeof exitCode === "number") {
        return {
            exitCode: prev.exitCode ?? exitCode,
            cancelled: prev.cancelled,
        };
    }
    return { exitCode: prev.exitCode ?? -1, cancelled: true };
};

/** Reduces a `pty-exit` event for `sid` when it matches the tracked terminal session. */
const applyPtyExitToState = (
    prev: StreamState,
    sid: number,
    exitCode: number | null | undefined,
    sessionIdHint: number | undefined,
): StreamState => {
    const matchesSession = prev.sessionId === sid || sessionIdHint === sid;
    if (!matchesSession || prev.phase === "finished") return prev;
    return {
        ...prev,
        phase: "finished",
        ...resolvePtyExitOutcome(prev, exitCode),
        waitingForInput: false,
    };
};

/**
 * Subscribe to live output for one command. `enabled` avoids piling up
 * listeners for historical (already finished) transcript rows.
 */
export const useAgentTerminalStream = (
    commandId: string | undefined,
    enabled: boolean,
    sessionIdHint?: number,
): StreamState => {
    const [state, setState] = useState<StreamState>({
        phase: "idle",
        output: "",
        exitCode: null,
        sessionId: sessionIdHint ?? null,
        cancelled: false,
        waitingForInput: false,
    });
    const bufferRef = useRef<TerminalStreamBuffer>({ output: "", carry: "" });
    const lastCommandIdRef = useRef<string | undefined>(commandId);
    const sessionIdHintRef = useRef<number | undefined>(sessionIdHint);

    useEffect(() => {
        sessionIdHintRef.current = sessionIdHint;
    }, [sessionIdHint]);

    useEffect(() => {
        if (lastCommandIdRef.current !== commandId) {
            lastCommandIdRef.current = commandId;
            bufferRef.current = { output: "", carry: "" };
        }
        if (!commandId || !enabled) return undefined;
        let disposed = false;
        const unlistenStream = safeListen<AgentTerminalEvent>(
            "agent-terminal-stream",
            (event) => {
                const payload = event.payload;
                if (!disposed && payload?.commandId === commandId) {
                    dispatchTerminalStreamPayload(payload, bufferRef, setState);
                }
            },
        );
        const unlistenPty = safeListen<{
            id?: number;
            exit_code?: number | null;
        }>("pty-exit", (event) => {
            const sid = event.payload?.id;
            const exitCode = event.payload?.exit_code;
            if (!disposed && typeof sid === "number") {
                setState((prev) =>
                    applyPtyExitToState(
                        prev,
                        sid,
                        exitCode,
                        sessionIdHintRef.current,
                    ),
                );
            }
        });
        return () => {
            disposed = true;
            unlistenStream.then((fn) => fn()).catch(() => undefined);
            unlistenPty.then((fn) => fn()).catch(() => undefined);
        };
    }, [commandId, enabled]);

    return state;
};

/** Resolves the highlight class for a terminal log line containing warning or error markers. */
const resolveTerminalLineToneClass = (line: string): string => {
    const isErr = /\[error\]|\berror:/i.test(line);
    if (isErr) return "text-error";
    return /\[warn\]|\bwarn(ing)?:/i.test(line)
        ? "bg-warning/15 text-warning"
        : "";
};

/** Auto-scrolling monospace output box (last lines of a running command). */
export const LiveTerminalOutput = ({
    text,
    maxHeight = 180,
}: {
    text: string;
    maxHeight?: number;
}) => {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const pinnedRef = useRef(true);

    useEffect(() => {
        const el = scrollRef.current;
        if (el && pinnedRef.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [text]);

    const onScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    }, []);

    if (!text.trim()) return null;

    const lines = text.replace(/(?<!\s)\s+$/, "").split("\n");
    const lineKey = createOccurrenceKeyer();

    return (
        <div
            ref={scrollRef}
            onScroll={onScroll}
            style={{ maxHeight }}
            className="my-1 overflow-y-auto custom-scrollbar font-mono text-sm leading-[1.55] text-text-secondary"
        >
            {lines.map((line, lineNo) => (
                <div
                    key={lineKey(line)}
                    className={cn(
                        "flex gap-3 px-1 py-px whitespace-pre-wrap break-words",
                        resolveTerminalLineToneClass(line),
                    )}
                >
                    <span className="shrink-0 select-none tabular-nums text-text-disabled">
                        {String(lineNo + 1).padStart(2, " ")}
                    </span>
                    <span>{line ? line : " "}</span>
                </div>
            ))}
        </div>
    );
};

/** Persists `mode` to settings and notifies the active backend turn policy. */
const selectAutoRunMode = (mode: AutoRunModeSetting): void => {
    updateSettingSection("ai", { autoRunMode: mode });
    commands.updateTurnPolicy({ autoRunMode: mode }).catch(() => undefined);
};

/** Renders the TerminalCommandMenu UI component. */
const TerminalCommandMenu = ({ command }: { command: string }) => {
    const settings = useSettings();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="Command options"
                    className="inline-flex size-[24px] items-center justify-center rounded text-text-muted hover:bg-[var(--btn-hover)] hover:text-text-primary"
                >
                    <Icon icon={MoreHorizontal20Regular} />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-76">
                <div className="px-2 py-1.5 text-sm font-medium text-text-muted">
                    Auto-run
                </div>
                {AUTO_RUN_OPTIONS.map((opt) => {
                    const selected = settings.ai.autoRunMode === opt.value;
                    return (
                        <DropdownMenuItem
                            key={opt.value}
                            onClick={() => selectAutoRunMode(opt.value)}
                            className="flex flex-col items-start py-2"
                        >
                            <span className="flex w-full items-center gap-2 text-sm text-text-primary">
                                <span className="flex-1">{opt.label}</span>
                                {selected ? (
                                    <Icon icon={Checkmark20Regular} />
                                ) : null}
                            </span>
                            <span className="text-text-muted">
                                {opt.description}
                            </span>
                        </DropdownMenuItem>
                    );
                })}
                <DropdownMenuItem
                    onClick={() => {
                        navigator.clipboard
                            .writeText(command)
                            .catch(() => undefined);
                    }}
                >
                    Copy command
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

/** Formats elapsed seconds (`45s` or `1m 05s`) for a live running terminal command. */
const formatElapsedCommandSeconds = (elapsedSec: number): string =>
    elapsedSec < 60
        ? `${elapsedSec}s`
        : `${Math.floor(elapsedSec / 60)}m ${String(elapsedSec % 60).padStart(2, "0")}s`;

/** Checks whether `exitCode` represents a non-zero exit code for a failed command. */
const hasNonZeroFailureExit = (
    failed: boolean | undefined,
    exitCode: number | null | undefined,
): exitCode is number =>
    Boolean(failed) && typeof exitCode === "number" && exitCode !== 0;

/** Renders the trailing timer or non-zero exit badge on `TerminalCommandRow`. */
const renderCommandRowExtra = ({
    isRunning,
    elapsedSec,
    failed,
    exitCode,
}: {
    isRunning?: boolean;
    elapsedSec: number;
    failed?: boolean;
    exitCode?: number | null;
}): React.ReactNode => {
    if (isRunning && elapsedSec >= 3) {
        return (
            <span className="shrink-0 text-2xs tabular-nums text-text-muted/75">
                {formatElapsedCommandSeconds(elapsedSec)}
            </span>
        );
    }
    if (hasNonZeroFailureExit(failed, exitCode)) {
        return (
            <span className="shrink-0 font-mono text-2xs tabular-nums text-error">
                exit {exitCode}
            </span>
        );
    }
    return null;
};

/** Renders the expandable output or `$ command` preview panel inside `TerminalCommandRow`. */
const TerminalExpandedPanel = ({
    command,
    output,
    notice,
}: {
    command: string;
    output: string;
    notice?: string;
}) => {
    const hasTrimmedOutput = Boolean(output.trim());
    const hasTrimmedCommand = Boolean(command.trim());
    return (
        <div className="relative mt-1 mb-1 rounded-xl border border-border-subtle bg-surface-2/40 px-1.5 py-2">
            <div className="absolute right-2 top-2 z-[1]">
                <TerminalCommandMenu command={command} />
            </div>
            {hasTrimmedOutput ? (
                <div className="pr-8">
                    <LiveTerminalOutput text={output} maxHeight={200} />
                </div>
            ) : null}
            {!hasTrimmedOutput && hasTrimmedCommand ? (
                <div className="px-2 py-0.5 pr-8 font-mono text-xs text-text-secondary">
                    <span className="select-none text-text-muted">$ </span>
                    {command}
                </div>
            ) : null}
            {notice ? (
                <div className="pr-8 pt-1 text-xs text-warning">{notice}</div>
            ) : null}
        </div>
    );
};

/** Computes whether `TerminalCommandRow` should auto-open when live output or failure arrives. */
const shouldAutoExpandRow = (
    isRunning: boolean | undefined,
    failed: boolean | undefined,
    hasOutput: boolean,
): boolean => Boolean((isRunning || failed) && hasOutput);

/** Tracks elapsed seconds once per second while `isRunning` is true. */
const useRunningCommandElapsed = (isRunning: boolean | undefined): number => {
    const [elapsedSec, setElapsedSec] = useState(0);
    useEffect(() => {
        if (!isRunning) return undefined;
        const startedAt = Date.now();
        const interval = window.setInterval(() => {
            setElapsedSec(
                Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
            );
        }, 1000);
        return () => window.clearInterval(interval);
    }, [isRunning]);
    return elapsedSec;
};

/** Renders the leading console or error icon for `TerminalCommandRow`. */
const renderCommandRowIcon = (failed: boolean | undefined): React.ReactElement =>
    failed ? (
        <Icon icon={ErrorCircle20Regular} className="size-3.5 text-error" />
    ) : (
        <Icon
            icon={WindowConsole20Regular}
            className="size-3.5 text-text-muted/80"
        />
    );

/** Manages collapsible disclosure state for `TerminalCommandRow`, auto-opening once on live output. */
const useCommandRowDisclosure = (
    initialExpanded: boolean,
    expandWanted: boolean,
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] => {
    const [expanded, setExpanded] = useState(initialExpanded);
    const [seenExpandWanted, setSeenExpandWanted] = useState(expandWanted);
    if (expandWanted !== seenExpandWanted) {
        setSeenExpandWanted(expandWanted);
        if (expandWanted) setExpanded(true);
    }
    return [expanded, setExpanded];
};

/** Computes initial open state and content flags for `TerminalCommandRow`. */
const deriveCommandRowFlags = (
    command: string,
    output: string,
    defaultOpen: boolean,
    failed: boolean | undefined,
    notice: string | undefined,
) => {
    const hasOutput = Boolean(output.trim() || notice);
    return {
        hasOutput,
        canExpand: hasOutput || Boolean(command.trim()),
        initialOpen: defaultOpen || Boolean(failed && output.trim()),
    };
};

/** Formats the combined status + summary lead string for `splitActionLabel`. */
const formatCommandRowLead = (statusLabel: string, summary: string): string =>
    summary ? `${statusLabel} ${summary}` : statusLabel;

/** Renders the `ActionLine` shell for a visible `TerminalCommandRow`. */
const renderTerminalActionLine = ({
    lead,
    failed,
    isRunning,
    elapsedSec,
    exitCode,
    canExpand,
    expanded,
    setExpanded,
    command,
    output,
    notice,
}: {
    lead: string;
    failed?: boolean;
    isRunning?: boolean;
    elapsedSec: number;
    exitCode?: number | null;
    canExpand: boolean;
    expanded: boolean;
    setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
    command: string;
    output: string;
    notice?: string;
}): React.ReactElement => {
    const parts = splitActionLabel(lead);
    return (
        <ActionLine
            action={parts.action}
            detail={parts.detail}
            tone={failed ? "error" : "default"}
            shimmer={Boolean(isRunning)}
            icon={renderCommandRowIcon(failed)}
            extra={renderCommandRowExtra({
                isRunning,
                elapsedSec,
                failed,
                exitCode,
            })}
            open={canExpand ? expanded : undefined}
            onOpenChange={canExpand ? setExpanded : undefined}
        >
            {canExpand ? (
                <TerminalExpandedPanel
                    command={command}
                    output={output}
                    notice={notice}
                />
            ) : null}
        </ActionLine>
    );
};

/** Inline text row matching staged/checked arrow UI, action bright, detail muted; expand shows output only. */
const TerminalCommandRow = ({
    command,
    statusLabel,
    output,
    isRunning,
    failed,
    exitCode,
    defaultOpen = false,
    notice,
}: {
    command: string;
    statusLabel: string;
    output: string;
    isRunning?: boolean;
    failed?: boolean;
    exitCode?: number | null;
    defaultOpen?: boolean;
    notice?: string;
}) => {
    const flags = deriveCommandRowFlags(
        command,
        output,
        defaultOpen,
        failed,
        notice,
    );
    const [expanded, setExpanded] = useCommandRowDisclosure(
        flags.initialOpen,
        shouldAutoExpandRow(isRunning, failed, flags.hasOutput),
    );
    const elapsedSec = useRunningCommandElapsed(isRunning);
    const summary = commandSummary(command);

    if (!summary && !statusLabel) return null;

    return renderTerminalActionLine({
        lead: formatCommandRowLead(statusLabel, summary),
        failed,
        isRunning,
        elapsedSec,
        exitCode,
        canExpand: flags.canExpand,
        expanded,
        setExpanded,
        command,
        output,
        notice,
    });
};

/** Dropdown selector for configuring future terminal auto-run approval policy. */
const AutoRunModePicker = ({ disabled }: { disabled?: boolean }) => {
    const settings = useSettings();
    const activeLabel =
        AUTO_RUN_OPTIONS.find((opt) => opt.value === settings.ai.autoRunMode)
            ?.label ?? "Ask every time";

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={disabled}>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    aria-label="Approval mode for future agent commands"
                >
                    {activeLabel}
                    <Icon icon={ChevronDown20Regular} className="opacity-70" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
                {AUTO_RUN_OPTIONS.map((opt) => {
                    const selected = settings.ai.autoRunMode === opt.value;
                    return (
                        <DropdownMenuItem
                            key={opt.value}
                            onClick={() => selectAutoRunMode(opt.value)}
                            className={cn(
                                "items-start gap-2 py-2",
                                selected && "bg-panel-hover",
                            )}
                        >
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="text-sm text-text-primary">
                                    {opt.label}
                                </span>
                                <span className="text-xs text-text-muted leading-snug">
                                    {opt.description}
                                </span>
                            </span>
                            {selected ? (
                                <Icon
                                    icon={Checkmark20Regular}
                                    className="mt-0.5 shrink-0"
                                />
                            ) : null}
                        </DropdownMenuItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

/**
 * Approval card for a pending terminal command:
 * header ("Run command"), monospace `$ command` body, footer with the
 * auto-run mode selector on the left and Skip / Run on the right.
 */
export const CommandApprovalCard = ({
    command,
    reason,
    isProcessing,
    onRun,
    onSkip,
}: {
    command: string;
    reason?: string;
    isProcessing: boolean;
    onRun: () => void;
    onSkip: () => void;
}) => (
    <ApprovalCard
        icon={
            <Icon
                icon={WindowConsole20Regular}
                className="shrink-0 text-text-muted"
            />
        }
        title={
            <span className="inline-flex min-w-0 items-center gap-1.5">
                <span>Run command</span>
                {reason ? (
                    <Tooltip content={reason} side="top">
                        <Icon
                            icon={Info20Regular}
                            className="shrink-0 text-text-disabled"
                        />
                    </Tooltip>
                ) : null}
            </span>
        }
        isProcessing={isProcessing}
        onSkip={onSkip}
        onAccept={onRun}
        skipLabel="Skip"
        acceptLabel="Run"
        footerLeft={<AutoRunModePicker disabled={isProcessing} />}
    >
        <div className="max-h-[96px] min-h-[48px] overflow-y-auto px-3 pb-2 font-mono text-sm text-text-primary whitespace-pre-wrap break-words custom-scrollbar">
            <span className="select-none text-text-disabled">$ </span>
            {command}
        </div>
    </ApprovalCard>
);

/** Checks whether the persisted transcript chunk has already reached a terminal status. */
const isTranscriptChunkSettled = (
    chunkStatus: string,
    isGenerating: boolean | undefined,
): boolean => !isGenerating && !LIVE_COMMAND_STATUSES.has(chunkStatus);

/** Resolves the status emitted when `stream.phase === "finished"`. */
const resolveFinishedStreamStatus = (stream: StreamState): string => {
    if (stream.cancelled) return "cancelled";
    return (stream.exitCode ?? 0) === 0 ? "completed" : "failed";
};

/** Checks whether `phase` is an active live stream phase (`"running"` or `"background"`). */
const isLiveStreamPhase = (
    phase: StreamPhase,
): phase is "running" | "background" =>
    phase === "running" || phase === "background";

/** Computes the effective status of a terminal command step across stream, local, and persisted state. */
const computeEffectiveCommandStatus = (
    stream: StreamState,
    localStatus: string | null,
    chunkStatus: string,
    isGenerating: boolean | undefined,
): string => {
    if (stream.phase === "finished") return resolveFinishedStreamStatus(stream);
    if (isTranscriptChunkSettled(chunkStatus, isGenerating)) return chunkStatus;
    if (isLiveStreamPhase(stream.phase)) return stream.phase;
    return localStatus ?? chunkStatus;
};

/** Resolves the command text from `block.command` or `block.content`. */
const resolveBlockCommandText = (block: Chunk): string =>
    (block.command ?? block.content ?? "").trim();

/** Resolves the visible output text from live stream output or persisted chunk body. */
const resolveStepOutputText = (streamOutput: string, block: Chunk): string =>
    streamOutput ? streamOutput : stripTerminalChunkOutput(block);

/** Resolves the human-readable row status label for a finished command step. */
const resolveFinishedRowLabel = (
    cancelled: boolean,
    failed: boolean,
): string => {
    if (cancelled) return "Cancelled";
    return failed ? "Failed" : "Ran";
};

/** Checks whether a finished command step failed by status or non-zero exit code. */
const didCommandStepFail = (
    effectiveStatus: string,
    exitCode: number | undefined,
): boolean =>
    effectiveStatus === "failed" ||
    effectiveStatus === "error" ||
    (typeof exitCode === "number" && exitCode !== 0);

/** Subscribes to `agent-command-resolved` while a pending command awaits approval. */
const usePendingCommandResolution = (
    chunkStatus: string,
    commandId: string | undefined,
    setLocalStatus: React.Dispatch<React.SetStateAction<string | null>>,
): void => {
    useEffect(() => {
        if (chunkStatus !== "pending" || !commandId) return undefined;
        let disposed = false;
        const unlistenPromise = safeListen<{ id?: string; approved?: boolean }>(
            "agent-command-resolved",
            (event) => {
                if (!disposed && event.payload?.id === commandId) {
                    setLocalStatus(
                        event.payload.approved ? "running" : "rejected",
                    );
                }
            },
        );
        return () => {
            disposed = true;
            unlistenPromise.then((fn) => fn()).catch(() => undefined);
        };
    }, [chunkStatus, commandId, setLocalStatus]);
};

/** Renders a running or backgrounded `TerminalCommandRow` for `TerminalCommandStep`. */
const renderLiveTerminalRow = (
    command: string,
    effectiveStatus: string,
    output: string,
    waitingForInput: boolean,
): React.ReactElement => (
    <TerminalCommandRow
        command={command}
        statusLabel={
            effectiveStatus === "background"
                ? "Running in background"
                : "Running"
        }
        output={output}
        isRunning
        defaultOpen
        notice={
            waitingForInput
                ? "Waiting for input: the agent can answer with write_to_terminal, or you can stop the turn."
                : undefined
        }
    />
);

/** Renders a finished, rejected, or blocked `TerminalCommandRow` for `TerminalCommandStep`. */
const renderSettledTerminalRow = (
    command: string,
    effectiveStatus: string,
    output: string,
    exitCode: number | undefined,
): React.ReactElement => {
    if (effectiveStatus === "rejected" || effectiveStatus === "blocked") {
        return (
            <TerminalCommandRow
                command={command}
                statusLabel={
                    effectiveStatus === "rejected" ? "Rejected" : "Blocked"
                }
                output=""
            />
        );
    }
    const failed = didCommandStepFail(effectiveStatus, exitCode);
    const cancelled = effectiveStatus === "cancelled";
    return (
        <TerminalCommandRow
            command={command}
            statusLabel={resolveFinishedRowLabel(cancelled, failed)}
            output={output}
            failed={failed && !cancelled}
            exitCode={exitCode}
        />
    );
};

const ACTIVE_STEP_STATUSES = new Set(["running", "background"]);

/** Renders the non-pending row view for `TerminalCommandStep`. */
const renderNonPendingCommandStep = (
    block: Chunk,
    command: string,
    effectiveStatus: string,
    stream: StreamState,
): React.ReactElement => {
    const resolvedOutput = resolveStepOutputText(stream.output, block);
    if (ACTIVE_STEP_STATUSES.has(effectiveStatus)) {
        return renderLiveTerminalRow(
            command,
            effectiveStatus,
            resolvedOutput,
            stream.waitingForInput,
        );
    }
    return renderSettledTerminalRow(
        command,
        effectiveStatus,
        resolvedOutput,
        stream.exitCode ?? block.exitCode,
    );
};

/** Compact terminal row for finished/rejected states + live card while running. */
export const TerminalCommandStep = ({ block }: { block: Chunk }) => {
    const command = resolveBlockCommandText(block);
    const chunkStatus = block.commandStatus ?? "completed";
    const [localStatus, setLocalStatus] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    const couldBeLive = !isTranscriptChunkSettled(
        chunkStatus,
        block.isGenerating,
    );
    const stream = useAgentTerminalStream(
        block.commandId,
        couldBeLive,
        block.sessionId,
    );

    usePendingCommandResolution(chunkStatus, block.commandId, setLocalStatus);

    const effectiveStatus = useMemo(
        () =>
            computeEffectiveCommandStatus(
                stream,
                localStatus,
                chunkStatus,
                block.isGenerating,
            ),
        [stream, localStatus, chunkStatus, block.isGenerating],
    );

    const runDecision = useCallback(
        (action: (id: string) => Promise<unknown>, nextStatus: string) => {
            if (!block.commandId || isProcessing) return;
            setIsProcessing(true);
            action(block.commandId)
                .then(() => setLocalStatus(nextStatus))
                .catch(() => setLocalStatus("error"))
                .finally(() => setIsProcessing(false));
        },
        [block.commandId, isProcessing],
    );

    if (effectiveStatus === "pending") {
        return (
            <CommandApprovalCard
                command={command}
                reason={block.commandReason}
                isProcessing={isProcessing}
                onRun={() =>
                    runDecision(commands.approveTerminalCommand, "running")
                }
                onSkip={() =>
                    runDecision(commands.rejectTerminalCommand, "rejected")
                }
            />
        );
    }

    return renderNonPendingCommandStep(block, command, effectiveStatus, stream);
};
