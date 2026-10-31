type ProposedEdit = {
    original: string;
    replacement: string;
    /** Content before the first unresolved AI edit (reject/undo target). */
    baseline: string;
    id: string;
};

type ResolvedEntry = {
    status: "applied" | "rejected";
    contentHash?: string;
};

type RawResolvedValue = ResolvedEntry | "applied" | "rejected" | undefined;
type ResolvedConversationMap = Map<string, ResolvedEntry>;
type ResolvedStoreMap = Map<string, ResolvedConversationMap>;

const RESOLVED_FILES_KEY = "bettershape-resolved-files";

const proposedEdits = new Map<string, ProposedEdit>();
let currentConversationId: string | null = null;

/** Normalizes slashes and case for cross-platform path comparisons. */
const normalize = (filePath: string): string =>
    filePath.replaceAll("\\", "/").toLowerCase();

/** Exact path equality after normalize, or one path ending with `/<other>`. */
const pathsMatch = (leftPath: string, rightPath: string): boolean => {
    const normLeft = normalize(leftPath);
    const normRight = normalize(rightPath);
    if (normLeft === normRight) return true;
    return normLeft.endsWith(`/${normRight}`) || normRight.endsWith(`/${normLeft}`);
};

export function pathsEqual(leftPath: string, rightPath: string): boolean {
    return pathsMatch(leftPath, rightPath);
}

/** Fingerprint for matching an accepted/rejected edit payload. */
/** ToInt32 without the `| 0` idiom (Sonar S7767); `Math.imul(1, n)` truncates to int32. */
const toInt32 = (value: number) => Math.imul(1, value);

export function editContentHash(replacement: string): string {
    const normalized = replacement.replaceAll("\r\n", "\n");
    let hash = 0;
    for (let idx = 0; idx < normalized.length; idx += 1) {
        hash = toInt32(Math.imul(hash, 31) + normalized.charCodeAt(idx));
    }
    return `${normalized.length}:${hash.toString(36)}`;
}

export function setCurrentConversationId(id: string | null) {
    if (currentConversationId !== id) {
        proposedEdits.clear();
    }
    currentConversationId = id;
}

export function getCurrentConversationId(): string | null {
    return currentConversationId;
}

/** Reads a stored entry from any older format, or `null` when it is not a decision. */
const normalizeEntry = (raw: RawResolvedValue): ResolvedEntry | null => {
    if (!raw) return null;
    if (raw === "applied" || raw === "rejected") return { status: raw };
    if (raw.status === "applied" || raw.status === "rejected") return raw;
    return null;
};

/** Parses one conversation's raw JSON object into a `Map` without prototype keys. */
const parseConversationEntries = (rawConv: unknown): ResolvedConversationMap => {
    const convMap: ResolvedConversationMap = new Map();
    if (!rawConv || typeof rawConv !== "object" || Array.isArray(rawConv)) {
        return convMap;
    }
    for (const [fileKey, rawVal] of Object.entries(rawConv as Record<string, RawResolvedValue>)) {
        const entry = normalizeEntry(rawVal);
        if (entry) convMap.set(fileKey, entry);
    }
    return convMap;
};

/** Parses the top-level persisted JSON object into a nested `Map` store. */
const parseResolvedStoreJson = (stored: string | null): ResolvedStoreMap => {
    const storeMap: ResolvedStoreMap = new Map();
    if (!stored) return storeMap;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return storeMap;
    }
    for (const [convKey, rawConv] of Object.entries(parsed as Record<string, unknown>)) {
        storeMap.set(convKey, parseConversationEntries(rawConv));
    }
    return storeMap;
};

/** Serializes the nested `Map` store into a plain JSON string. */
const serializeResolvedStore = (store: ResolvedStoreMap): string => {
    const outerEntries = Array.from(store.entries(), ([convKey, convMap]) => [
        convKey,
        Object.fromEntries(convMap),
    ]);
    return JSON.stringify(Object.fromEntries(outerEntries));
};

/** `undefined` means "no memo yet"; `null` is a real value (`getItem` miss). */
let resolvedStoreRaw: string | null | undefined;
let resolvedStore: ResolvedStoreMap = new Map();

/** Reads the resolved-edit map, reusing the last parse when storage is unchanged. */
const loadResolvedFilesStore = (): ResolvedStoreMap => {
    let stored: string | null;
    try {
        stored = localStorage.getItem(RESOLVED_FILES_KEY);
    } catch {
        return new Map();
    }

    if (resolvedStoreRaw !== undefined && stored === resolvedStoreRaw) {
        return resolvedStore;
    }

    try {
        const parsed = parseResolvedStoreJson(stored);
        resolvedStoreRaw = stored;
        resolvedStore = parsed;
    } catch {
        resolvedStoreRaw = stored;
        resolvedStore = new Map();
    }
    return resolvedStore;
};

/** Persists the resolved-edit map and refreshes the in-memory copy. */
const saveResolvedFilesStore = (store: ResolvedStoreMap): void => {
    try {
        const raw = serializeResolvedStore(store);
        localStorage.setItem(RESOLVED_FILES_KEY, raw);
        resolvedStoreRaw = raw;
        resolvedStore = store;
    } catch {
        resolvedStoreRaw = undefined;
    }
};

