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

function createTabId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : randomSuffix(9);
}

class TerminalSessionStore {
    tabs: TerminalTab[] = [];
    activeProjectTabs: Record<string, string | null> = {};
    activeSecondaryTabs: Record<string, string | null> = {};
    focusedGroup: Record<string, TerminalGroupId> = {};
    instances = new Map<string, Instance>();
    /** Output captured while no xterm is attached (background Run). */
    ptyScrollback = new Map<number, string>();
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
        this.notify();
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
        const project = this.activeProjectTabs[cwd];
        const secondary = this.activeSecondaryTabs[cwd];
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

    takePendingCommandInsert(tabId?: string): string | null {
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

/**
 * Opens the workspace Terminal dock and safely inserts `rawCommand` into the
 * active interactive shell tab using xterm's bracketed-paste-aware `paste()`
 * (stripping leading `$ ` prompt prefixes and never auto-executing raw newlines).
 */
export function insertCommandIntoWorkspaceTerminal(rawCommand: string): boolean {
    const cleaned = stripShellPromptPrefix(rawCommand);
    if (!cleaned) return false;

    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("bettershape-open-workspace-terminal"));
    }

    const cwd = terminalSessionStore.panel.cwd;
    const preferredTabId = cwd ? terminalSessionStore.activeProjectTabs[cwd] : null;
    const preferredTab = preferredTabId
        ? terminalSessionStore.tabs.find((t) => t.id === preferredTabId && t.shell !== "ai")
        : undefined;
    const fallbackTab = terminalSessionStore.tabs.find(
        (t) => t.shell !== "ai" && terminalSessionStore.instances.has(t.id),
    );
    const targetTab = preferredTab ?? fallbackTab;
    const inst = targetTab ? terminalSessionStore.instances.get(targetTab.id) : undefined;

    if (inst?.term && typeof inst.term.paste === "function") {
        inst.term.paste(cleaned);
        inst.term.focus?.();
        inst.term.scrollToBottom?.();
        return true;
    }

    const nextTargetId = targetTab?.id ?? null;
    if (
        terminalSessionStore.pendingCommandInsert &&
        terminalSessionStore.pendingCommandTargetTabId === nextTargetId
    ) {
        terminalSessionStore.pendingCommandInsert = `${terminalSessionStore.pendingCommandInsert}\n${cleaned}`;
    } else {
        terminalSessionStore.pendingCommandInsert = cleaned;
        terminalSessionStore.pendingCommandTargetTabId = nextTargetId;
    }
    return true;
}

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
