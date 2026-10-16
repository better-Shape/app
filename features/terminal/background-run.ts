/**
 * Module-level background Run — survives React remounts and works with the
 * Terminal panel closed. Design Mode and the play button both use this.
 * Rust owns spawn (`pty_spawn_run`), URL scrape, and TCP probe.
 */

import { EarlyPtyOutput } from "./early-pty-output";
import { getProjectPath } from "@/lib/backend";
import { isWindows } from "@/lib/platform";
import {
    clearDevRun,
    matchDevUrl,
    noteDevRunExit,
    noteDevRunOutput,
    setDevRunPtyId,
    startDevRun,
    getDevRunSnapshot,
} from "@/features/preview/run-status";
import {
    registerBoundTerminalTab,
    terminalSessionStore,
} from "@/features/terminal/session";
import { resolveDefaultTerminalShell } from "@/lib/settings";

type ReadyListener = (url: string) => void;

/** How much of a live run's buffered output is scanned for a URL it printed but did not record. */
const OUTPUT_SCAN_CHARS = 8000;

type Runtime = {
    ptyId: number;
    command: string;
    cwd: string;
    dispose: () => void;
};

let runtime: Runtime | null = null;
let runGeneration = 0;
let starting: { command: string; cwd: string; generation: number; promise: Promise<number> } | null = null;
const readyListeners = new Set<ReadyListener>();
let lastReadyUrl: string | null = null;
type PreviewReady = { id: number; url: string; source?: "output" | "probe"; revision?: number | null };
let announcedReady: PreviewReady | null = null;

/** Delayed native events must not replace a newer retained snapshot or output event. */
const isOlderReadiness = (incoming: PreviewReady, current: PreviewReady | undefined | null): boolean =>
    current?.source === "output" && incoming.source === "output"
    && typeof current.revision === "number" && typeof incoming.revision === "number"
    && incoming.revision <= current.revision;

/** Only a live run's own output can grant design editing; a port probe cannot. */
export function getBackgroundPreviewService(): { ptyId: number; projectPath: string; url: string } | null {
    if (!runtime || announcedReady?.id !== runtime.ptyId) return null;
    return { ptyId: runtime.ptyId, projectPath: runtime.cwd, url: announcedReady.url };
}

function rememberReady(event: PreviewReady) {
    if (event.source !== "output" && announcedReady?.id === event.id) return;
    if (isOlderReadiness(event, announcedReady)) return;
    if (event.source === "output") announcedReady = event;
    emitReady(event.url);
}

function preferIpv4DevCommand(command: string): string {
    const t = command.trim();
    // Rust `pty_spawn_run` applies `-- --hostname 127.0.0.1`. Do not append
    // `-- -H` here — Windows cmd joining collapsed it into the broken `---H`.
    if (/--hostname\b| -H\s| -H$|---H/i.test(t)) return t.replace(/---H/gi, "-- --hostname");
    return t;
}

/** Strip Windows `\\?\` prefixes so cmd.exe and path compares see a normal drive path. */
export function spawnCwd(path: string): string {
    // Resolved filesystem paths may contain significant surrounding whitespace.
    let value = path;
    if (value.startsWith("\\\\?\\UNC\\")) value = `\\\\${value.slice(8)}`;
    else if (value.startsWith("\\\\?\\")) value = value.slice(4);
    else if (value.startsWith("//?/UNC/")) value = `//${value.slice(8)}`;
    else if (value.startsWith("//?/")) value = value.slice(4);
    return value;
}

