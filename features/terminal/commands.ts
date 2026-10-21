/**
 * Terminal commands that also work while the panel is closed.
 *
 * The terminal component only mounts when the panel opens, so a command
 * dispatched at the same moment as `bettershape-layout-toggle` used to be lost.
 * Requests are held here until a terminal registers its listener.
 *
 * The close commands are deliberately not queued: replaying "close" after the
 * panel mounts would open it and shut it again in the same tick.
 */

const PENDING_TTL_MS = 3_000;

export type TerminalCommand =
    | "new"
    | "split"
    | "close_tab"
    | "close_all_tabs"
    | "clear"
    | "find"
    | "open"
    | "close";

type PendingCommand = { action: TerminalCommand; at: number };

let mountedHosts = 0;
let pending: PendingCommand | null = null;

function dispatchCommand(action: TerminalCommand): void {
    window.dispatchEvent(
        new CustomEvent("bettershape-terminal-shortcut", { detail: { action } }),
    );
}

function isCloseCommand(action: TerminalCommand): boolean {
    return action === "close" || action === "close_tab" || action === "close_all_tabs";
}

export function requestTerminalCommand(action: TerminalCommand): void {
    // Announce it every time: the dock uses the event to open the panel, and a
    // mounted terminal handles it directly.
    dispatchCommand(action);

    if (mountedHosts > 0) return;
    if (isCloseCommand(action)) return;

    pending = { action, at: Date.now() };
    window.dispatchEvent(
        new CustomEvent("bettershape-layout-toggle", { detail: { id: "panel", value: true } }),
    );
}

/** Drop a command the panel never picked up, so it cannot replay much later. */
function takePending(now: number): TerminalCommand | null {
    if (!pending) return null;
    const { action, at } = pending;
    pending = null;
    if (now - at > PENDING_TTL_MS) return null;
    return action;
}

/**
 * Called by the terminal after its `bettershape-terminal-shortcut` listener is
 * attached. Returns the matching cleanup.
 */
export function attachTerminalCommandHost(): () => void {
    mountedHosts += 1;
    const action = takePending(Date.now());
    if (action) dispatchCommand(action);

    let detached = false;
    return () => {
        if (detached) return;
        detached = true;
        mountedHosts = Math.max(0, mountedHosts - 1);
    };
}

/** Tests only: forget queued work and hosts. */
export function resetTerminalCommandQueue(): void {
    mountedHosts = 0;
    pending = null;
}
