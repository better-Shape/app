export type SubagentStatus = "pending" | "running" | "done" | "error";
export type SubagentPhase = "reviewing" | "editing" | "working";
export type SubagentRead = { path: string; start?: number; end?: number };

export type SubagentCard = {
    id: string;
    title: string;
    agent?: string;
    model?: string;
    activity: string;
    task?: string;
    transcript?: string;
    parentId?: string;
    status: SubagentStatus;
    phase?: SubagentPhase;
    reads?: SubagentRead[];
    tokens?: number;
    truncated?: boolean;
    startedAt?: number;
    updatedAt: number;
};

type Listener = () => void;

let cards: SubagentCard[] = [];
let activeId: string | null = null;
let parentConversationId: string | null = null;
const listeners = new Set<Listener>();

/** Notifies all subscribed subagent store listeners of a state change. */
function emit() {
    for (const l of listeners) l();
}

/** Returns the currently focused subagent card identifier, if any. */
export function getActiveSubagentId(): string | null {
    return activeId;
}

/** Returns the active subagent card snapshot when one is open. */
export function getActiveSubagent(): SubagentCard | null {
    if (!activeId) return null;
    return cards.find((c) => c.id === activeId) ?? null;
}

/** Marks the target subagent card active and opens its workspace inspector. */
export function openSubagent(id: string) {
    if (!id) return;
    activeId = id;
    emit();
    const card = cards.find((c) => c.id === id);
    window.dispatchEvent(
        new CustomEvent("bettershape-open-subagent", { detail: { id, parentId: card?.parentId } }),
    );
}

/** Clears the active subagent inspector selection. */
export function closeSubagent() {
    activeId = null;
    emit();
}

/** Sets the default parent conversation identifier for newly spawned subagents. */
export function setSubagentParentConversation(id: string | null) {
    parentConversationId = id;
}

/** Returns all subagent cards belonging to the given parent conversation. */
export function subagentsForParent(parentId: string): SubagentCard[] {
    return cards.filter((c) => c.parentId === parentId);
}

const SUBAGENT_STATUS_MAP: Partial<Record<string, SubagentStatus>> = {
    error: "error",
    failed: "error",
    done: "done",
    completed: "done",
    pending: "pending",
    running: "running",
};

/** Normalizes a raw XML status attribute to a `SubagentStatus`. */
const parseSubagentStatus = (statusRaw?: string): SubagentStatus =>
    SUBAGENT_STATUS_MAP[(statusRaw || "").toLowerCase()] ?? "done";

/** `<attr="value">` readers, compiled once per attribute name. */
const ATTR_PATTERNS = new Map<string, RegExp>();

type ExtractedSubagentEntry = {
    id: string;
    title: string;
    task: string;
    model?: string;
    transcript?: string;
    status: SubagentStatus;
};

/** Reads a quoted XML attribute value from a `<subagent>` or `<subagent_ref>` tag header. */
const readXmlAttr = (tag: string, name: string): string => {
    let re = ATTR_PATTERNS.get(name);
    if (!re) {
        re = new RegExp(`${name}="([^"]*)"`);
        ATTR_PATTERNS.set(name, re);
    }
    return tag.match(re)?.[1] ?? "";
};

/** Resolves a non-empty subagent display title from `<subagent>` XML attributes. */
const resolveXmlSubagentTitle = (tag: string): string =>
    readXmlAttr(tag, "agent") || readXmlAttr(tag, "name") || "Subagent";

/** Builds an `ExtractedSubagentEntry` from a matched `<subagent>` or `<subagent_ref>` tag. */
const toExtractedSubagent = (tag: string, rawBody?: string): ExtractedSubagentEntry => {
    const title = resolveXmlSubagentTitle(tag);
    const id = readXmlAttr(tag, "id") || title;
    const model = readXmlAttr(tag, "model");
    return {
        id,
        title,
        task: readXmlAttr(tag, "task"),
        model: model ? model : undefined,
        transcript: rawBody?.trim(),
        status: parseSubagentStatus(readXmlAttr(tag, "status")),
    };
};

/** Collects parsed subagent entries from a regex match iterator. */
const collectXmlSubagentMatches = (
    text: string,
    pattern: RegExp,
    hasBody: boolean,
): ExtractedSubagentEntry[] =>
    Array.from(text.matchAll(pattern), (m) =>
        toExtractedSubagent(m.at(1) ?? "", hasBody ? (m.at(2) ?? "") : undefined),
    );

