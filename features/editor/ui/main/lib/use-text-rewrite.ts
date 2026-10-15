"use client";

import { useCallback, useState } from "react";
import { commands } from "@/lib/backend/commands";
import { notificationStore } from "@/features/notifications";
import { hasAnyUsableProvider } from "@/lib/ai/providers";
import { getSettings } from "@/lib/settings";

export type TextRewriteAction =
    | "rewrite"
    | "shorter"
    | "longer"
    | "professional"
    | "casual"
    | "friendly";

const ACTION_PROMPTS: Record<TextRewriteAction, string> = {
    rewrite: "Rewrite the following text to improve clarity while keeping the same meaning. Return only the rewritten text with no quotes or explanation:",
    shorter: "Make the following text shorter while keeping the core meaning. Return only the shortened text:",
    longer: "Expand the following text with more detail. Return only the expanded text:",
    professional: "Rewrite the following text in a professional tone. Return only the rewritten text:",
    casual: "Rewrite the following text in a casual tone. Return only the rewritten text:",
    friendly: "Rewrite the following text in a friendly tone. Return only the rewritten text:",
};

function stripAssistantResponse(raw: string): string {
    const trimmed = raw.trim();
    const codeFence = trimmed.match(/^```(?:\w+)?\n?([\s\S]*?)\n?```$/);
    if (codeFence) return codeFence[1].trim();
    return trimmed.replace(/^["']|["']$/g, "");
}

export function useTextRewrite(_model = "auto") {
    const [loading, setLoading] = useState(false);

    const rewrite = useCallback(async (text: string, action: TextRewriteAction): Promise<string | null> => {
        if (!hasAnyUsableProvider(getSettings().ai.providers)) {
            notificationStore.add(
                "Add an API key in Settings → Providers",
                "warning",
                undefined,
                { autoHide: true },
            );
            return null;
        }

        setLoading(true);
        try {
            const prompt = `${ACTION_PROMPTS[action]}\n\n${text}`;
            const response = await commands.rewriteText(prompt);

            return stripAssistantResponse(response);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            notificationStore.add("AI rewrite failed", "error", message, { autoHide: true });
            return null;
        } finally {
            setLoading(false);
        }
    }, []);

    // Everything runs on the user's own keys, so the feature is always "signed in".
    return { rewrite, loading, loggedIn: true };
}

/** @deprecated use useTextRewrite */
export const usePreviewTextRewrite = useTextRewrite;
