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

export function ChatErrorDialog({
    message,
    onDismiss,
    onRetry,
}: {
    message: string | null;
    onDismiss: () => void;
    onRetry?: () => void;
}) {
    const entry = classifyAiError(message ?? "");
    const lowerMessage = (message ?? "").toLowerCase();
    const isQuota =
        Boolean(message) &&
        /insufficient_quota|insufficient\s+credits|credit\s+balance\s+is\s+too\s+low|exceeded\s+your\s+current\s+quota|billing_hard_limit|billing\s+limit/i.test(
            message ?? "",
        );
    const openaiBilling =
        Boolean(message) &&
        ((isQuota && lowerMessage.includes("openai")) ||
            lowerMessage.includes("platform.openai.com/account/billing") ||
            lowerMessage.includes("platform.openai.com/settings/organization/billing"));
    const isContextOverflow =
        Boolean(message) &&
        /context_length_exceeded|context\s*window|maximum\s*context\s*length|prompt\s*is\s*too\s*long/i.test(
            message ?? "",
        );
    const docsUrl = openaiBilling
        ? "https://platform.openai.com/settings/organization/billing/"
        : errorDocsUrl(entry.code);
    const isModelBusy = /model_busy|model is busy|high\s*(load|demand)/i.test(message ?? "");
    const isTransient =
        Boolean(message) &&
        !isQuota &&
        !isContextOverflow &&
        (entry.code === 2100 ||
            /rate\s*limit/i.test(message ?? "") ||
            isModelBusy ||
            /too many requests/i.test(message ?? ""));

    const title = !message
        ? entry.title
        : isContextOverflow
          ? "Context window full"
          : isTransient
            ? isModelBusy
                ? "Model busy"
                : "Rate limited"
            : entry.title;

    const hint = !message
        ? ""
        : isContextOverflow
          ? "This thread has reached the model's context limit. Summarize older turns with /compact to free context and continue."
          : isTransient
            ? isModelBusy
                ? "This model is under heavy load. Wait a moment or switch models."
                : "Try again or switch models."
            : openaiBilling || (isQuota && /openai api error/i.test(message))
              ? "(api.openai.com) has exhausted its credits. Add credits to continue."
              : isQuota && /openrouter api error/i.test(message)
                ? "(openrouter.ai) has exhausted its credits. Add credits to continue."
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
                                {openaiBilling ? "Add credits" : "Learn more"}
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