export function markFileResolved(
    conversationId: string,
    file: string,
    status: "applied" | "rejected",
    replacement?: string,
) {
    const store = loadResolvedFilesStore();
    let convMap = store.get(conversationId);
    if (!convMap) {
        convMap = new Map();
        store.set(conversationId, convMap);
    }
    convMap.set(normalize(file), {
        status,
        contentHash: replacement !== undefined ? editContentHash(replacement) : undefined,
    });
    saveResolvedFilesStore(store);
    clearProposedEdit(file);
}

export function clearFileResolved(conversationId: string, file: string) {
    const store = loadResolvedFilesStore();
    const convMap = store.get(conversationId);
    if (!convMap) return;
    const normalizedFile = normalize(file);
    convMap.delete(normalizedFile);
    for (const key of Array.from(convMap.keys())) {
        if (pathsMatch(key, normalizedFile)) convMap.delete(key);
    }
    saveResolvedFilesStore(store);
}

/** Resolved content hash for a file, if any (used to slice pending edit chains). */
export function getResolvedContentHash(
    conversationId: string | null,
    file: string,
): string | undefined {
    if (!conversationId) return undefined;
    const convMap = loadResolvedFilesStore().get(conversationId);
    if (!convMap) return undefined;
    const normalizedFile = normalize(file);
    const direct = convMap.get(normalizedFile);
    if (direct?.contentHash) return direct.contentHash;
    for (const [key, entry] of convMap.entries()) {
        if (pathsMatch(key, normalizedFile) && entry.contentHash) {
            return entry.contentHash;
        }
    }
    return undefined;
}

/** Checks whether `entry` matches the optional `currentReplacement` hash. */
const matchesResolvedReplacement = (
    entry: ResolvedEntry | undefined,
    currentReplacement?: string,
): boolean => {
    if (!entry) return false;
    if (currentReplacement === undefined || !entry.contentHash) return true;
    return editContentHash(currentReplacement) === entry.contentHash;
};

export function isFileResolved(
    conversationId: string | null,
    file: string,
    currentReplacement?: string,
): boolean {
    if (!conversationId) return false;
    const convMap = loadResolvedFilesStore().get(conversationId);
    if (!convMap) return false;
    const normalizedFile = normalize(file);
    if (matchesResolvedReplacement(convMap.get(normalizedFile), currentReplacement)) {
        return true;
    }
    for (const [key, entry] of convMap.entries()) {
        if (pathsMatch(key, normalizedFile) && matchesResolvedReplacement(entry, currentReplacement)) {
            return true;
        }
    }
    return false;
}

export function getResolvedFiles(conversationId: string | null): Record<string, "applied" | "rejected"> {
    if (!conversationId) return {};
    const convMap = loadResolvedFilesStore().get(conversationId);
    if (!convMap) return {};
    const statusEntries = Array.from(convMap.entries(), ([fileKey, entry]) => [
        fileKey,
        entry.status,
    ]);
    return Object.fromEntries(statusEntries) as Record<string, "applied" | "rejected">;
}

export function setProposedEdit(path: string, edit: ProposedEdit) {
    if (currentConversationId && isFileResolved(currentConversationId, path, edit.replacement)) {
        return;
    }
    const normalizedPath = normalize(path);
    proposedEdits.set(normalizedPath, {
        ...edit,
        baseline: edit.baseline ?? edit.original,
    });
    window.dispatchEvent(new CustomEvent("bettershape-proposed-edits-changed", {
        detail: { path: normalizedPath },
    }));
}

export function getProposedEdit(path: string): ProposedEdit | null {
    const normalizedPath = normalize(path);
    const direct = proposedEdits.get(normalizedPath);
    if (direct) return direct;
    for (const [key, value] of proposedEdits.entries()) {
        if (pathsMatch(normalizedPath, key)) {
            return value;
        }
    }
    return null;
}

export function clearProposedEdit(path: string) {
    const normalizedPath = normalize(path);
    proposedEdits.delete(normalizedPath);
    for (const key of Array.from(proposedEdits.keys())) {
        if (pathsMatch(normalizedPath, key)) {
            proposedEdits.delete(key);
        }
    }
    window.dispatchEvent(new CustomEvent("bettershape-proposed-edits-changed", {
        detail: { path: normalizedPath },
    }));
}

export function clearAllProposedEdits() {
    proposedEdits.clear();
    window.dispatchEvent(new CustomEvent("bettershape-proposed-edits-changed", {
        detail: { all: true },
    }));
}

export function getAllProposedEdits(): Record<string, ProposedEdit> {
    return Object.fromEntries(proposedEdits);
}

export function isFileResolvedForCurrentConversation(
    file: string,
    currentReplacement?: string,
): boolean {
    return isFileResolved(currentConversationId, file, currentReplacement);
}

/** @deprecated Use isFileResolved instead - kept for gradual migration */
export function loadEditStatuses(): Record<string, "applied" | "rejected"> {
    return {};
}
