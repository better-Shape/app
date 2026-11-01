/**
 * The copy path that still works when the asynchronous clipboard is denied.
 *
 * `navigator.clipboard.writeText` rejects when the user gesture has expired,
 * which is the normal case for a copy-on-select surface: the write happens once
 * the selection settles. The hidden textarea with `execCommand("copy")` is the
 * fallback, and it fails silently on its own, so the caller gets the answer
 * rather than a boolean nobody read.
 */
export function copyWithHiddenTextarea(text: string): boolean {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try {
        copied = document.execCommand("copy");
    } catch {
        // A webview that does not implement the command at all. The caller
        // reports the failure either way.
        copied = false;
    }
    area.remove();
    return copied;
}
