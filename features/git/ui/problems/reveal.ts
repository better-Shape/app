import { commands } from "@/lib/backend";
import { notify } from "@/features/notifications";

/**
 * The editor attaches its jump listener in a mount effect, and the workspace
 * only mounts a CodeMirror view for the tab that is active — which happens
 * after `set_active_file` has round-tripped through Rust and React has
 * re-rendered. A jump dispatched straight from the click handler is therefore
 * always dropped, so it is replayed on a short ladder instead.
 *
 * Replays are safe: each one sets the cursor to the same position, and the
 * editor drops any jump whose path is not the file it is currently showing.
 */
const JUMP_REPLAY_DELAYS_MS = [0, 150, 450];

let pendingReplay: ReturnType<typeof setTimeout>[] = [];

function jumpToDiagnostic(path: string, line: number, column: number): void {
    window.dispatchEvent(
        new CustomEvent("bettershape-editor-jump", { detail: { path, line, column } }),
    );
}

export function openDiagnostic(path: string, line: number, column: number): void {
    for (const timer of pendingReplay) clearTimeout(timer);
    pendingReplay = [];

    void commands.setActiveFile(path).catch(() => {
        notify.error("Couldn't open the file", path);
    });

    for (const delay of JUMP_REPLAY_DELAYS_MS) {
        pendingReplay.push(setTimeout(() => jumpToDiagnostic(path, line, column), delay));
    }
}