/** Compare native project identities without treating POSIX double-slash roots as UNC. */
export function sameProjectPath(a: string, b: string): boolean {
    if (!a || !b) return false;
    // Drive and backslash UNC syntax is unambiguous; slash-only UNC needs Windows.
    const windows = isWindows() || (/^(?:[a-z]:|\\\\)/i.test(a) && /^(?:[a-z]:|\\\\)/i.test(b));
    const norm = (value: string) => {
        const path = windows ? spawnCwd(value).replace(/\\/g, "/") : value;
        const rootLength = path.startsWith("//") && !path.startsWith("///") ? 2 : 1;
        const minimum = windows && /^[a-z]:\//i.test(path) ? 3 : rootLength;
        let end = path.length;
        while (end > minimum && path[end - 1] === "/") end -= 1;
        return path.slice(0, end);
    };
    return windows ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

/** Compare run commands ignoring hostname flags Rust may add. */
export function sameDevCommand(a: string, b: string): boolean {
    const strip = (s: string) =>
        s
            .replace(/\s+--\s+--hostname\s+\S+/gi, "")
            .replace(/\s+--hostname\s+\S+/gi, "")
            .replace(/\s+/g, " ")
            .trim();
    return strip(a) === strip(b);
}

export function getBackgroundRunPtyId(): number | null {
    return runtime?.ptyId ?? getDevRunSnapshot().ptyId;
}

export function getBackgroundRunCommand(): string | null {
    return runtime?.command ?? getDevRunSnapshot().command;
}

export function getBackgroundRunCwd(): string | null {
    return runtime?.cwd ?? null;
}

export function getLastPreviewReadyUrl(): string | null {
    return lastReadyUrl;
}

export function subscribePreviewReady(cb: ReadyListener): () => void {
    readyListeners.add(cb);
    if (lastReadyUrl) {
        try {
            cb(lastReadyUrl);
        } catch {
            /* ignore */
        }
    }
    return () => {
        readyListeners.delete(cb);
    };
}

function emitReady(url: string) {
    lastReadyUrl = url;
    for (const l of readyListeners) {
        try {
            l(url);
        } catch {
            /* ignore */
        }
    }
}

/** Register the entire event owner before spawning; activate only the returned PTY. */
async function attachListeners() {
    const { listen } = await import("@tauri-apps/api/event");
    const cleanup: Array<() => void> = [];
    let active = true;
    let ptyId: number | null = null;
    let selectedId: number | null = null;
    let exited = false;
    const earlyReady = new Map<number, PreviewReady>();
    const earlyExit = new Map<number, number | null>();
    const earlyOutput = new EarlyPtyOutput();
    const unrelated = (id: number) => selectedId !== null && id !== selectedId;
    const dispose = () => {
        active = false;
        earlyOutput.clear();
        for (const unlisten of cleanup.splice(0)) {
            try { void Promise.resolve(unlisten()).catch(() => undefined); } catch { /* Finish releasing the remaining listeners. */ }
        }
    };
    const exit = (code: number | null) => {
        exited = true;
        lastReadyUrl = null;
        announcedReady = null;
        if (runtime?.ptyId === ptyId) runtime = null;
        dispose();
        noteDevRunExit(code);
    };
    try {
        cleanup.push(await listen<{ id: number; data: string }>("pty-output", ({ payload }) => {
            if (!active || exited || unrelated(payload.id)) return;
            if (ptyId === null) { earlyOutput.append(payload.id, payload.data); return; }
            if (payload.id !== ptyId) return;
            terminalSessionStore.appendPtyOutput(payload.id, payload.data);
            noteDevRunOutput(payload.data);
        }));
        cleanup.push(await listen<{ id: number; exit_code?: number | null }>("pty-exit", ({ payload }) => {
            if (!active || unrelated(payload.id)) return;
            if (ptyId === null) {
                if (earlyExit.size < 128 || earlyExit.has(payload.id)) earlyExit.set(payload.id, payload.exit_code ?? null);
            } else if (payload.id === ptyId) exit(payload.exit_code ?? null);
        }));
        cleanup.push(await listen<PreviewReady>("preview-ready", ({ payload }) => {
            if (!active || exited || unrelated(payload.id)) return;
            if (ptyId === null) {
                if (earlyReady.get(payload.id)?.source === "output" && payload.source !== "output") return;
                if (isOlderReadiness(payload, earlyReady.get(payload.id))) return;
                if (earlyReady.size < 32 || earlyReady.has(payload.id)) earlyReady.set(payload.id, payload);
            } else if (payload.id === ptyId) rememberReady(payload);
        }));
    } catch (error) { dispose(); throw error; }
    return {
        dispose,
        async reconcile(id: number): Promise<void> {
            selectedId = id;
            const hadExit = earlyExit.has(id);
            const code = earlyExit.get(id) ?? null;
            const ready = earlyReady.get(id);
            earlyExit.clear(); earlyReady.clear();
            if (hadExit) earlyExit.set(id, code);
            if (ready) earlyReady.set(id, ready);
            if (hadExit) return;
            // Events are bounded hints. Native state restores a dropped readiness
            // event and reattaches an existing PTY that will not announce again.
            const { invoke } = await import("@tauri-apps/api/core");
            const readyBeforeRead = earlyReady.get(id);
            const snapshot = await invoke<{ sessionId: number; running: boolean; exitCode?: number | null; previewUrl?: string | null; previewRevision?: number } | null>(
                "pty_read_output", { id, tailChars: 500 },
            );
            if (!snapshot || snapshot.sessionId !== id || typeof snapshot.running !== "boolean") {
                throw new Error("Preview process status is unavailable");
            }
            if (!snapshot.running && !earlyExit.has(id)) earlyExit.set(id, snapshot.exitCode ?? null);
            if (snapshot.running && typeof snapshot.previewUrl === "string" && snapshot.previewUrl) {
                const retained: PreviewReady = { id, url: snapshot.previewUrl, source: "output", revision: snapshot.previewRevision };
                const received = earlyReady.get(id);
                const ordered = typeof retained.revision === "number" && typeof received?.revision === "number";
                if (!isOlderReadiness(retained, received) && (ordered || received?.source !== "output" || received === readyBeforeRead)) {
                    earlyReady.set(id, retained);
                }
            }
            if (snapshot.running && !earlyExit.has(id) && earlyReady.get(id)?.source !== "output" && !(typeof snapshot.previewUrl === "string" && snapshot.previewUrl)) {
                // A live run without an output-sourced readiness record: the URL it printed is
                // still in the buffered output, and that output is the run's own, so it grants
                // exactly what a preview-ready event with source "output" would. A *probe*
                // record must not skip this: a port probe announces a URL but cannot grant
                // design editing (`getBackgroundPreviewService`), so treating it as a readiness
                // record would leave a run whose URL was only ever printed without one. Read a
                // wider tail than the status probe — a chatty startup can push the URL out of
                // the last 500 chars — and treat an unreadable probe as no URL rather than as a
                // failure.
                const printed = await invoke<{ sessionId: number; running: boolean; output?: string | null } | null>(
                    "pty_read_output", { id, tailChars: OUTPUT_SCAN_CHARS },
                ).catch(() => null);
                const url = printed && printed.sessionId === id && printed.running ? matchDevUrl(printed.output ?? "") : null;
                // A readiness event can arrive while the wider scan runs. It carries the run's own
                // current revision, so it outranks a URL parsed from output buffered before it; the
                // scan only fills the gap it was asked to fill.
                if (url) {
                    // A readiness event can arrive while the wider scan runs. It carries the run's
                    // own current revision, so the scan only fills a gap it still owns - the same
                    // ordering rule the status snapshot above applies to its own record.
                    const retained: PreviewReady = { id, url, source: "output", revision: snapshot.previewRevision };
                    const later = earlyReady.get(id);
                    const ordered = typeof retained.revision === "number" && typeof later?.revision === "number";
                    if (!isOlderReadiness(retained, later) && (ordered || later?.source !== "output" || later === readyBeforeRead)) {
                        earlyReady.set(id, retained);
                    }
                }
            }
        },
        activate(id: number): boolean {
            if (!active || exited) return false;
            ptyId = id;
            for (const chunk of earlyOutput.take(id)) {
                terminalSessionStore.appendPtyOutput(id, chunk);
                noteDevRunOutput(chunk);
            }
            if (earlyExit.has(id)) { exit(earlyExit.get(id) ?? null); return false; }
            const ready = earlyReady.get(id);
            earlyReady.clear(); earlyExit.clear();
            if (ready) rememberReady(ready);
            return active && !exited;
        },
    };
}

/**
 * Ensure a background run is alive for `command`. Idempotent for the same
 * command — Strict Mode remounts will not kill/respawn.
 */
export async function ensureBackgroundRun(command: string, cwdOverride?: string): Promise<number> {
    const trimmed = preferIpv4DevCommand(command);
    if (!trimmed) throw new Error("Empty run command");

    const cwd = spawnCwd(cwdOverride || getProjectPath() || "");
    if (!cwd) throw new Error("No project open");

    if (runtime && sameDevCommand(runtime.command, trimmed) && sameProjectPath(runtime.cwd, cwd)) {
        return runtime.ptyId;
    }
    if (starting) {
        const pending = starting;
        if (pending.generation === runGeneration && sameDevCommand(pending.command, trimmed) && sameProjectPath(pending.cwd, cwd)) {
            return pending.promise;
        }
        try {
            await pending.promise;
        } catch {
            // The new project still gets its own start attempt below.
        }
        return ensureBackgroundRun(trimmed, cwd);
    }

    const generation = ++runGeneration;
    const promise = (async () => {
        if (runtime && !(await stopCurrentRun())) {
            // The previous server could not be killed. Spawning a replacement now would leave
            // that process running with nothing owning it, still holding its port, so stop here
            // and let the caller report the failure.
            throw new Error("Could not stop the running preview process");
        }
        if (generation !== runGeneration) throw new Error("Preview start cancelled");
        startDevRun(trimmed);
        lastReadyUrl = null;
        announcedReady = null;
        let owner: Awaited<ReturnType<typeof attachListeners>> | undefined;
        let ptyId: number | undefined;
        let invoke: typeof import("@tauri-apps/api/core").invoke | undefined;
        try {
            ({ invoke } = await import("@tauri-apps/api/core"));
            owner = await attachListeners();
            if (generation !== runGeneration) throw new Error("Preview start cancelled");
            ptyId = await invoke<number>("pty_spawn_run", { cwd, command: trimmed });
            if (generation !== runGeneration) throw new Error("Preview start cancelled");
            await owner.reconcile(ptyId);
            if (generation !== runGeneration) throw new Error("Preview start cancelled");
            setDevRunPtyId(ptyId);
            if (!owner.activate(ptyId)) throw new Error("Preview process exited during startup");
            if (generation !== runGeneration) throw new Error("Preview start cancelled");
            runtime = { ptyId, command: trimmed, cwd, dispose: owner.dispose };
            registerBoundTerminalTab({
                title: `Run: ${trimmed.split(/\s+/).slice(0, 3).join(" ")}`,
                cwd,
                shell: resolveDefaultTerminalShell(),
                boundPtyId: ptyId,
            });
            if (lastReadyUrl) emitReady(lastReadyUrl);
            return ptyId;
        } catch (error) {
            let killFailure: unknown;
            if (ptyId !== undefined && invoke) {
                killFailure = await invoke("pty_kill", { id: ptyId }).catch((reason: unknown) => reason);
            }
            if (killFailure === undefined) {
                owner?.dispose();
                if (generation === runGeneration) {
                    runtime = null;
                    lastReadyUrl = null;
                    announcedReady = null;
                    if (getDevRunSnapshot().status !== "error") clearDevRun();
                }
            } else if (runtime === null && ptyId !== undefined && owner) {
                // The kill was not confirmed, so this failed start may have left a live process.
                // Keep owning it - listeners plus runtime - for the same reason `stopCurrentRun`
                // does: Stop can then retry it, and a later start reports the running run instead
                // of spawning a second server on top of an unowned one.
                runtime = { ptyId, command: trimmed, cwd, dispose: owner.dispose };
                setDevRunPtyId(ptyId);
            }
            throw error;
        }
    })();
    const request = { command: trimmed, cwd, generation, promise };
    starting = request;

    try {
        return await promise;
    } finally {
        if (starting === request) starting = null;
    }
}

/** Stop the current run. Rejects when the process is confirmed to still be alive. */
export async function stopBackgroundRun() {
    runGeneration += 1;
    if (!(await stopCurrentRun())) {
        throw new Error("Could not stop the running preview process");
    }
}

/**
 * Ask native to kill the current run, and report whether it is gone.
 *
 * A kill failure keeps the runtime and its listeners: the process is still alive, so it
 * stays observable and a later Stop can retry. Clearing the state first would leave the
 * process running with nothing owning it, and the next start would spawn a second server
 * on top of it.
 */
async function stopCurrentRun(): Promise<boolean> {
    const current = runtime;
    if (!current) {
        lastReadyUrl = null;
        announcedReady = null;
        clearDevRun();
        return true;
    }
    let killed = true;
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("pty_kill", { id: current.ptyId });
    } catch {
        killed = false;
    }
    if (!killed) return false;
    if (runtime === current) {
        runtime = null;
        lastReadyUrl = null;
        announcedReady = null;
        clearDevRun();
    }
    current.dispose();
    terminalSessionStore.clearPtyScrollback(current.ptyId);
    return true;
}
