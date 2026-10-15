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

function createTabId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2, 11);
}

class TerminalSessionStore {
    tabs: TerminalTab[] = [];
    activeProjectTabs: Record<string, string | null> = {};
    activeSecondaryTabs: Record<string, string | null> = {};
    focusedGroup: Record<string, TerminalGroupId> = {};
    instances = new Map<string, Instance>();
    /** Output captured while no xterm is attached (background Run). */
    ptyScrollback = new Map<number, string>();
    /**
     * Tabs that produced output while the user was looking at something else.
     * One meaning, no second colour: a dot means "there is output on this tab you
     * have not seen yet", which is true of a running build and of a finished one.
     */
    unreadTabs = new Set<string>();
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
        // A closed tab must not keep a dot alive for an id that can never be shown.
        if (this.unreadTabs.size > 0) {
            const live = new Set(this.tabs.map((t) => t.id));
            for (const id of [...this.unreadTabs]) if (!live.has(id)) this.unreadTabs.delete(id);
        }
        this.notify();
    }
    setActive(cwd: string, id: string | null) {
        this.activeProjectTabs = { ...this.activeProjectTabs, [cwd]: id };
        if (id) this.clearUnread(id);
        this.notify();
    }
    setSecondaryActive(cwd: string, id: string | null) {
        this.activeSecondaryTabs = { ...this.activeSecondaryTabs, [cwd]: id };
        if (id) this.clearUnread(id);
        this.notify();
    }

    /** The tab the user is currently looking at in either split group. */
    visibleTabIds(): Set<string> {
        const ids = new Set<string>();
        for (const id of Object.values(this.activeProjectTabs)) if (id) ids.add(id);
        for (const id of Object.values(this.activeSecondaryTabs)) if (id) ids.add(id);
        return ids;
    }

    /**
     * Record that a pty produced output. Called on every chunk, so the only work
     * that happens past the first one is a set lookup: the subscription is notified
     * once per tab becoming unread, not once per chunk, which keeps the 60fps
     * budget out of the output path.
     */
    noteOutput(ptyId: number) {
        const tab = this.tabs.find((t) => t.boundPtyId === ptyId);
        if (!tab) return;
        if (this.visibleTabIds().has(tab.id)) return;
        if (this.unreadTabs.has(tab.id)) return;
        this.unreadTabs.add(tab.id);
        this.notify();
    }

    clearUnread(tabId: string) {
        if (!this.unreadTabs.delete(tabId)) return;
        this.notify();
    }
    setFocusedGroup(cwd: string, group: TerminalGroupId) {
        this.focusedGroup = { ...this.focusedGroup, [cwd]: group };
        this.notify();
    }

    appendPtyOutput(ptyId: number, data: string) {
        const prev = this.ptyScrollback.get(ptyId) ?? "";
        let next = prev + data;
        if (next.length > MAX_SCROLLBACK_CHARS) {
            next = next.slice(next.length - MAX_SCROLLBACK_CHARS);
        }
        this.ptyScrollback.set(ptyId, next);
        // Live-attached xterms write via their own listeners; nothing else to notify.
        this.noteOutput(ptyId);
    }

    takePtyScrollback(ptyId: number): string {
        return this.ptyScrollback.get(ptyId) ?? "";
    }

    clearPtyScrollback(ptyId: number) {
        this.ptyScrollback.delete(ptyId);
    }
}

/** Singleton, Terminal UI and DevRunHost share this. */
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
