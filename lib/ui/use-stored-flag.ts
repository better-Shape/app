import { useSyncExternalStore } from "react";

function readFlag(key: string): boolean {
    try {
        return localStorage.getItem(key) === "true";
    } catch {
        return false;
    }
}

/**
 * A boolean kept in localStorage, read from storage on each render, so no component copies
 * it into state. Writers save first and then dispatch `changeEvent` on `window`.
 * The server render (and hydration) use `false`, which matches the static export.
 */
export function useStoredFlag(key: string, changeEvent: string): boolean {
    return useSyncExternalStore(
        (onChange) => {
            window.addEventListener(changeEvent, onChange);
            window.addEventListener("storage", onChange);
            return () => {
                window.removeEventListener(changeEvent, onChange);
                window.removeEventListener("storage", onChange);
            };
        },
        () => readFlag(key),
        () => false,
    );
}
