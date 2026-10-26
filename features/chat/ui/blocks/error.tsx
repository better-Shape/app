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
import {
    BETTERSHAPE_ERRORS,
    classifyAiError,
    errorDocsUrl,
} from "@/lib/errors/catalog";
import { commands } from "@/lib/backend";

const QUOTA_ERROR_RE =
    /insufficient_quota|insufficient\s+credits|credit\s+balance\s+is\s+too\s+low|exceeded\s+your\s+current\s+quota|billing_hard_limit|billing\s+limit/i;
const CONTEXT_OVERFLOW_RE =
    /context_length_exceeded|context\s*window\s*(?:exceeded|overflow|full|limit)|exceed(?:s|ed)?\s*(?:the\s*)?(?:maximum\s*)?context\s*(?:window|length)|maximum\s*context\s*length|prompt\s*is\s*too\s*long/i;
const MODEL_BUSY_RE = /model_busy|model is busy|high\s*(load|demand)/i;
const RATE_LIMIT_RE = /rate\s*limit|too many requests/i;

const OPENROUTER_BILLING_PREFIXES = [
    "/credits",
    "/credits/",
    "/settings/credits",
    "/settings/credits/",
];

const OPENAI_BILLING_PREFIXES = [
    "/account/billing",
    "/account/billing/",
    "/settings/organization/billing",
    "/settings/organization/billing/",
];

const OPENAI_HOSTNAMES = new Set(["api.openai.com", "platform.openai.com"]);

const BILLING_DOCS_URLS: Partial<Record<string, string>> = {
    openrouter: "https://openrouter.ai/settings/credits",
    openai: "https://platform.openai.com/settings/organization/billing/",
};

const BILLING_HINTS: Partial<Record<string, string>> = {
    openrouter:
        "(openrouter.ai) has exhausted its credits. Add credits to continue.",
    openai:
        "(api.openai.com) has exhausted its credits. Add credits to continue.",
};

/** Parses HTTP(S) URLs embedded in a raw AI error string. */
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

/** Checks whether `pathname` equals an exact route or starts with a trailing-slash prefix. */
const matchesRoutePrefixList = (
    pathname: string,
    prefixes: readonly string[],
): boolean =>
    prefixes.some((prefix) =>
        prefix.endsWith("/")
            ? pathname.startsWith(prefix)
            : pathname === prefix,
    );

/** Checks whether `hostname` belongs to OpenRouter (`openrouter.ai` or subdomains). */
const isOpenRouterHostname = (hostname: string): boolean =>
    hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai");

/** Checks whether `url` points to an OpenRouter credits/billing management page. */
const isOpenRouterBillingUrl = (url: URL): boolean =>
    isOpenRouterHostname(url.hostname) &&
    matchesRoutePrefixList(url.pathname, OPENROUTER_BILLING_PREFIXES);

/** Checks whether `url` points to an OpenAI organization billing page. */
const isOpenAiBillingUrl = (url: URL): boolean =>
    url.hostname === "platform.openai.com" &&
    matchesRoutePrefixList(url.pathname, OPENAI_BILLING_PREFIXES);

/** Checks whether a quota error references OpenRouter by prose or hostname. */
const matchesOpenRouterQuota = (
    urls: URL[],
    proseWithoutUrls: string,
): boolean =>
    /\bopenrouter\b/.test(proseWithoutUrls) ||
    urls.some((url) => isOpenRouterHostname(url.hostname));

/** Checks whether a quota error references OpenAI by prose or API/platform hostname. */
const matchesOpenAiQuota = (urls: URL[], proseWithoutUrls: string): boolean =>
    /\bopenai\b/.test(proseWithoutUrls) ||
    urls.some((url) => OPENAI_HOSTNAMES.has(url.hostname));

/** Checks whether URLs or quota prose identify OpenRouter billing exhaustion. */
const isOpenRouterBillingError = (
    urls: URL[],
    proseWithoutUrls: string,
    isQuota: boolean,
): boolean =>
    urls.some(isOpenRouterBillingUrl) ||
    (isQuota && matchesOpenRouterQuota(urls, proseWithoutUrls));

/** Checks whether URLs or quota prose identify OpenAI billing exhaustion. */
const isOpenAiBillingError = (
    urls: URL[],
    proseWithoutUrls: string,
    isQuota: boolean,
): boolean =>
    urls.some(isOpenAiBillingUrl) ||
    (isQuota && matchesOpenAiQuota(urls, proseWithoutUrls));

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
    if (isOpenRouterBillingError(urls, proseWithoutUrls, isQuota)) {
        return "openrouter";
    }
    return isOpenAiBillingError(urls, proseWithoutUrls, isQuota)
        ? "openai"
        : null;
};

