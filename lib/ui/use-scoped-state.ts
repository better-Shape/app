"use client";

import { useCallback, useState, type DependencyList, type Dispatch, type SetStateAction } from "react";

/** Reset before commit when ownership changes; callbacks from an old owner cannot overwrite the new value. */
export function useScopedState<T>(inputs: DependencyList, initial: () => T): [T, Dispatch<SetStateAction<T>>] {
    const [stored, setStored] = useState(() => ({ inputs, value: initial(), owner: {} }));
    let current = stored;
    if (stored.inputs.length !== inputs.length || inputs.some((value, index) => !Object.is(value, stored.inputs[index]))) {
        current = { inputs, value: initial(), owner: {} };
        setStored(current);
    }
    const owner = current.owner;
    const setValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
        setStored(previous => {
            if (previous.owner !== owner) return previous;
            const value = typeof update === "function" ? (update as (value: T) => T)(previous.value) : update;
            return Object.is(value, previous.value) ? previous : { ...previous, value };
        });
    }, [owner]);
    return [current.value, setValue];
}
