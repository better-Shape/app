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

const extractErrorUrls = (rawMessage: string): URL[] => {
    const matches = rawMessage.match(/\bhttps?:\/\/[^\s"'<>)\]]+/gi);
    if (!matches) return [];
    const urls: URL[] = [];
    for (const candidate of matches) {
        try {
            urls.push(new URL(candidate));
        } catch {
            /* ignore malformed URL token */
        }
    }
    return urls;
};

const isOpenRouterHostname = (hostname: string): boolean =>
    hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai");

const isOpenRouterBillingUrl = (url: URL): boolean =>
    isOpenRouterHostname(url.hostname) &&
    (url.pathname === "/credits" ||
        url.pathname.startsWith("/credits/") ||
        url.pathname === "/settings/credits" ||
        url.pathname.startsWith("/settings/credits/"));

const isOpenAiBillingUrl = (url: URL): boolean =>
    url.hostname === "platform.openai.com" &&
    (url.pathname === "/account/billing" ||
        url.pathname.startsWith("/account/billing/") ||
        url.pathname === "/settings/organization/billing" ||
        url.pathname.startsWith("/settings/organization/billing/"));

/** Billing provider detected from a raw AI error string (`"openrouter"` takes precedence over `"openai"`). */
export const detectErrorBillingProvider = (
    rawMessage: string,
    isQuota: boolean,
): "openrouter" | "openai" | null => {
    if (!rawMessage) return null;
    const urls = extractErrorUrls(rawMessage);
    const proseWithoutUrls = rawMessage
        .replace(/\bhttps?:\/\/[^\s"'<>)\]]+/gi, " ")
        .toLowerCase();
    const isOpenRouter =
        urls.some(isOpenRouterBillingUrl) ||
        (isQuota &&
            (/\bopenrouter\b/.test(proseWithoutUrls) ||
                urls.some((url) => isOpenRouterHostname(url.hostname))));
    if (isOpenRouter) return "openrouter";
    const isOpenAi =
        urls.some(isOpenAiBillingUrl) ||
        (isQuota &&
            (/\bopenai\b/.test(proseWithoutUrls) ||
                urls.some(
                    (url) =>
                        url.hostname === "api.openai.com" ||
                        url.hostname === "platform.openai.com",
                )));
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