/** Parses XML `<subagent_ref/>` and `<subagent>...</subagent>` tags into deduplicated subagent entries. */
export const extractSubagentsFromText = (text: string, _parentId?: string): ExtractedSubagentEntry[] => {
    const out: ExtractedSubagentEntry[] = [];
    const seen = new Set<string>();
    const candidates = [
        ...collectXmlSubagentMatches(text, /<subagent_ref\b([^>]*)\/>/gi, false),
        ...collectXmlSubagentMatches(text, /<subagent\b([^>]*)>([\s\S]*?)<\/subagent>/gi, true),
    ];
    for (const entry of candidates) {
        if (entry.id && !seen.has(entry.id)) {
            seen.add(entry.id);
            out.push(entry);
        }
    }
    return out;
};

/** Formats a single `SubagentRead` entry as an XML `<cat>` tag. */
const formatSubagentReadTag = (read: SubagentRead): string => {
    const start = read.start != null ? ` start="${read.start}"` : "";
    const end = read.end != null ? ` end="${read.end}"` : "";
    return `<cat${start}${end}>${read.path}</cat>`;
};

/** Trims an optional string field, returning `""` when missing. */
const trimOptionalField = (value: string | undefined): string =>
    value ? value.trim() : "";

/** Formats file-read or fallback search lines for a subagent without a live transcript. */
const formatSubagentFallbackLines = (card: SubagentCard): string => {
    if (card.reads && card.reads.length > 0) {
        return card.reads.map(formatSubagentReadTag).join("\n");
    }
    const fallbackActivity = trimOptionalField(card.activity);
    return fallbackActivity ? `<search>${fallbackActivity}</search>` : "";
};

/** Formats a subagent's transcript, file reads, or search activity into workflow block XML. */
export const subagentWorkflowContent = (card: SubagentCard): string => {
    const transcript = trimOptionalField(card.transcript);
    return transcript || formatSubagentFallbackLines(card);
};

/** Returns the current immutable list of tracked subagent cards. */
export function getSubagents(): SubagentCard[] {
    return cards;
}

