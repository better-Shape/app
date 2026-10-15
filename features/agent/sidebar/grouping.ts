import type { Conversation } from "@/lib/backend/types";
import type { ChatCollection } from "@/lib/sidebar/chat-list-meta";

export type ChatGrouping = "none" | "collection" | "project";
export const GROUP_OPTIONS: { value: ChatGrouping; label: string }[] = [
    { value: "none", label: "None" },
    { value: "collection", label: "Collection" },
    { value: "project", label: "Project" },
];

export interface ChatGroup {
    id: string;
    label: string;
    detail?: string;
    chats: Conversation[];
}

/** Linear-time trimming, retaining POSIX and drive roots as real projects. */
function projectGroupId(path = ""): string {
    const normalized = path.replaceAll("\\", "/");
    const rootLength = normalized.slice(1, 3) === ":/" ? 3 : 1;
    let end = normalized.length;
    while (end > rootLength && normalized[end - 1] === "/") end -= 1;
    return normalized.slice(0, end);
}

function collectionMetadata(collection?: ChatCollection): Omit<ChatGroup, "chats"> {
    if (!collection) return { id: "", label: "No collection" };
    return { id: collection.id, label: collection.name };
}

/** Windows drive and UNC paths ignore case; POSIX project paths retain it. */
function projectMetadata(chat: Conversation): Omit<ChatGroup, "chats"> {
    const project = projectGroupId(chat.project_path ?? "");
    const id = /^(?:[a-z]:\/|\/\/)/i.test(project) ? project.toLowerCase() : project;
    return { id, label: project.split("/").pop() || project || "No project", detail: project };
}

function groupMetadata(chat: Conversation, mode: ChatGrouping, collection?: ChatCollection): Omit<ChatGroup, "chats"> {
    return mode === "collection" ? collectionMetadata(collection) : projectMetadata(chat);
}

function compareGroups(a: ChatGroup, b: ChatGroup): number {
    if (!a.id) return b.id ? 1 : 0;
    if (!b.id) return -1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
}

/** Keep the chosen sort inside each group. Missing metadata is a visible final group. */
export function groupChats(
    chats: readonly Conversation[],
    mode: ChatGrouping,
    collections: readonly ChatCollection[] = [],
): ChatGroup[] {
    if (mode === "none") return [{ id: "all", label: "", chats: [...chats] }];
    const collectionByChat = new Map(collections.flatMap((collection) => collection.chatIds.map((id) => [id, collection] as const)));
    const groups = new Map<string, ChatGroup>();
    for (const chat of chats) {
        const metadata = groupMetadata(chat, mode, collectionByChat.get(chat.id));
        const group = groups.get(metadata.id);
        if (group) group.chats.push(chat);
        else groups.set(metadata.id, { ...metadata, chats: [chat] });
    }
    return [...groups.values()].sort(compareGroups);
}

export function matchesChatSearch(chat: Conversation, query: string, collection?: string): boolean {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const text = [chat.title || "Untitled", chat.project_path, collection].filter(Boolean).join(" ").toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
}
