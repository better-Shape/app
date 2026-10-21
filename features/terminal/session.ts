/**
 * Shared terminal session registration (used by the always-mounted DevRunHost
 * and the Terminal UI). Keeps background Run tabs available when the panel is closed.
 */

type TerminalShell = "powershell" | "pwsh" | "cmd" | "gitbash" | "wsl" | "ai";
type TerminalGroupId = "left" | "right";

export type TerminalTab = {
    id: string;
    title: string;
    shell: TerminalShell;
    cwd: string;
    boundPtyId?: number;
    group: TerminalGroupId;
};

type Instance = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    term: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fitAddon: any;
    ptyId: number;
    unlistenOutput: () => void;
};

const MAX_SCROLLBACK_CHARS = 400_000;

/** Chunked scrollback so trimming never rewrites the whole buffer. */
type PtyScrollback = { chunks: string[]; head: number; total: number };

function createTabId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2, 11);
}

/** Exported for tests; the app uses the `terminalSessionStore` singleton. */
export class TerminalSessionStore {
    tabs: TerminalTab[] = [];
    activeProjectTabs: Record<string, string | null> = {};
    activeSecondaryTabs: Record<string, string | null> = {};
    focusedGroup: Record<string, TerminalGroupId> = {};
    instances = new Map<string, Instance>();
    /** Output captured while no xterm is attached (background Run). */
    ptyScrollback = new Map<number, PtyScrollback>();
    listeners = new Set<() => void>();

    subscribe(l: () => void): () => void {
        this.listeners.add(l);
        return () => this.listeners.delete(l);
    }
    notify() {
        this.listeners.forEach((l) => l());
    }
    setTabs(u: (p: TerminalTab[]) => TerminalTab[]) {
        this.tabs = u(this.tabs).map((t) => ({ ...t, group: t.group ?? "left" }));
        this.notify();
    }
    setActive(cwd: string, id: string | null) {
        this.activeProjectTabs = { ...this.activeProjectTabs, [cwd]: id };
        this.notify();
    }
    setSecondaryActive(cwd: string, id: string | null) {
        this.activeSecondaryTabs = { ...this.activeSecondaryTabs, [cwd]: id };
        this.notify();
    }
    setFocusedGroup(cwd: string, group: TerminalGroupId) {
        this.focusedGroup = { ...this.focusedGroup, [cwd]: group };
        this.notify();
    }

    appendPtyOutput(ptyId: number, data: string) {
        if (!data) return;
        let entry = this.ptyScrollback.get(ptyId);
        if (!entry) {
            entry = { chunks: [], head: 0, total: 0 };
            this.ptyScrollback.set(ptyId, entry);
        }
        entry.chunks.push(data);
        entry.total += data.length;
        // Drop whole chunks from the front: the old code re-sliced the entire
        // 400k-char scrollback on every chunk once it was full.
        while (entry.total > MAX_SCROLLBACK_CHARS && entry.chunks.length - entry.head > 1) {
            entry.total -= entry.chunks[entry.head].length;
            entry.head += 1;
        }
        // One event can exceed the whole budget (a pasted dump, a huge frame).
        // Keep its tail, which is what the old `slice(-MAX)` did.
        if (entry.total > MAX_SCROLLBACK_CHARS) {
            const last = entry.chunks[entry.chunks.length - 1]!.slice(-MAX_SCROLLBACK_CHARS);
            entry.chunks = [last];
            entry.head = 0;
            entry.total = last.length;
        }
        // Compact once the dropped prefix dominates, keeping `head` bookkeeping cheap.
        if (entry.head > 1024 && entry.head * 2 > entry.chunks.length) {
            entry.chunks = entry.chunks.slice(entry.head);
            entry.head = 0;
        }
        // Live-attached xterms write via their own listeners; nothing else to notify.
    }

    takePtyScrollback(ptyId: number): string {
        const entry = this.ptyScrollback.get(ptyId);
        if (!entry) return "";
        return entry.chunks.slice(entry.head).join("");
    }

    clearPtyScrollback(ptyId: number) {
        this.ptyScrollback.delete(ptyId);
    }
}

/** Singleton — Terminal UI and DevRunHost share this. */
export const terminalSessionStore = new TerminalSessionStore();

export function registerBoundTerminalTab(opts: {
    title: string;
    cwd: string;
    shell: TerminalShell;
    boundPtyId: number;
}): string {
    const existing = terminalSessionStore.tabs.find(
        (t) => t.boundPtyId === opts.boundPtyId && t.cwd === opts.cwd,
    );
    if (existing) {
        terminalSessionStore.setActive(opts.cwd, existing.id);
        return existing.id;
    }
    const id = createTabId();
    terminalSessionStore.setTabs((tabs) => [
        ...tabs,
        {
            id,
            title: opts.title,
            shell: opts.shell,
            cwd: opts.cwd,
            boundPtyId: opts.boundPtyId,
            group: "left",
        },
    ]);
    terminalSessionStore.setActive(opts.cwd, id);
    return id;
}

export function findActiveRunTab(cwd: string): TerminalTab | undefined {
    return terminalSessionStore.tabs.find(
        (t) => t.cwd === cwd && typeof t.boundPtyId === "number" && t.title.startsWith("Run:"),
    );
}
