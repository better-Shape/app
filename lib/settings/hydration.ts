function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function equal(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((value, index) => equal(value, right[index]));
    }
    if (!record(left) || !record(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
        && keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && equal(left[key], right[key]));
}

function merge(before: unknown, live: unknown, incoming: unknown, path: string[]): unknown {
    if (equal(before, live)) return incoming;
    // A credential and its destination must never come from different snapshots.
    if (path.length === 4 && path[0] === "ai" && path[1] === "providers"
        && (path[2] === "connections" || path[2] === "services")) return live;
    if (!record(before) || !record(live) || !record(incoming)) return live;
    const result = new Map(Object.entries(incoming));
    for (const key of new Set([...Object.keys(before), ...Object.keys(live)])) {
        if (!Object.prototype.hasOwnProperty.call(live, key)) result.delete(key);
        else if (!Object.prototype.hasOwnProperty.call(before, key)) result.set(key, live[key]);
        else if (!equal(before[key], live[key])) result.set(key, merge(before[key], live[key], incoming[key], [...path, key]));
    }
    return Object.fromEntries(result);
}

export function mergeSettingsHydration<T extends object>(before: T, live: T, incoming: T): T {
    return merge(before, live, incoming, []) as T;
}
