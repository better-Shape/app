"use client";

const CLOSE_STARTED = "bettershape-window-close-started";
const CLOSE_CANCELLED = "bettershape-window-close-cancelled";

export async function reportCancelledClose(label: string): Promise<void> {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("main", CLOSE_CANCELLED, { label }).catch(() => undefined);
}

/** A live close guard has taken ownership; its human prompts have no deadline. */
export async function reportStartedClose(label: string): Promise<void> {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("main", CLOSE_STARTED, { label }).catch(() => undefined);
}

/** Native close() queues a request; only destruction confirms it completed. */
export function closeOtherWindows(mainLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
        let active = true;
        const cleanup = new Set<() => void>();
        const stop = (unlisten: () => void) => {
            cleanup.delete(unlisten);
            try { void Promise.resolve(unlisten()).catch(() => undefined); }
            catch { /* A failed cleanup must not prevent the remaining listeners from stopping. */ }
        };
        const finish = (closed: boolean) => {
            if (!active) return;
            active = false;
            clearTimeout(timer);
            for (const unlisten of cleanup) stop(unlisten);
            resolve(closed);
        };
        let timer: ReturnType<typeof setTimeout>;
        const armDeadline = () => {
            clearTimeout(timer);
            timer = setTimeout(() => finish(false), 60_000);
        };
        armDeadline();
        const track = async (registration: Promise<() => void>) => {
            const unlisten = await registration;
            if (active) cleanup.add(unlisten);
            else stop(unlisten);
        };
        void (async () => {
            const { getAllWindows } = await import("@tauri-apps/api/window");
            const { listen, TauriEvent } = await import("@tauri-apps/api/event");
            if (!active) return false;
            const windows = await getAllWindows();
            for (const window of windows) {
                if (!active) return false;
                if (window.label === mainLabel) continue;
                armDeadline();
                let outcome: boolean | undefined;
                let complete!: (closed: boolean) => void;
                const destroyed = new Promise<boolean>((done) => { complete = done; });
                const endWindow = (closed: boolean) => {
                    if (outcome !== undefined) return;
                    outcome = closed;
                    complete(closed);
                    if (!closed) finish(false);
                };
                await track(listen<{ label: string }>(CLOSE_CANCELLED, ({ payload }) => {
                    if (payload.label === window.label) endWindow(false);
                }));
                if (!active) return false;
                await track(listen<{ label: string }>(CLOSE_STARTED, ({ payload }) => {
                    if (payload.label === window.label) clearTimeout(timer);
                }));
                if (!active) return false;
                await track(window.once(TauriEvent.WINDOW_DESTROYED, () => endWindow(true)));
                if (!active) return false;
                const closed = outcome ?? await Promise.race([window.close().then(() => destroyed), destroyed]);
                for (const unlisten of cleanup) stop(unlisten);
                if (!closed) return false;
            }
            return true;
        })().then(finish, () => finish(false));
    });
}
