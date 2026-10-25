"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogBody,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { classifyAiError, errorDocsUrl } from "@/lib/errors/catalog";
import { commands } from "@/lib/backend";

const OPENROUTER_BILLING_URLS = [
    "openrouter.ai/settings/credits",
    "openrouter.ai/credits",
] as const;
const OPENAI_BILLING_URLS = [
    "platform.openai.com/account/billing",
    "platform.openai.com/settings/organization/billing",
] as const;

const includesAnySubstring = (haystack: string, needles: readonly string[]): boolean =>
    needles.some((needle) => haystack.includes(needle));

/** Billing provider detected from a raw AI error string (`"openrouter"` takes precedence over `"openai"`). */
export const detectErrorBillingProvider = (
    rawMessage: string,
    isQuota: boolean,
): "openrouter" | "openai" | null => {
    if (!rawMessage) return null;
    const lower = rawMessage.toLowerCase();
    const isOpenRouter =
        includesAnySubstring(lower, OPENROUTER_BILLING_URLS) ||
        (isQuota && (/\bopenrouter\b/.test(lower) || lower.includes("openrouter.ai")));
    if (isOpenRouter) return "openrouter";
    const isOpenAi =
        includesAnySubstring(lower, OPENAI_BILLING_URLS) ||
        (isQuota && (/\bopenai\b/.test(lower) || lower.includes("api.openai.com")));
    return isOpenAi ? "openai" : null;
};

export function ChatErrorDialog({
    message,
    onDismiss,
    onRetry,
}: {
    message: string | null;
    onDismiss: () => void;
    onRetry?: () => void;
}) {
    const rawMessage = message ?? "";
    const hasMessage = rawMessage.length > 0;
    const entry = classifyAiError(rawMessage);
    const isQuota =
        hasMessage &&
        /insufficient_quota|insufficient\s+credits|credit\s+balance\s+is\s+too\s+low|exceeded\s+your\s+current\s+quota|billing_hard_limit|billing\s+limit/i.test(
            rawMessage,
        );
    const billingProvider = detectErrorBillingProvider(rawMessage, isQuota);
    const openaiBilling = billingProvider === "openai";
    const openrouterBilling = billingProvider === "openrouter";
    const isContextOverflow =
        hasMessage &&
        /context_length_exceeded|context\s*window\s*(?:exceeded|overflow|full|limit)|exceed(?:s|ed)?\s*(?:the\s*)?(?:maximum\s*)?context\s*(?:window|length)|maximum\s*context\s*length|prompt\s*is\s*too\s*long/i.test(
            rawMessage,
        );
    const docsUrl = openrouterBilling
        ? "https://openrouter.ai/settings/credits"
        : openaiBilling
          ? "https://platform.openai.com/settings/organization/billing/"
          : errorDocsUrl(entry.code);
    const isModelBusy = /model_busy|model is busy|high\s*(load|demand)/i.test(rawMessage);
    const isTransient =
        hasMessage &&
        !isQuota &&
        !isContextOverflow &&
        (entry.code === 2100 ||
            /rate\s*limit/i.test(rawMessage) ||
            isModelBusy ||
            /too many requests/i.test(rawMessage));

    let title = entry.title;
    if (hasMessage && isContextOverflow) {
        title = "Context window full";
    } else if (hasMessage && isTransient) {
        title = isModelBusy ? "Model busy" : "Rate limited";
    }

    const hint = !hasMessage
        ? ""
        : isContextOverflow
          ? "This thread has reached the model's context limit. Summarize older turns with /compact to free context and continue."
          : isTransient
            ? isModelBusy
                ? "This model is under heavy load. Wait a moment or switch models."
                : "Try again or switch models."
            : openrouterBilling
              ? "(openrouter.ai) has exhausted its credits. Add credits to continue."
              : openaiBilling
                ? "(api.openai.com) has exhausted its credits. Add credits to continue."
                : entry.description;

    return (
        <AlertDialog
            open={Boolean(message)}
            onOpenChange={(open) => {
                if (!open) onDismiss();
            }}
        >
            <AlertDialogContent sizeClassName="max-w-[400px]">
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription className="sr-only">{hint}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogBody className="flex flex-col text-start">
                    {hint ? (
                        <p className="text-sm leading-snug text-text-secondary">{hint}</p>
                    ) : null}
                </AlertDialogBody>
                <AlertDialogFooter>
                    {isContextOverflow ? (
                        <>
                            <Button
                                type="button"
                                variant="secondary"
                                size="lg"
                                className="w-full bg-panel-hover"
                                onClick={onDismiss}
                            >
                                Dismiss
                            </Button>
                            <AlertDialogAction asChild>
                                <Button
                                    type="button"
                                    size="lg"
                                    className="w-full"
                                    onClick={() => {
                                        window.dispatchEvent(
                                            new CustomEvent("bettershape-chat-insert-prompt", {
                                                detail: { prompt: "/compact", send: true },
                                            }),
                                        );
                                    }}
                                >
                                    Compact context
                                </Button>
                            </AlertDialogAction>
                        </>
                    ) : (
                        <>
                            <Button
                                type="button"
                                variant="secondary"
                                size="lg"
                                className="w-full bg-panel-hover"
                                onClick={() => void commands.openUrlExternal(docsUrl)}
                            >
                                {openaiBilling || openrouterBilling ? "Add credits" : "Learn more"}
                            </Button>
                            {onRetry && isTransient ? (
                                <AlertDialogAction asChild>
                                    <Button type="button" size="lg" className="w-full" onClick={onRetry}>
                                        Try again
                                    </Button>
                                </AlertDialogAction>
                            ) : (
                                <AlertDialogAction asChild>
                                    <Button type="button" size="lg" className="w-full">
                                        OK
                                    </Button>
                                </AlertDialogAction>
                            )}
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
