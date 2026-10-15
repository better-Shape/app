import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "@/lib/window/tauri-window";
import { closeOtherWindows, reportCancelledClose, reportStartedClose } from "@/lib/window/close-others";
import { getCredentialDraftRevision } from "@/lib/ai/credential-drafts";
import { dirtyOpenFiles, flushDirtyBuffers, preventUnpersistedEditorUnload } from "@/lib/workspace/dirty-buffers";
import { requestSaveAll } from "@/lib/workspace/save-all";
import { confirmCredentialClose, preventUnsavedCredentialUnload } from "@/lib/ai/credential-close";
import { notify } from "@/features/notifications";

let currentCloseAttempt: (() => Promise<void>) | undefined;

/** The titlebar uses the same guarded path even if native listener registration failed. */
export async function requestGuardedWindowClose(): Promise<boolean> {
    const attempt = currentCloseAttempt;
    if (!attempt || !isTauriRuntime()) return false;
    await attempt();
    return true;
}

export function installWindowCloseGuard(): () => void {
    window.addEventListener("beforeunload", preventUnsavedCredentialUnload);
    window.addEventListener("beforeunload", preventUnpersistedEditorUnload);
    let closing = false;
    let destroying = false;
    let editorRevision = 0;
    let unknownEditorRevision = 0;
    const editedPaths = new Map<string, number>();
    const pendingDiscard = new Set<string>();
    const onEditorBuffer = (event: Event) => {
        editorRevision++;
        // Editors stage recovery before publishing their change event. Native
        // destroy can still be pending, so do not leave a later edit debounced.
        if (destroying && !flushDirtyBuffers()) {
            notify.error("Could not persist editor recovery", "A late edit could not be saved before the window closed.");
        }
        if (!closing) return;
        const path = (event as CustomEvent<{ path?: string }>).detail?.path;
        if (typeof path === "string") editedPaths.set(path, editorRevision);
        else unknownEditorRevision++;
    };
    window.addEventListener("bettershape-editor-changed", onEditorBuffer);
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const attemptClose = async () => {
        const win = getCurrentWindow();
        if (cancelled) return;
        if (closing) {
            if (win.label !== "main") await reportStartedClose(win.label);
            return;
        }
        closing = true;
        const editorRevisionAtStart = editorRevision;
        let destroyed = false;
        try {
            if (win.label !== "main") await reportStartedClose(win.label);
            const { confirm, message } = await import("@tauri-apps/plugin-dialog");
            const { commands } = await import("@/lib/backend");
            const restoredDirty = new Set(pendingDiscard);
            for (const path of pendingDiscard) {
                await commands.markFileDirty(path, true);
                pendingDiscard.delete(path);
            }
            let isGenerating = () => false;
            if (win.label === "main") {
                const { hasGeneratingChats } = await import("@/features/chat/lib/generating-chats");
                isGenerating = hasGeneratingChats;
                if (cancelled) return;
                if (hasGeneratingChats()) { await win.hide(); return; }
            }
            const approvedRevision = getCredentialDraftRevision();
            const discard = await confirmCredentialClose(() => confirm(
                "Credential changes have not been saved to the OS keychain. Closing can lose new keys; failed deletions may leave stored keys. Close anyway?",
                { title: "Unsaved credentials", kind: "warning", okLabel: "Close anyway", cancelLabel: "Keep open" },
            ));
            if (!discard || cancelled) { await reportCancelledClose(win.label); return; }
            const unchanged = () => !cancelled && approvedRevision === getCredentialDraftRevision() && editorRevision === editorRevisionAtStart;
            const destroyIfUnchanged = async (discardPaths: string[] = []) => {
                const { clearDirtyBuffer, loadDirtyBuffer, saveDirtyBuffer } = await import("@/lib/workspace/dirty-buffers");
                if (!unchanged()) {
                    await reportCancelledClose(win.label);
                    return;
                }
                if (isGenerating()) { await win.hide(); return; }
                // The main window's prompts must complete before closing peers.
                if (win.label === "main" && !(await closeOtherWindows(win.label))) return;
                if (!unchanged()) { await reportCancelledClose(win.label); return; }
                if (isGenerating()) { await win.hide(); return; }
                const unknownRevision = unknownEditorRevision;
                const recovery = discardPaths.map((path) => ({ buffer: loadDirtyBuffer(path), revision: editedPaths.get(path) }));
                try {
                    for (const path of discardPaths) {
                        if (!clearDirtyBuffer(path)) throw new Error("Could not remove editor recovery");
                    }
                    if (!flushDirtyBuffers()) throw new Error("Could not persist editor recovery");
                    destroying = true;
                    // A change event can still be queued behind this check. Give it
                    // its synchronous flush, and refuse the destructive step when
                    // recovery cannot be written: a destroyed window owns no retry.
                    await new Promise((resolve) => setTimeout(resolve, 0));
                    if (!flushDirtyBuffers()) {
                        destroying = false;
                        throw new Error("Could not persist editor recovery");
                    }
                    await win.destroy();
                    destroyed = true;
                } catch (error) {
                    for (const { buffer, revision } of recovery) {
                        if (buffer && unknownRevision === unknownEditorRevision && editedPaths.get(buffer.path) === revision && !loadDirtyBuffer(buffer.path)) {
                            saveDirtyBuffer(buffer.path, buffer.content, buffer.savedContent);
                        }
                    }
                    throw error;
                }
            };
            if (win.label !== "main") { await destroyIfUnchanged(); return; }
            const { getProjectSnapshot } = await import("@/lib/backend");
            const dirty = dirtyOpenFiles(getProjectSnapshot().open_files, restoredDirty);
            if (dirty.length === 0) { await destroyIfUnchanged(); return; }

            const choice = await message(
                dirty.length === 1
                    ? `Save changes to ${dirty[0].name || dirty[0].path} before closing?`
                    : `Save changes to ${dirty.length} files before closing?`,
                {
                    title: "Unsaved changes",
                    kind: "warning",
                    buttons: { yes: "Save", no: "Don't save", cancel: "Cancel" },
                },
            );

            if (choice !== "Save" && choice !== "Yes" && choice !== "Don't save" && choice !== "No") {
                await reportCancelledClose(win.label);
                return;
            }
            if (!unchanged()) { await reportCancelledClose(win.label); return; }
            if (isGenerating()) { await win.hide(); return; }
            if (choice === "Save" || choice === "Yes") {
                if (!(await requestSaveAll()) || dirtyOpenFiles((await commands.getProjectState()).open_files).length > 0) {
                    notify.error("Could not save all files", "Your window remains open. Save the remaining changes before closing.");
                    return;
                }
            } else {
                for (const f of dirty) {
                    if (!unchanged()) { await reportCancelledClose(win.label); return; }
                    pendingDiscard.add(f.path);
                    await commands.markFileDirty(f.path, false);
                }
                await destroyIfUnchanged(dirty.map((file) => file.path));
                return;
            }
            await destroyIfUnchanged();
        } catch {
            await reportCancelledClose(win.label);
            notify.error("Could not close the window", "Your window remains open. Retry after saving your changes.");
        } finally {
            if (!destroyed && pendingDiscard.size > 0) {
                const { commands } = await import("@/lib/backend");
                for (const path of pendingDiscard) {
                    try {
                        await commands.markFileDirty(path, true);
                        pendingDiscard.delete(path);
                    } catch {
                        notify.error("Could not restore unsaved file state", "Your drafts remain in this window. Save them before trying to close again.");
                    }
                }
            }
            destroying = false;
            closing = false;
            editedPaths.clear();
        }
    };
    currentCloseAttempt = attemptClose;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 500;
    let reportedRegistrationFailure = false;
    const register = async () => {
        try {
            if (cancelled) return;
            const win = getCurrentWindow();
            const stop = await win.onCloseRequested(event => {
                event.preventDefault();
                return attemptClose();
            });
            if (cancelled) stop();
            else unlisten = stop;
        } catch {
            if (cancelled || !isTauriRuntime()) return;
            if (!reportedRegistrationFailure) {
                reportedRegistrationFailure = true;
                notify.error("Window close protection is unavailable", "Retrying automatically. The titlebar Close button still checks your unsaved changes.");
            }
            retryTimer = setTimeout(() => { void register(); }, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 30_000);
        }
    };
    void register();

    return () => {
        cancelled = true;
        clearTimeout(retryTimer);
        if (currentCloseAttempt === attemptClose) currentCloseAttempt = undefined;
        window.removeEventListener("beforeunload", preventUnsavedCredentialUnload);
        window.removeEventListener("beforeunload", preventUnpersistedEditorUnload);
        flushDirtyBuffers();
        window.removeEventListener("bettershape-editor-changed", onEditorBuffer);
        unlisten?.();
    };
}
