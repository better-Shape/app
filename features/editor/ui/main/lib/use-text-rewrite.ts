"use client";

import { useCallback, useState } from "react";
import { commands } from "@/lib/backend/commands";
import { notificationStore } from "@/features/notifications";
import {
    describeProviderSetupGap,
    hasAnyUsableProvider,
} from "@/lib/ai/providers";
import { getSettings } from "@/lib/settings";

export type TextRewriteAction =
    | "rewrite"
    | "shorter"
    | "longer"
    | "professional"
    | "casual"
    | "friendly";

const ACTION_PROMPTS: Record<TextRewriteAction, string> = {
    rewrite:
        "Rewrite the following text to improve clarity while keeping the same meaning. Return only the rewritten text with no quotes or explanation:",
    shorter:
        "Make the following text shorter while keeping the core meaning. Return only the shortened text:",
    longer: "Expand the following text with more detail. Return only the expanded text:",
    professional:
        "Rewrite the following text in a professional tone. Return only the rewritten text:",
    casual: "Rewrite the following text in a casual tone. Return only the rewritten text:",
    friendly:
        "Rewrite the following text in a friendly tone. Return only the rewritten text:",
};

/** Unwraps a matching outer single- or double-quote pair around `value`. */
const unwrapMatchingOuterQuotes = (value: string): string => {
    if (value.length < 2) return value;
    const first = value.charAt(0);
    if ((first === '"' || first === "'") && value.endsWith(first)) {
        return value.slice(1, -1);
    }
    return value;
};

const FENCE_LANGUAGE_HEADER_RE = /^[\w+#.-]*$/u;

/** Strips an optional single-token language identifier line after opening triple backticks. */
export const stripFenceLanguageHeader = (inner: string): string => {
    const nl = inner.indexOf("\n");
    if (nl === -1) return inner;
    const header = inner.slice(0, nl).trim();
    return FENCE_LANGUAGE_HEADER_RE.test(header) ? inner.slice(nl + 1) : inner;
};

/** Extracts inner text from a triple-backtick fenced reply, or `null` when unfenced. */
const extractTripleBacktickFence = (trimmed: string): string | null => {
    if (trimmed.length < 6 || !trimmed.startsWith("```") || !trimmed.endsWith("```")) {
        return null;
    }
    return stripFenceLanguageHeader(trimmed.slice(3, -3)).trim();
};

/** Unwraps optional Markdown fences or surrounding quote characters from a rewrite reply. */
export const stripAssistantResponse = (raw: string): string => {
    const trimmed = raw.trim();
    const fenced = extractTripleBacktickFence(trimmed);
    if (fenced !== null) return fenced;
    return unwrapMatchingOuterQuotes(trimmed);
};

/** Formats an unknown caught rewrite error into a displayable message string. */
const formatRewriteErrorMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

/** React hook providing AI-powered inline text rewrite actions with provider readiness checks. */
export const useTextRewrite = (_model = "auto") => {
    const [loading, setLoading] = useState(false);

    const rewrite = useCallback(
        async (text: string, action: TextRewriteAction): Promise<string | null> => {
            const providers = getSettings().ai.providers;
            if (!hasAnyUsableProvider(providers)) {
                notificationStore.add(
                    describeProviderSetupGap(providers),
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
                notificationStore.add(
                    "AI rewrite failed",
                    "error",
                    formatRewriteErrorMessage(err),
                    { autoHide: true },
                );
                return null;
            } finally {
                setLoading(false);
            }
        },
        [],
    );

    // Everything runs on the user's own keys, so the feature is always "signed in".
    return { rewrite, loading, loggedIn: true };
};

/** @deprecated use useTextRewrite */
export const usePreviewTextRewrite = useTextRewrite;
