import { randomSuffix } from "@/lib/utils";
import { stripShellPromptPrefix } from "@/lib/chat/prompt-history";

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
        : randomSuffix(9);
}

/** Exported for tests; the app uses the `terminalSessionStore` singleton. */
const projectPathKey = (raw: string): string => {
    const isWindows = raw.includes("\\") || /^[A-Za-z]:/.test(raw);
    const forward = raw.replaceAll("\\", "/");
    let end = forward.length;
    while (end > 1 && forward.charCodeAt(end - 1) === 47) end -= 1;
    const trimmed = forward.slice(0, end);
    return isWindows ? trimmed.toLowerCase() : trimmed;
};

const lookupByProjectPath = (
    map: Record<string, string | null>,
    cwd: string,
): string | null => {
    if (cwd in map) return map[cwd] ?? null;
    const target = projectPathKey(cwd);
    for (const [key, value] of Object.entries(map)) {
        if (projectPathKey(key) === target) return value;
    }
    return null;
};

export class TerminalSessionStore {
    tabs: TerminalTab[] = [];
    activeProjectTabs: Record<string, string | null> = {};
    activeSecondaryTabs: Record<string, string | null> = {};
    focusedGroup: Record<string, TerminalGroupId> = {};
    instances = new Map<string, Instance>();
    /** Output captured while no xterm is attached (background Run). */
    ptyScrollback = new Map<number, PtyScrollback>();
    /** Shell snippet queued when `Insert in terminal` triggers before xterm attaches. */
    pendingCommandInsert: string | null = null;
    pendingCommandTargetTabId: string | null = null;
    /**
     * Tabs that produced output while the user was looking at something else.
     * One meaning, no second colour: a dot means "there is output on this tab you
     * have not seen yet", which is true of a running build and of a finished one.
     */
    unreadTabs = new Set<string>();
    /**
     * Whether the surface showing these tabs is on screen, and which project it shows.
     * The store cannot read the panel's props, so the view reports them. A tab counts as
     * seen only while that panel is open on the project that owns it, which is what lets
     * a background run's output raise a dot while the user is elsewhere.
     */
    panel: { visible: boolean; cwd: string | null } = { visible: false, cwd: null };
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
        // A closed tab must not keep a dot alive for an id that can never be shown, and it
        // must not keep its xterm either: the instance holds a scrollback and a set of
        // listeners, and nothing else ever removes it once the tab is gone.
        const live = new Set(this.tabs.map((t) => t.id));
        if (this.unreadTabs.size > 0) {
            for (const id of [...this.unreadTabs]) if (!live.has(id)) this.unreadTabs.delete(id);
        }
        if (this.instances.size > 0) {
            for (const id of [...this.instances.keys()]) if (!live.has(id)) this.instances.delete(id);
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

    setPanel(next: { visible: boolean; cwd: string | null }) {
        if (this.panel.visible === next.visible && this.panel.cwd === next.cwd) return;
        this.panel = next;
        for (const id of this.visibleTabIds()) {
            this.unreadTabs.delete(id);
        }
        this.notify();
    }

    /**
     * Whether any terminal tab belonging to `cwd` carries unseen output.
     * Used by the closed-dock toggle button so background builds and commands
     * surface activity even while the terminal strip itself is hidden.
     */
    hasUnreadForProject(cwd: string | null | undefined): boolean {
        if (!cwd || this.unreadTabs.size === 0) return false;
        const norm = projectPathKey(cwd);
        return this.tabs.some(
            (tab) => this.unreadTabs.has(tab.id) && projectPathKey(tab.cwd) === norm,
        );
    }

    /**
     * The tabs the user is currently looking at: the active tab of each split group of
     * the project on screen, and nothing while the panel is closed. Output on any other
     * tab is output the user has not seen.
     */
    visibleTabIds(): Set<string> {
        const ids = new Set<string>();
        const cwd = this.panel.cwd;
        if (!this.panel.visible || !cwd) return ids;
        const project = lookupByProjectPath(this.activeProjectTabs, cwd);
        const secondary = lookupByProjectPath(this.activeSecondaryTabs, cwd);
        if (project) ids.add(project);
        if (secondary) ids.add(secondary);
        return ids;
    }

    /**
     * Record that a pty produced output. Called on every chunk, so the only work
     * that happens past the first one is a set lookup: the subscription is notified
     * once per tab becoming unread, not once per chunk, which keeps the 60fps
     * budget out of the output path.
     */
    noteOutput(ptyId: number) {
        // A shell tab is created without a bound pty: the pty is made when the tab first
        // attaches, and only the live instance remembers it. Reading `boundPtyId` alone
        // therefore found nothing for every shell tab, so their output could never raise
        // a dot. The instance map is the second place that knows.
        const tab =
            this.tabs.find((t) => t.boundPtyId === ptyId) ??
            this.tabs.find((t) => this.instances.get(t.id)?.ptyId === ptyId);
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
        this.noteOutput(ptyId);
    }

    takePtyScrollback(ptyId: number): string {
        const entry = this.ptyScrollback.get(ptyId);
        if (!entry) return "";
        return entry.chunks.slice(entry.head).join("");
    }

    clearPtyScrollback(ptyId: number) {
        this.ptyScrollback.delete(ptyId);
    }

    peekPendingCommandInsert(tabId?: string): string | null {
        const next = this.pendingCommandInsert;
        if (!next) return null;
        if (
            this.pendingCommandTargetTabId
            && tabId
            && this.pendingCommandTargetTabId !== tabId
            && this.tabs.some((t) => t.id === this.pendingCommandTargetTabId)
        ) {
            return null;
        }
        return next;
    }

    takePendingCommandInsert(tabId?: string): string | null {
        const next = this.peekPendingCommandInsert(tabId);
        if (!next) return null;
        this.pendingCommandInsert = null;
        this.pendingCommandTargetTabId = null;
        return next;
    }

    clearPendingCommandInsertForTab(tabId?: string) {
        if (
            !tabId
            || !this.pendingCommandTargetTabId
            || this.pendingCommandTargetTabId === tabId
        ) {
            this.pendingCommandInsert = null;
            this.pendingCommandTargetTabId = null;
        }
    }
}

/** Singleton, Terminal UI and DevRunHost share this. */
export const terminalSessionStore = new TerminalSessionStore();

/** Selects the interactive shell tab belonging to the active project `cwd`, if any. */
const findTargetProjectShellTab = (cwd: string | null): TerminalTab | undefined => {
    const isProjectShell = (tab: TerminalTab) =>
        tab.shell !== "ai" && (!cwd || tab.cwd === cwd);
    const preferredTabId = cwd ? terminalSessionStore.activeProjectTabs[cwd] : null;
    const preferredTab = preferredTabId
        ? terminalSessionStore.tabs.find((tab) => tab.id === preferredTabId && isProjectShell(tab))
        : undefined;
    if (preferredTab) return preferredTab;
    const instantiatedTab = terminalSessionStore.tabs.find(
        (tab) => isProjectShell(tab) && terminalSessionStore.instances.has(tab.id),
    );
    if (instantiatedTab) return instantiatedTab;
    return cwd ? terminalSessionStore.tabs.find(isProjectShell) : undefined;
};

/** Queues `cleaned` for insertion once the target shell tab attaches its xterm instance. */
const enqueuePendingTerminalCommand = (cleaned: string, nextTargetId: string | null): void => {
    const existing = terminalSessionStore.pendingCommandInsert;
    if (existing && terminalSessionStore.pendingCommandTargetTabId === nextTargetId) {
        terminalSessionStore.pendingCommandInsert = `${existing}\n${cleaned}`;
        return;
    }
    terminalSessionStore.pendingCommandInsert = cleaned;
    terminalSessionStore.pendingCommandTargetTabId = nextTargetId;
};

/**
 * Opens the workspace Terminal dock and safely inserts `rawCommand` into the
 * active interactive shell tab using xterm's bracketed-paste-aware `paste()`
 * (stripping leading `$ ` prompt prefixes and never auto-executing raw newlines).
 */
export const insertCommandIntoWorkspaceTerminal = (rawCommand: string): boolean => {
    const cleaned = stripShellPromptPrefix(rawCommand);
    if (!cleaned) return false;

    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("bettershape-open-workspace-terminal"));
    }

    const targetTab = findTargetProjectShellTab(terminalSessionStore.panel.cwd);
    const hasPendingDrain = Boolean(
        targetTab && terminalSessionStore.peekPendingCommandInsert(targetTab.id),
    );
    const inst = targetTab ? terminalSessionStore.instances.get(targetTab.id) : undefined;
    if (!hasPendingDrain && inst?.term && typeof inst.term.paste === "function") {
        inst.term.paste(cleaned);
        inst.term.focus?.();
        inst.term.scrollToBottom?.();
        return true;
    }

    enqueuePendingTerminalCommand(cleaned, targetTab?.id ?? null);
    return true;
};

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
