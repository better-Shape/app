"use client";

import { useSyncExternalStore } from "react";
import { BETTERSHAPE_ERRORS, classifyAiError } from "@/lib/errors/catalog";
import type { TurnPhase } from "./chat-stream-store";

export type ChatActivity = "approval" | "input" | "working" | "waiting" | "failed" | "limited" | "ready";
const EMPTY: ReadonlyMap<string, ChatActivity> = new Map();
let snapshot: ReadonlyMap<string, ChatActivity> = EMPTY;
const listeners = new Set<() => void>();

/** Only real runtime events select a status; unread and shelf intent are separate. */
export function activityForPhase(phase: TurnPhase, error?: string | null): ChatActivity {
    switch (phase) {
        case "awaiting_approval": return "approval";
        case "awaiting_input": return "input";
        case "waiting": return "waiting";
        case "thinking": case "tool": case "running_command": case "editing": return "working";
        case "failed": return error && classifyAiError(error).code === BETTERSHAPE_ERRORS.AI_RATE_LIMITED ? "limited" : "failed";
        default: return "ready";
    }
}

export function setChatActivity(id: string | null | undefined, phase: TurnPhase, error?: string | null) {
    if (!id) return;
    const activity = activityForPhase(phase, error);
    if ((snapshot.get(id) ?? "ready") === activity) return;
    const next = new Map(snapshot);
    if (activity === "ready") next.delete(id);
    else next.set(id, activity);
    snapshot = next.size ? next : EMPTY;
    for (const listener of listeners) listener();
}

export function getChatActivities() { return snapshot; }
export function resetChatActivitiesForTests() {
    snapshot = EMPTY;
    for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
export function useChatActivities() {
    return useSyncExternalStore(subscribe, getChatActivities, () => EMPTY);
}

export const CHAT_ACTIVITY_LABELS: Record<ChatActivity, string> = {
    approval: "Approval required", input: "Input needed", working: "Working", waiting: "Waiting",
    failed: "Failed", limited: "Rate limited", ready: "Ready",
};