/** Checks whether a raw message matches transient rate-limit / model-busy codes or patterns. */
const matchesTransientSignal = (
    rawMessage: string,
    code: number,
    isModelBusy: boolean,
): boolean =>
    code === 2100 || isModelBusy || RATE_LIMIT_RE.test(rawMessage);

/** Checks whether a classified error represents a retryable rate-limit or model-busy condition. */
const isTransientChatError = (
    rawMessage: string,
    code: number,
    isQuota: boolean,
    isContextOverflow: boolean,
    isModelBusy: boolean,
): boolean => {
    if (!rawMessage || isQuota || isContextOverflow) return false;
    return matchesTransientSignal(rawMessage, code, isModelBusy);
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

/** Resolves the fallback non-transient hint from billing provider or catalog description. */
const resolveNonTransientErrorHint = (
    billingProvider: string | null,
    defaultDescription: string,
): string => {
    const billingHint = billingProvider
        ? BILLING_HINTS[billingProvider]
        : undefined;
    return billingHint ?? defaultDescription;
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
    return resolveNonTransientErrorHint(billingProvider, defaultDescription);
};

const SECRET_ASSIGNMENT_RE =
    /(["']?\b(?:api[_-]?key|access[_-]?token|secret[_-]?key|authorization|x-api-key)\b["']?[ \t]*[:=][ \t]*["']?)(?:(?:Bearer|Basic)[ \t]+[A-Za-z0-9._~+/=-]{4,}|[A-Za-z0-9._~+/=-]{8,})/giu;
const BEARER_TOKEN_RE = /\bBearer[ \t]+[A-Za-z0-9._~+/=-]{8,}/giu;
const BASIC_TOKEN_CANDIDATE_RE = /\b(Basic[ \t]+)([A-Za-z0-9+/=_-]{4,})\b/gu;
const URL_AUTHORITY_RE = /\b(https?:\/\/)([^\s/?#"']+)/giu;
const QUERY_SECRET_RE =
    /([?&](?:api[_-]?key|key|token|access_token)=)[^&\s"']+/giu;
const KNOWN_KEY_PREFIX_RE =
    /\b(?:(?:sk|xai|pplx|csk|nvapi|tvly)-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{16,}|dapi[0-9a-f]{16,}|BSA[0-9A-Za-z_-]{16,}|(?:tgp_v1|doo_v1|oc_sk|VENICE_INFERENCE_KEY|llmgtwy|kilo|vck|sk|rk|pk|gsk|csk|nvapi|hf|r8|fw)_[A-Za-z0-9_-]{8,})\b/gu;

/** Redacts `user:password@host` credentials inside an HTTP(S) URL authority span. */
const redactAuthorityCredentials = (authority: string): string => {
    const atIdx = authority.indexOf("@");
    if (atIdx <= 0) return authority;
    const colonIdx = authority.indexOf(":");
    if (colonIdx <= 0 || colonIdx >= atIdx) return authority;
    return `${authority.slice(0, colonIdx + 1)}[REDACTED]${authority.slice(atIdx)}`;
};

/** Decodes a standard/URL-safe base64 token, returning `""` when malformed. */
const safeDecodeBase64 = (token: string): string => {
    const std = token.replace(/-/gu, "+").replace(/_/gu, "/");
    if (std.length % 4 !== 0 || typeof atob !== "function") return "";
    try {
        return atob(std);
    } catch {
        return "";
    }
};

/** Checks whether `token` is an RFC 7617 `user:pass` base64 credential or opaque secret token. */
const isBasicAuthCredentialToken = (token: string): boolean => {
    const decoded = safeDecodeBase64(token);
    if (decoded.includes(":") && /^[ -~]+$/u.test(decoded)) return true;
    return token.length >= 8 && /[0-9+/=_-]/u.test(token);
};

/** Redacts echoed bearer/basic tokens, URL credentials, API keys, and query secrets from error details. */
export const redactErrorSecrets = (raw: string): string =>
    raw
        .replace(SECRET_ASSIGNMENT_RE, "$1[REDACTED]")
        .replace(BEARER_TOKEN_RE, "Bearer [REDACTED]")
        .replace(BASIC_TOKEN_CANDIDATE_RE, (full, prefix: string, token: string) =>
            isBasicAuthCredentialToken(token) ? `${prefix}[REDACTED]` : full,
        )
        .replace(
            URL_AUTHORITY_RE,
            (_full, scheme: string, authority: string) =>
                `${scheme}${redactAuthorityCredentials(authority)}`,
        )
        .replace(QUERY_SECRET_RE, "$1[REDACTED]")
        .replace(KNOWN_KEY_PREFIX_RE, "[REDACTED]");

/** Extracts sanitized diagnostic detail when distinct from `title` and `hint` so provider messages stay visible. */
const resolveChatErrorDetail = (
    rawMessage: string,
    title: string,
    hint: string,
): string => {
    const trimmed = redactErrorSecrets(rawMessage.trim());
    if (!trimmed || trimmed === title || trimmed === hint) return "";
    return hint.includes(trimmed) ? "" : trimmed;
};

/** Resolves the billing or error-catalog documentation URL for `ChatErrorDialog`. */
const resolveChatErrorDocsUrl = (
    billingProvider: string | null,
    code: number,
): string => {
    const billingUrl = billingProvider
        ? BILLING_DOCS_URLS[billingProvider]
        : undefined;
    return billingUrl ?? errorDocsUrl(code);
};

/** Checks whether `ChatErrorDialog` should expose `onRetry` ("Try again") for a classified error. */
const isRetryableChatError = (
    code: number,
    isQuota: boolean,
    isContextOverflow: boolean,
): boolean =>
    !isQuota &&
    !isContextOverflow &&
    code !== BETTERSHAPE_ERRORS.AI_KEY_MISSING;

/** Computes title, hint, detail, docs link, and action flags for `ChatErrorDialog`. */
const deriveChatErrorViewModel = (rawMessage: string) => {
    const hasMessage = rawMessage.length > 0;
    const entry = classifyAiError(rawMessage);
    const isQuota = hasMessage && QUOTA_ERROR_RE.test(rawMessage);
    const billingProvider = detectErrorBillingProvider(rawMessage, isQuota);
    const isContextOverflow = hasMessage && CONTEXT_OVERFLOW_RE.test(rawMessage);
    const isModelBusy = MODEL_BUSY_RE.test(rawMessage);
    const isTransient = isTransientChatError(
        rawMessage,
        entry.code,
        isQuota,
        isContextOverflow,
        isModelBusy,
    );
    const title = resolveChatErrorTitle(
        entry.title,
        hasMessage,
        isContextOverflow,
        isTransient,
        isModelBusy,
    );
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
        canRetry: isRetryableChatError(entry.code, isQuota, isContextOverflow),
        hasBillingProvider: Boolean(billingProvider),
        docsUrl: resolveChatErrorDocsUrl(billingProvider, entry.code),
    };
};

/** Dispatches the `/compact` prompt command from the context-overflow error dialog. */
const dispatchCompactContextAction = (): void => {
    window.dispatchEvent(
        new CustomEvent("bettershape-chat-insert-prompt", {
            detail: { prompt: "/compact", send: true },
        }),
    );
};

/** Renders the footer actions for context-window-overflow errors. */
const ContextOverflowFooter = ({ onDismiss }: { onDismiss: () => void }) => (
    <div className="contents">
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
                onClick={dispatchCompactContextAction}
            >
                Compact context
            </Button>
        </AlertDialogAction>
    </div>
);

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
        return <ContextOverflowFooter onDismiss={onDismiss} />;
    }
    const secondaryLabel = view.hasBillingProvider ? "Add credits" : "Learn more";
    const retryHandler = view.canRetry ? onRetry : undefined;
    return (
        <div className="contents">
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
                <Button
                    type="button"
                    size="lg"
                    className="w-full"
                    onClick={retryHandler}
                >
                    {retryHandler ? "Try again" : "OK"}
                </Button>
            </AlertDialogAction>
        </div>
    );
};

/** Builds the screen-reader description combining generic hint and raw provider error detail. */
const buildAccessibleErrorDescription = (hint: string, detail: string): string =>
    [hint, detail].filter(Boolean).join(" ");

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
                    <AlertDialogDescription className="sr-only">
                        {buildAccessibleErrorDescription(view.hint, view.detail)}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogBody className="flex flex-col gap-2 text-start">
                    {view.hint ? (
                        <p className="text-sm leading-snug text-text-secondary">
                            {view.hint}
                        </p>
                    ) : null}
                    {view.detail ? (
                        <p className="max-h-28 overflow-y-auto rounded-md border border-border-subtle bg-surface-1 px-2.5 py-1.5 font-mono text-2xs leading-relaxed text-text-muted break-words">
                            {view.detail}
                        </p>
                    ) : null}
                </AlertDialogBody>
                <AlertDialogFooter>
                    <ChatErrorDialogFooter
                        view={view}
                        onDismiss={onDismiss}
                        onRetry={onRetry}
                    />
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
