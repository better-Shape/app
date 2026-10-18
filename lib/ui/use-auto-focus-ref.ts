import { useCallback } from "react";

/**
 * A ref that focuses its element the moment the element mounts, in place of the
 * `autoFocus` attribute the analyzer flags.
 *
 * `autoFocus` focuses during render and only on the first render of the field. This
 * callback ref focuses on every attach, so a field that is swapped in later, such as a
 * later step of a dialog, is focused too. The callback is stable, so React calls it only
 * when the node attaches or detaches rather than on each render, which keeps focus from
 * being yanked back while the user is typing.
 */
export function useAutoFocusRef<T extends HTMLElement>() {
    return useCallback((node: T | null) => {
        node?.focus();
    }, []);
}
