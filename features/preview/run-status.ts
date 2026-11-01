"use client";

import { useSyncExternalStore } from "react";

export type DevRunStatus = "idle" | "starting" | "running" | "error";

type State = {
    status: DevRunStatus;
    command: string | null;
    ptyId: number | null;
    /**
     * Whether the process is still running. A compile error keeps the server
     * alive, so the status can read `error` while there is still something to
     * stop; the exit handlers are what clear this.
     */
    alive: boolean;
};

let state: State = { status: "idle", command: null, ptyId: null, alive: false };
const listeners = new Set<() => void>();
let startingTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * True between `startDevRun` and the moment the run's own PTY id is known.
 *
 * An exit that arrives in that window cannot be attributed to a terminal: the
 * spawn path reports its own early exit, so the event is ignored rather than
 * clearing a run over some other tab closing.
 */
let awaitingPtyBinding = false;

function emit() {
    for (const l of listeners) l();
}

function clearStartingTimer() {
    if (startingTimer) {
        clearTimeout(startingTimer);
        startingTimer = null;
    }
}

const READY_RE =
    /\b(ready|started|listening|compiled successfully|local:|network:|✓ ready|ready in|Local:\s+http|➜\s+Local|VITE\s+v|webpack compiled|Next\.js|serving at)\b/i;
const URL_RE = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+/i;
const ERR_RE =
    /\b(error|EADDRINUSE|ECONNREFUSED|failed to compile|ELIFECYCLE|panic|fatal|crash|exited with code [1-9])/i;

export function startDevRun(command: string, ptyId?: number | null) {
    clearStartingTimer();
    // A previous run's id must not be inherited: the next one has its own, and
    // comparing against the old one would reject the exit that matters.
    awaitingPtyBinding = ptyId == null;
    state = { status: "starting", command, ptyId: ptyId ?? null, alive: true };
    emit();
    startingTimer = setTimeout(() => {
        if (state.status === "starting") {
            state = { ...state, status: "running" };
            emit();
        }
    }, 14_000);
}

export function setDevRunPtyId(ptyId: number | null) {
    if (ptyId != null) awaitingPtyBinding = false;
    state = { ...state, ptyId };
    emit();
}

/** First local dev URL printed by a run — the same shape Rust scrapes into readiness. */
export function matchDevUrl(text: string): string | null {
    return URL_RE.exec(text)?.[0] ?? null;
}

export function noteDevRunOutput(chunk: string) {
    if (state.status === "idle") return;
    if (ERR_RE.test(chunk) && !READY_RE.test(chunk) && !URL_RE.test(chunk)) {
        clearStartingTimer();
        state = { ...state, status: "error" };
        emit();
        return;
    }
    if (READY_RE.test(chunk) || URL_RE.test(chunk)) {
        clearStartingTimer();
        state = { ...state, status: "running" };
        emit();
    }
}

/**
 * Records the end of the dev run.
 *
 * `ptyId` is the terminal that exited. Any terminal can report an exit, and an
 * unrelated one saying "code 0" would otherwise clear a dev server that is
 * still running, so a mismatch is ignored once the dev run's own PTY is known.
 */
export function noteDevRunExit(code: number | null, ptyId?: number | null) {
    clearStartingTimer();
    if (state.status === "idle") return;
    if (awaitingPtyBinding) return;
    if (ptyId != null && state.ptyId != null && ptyId !== state.ptyId) return;
    if (code === 0) {
        awaitingPtyBinding = false;
        state = { status: "idle", command: null, ptyId: null, alive: false };
    } else {
        state = { ...state, status: "error", ptyId: null, alive: false };
    }
    emit();
}

export function clearDevRun() {
    clearStartingTimer();
    awaitingPtyBinding = false;
    state = { status: "idle", command: null, ptyId: null, alive: false };
    emit();
}

export function getDevRunSnapshot(): State {
    return state;
}

function subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function getSnapshot() {
    return state;
}

export function useDevRunStatus() {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
