/**
 * Clipboard writes that keep the order they were asked for.
 *
 * `navigator.clipboard.writeText` is a promise, and a copy-on-select surface
 * asks for a new write on every selection change. Two writes in flight can
 * settle out of order, and the older text then lands over the newer one. The
 * queue runs one write at a time so the last request is the last write, and a
 * request that a later copy has already superseded is dropped rather than
 * written late.
 */
export type ClipboardWriter = (text: string) => Promise<unknown>;

export type ClipboardRequest = {
    /** Called when the newest write fails, so the caller can say so. */
    onFailure?: (text: string) => void;
    /**
     * Checked again when the write reaches the front of the queue. A copy that
     * landed by another path in the meantime makes this false, and writing then
     * would put the older text over the newer selection.
     */
    shouldWrite?: () => boolean;
};

/**
 * Returns a function that writes `text` once every earlier write has settled.
 * A failure only reports when that request is still the newest one: its text is
 * no longer what the user wants once something newer was asked for.
 */
export function createClipboardQueue(
    writeText: ClipboardWriter,
): (text: string, request?: ClipboardRequest) => Promise<void> {
    let chain: Promise<void> = Promise.resolve();
    let latest = 0;
    return (text, request = {}) => {
        const seq = ++latest;
        chain = chain
            .catch(() => undefined)
            .then(() => {
                if (request.shouldWrite && !request.shouldWrite()) return;
                return writeText(text);
            })
            .then(() => undefined)
            .catch(() => {
                if (seq !== latest) return;
                request.onFailure?.(text);
            });
        return chain;
    };
}
