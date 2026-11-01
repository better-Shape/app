/**
 * Clipboard writes that keep the order they were asked for.
 *
 * `navigator.clipboard.writeText` is a promise, and a copy-on-select surface
 * asks for a new write on every selection change. Two writes in flight can
 * settle out of order, and the older text then lands over the newer one. The
 * queue runs one write at a time so the last request is the last write.
 */
export type ClipboardWriter = (text: string) => Promise<unknown>;

/**
 * Returns a function that writes `text` once every earlier write has settled,
 * and calls `onFailure` when the newest write fails. An older failure is
 * ignored: its text is no longer what the user wants.
 */
export function createClipboardQueue(
    writeText: ClipboardWriter,
    onFailure?: (text: string) => void,
): (text: string, failure?: (text: string) => void) => Promise<void> {
    let chain: Promise<void> = Promise.resolve();
    let latest = 0;
    return (text, failure) => {
        const seq = ++latest;
        chain = chain
            .catch(() => undefined)
            .then(() => writeText(text))
            .then(() => undefined)
            .catch(() => {
                if (seq !== latest) return;
                failure?.(text);
                onFailure?.(text);
            });
        return chain;
    };
}
