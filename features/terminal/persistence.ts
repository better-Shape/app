/**
 * Terminal scrollback persistence.
 *
 * Terminals live in the webview, so a reload (or an app restart) throws the
 * visible history away. We keep a bounded, plain-text tail of the normal screen
 * buffer per shell+cwd and replay it into the first new terminal for that
 * key in a session.
 *
 * Deliberate limits:
 *  - alternate-screen content is never captured (a full-screen TUI snapshot is
 *    meaningless out of context and can be huge);
 *  - high-confidence credentials are redacted before the text reaches storage,
 *    because provider keys live in the OS keyring and terminal output is not;
 *  - entries expire after `TERMINAL_SNAPSHOT_TTL_MS` and the whole store is
 *    capped, because localStorage is small;
 *  - every storage access is guarded: private mode, disabled storage or a
 *    quota error must never break the terminal.
 */

const STORAGE_KEY = "bettershape-terminal-scrollback-v1";

export const TERMINAL_SNAPSHOT_MAX_CHARS = 120_000;
export const TERMINAL_SNAPSHOT_MAX_ENTRIES = 8;
export const TERMINAL_SNAPSHOT_MAX_TOTAL_CHARS = 480_000;
export const TERMINAL_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type TerminalSnapshotTarget = {
    cwd: string;
    shell: string;
};

export type TerminalSnapshotEntry = {
    target: TerminalSnapshotTarget;
    text: string;
};

type StoredEntry = {
    text: string;
    savedAt: number;
    shell: string;
    cwd: string;
};

type StoredShape = {
    version: 1;
    entries: Record<string, StoredEntry>;
};

/** The subset of xterm's `IBuffer` this module needs. */
export type BufferLike = {
    type?: string;
    length: number;
    getLine(y: number): { translateToString(trimRight?: boolean): string } | undefined;
};

export function terminalSnapshotKey(target: TerminalSnapshotTarget): string {
    const cwd = (target.cwd || "global").trim() || "global";
    const shell = (target.shell || "shell").trim() || "shell";
    return `${shell}\u0000${cwd}`;
}

/**
 * Plain-text tail of a buffer, newest lines kept. Returns "" for an alternate
 * screen buffer or an empty buffer.
 */
export function snapshotBuffer(
    buffer: BufferLike | null | undefined,
    maxChars: number = TERMINAL_SNAPSHOT_MAX_CHARS,
): string {
    if (!buffer || buffer.type === "alternate") return "";
    if (!Number.isFinite(buffer.length) || buffer.length <= 0) return "";

    const read = (i: number) => buffer.getLine(i)?.translateToString(true) ?? "";

    // Skip the blank padding under the cursor first: a fresh prompt at the
    // bottom of a tall screen must not persist a wall of empty rows.
    let last = buffer.length - 1;
    while (last >= 0 && read(last) === "") last--;

    // Collect newest to oldest, then reverse once: `unshift` per line is
    // quadratic on a full scrollback.
    const lines: string[] = [];
    let total = 0;
    for (let i = last; i >= 0; i--) {
        const line = read(i);
        total += line.length + 1;
        lines.push(line);
        if (total >= maxChars) break;
    }
    lines.reverse();

    while (lines.length > 0 && lines[0] === "") lines.shift();

    let text = lines.join("\n");
    if (text.length > maxChars) {
        const cut = text.slice(text.length - maxChars);
        // Never start mid-line: a partial first line looks like corruption.
        const firstBreak = cut.indexOf("\n");
        text = firstBreak === -1 ? cut : cut.slice(firstBreak + 1);
    }
    return text;
}

/* ------------------------------------------------------------------------- *
 * Secret redaction
 *
 * Best effort by design: a terminal prints whatever a command prints, and the
 * app cannot know which of those strings are credentials. These patterns cover
 * the shapes that are unambiguous enough to redact without mangling ordinary
 * output. A miss is possible; the TTL and size caps bound the exposure.
 * ------------------------------------------------------------------------- */

const PRIVATE_KEY_BLOCK =
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const PRIVATE_KEY_HEADER = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;

const SECRET_PATTERNS: RegExp[] = [
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
];

