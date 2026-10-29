"use client";

import { listen } from "@tauri-apps/api/event";
import { notify } from "@/features/notifications";

type AgentTerminalEvent = {
    commandId?: string;
    sessionId?: number;
    kind?: string;
    exitCode?: number;
    cancelled?: boolean;
};

const backgroundIds = new Set<string>();
const MAX_TRACKED_COMMAND_STARTS = 128;
const commandStartedAtById = new Map<string, number>();

/** Evicts the oldest tracked command timestamp when `commandStartedAtById` reaches capacity. */
const trimCommandStartMap = (): void => {
    if (commandStartedAtById.size < MAX_TRACKED_COMMAND_STARTS) return;
    const oldestKey = commandStartedAtById.keys().next().value;
    if (oldestKey !== undefined) commandStartedAtById.delete(oldestKey);
};

/** Overwrites the wall-clock start timestamp for `commandId` when a fresh run begins. */
export const setAgentCommandStart = (
    commandId: string,
    startedAtMs: number,
): number => {
    if (!commandStartedAtById.has(commandId)) trimCommandStartMap();
    commandStartedAtById.set(commandId, startedAtMs);
    return startedAtMs;
};

/** Returns the existing start timestamp for `commandId`, or records `Date.now()` if absent. */
export const ensureAgentCommandStart = (commandId: string): number => {
    const existing = commandStartedAtById.get(commandId);
    if (existing !== undefined) return existing;
    return setAgentCommandStart(commandId, Date.now());
};

/** Reads the recorded start timestamp for `commandId`, or `null` when unknown. */
export const getAgentCommandStartedAt = (
    commandId: string | undefined,
): number | null => {
    if (!commandId) return null;
    return commandStartedAtById.get(commandId) ?? null;
};

/** Removes any recorded start timestamp for `commandId`. */
export const clearAgentCommandStart = (commandId: string | undefined): void => {
    if (!commandId) return;
    commandStartedAtById.delete(commandId);
};

const TERMINAL_TIME_HANDLERS: Partial<Record<string, (id: string) => void>> = {
    start: (id) => {
        setAgentCommandStart(id, Date.now());
    },
    data: (id) => {
        ensureAgentCommandStart(id);
    },
    waiting_for_input: (id) => {
        ensureAgentCommandStart(id);
    },
    background: (id) => {
        ensureAgentCommandStart(id);
    },
    exit: (id) => {
        clearAgentCommandStart(id);
    },
};

/** Updates command start-timestamp tracking from an `agent-terminal-stream` payload. */
export const syncTerminalEventStartTime = (
    payload: AgentTerminalEvent,
): void => {
    if (!payload.commandId || !payload.kind) return;
    TERMINAL_TIME_HANDLERS[payload.kind]?.(payload.commandId);
};

function keyOf(event: AgentTerminalEvent): string | null {
    if (event.commandId) return `c:${event.commandId}`;
    if (event.sessionId != null) return `s:${event.sessionId}`;
    return null;
}

/** Toast when an agent command that went background later exits. */
export function startAgentBackgroundExitToasts(): () => void {
    let disposed = false;
    const unlisten = listen<AgentTerminalEvent>("agent-terminal-stream", (event) => {
        if (disposed) return;
        const payload = event.payload ?? {};
        syncTerminalEventStartTime(payload);
        const key = keyOf(payload);
        if (!key) return;
        if (payload.kind === "background") {
            backgroundIds.add(key);
            if (payload.sessionId != null) backgroundIds.add(`s:${payload.sessionId}`);
            return;
        }
        if (payload.kind !== "exit") return;
        const tracked =
            backgroundIds.has(key)
            || (payload.sessionId != null && backgroundIds.has(`s:${payload.sessionId}`));
        backgroundIds.delete(key);
        if (payload.sessionId != null) backgroundIds.delete(`s:${payload.sessionId}`);
        if (!tracked || payload.cancelled) return;
        const code = payload.exitCode ?? 0;
        notify.info("Background command finished", `Exit code ${code}`);
    });
    return () => {
        disposed = true;
        void unlisten.then((fn) => fn()).catch(() => undefined);
    };
}
