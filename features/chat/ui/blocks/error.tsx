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

/** Extract error urls. */
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

/** Is open router hostname. */
const isOpenRouterHostname = (hostname: string): boolean =>
    hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai");

/** Is open router billing url. */
const isOpenRouterBillingUrl = (url: URL): boolean =>
    isOpenRouterHostname(url.hostname) &&
    (url.pathname === "/credits" ||
        url.pathname.startsWith("/credits/") ||
        url.pathname === "/settings/credits" ||
        url.pathname.startsWith("/settings/credits/"));

/** Is open ai billing url. */
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

const QUOTA_ERROR_RE =
    /insufficient_quota|insufficient\s+credits|credit\s+balance\s+is\s+too\s+low|exceeded\s+your\s+current\s+quota|billing_hard_limit|billing\s+limit/i;
const CONTEXT_OVERFLOW_RE =
    /context_length_exceeded|context\s*window\s*(?:exceeded|overflow|full|limit)|exceed(?:s|ed)?\s*(?:the\s*)?(?:maximum\s*)?context\s*(?:window|length)|maximum\s*context\s*length|prompt\s*is\s*too\s*long/i;
const MODEL_BUSY_RE = /model_busy|model is busy|high\s*(load|demand)/i;
const RATE_LIMIT_RE = /rate\s*limit|too many requests/i;

const BILLING_DOCS_URLS: Record<string, string> = {
    openrouter: "https://openrouter.ai/settings/credits",
    openai: "https://platform.openai.com/settings/organization/billing/",
};

const BILLING_HINTS: Record<string, string> = {
    openrouter: "(openrouter.ai) has exhausted its credits. Add credits to continue.",
    openai: "(api.openai.com) has exhausted its credits. Add credits to continue.",
};

/** Checks whether a classified error represents a retryable rate-limit or model-busy condition. */
const isTransientChatError = (
    rawMessage: string,
    code: number,
    isQuota: boolean,
    isContextOverflow: boolean,
    isModelBusy: boolean,
): boolean => {
    if (!rawMessage || isQuota || isContextOverflow) return false;
    return code === 2100 || isModelBusy || RATE_LIMIT_RE.test(rawMessage);
};

/** Resolves the primary dialog title for a classified chat error. */
const resolveChatErrorTitle = (
    fallbackTitle: string,
    hasMessage: boolean,
    isContextOverflow: boolean,
    isTransient: boolean,
    isModelBusy: boolean,
): string => {
    if (!hasMessage) return fallbackTitle;
    if (isContextOverflow) return "Context window full";
    if (!isTransient) return fallbackTitle;
    return isModelBusy ? "Model busy" : "Rate limited";
};

/** Resolves the explanatory hint text for a classified chat error. */
const resolveChatErrorHint = ({
    hasMessage,
    isContextOverflow,
    isTransient,
    isModelBusy,
    billingProvider,
    defaultDescription,
}: {
    hasMessage: boolean;
    isContextOverflow: boolean;
    isTransient: boolean;
    isModelBusy: boolean;
    billingProvider: string | null;
    defaultDescription: string;
}): string => {
    if (!hasMessage) return "";
    if (isContextOverflow) {
        return "This thread has reached the model's context limit. Summarize older turns with /compact to free context and continue.";
    }
    if (isTransient) {
        return isModelBusy
            ? "This model is under heavy load. Wait a moment or switch models."
            : "Try again or switch models.";
    }
    return (billingProvider ? BILLING_HINTS[billingProvider] : undefined) ?? defaultDescription;
};

/** Extracts raw diagnostic detail when distinct from `title` and `hint`. */
const resolveChatErrorDetail = (rawMessage: string, title: string, hint: string): string => {
    const trimmed = rawMessage.trim();
    if (!trimmed || trimmed === title || trimmed === hint) return "";
    return hint.includes(trimmed) ? "" : trimmed;
};

/** Computes title, hint, detail, docs link, and action flags for `ChatErrorDialog`. */
const deriveChatErrorViewModel = (rawMessage: string) => {
    const hasMessage = rawMessage.length > 0;
    const entry = classifyAiError(rawMessage);
    const isQuota = hasMessage && QUOTA_ERROR_RE.test(rawMessage);
    const billingProvider = detectErrorBillingProvider(rawMessage, isQuota);
    const isContextOverflow = hasMessage && CONTEXT_OVERFLOW_RE.test(rawMessage);
    const isModelBusy = MODEL_BUSY_RE.test(rawMessage);
    const isTransient = isTransientChatError(rawMessage, entry.code, isQuota, isContextOverflow, isModelBusy);
    const title = resolveChatErrorTitle(entry.title, hasMessage, isContextOverflow, isTransient, isModelBusy);
    const hint = resolveChatErrorHint({
        hasMessage,
        isContextOverflow,
        isTransient,
        isModelBusy,
        billingProvider,
        defaultDescription: entry.description,
    });
    return {
        title,
        hint,
        detail: resolveChatErrorDetail(rawMessage, title, hint),
        isContextOverflow,
        isTransient,
        hasBillingProvider: Boolean(billingProvider),
        docsUrl: (billingProvider ? BILLING_DOCS_URLS[billingProvider] : undefined) ?? errorDocsUrl(entry.code),
    };
};

/** Renders the action footer buttons for `ChatErrorDialog`. */
const ChatErrorDialogFooter = ({
    view,
    onDismiss,
    onRetry,
}: {
    view: ReturnType<typeof deriveChatErrorViewModel>;
    onDismiss: () => void;
    onRetry?: () => void;
}) => {
    if (view.isContextOverflow) {
        return (
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
        );
    }
    const secondaryLabel = view.hasBillingProvider ? "Add credits" : "Learn more";
    const canRetry = Boolean(onRetry) && view.isTransient;
    return (
        <>
            <Button
                type="button"
                variant="secondary"
                size="lg"
                className="w-full bg-panel-hover"
                onClick={() => {
                    commands.openUrlExternal(view.docsUrl).catch(() => undefined);
                }}
            >
                {secondaryLabel}
            </Button>
            <AlertDialogAction asChild>
                <Button type="button" size="lg" className="w-full" onClick={canRetry ? onRetry : undefined}>
                    {canRetry ? "Try again" : "OK"}
                </Button>
            </AlertDialogAction>
        </>
    );
};

/** Renders the ChatErrorDialog UI component. */
export const ChatErrorDialog = ({
    message,
    onDismiss,
    onRetry,
}: {
    message: string | null;
    onDismiss: () => void;
    onRetry?: () => void;
}) => {
    const view = deriveChatErrorViewModel(message ?? "");

    return (
        <AlertDialog
            open={Boolean(message)}
            onOpenChange={(open) => {
                if (!open) onDismiss();
            }}
        >
            <AlertDialogContent sizeClassName="max-w-[400px]">
                <AlertDialogHeader>
                    <AlertDialogTitle>{view.title}</AlertDialogTitle>
                    <AlertDialogDescription className="sr-only">{view.hint || view.detail}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogBody className="flex flex-col gap-2 text-start">
                    {view.hint ? (
                        <p className="text-sm leading-snug text-text-secondary">{view.hint}</p>
                    ) : null}
                    {view.detail ? (
                        <p className="max-h-28 overflow-y-auto rounded-md border border-border-subtle bg-surface-1 px-2.5 py-1.5 font-mono text-2xs leading-relaxed text-text-muted break-words">
                            {view.detail}
                        </p>
                    ) : null}
                </AlertDialogBody>
                <AlertDialogFooter>
                    <ChatErrorDialogFooter view={view} onDismiss={onDismiss} onRetry={onRetry} />
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