/** `TOKEN=value` / `password: value`, but only when the value looks secret. */
const ASSIGNED_SECRET =
    /\b(api[_-]?key|secret|token|password|passwd|authorization)\b(\s*[:=]\s*)(["']?)([^\s"']{8,})\3/gi;

export const REDACTED = "[redacted]";

function looksSecret(value: string): boolean {
    return /\d/.test(value) && /[A-Za-z]/.test(value);
}

export function redactTerminalSecrets(text: string): string {
    if (!text) return text;

    let out = text.replace(PRIVATE_KEY_BLOCK, REDACTED);
    for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
    out = out.replace(ASSIGNED_SECRET, (match, key: string, separator: string, quote: string, value: string) => {
        if (!looksSecret(value)) return match;
        return `${key}${separator}${quote}${REDACTED}${quote}`;
    });
    // A block whose END marker has not printed yet still leaks the header.
    out = out.replace(PRIVATE_KEY_HEADER, REDACTED);
    return out;
}

function defaultStorage(): Storage | null {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
}

function readStore(storage: Storage | null): StoredShape {
    const empty: StoredShape = { version: 1, entries: {} };
    if (!storage) return empty;
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return empty;
        const parsed = JSON.parse(raw) as Partial<StoredShape> | null;
        if (!parsed || typeof parsed !== "object" || !parsed.entries) return empty;
        const entries: Record<string, StoredEntry> = {};
        for (const [key, value] of Object.entries(parsed.entries)) {
            if (
                !value
                || typeof value.text !== "string"
                || typeof value.savedAt !== "number"
            ) {
                continue;
            }
            entries[key] = value;
        }
        return { version: 1, entries };
    } catch {
        return empty;
    }
}

function writeStore(storage: Storage | null, store: StoredShape): boolean {
    if (!storage) return false;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(store));
        return true;
    } catch {
        // Quota: drop the oldest half and retry once, then give up quietly.
        try {
            const keys = Object.keys(store.entries).sort(
                (a, b) => store.entries[a]!.savedAt - store.entries[b]!.savedAt,
            );
            // Keep at least the newest entry: `floor(1 / 2)` is 0 and used to
            // prune the only snapshot away, turning a quota hit into data loss.
            const keep = Math.max(1, Math.floor(keys.length / 2));
            const pruned: StoredShape = { version: 1, entries: {} };
            for (const key of keys.slice(keys.length - keep)) {
                pruned.entries[key] = store.entries[key]!;
            }
            storage.setItem(STORAGE_KEY, JSON.stringify(pruned));
            return true;
        } catch {
            return false;
        }
    }
}

function pruneStore(store: StoredShape, now: number): StoredShape {
    for (const [key, entry] of Object.entries(store.entries)) {
        if (now - entry.savedAt > TERMINAL_SNAPSHOT_TTL_MS) delete store.entries[key];
    }

    const newestFirst = Object.keys(store.entries).sort(
        (a, b) => store.entries[b]!.savedAt - store.entries[a]!.savedAt,
    );
    const kept: Record<string, StoredEntry> = {};
    let total = 0;
    for (const key of newestFirst) {
        if (Object.keys(kept).length >= TERMINAL_SNAPSHOT_MAX_ENTRIES) break;
        const entry = store.entries[key]!;
        if (total + entry.text.length > TERMINAL_SNAPSHOT_MAX_TOTAL_CHARS && Object.keys(kept).length > 0) {
            continue;
        }
        kept[key] = entry;
        total += entry.text.length;
    }
    return { version: 1, entries: kept };
}

/**
 * Store several terminals in one storage round-trip. The panel persists every
 * dirty tab on the same tick, and each entry used to re-read and re-serialize
 * the whole store.
 */
export function saveTerminalSnapshots(
    entries: readonly TerminalSnapshotEntry[],
    now: number = Date.now(),
    storage: Storage | null = defaultStorage(),
): void {
    if (entries.length === 0) return;

    const store = readStore(storage);
    for (const { target, text } of entries) {
        if (!text) continue;
        const redacted = redactTerminalSecrets(text);
        if (!redacted) continue;
        store.entries[terminalSnapshotKey(target)] = {
            text: redacted.length > TERMINAL_SNAPSHOT_MAX_CHARS
                ? redacted.slice(redacted.length - TERMINAL_SNAPSHOT_MAX_CHARS)
                : redacted,
            savedAt: now,
            shell: target.shell,
            cwd: target.cwd,
        };
    }
    writeStore(storage, pruneStore(store, now));
}

/** Store the tail of one terminal. Empty text clears its entry. */
export function saveTerminalSnapshot(
    target: TerminalSnapshotTarget,
    text: string,
    now: number = Date.now(),
    storage: Storage | null = defaultStorage(),
): void {
    if (!text) {
        clearTerminalSnapshot(target, storage);
        return;
    }
    saveTerminalSnapshots([{ target, text }], now, storage);
}

/** Previously stored history for this shell+cwd, or "" when there is none. */
export function loadTerminalSnapshot(
    target: TerminalSnapshotTarget,
    now: number = Date.now(),
    storage: Storage | null = defaultStorage(),
): string {
    const store = readStore(storage);
    const entry = store.entries[terminalSnapshotKey(target)];
    if (!entry) return "";
    if (now - entry.savedAt > TERMINAL_SNAPSHOT_TTL_MS) return "";
    return entry.text;
}

export function clearTerminalSnapshot(
    target: TerminalSnapshotTarget,
    storage: Storage | null = defaultStorage(),
): void {
    const store = readStore(storage);
    const key = terminalSnapshotKey(target);
    if (!(key in store.entries)) return;
    delete store.entries[key];
    writeStore(storage, store);
}

export function clearAllTerminalSnapshots(storage: Storage | null = defaultStorage()): void {
    if (!storage) return;
    try {
        storage.removeItem(STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

/** Tabs already replayed this session, so switching tabs cannot duplicate history. */
const restoredThisSession = new Set<string>();

export function takeRestoreCandidate(target: TerminalSnapshotTarget): string {
    const key = terminalSnapshotKey(target);
    if (restoredThisSession.has(key)) return "";
    const text = loadTerminalSnapshot(target);
    if (!text) return "";
    restoredThisSession.add(key);
    return text;
}

/** Test/reset hook: forget which keys were replayed. */
export function resetTerminalSnapshotSession(): void {
    restoredThisSession.clear();
}