/** Subscribes a callback to subagent store updates and returns an unsubscribe handle. */
export function subscribeSubagents(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Infers a subagent execution phase from its activity summary when not explicitly set. */
function inferPhase(activity: string, explicit?: SubagentPhase): SubagentPhase {
    if (explicit) return explicit;
    const lower = activity.toLowerCase();
    if (/\breview/.test(lower)) return "reviewing";
    if (/\bedit/.test(lower)) return "editing";
    return "working";
}

/** Extracts file path and line-range read entries mentioned in an activity label. */
function parseReadsFromActivity(activity: string): SubagentRead[] {
    const reads: SubagentRead[] = [];
    const re = /(?:read(?:ing)?|reviewing)\s+(\S+?)(?::(\d+)(?:-(\d+))?)?(?:\s|$)/gi;
    for (const match of activity.matchAll(re)) {
        const path = match[1]?.replace(/(?<![.,;])[.,;]+$/, "");
        if (!path) continue;
        reads.push({
            path,
            start: match[2] ? Number(match[2]) : undefined,
            end: match[3] ? Number(match[3]) : undefined,
        });
    }
    return reads;
}

type SubagentUpsertInput = Omit<SubagentCard, "updatedAt"> & { updatedAt?: number };

/** Picks the first defined value between incoming, existing, and fallback fields. */
const pickDefined = <T>(primary: T | undefined, secondary: T | undefined, fallback?: T): T | undefined => {
    if (primary !== undefined) return primary;
    return secondary !== undefined ? secondary : fallback;
};

/** Resolves activity text, phase, and parsed file reads for an upserted subagent card. */
const resolveSubagentActivity = (next: SubagentUpsertInput, existing: SubagentCard | undefined) => {
    const activity = pickDefined(next.activity || undefined, existing?.activity || undefined, "Working...") ?? "Working...";
    const priorPhase = pickDefined(next.phase, existing?.phase);
    const priorReads = pickDefined(next.reads, existing?.reads);
    return {
        activity,
        phase: inferPhase(activity, priorPhase),
        reads: priorReads ?? parseReadsFromActivity(activity),
    };
};

/** Resolves parent conversation ownership and timestamps for an upserted subagent card. */
const resolveSubagentLineage = (next: SubagentUpsertInput, existing: SubagentCard | undefined) => {
    const now = Date.now();
    return {
        parentId: pickDefined(next.parentId, existing?.parentId, parentConversationId ?? undefined),
        startedAt: pickDefined(next.startedAt, existing?.startedAt, now) ?? now,
        updatedAt: next.updatedAt ?? now,
    };
};

/** Strips `undefined` keys so partial updates preserve prior `SubagentCard` metadata. */
const stripUndefinedFields = <T extends Record<string, unknown>>(obj: T): Partial<T> =>
    Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as Partial<T>;

/** Merges optional card metadata with an existing subagent entry when present. */
const mergeSubagentCard = (
    next: SubagentUpsertInput,
    existing: SubagentCard | undefined,
): SubagentCard => ({
    ...(existing ?? {}),
    ...stripUndefinedFields(next),
    id: next.id,
    title: next.title,
    status: next.status,
    ...resolveSubagentActivity(next, existing),
    ...resolveSubagentLineage(next, existing),
});

/** Upsert subagent. */
export const upsertSubagent = (next: SubagentUpsertInput) => {
    const idx = cards.findIndex((c) => c.id === next.id);
    const existing = idx >= 0 ? cards[idx] : undefined;
    const card = mergeSubagentCard(next, existing);
    cards = idx >= 0 ? cards.map((c, i) => (i === idx ? card : c)) : [...cards, card];
    emit();
};

/** Removes completed, failed, and cancelled subagent cards from the store. */
export function clearFinishedSubagents() {
    cards = cards.filter((c) => c.status === "running" || c.status === "pending");
    emit();
}

let demoTimer: ReturnType<typeof setInterval> | null = null;

/** Resets all tracked subagent cards and active selection state. */
export function resetSubagents() {
    if (demoTimer) {
        clearInterval(demoTimer);
        demoTimer = null;
    }
    cards = [];
    activeId = null;
    emit();
}

/** Drop subagents for one parent chat. Other sessions keep their nested rows. */
export function resetSubagentsForParent(parentId: string | null) {
    if (!parentId) {
        cards = cards.filter((c) => Boolean(c.parentId));
        if (activeId && !cards.some((c) => c.id === activeId)) activeId = null;
        emit();
        return;
    }
    cards = cards.filter((c) => c.parentId && c.parentId !== parentId);
    if (activeId && !cards.some((c) => c.id === activeId)) activeId = null;
    emit();
}

/** Applies an incoming backend subagent lifecycle event to the store. */
export function applySubagentEvent(payload: {
    id?: string;
    title?: string;
    activity?: string;
    status?: string;
    model?: string;
    task?: string;
    transcript?: string;
    phase?: SubagentPhase;
    reads?: SubagentRead[];
    tokens?: number;
    truncated?: boolean;
    conversationId?: string;
}) {
    if (!payload.id) return;
    const raw = (payload.status || "running").toLowerCase();
    const status: SubagentStatus =
        raw === "error" || raw === "failed"
            ? "error"
            : raw === "done" || raw === "completed"
              ? "done"
              : raw === "pending"
                ? "pending"
                : "running";
    upsertSubagent({
        id: payload.id,
        title: payload.title || "Subagent",
        activity: payload.activity || "Working…",
        status,
        model: payload.model,
        task: payload.task,
        transcript: payload.transcript,
        phase: payload.phase,
        reads: payload.reads,
        tokens: payload.tokens,
        truncated: payload.truncated,
        parentId: payload.conversationId,
    });
}

/** Populates sample subagent cards for offline preview and layout verification. */
export function seedDemoSubagents() {
    resetSubagents();
}

/** Synchronizes subagent store entries from parsed assistant message chunks. */
export function syncSubagentsFromChunks(
    chunks: Array<{
        type?: string;
        file?: string;
        query?: string;
        command?: string;
        content?: string;
        commandStatus?: string;
        isGenerating?: boolean;
    }>,
    generating: boolean,
) {
    const seen = new Set<string>();
    for (const chunk of chunks) {
        if (chunk.type !== "subagent" && chunk.type !== "subagent_ref") continue;
        const id = chunk.file || chunk.query || chunk.content || `sub-${cards.length}`;
        seen.add(id);
        const raw = (chunk.commandStatus || "").toLowerCase();
        const status: SubagentStatus =
            raw === "error" || raw === "failed"
                ? "error"
                : raw === "done" || raw === "completed"
                  ? "done"
                  : raw === "pending"
                    ? "pending"
                    : raw === "running" || chunk.isGenerating || generating
                      ? "running"
                      : "done";
        const existing = cards.find((c) => c.id === id);
        upsertSubagent({
            id,
            title: chunk.query || chunk.file || existing?.title || "Subagent",
            agent: chunk.query,
            model: chunk.command,
            activity:
                (chunk.type === "subagent" ? existing?.activity : chunk.content)
                || existing?.activity
                || "Working…",
            task: chunk.type === "subagent_ref" ? chunk.content : existing?.task,
            transcript: chunk.type === "subagent" ? chunk.content : existing?.transcript,
            parentId: parentConversationId ?? existing?.parentId,
            status,
        });
    }
    if (!generating) {
        cards = cards.map((c) =>
            seen.has(c.id) || c.status === "done" || c.status === "error"
                ? c
                : { ...c, status: "done" as const, updatedAt: Date.now() },
        );
        emit();
    }
}
