export type ChatShelfId = "pinned" | "working" | "active" | "snoozed" | "settled";

export type RowVariant = "card" | "slim";

export interface ChatShelfSpec {
    id: ChatShelfId;
    label: string;
    variant: RowVariant;
}

/** Explicit snooze/settle intent moves idle chats; a running chat remains visible. */
export const CHAT_SHELVES = [
    { id: "pinned", label: "Pinned", variant: "card" },
    { id: "working", label: "Working", variant: "slim" },
    { id: "active", label: "Active", variant: "slim" },
    { id: "snoozed", label: "Snoozed", variant: "slim" },
    { id: "settled", label: "Settled", variant: "slim" },
] as const satisfies readonly ChatShelfSpec[];

