/**
 * Pure queue policy for follow-up messages typed while a chat turn is running.
 *
 * Every queued message is bound to the conversation it was queued in. A queued
 * message may only be sent while that same conversation is on screen and idle;
 * it must never drift into another chat (or a fresh one) just because the
 * global "generating" flag flipped.
 */

export type QueuedChatMessage = {
    id: string;
    content: string;
    /** Conversation the message was queued in. `null` = draft chat with no id yet. */
    conversationId: string | null;
};

/** Messages queued in the conversation currently on screen (what the UI shows). */
export function queueForConversation(
    queue: readonly QueuedChatMessage[],
    conversationId: string | null,
): QueuedChatMessage[] {
    return queue.filter((m) => m.conversationId === conversationId);
}

/**
 * Pop the next message that belongs to the conversation on screen.
 * Messages queued for other conversations are left untouched.
 */
export function takeNextQueuedMessage(
    queue: readonly QueuedChatMessage[],
    conversationId: string | null,
): { item: QueuedChatMessage; rest: QueuedChatMessage[] } | null {
    const index = queue.findIndex((m) => m.conversationId === conversationId);
    if (index < 0) return null;
    const item = queue[index]!;
    return { item, rest: [...queue.slice(0, index), ...queue.slice(index + 1)] };
}

/**
 * A draft turn learns its real conversation id once the backend starts it.
 * Messages queued during that window adopt the new id so they are not orphaned.
 */
export function adoptDraftQueuedMessages(
    queue: QueuedChatMessage[],
    conversationId: string,
): QueuedChatMessage[] {
    // Same reference when nothing changed, so React state updates bail out.
    if (!queue.some((m) => m.conversationId === null)) return queue;
    return queue.map((m) => (m.conversationId === null ? { ...m, conversationId } : m));
}

/** True when the backend's current conversation must be switched before sending. */
export function needsBackendPin(
    backendConversationId: string | null,
    viewedConversationId: string | null,
): boolean {
    return Boolean(viewedConversationId) && backendConversationId !== viewedConversationId;
}

/**
 * Whether a queued message may be dispatched now. The send-in-flight count is
 * decremented only after the backend call settles, so a finished turn cannot
 * race a still-pending send and get its queued follow-up dropped.
 */
export function canDrainQueue(state: {
    isLoading: boolean;
    sendsInFlight: number;
    skipDrain: boolean;
}): boolean {
    return !state.isLoading && state.sendsInFlight === 0 && !state.skipDrain;
}
