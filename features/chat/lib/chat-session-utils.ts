import type { ChatMessage } from "@/lib/backend";
import { parseMessageContent, type Chunk } from "../ui/md/renderer";
import {
    clearAllProposedEdits,
    editContentHash,
    getResolvedContentHash,
    isFileResolved,
    setProposedEdit,
} from "./proposed-edits";

/**
 * Messages keep object identity while their content is unchanged, so parsing
 * is cached per message. Several scans walk the whole transcript per stream
 * tick and each one would otherwise re-parse every message it sees.
 */
const messageChunkCache = new WeakMap<ChatMessage, { content: string; chunks: Chunk[] }>();

/** Parsed chunks for a message, re-parsed only when its content changes. */
export function chunksForMessage(message: ChatMessage): Chunk[] {
    const cached = messageChunkCache.get(message);
    if (cached && cached.content === message.content) return cached.chunks;
    const chunks = parseMessageContent(message.content);
    messageChunkCache.set(message, { content: message.content, chunks });
    return chunks;
}

/** Absolutises a project-relative path, leaving absolute and Windows paths as-is. */
export function resolveChatFilePath(filePath: string, projectPath: string | null): string {
    if (/^[a-zA-Z]:[\\\/]/.test(filePath) || filePath.startsWith("/")) return filePath;
    if (!projectPath) return filePath;
    return `${projectPath.replace(/\\/g, "/")}/${filePath.replace(/\\/g, "/")}`.replace(/\/+/g, "/");
}

export function syncProposedEditsFromMessages(history: ChatMessage[], convId: string | null) {
    clearAllProposedEdits();
    if (!convId) return;

    type Step = { id: string; file: string; original: string; replacement: string };
    const stepsByFile = new Map<string, Step[]>();

    history.forEach((m, msgIdx) => {
        if (m.role !== "assistant") return;
        const chunks = chunksForMessage(m);
        chunks
            .filter((c): c is Chunk & { file: string } => c.type === "edit" && !!c.file)
            .forEach((e, editIdx) => {
                const list = stepsByFile.get(e.file) || [];
                list.push({
                    id: `msg-${msgIdx}-${editIdx}-${e.file}`,
                    file: e.file,
                    original: e.original || "",
                    replacement: e.replacement || "",
                });
                stepsByFile.set(e.file, list);
            });
    });

    stepsByFile.forEach((steps, file) => {
        const resolvedHash = getResolvedContentHash(convId, file);
        let startIdx = 0;
        if (resolvedHash) {
            let lastResolved = -1;
            for (let i = 0; i < steps.length; i++) {
                if (editContentHash(steps[i].replacement) === resolvedHash) {
                    lastResolved = i;
                }
            }
            if (lastResolved >= 0) {
                if (lastResolved === steps.length - 1) return;
                startIdx = lastResolved + 1;
            } else if (isFileResolved(convId, file, steps[steps.length - 1]?.replacement)) {
                return;
            } else if (isFileResolved(convId, file)) {
                startIdx = Math.max(0, steps.length - 1);
            }
        } else if (isFileResolved(convId, file, steps[steps.length - 1]?.replacement)) {
            return;
        }

        const chain = steps.slice(startIdx);
        if (chain.length === 0) return;
        const latest = chain[chain.length - 1];
        setProposedEdit(file, {
            original: latest.original,
            replacement: latest.replacement,
            baseline: chain[0].original,
            id: latest.id,
        });
    });
}

export type ChatMessageGroup = { msg: ChatMessage; msgIdx: number }[];

/**
 * Turns of a transcript. Streaming replaces `messages` on every token, so the
 * grouping is rebuilt constantly; a group whose members are the same objects as
 * last time is returned by identity. That lets a memoized turn component skip
 * every turn except the one being streamed into.
 */
let lastGroupInput: ChatMessage[] | null = null;
let lastGroups: ChatMessageGroup[] = [];

/** Groups consecutive assistant messages under the user turn that started them. */
export function groupChatMessages(messages: ChatMessage[]): ChatMessageGroup[] {
    if (messages === lastGroupInput) return lastGroups;

    const groups: ChatMessageGroup[] = [];
    for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
        const msg = messages[msgIdx];
        if (!msg || msg.hidden) continue;
        const current = groups[groups.length - 1];
        if (msg.role === "user" || !current) {
            groups.push([{ msg, msgIdx }]);
        } else {
            current.push({ msg, msgIdx });
        }
    }

    // Reuse the previous array for any turn that did not change, so React sees
    // stable props for it.
    for (let i = 0; i < groups.length; i++) {
        const previous = lastGroups[i];
        const next = groups[i];
        if (!previous || !next || previous.length !== next.length) continue;
        const unchanged = previous.every((entry, k) => {
            const other = next[k];
            return other !== undefined && entry.msg === other.msg && entry.msgIdx === other.msgIdx;
        });
        if (unchanged) groups[i] = previous;
    }

    lastGroupInput = messages;
    lastGroups = groups;
    return groups;
}
