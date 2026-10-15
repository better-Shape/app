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

const SERVICE_CREDENTIAL_FIELDS: ReadonlyMap<string, readonly string[]> = new Map([
    ["search", ["apiKey", "provider"]],
    ["composio", ["apiKey", "userId"]],
]);

/** Credentials and routing stay together; model preferences may hydrate independently. */
function preserveCredentialBundle(before: Record<string, unknown>, live: Record<string, unknown>, merged: Record<string, unknown>, path: string[]) {
    if (path.length !== 4 || path[0] !== "ai" || path[1] !== "providers") return merged;
    const fields = path[2] === "connections" ? ["apiKey", "baseUrl", "authStyle", "headers"]
        : path[2] === "services" ? SERVICE_CREDENTIAL_FIELDS.get(path[3]) ?? ["apiKey", "provider", "userId"] : [];
    if (!fields.some(key => !equal(before[key], live[key]))) return merged;
    for (const key of fields) {
        if (Object.prototype.hasOwnProperty.call(live, key)) merged[key] = live[key];
        else delete merged[key];
    }
    return merged;
}

function merge(before: unknown, live: unknown, incoming: unknown, path: string[]): unknown {
    if (equal(before, live)) return incoming;
    if (!record(before) || !record(live) || !record(incoming)) return live;
    const result = new Map(Object.entries(incoming));
    for (const key of new Set([...Object.keys(before), ...Object.keys(live)])) {
        if (!Object.prototype.hasOwnProperty.call(live, key)) result.delete(key);
        else if (!Object.prototype.hasOwnProperty.call(before, key)) result.set(key, live[key]);
        else if (!equal(before[key], live[key])) result.set(key, merge(before[key], live[key], incoming[key], [...path, key]));
    }
    return preserveCredentialBundle(before, live, Object.fromEntries(result), path);
}

export function mergeSettingsHydration<T extends object>(before: T, live: T, incoming: T): T {
    return merge(before, live, incoming, []) as T;
}

/** Keep known overlay fields and edits, not defaults whose legacy values are still unread. */
export function projectSettingsOverlay(defaults: unknown, live: unknown, ...known: unknown[]): unknown {
    if (!record(live) || record(defaults) && Object.keys(defaults).length === 0) return live;
    const base = record(defaults) ? defaults : {};
    const saved = known.filter(record);
    return Object.fromEntries(Object.entries(live)
        .filter(([key, value]) => saved.some(source => Object.prototype.hasOwnProperty.call(source, key)) || !equal(base[key], value))
        .map(([key, value]) => [key, projectSettingsOverlay(base[key], value, ...saved.map(source => source[key]))]));
}

/** Fixed settings fields merge sparsely; arrays and open-ended maps remain whole values. */
export function mergeSettingsOverlay(defaults: unknown, base: unknown, patch: unknown): unknown {
    if (!record(defaults) || Object.keys(defaults).length === 0 || !record(base) || !record(patch)) return patch;
    return {
        ...base,
        ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, mergeSettingsOverlay(defaults[key], base[key], value)])),
    };
}
