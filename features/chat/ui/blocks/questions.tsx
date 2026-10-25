"use client";

import { Attach20Regular } from "@fluentui/react-icons/headless/svg/attach";
import { ChevronLeft20Regular } from "@fluentui/react-icons/headless/svg/chevron-left";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";
import { Dismiss20Regular } from "@fluentui/react-icons/headless/svg/dismiss";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { DrawnCheck } from "@/components/ui/checkmark";
import { SwapText } from "@/components/ui/swap";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAutoFocusRef } from "@/lib/ui/use-auto-focus-ref";
import { commands } from "@/lib/backend/commands";
import { notificationStore } from "@/features/notifications";

export type QuestionOption = {
    id: string;
    label: string;
    description?: string;
    recommended?: boolean;
};

export type AgentQuestion = {
    id: string;
    prompt: string;
    options: QuestionOption[];
    allowMultiple?: boolean;
};

export type QuestionAnswers = Record<string, string | string[]>;

export function parseQuestionsPayload(raw: string): {
    questions: AgentQuestion[];
    answers?: QuestionAnswers | null;
} {
    try {
        const parsed = JSON.parse(raw) as {
            questions?: AgentQuestion[];
            answers?: QuestionAnswers | null;
        };
        const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
        return { questions, answers: parsed.answers ?? null };
    } catch {
        return { questions: [], answers: null };
    }
}

function formatAnswer(q: AgentQuestion, value: string | string[] | undefined): string {
    if (value == null) return "Skipped";
    const ids = Array.isArray(value) ? value : [value];
    if (ids.length === 0) return "Skipped";
    return ids
        .map((id) => {
            const opt = q.options.find((o) => o.id === id);
            return opt?.label || id;
        })
        .join(", ");
}

function isOptionSelected(value: string | string[] | undefined, optionId: string): boolean {
    if (Array.isArray(value)) return value.includes(optionId);
    return value === optionId;
}

export function QuestionsCard({
    askId,
    status,
    questions,
    answers: initialAnswers,
}: {
    askId?: string;
    status?: string;
    questions: AgentQuestion[];
    answers?: QuestionAnswers | null;
}) {
    const pending = status === "pending" && Boolean(askId);
    const [index, setIndex] = useState(0);
    const [picked, setPicked] = useState<QuestionAnswers>(initialAnswers || {});
    const [customOpen, setCustomOpen] = useState(false);
    const [customText, setCustomText] = useState("");
    const customInputRef = useAutoFocusRef<HTMLInputElement>();
    const [submitting, setSubmitting] = useState(false);

    const cardRef = React.useRef<HTMLDivElement>(null);
    const total = Math.max(questions.length, 1);
    const current = questions.at(index);
    const skipped = status === "skipped";
    const answered = status === "answered" || skipped || (!pending && Boolean(initialAnswers));

    // New saved answers replace the picks shown. Compared during render.
    const [seenAnswers, setSeenAnswers] = useState(initialAnswers);
    if (initialAnswers !== seenAnswers) {
        setSeenAnswers(initialAnswers);
        if (initialAnswers) setPicked(initialAnswers);
    }

    const recap = useMemo(() => {
        if (!answered && pending) return null;
        const effectiveAnswers = skipped ? (initialAnswers ?? {}) : (initialAnswers || picked);
        return questions.map((q) => ({
            id: q.id,
            prompt: q.prompt,
            answer: formatAnswer(q, effectiveAnswers[q.id]),
        }));
    }, [answered, pending, skipped, questions, initialAnswers, picked]);

    const submit = useCallback(
        async (next: QuestionAnswers, isSkipped = false) => {
            if (!askId || submitting) return;
            setSubmitting(true);
            try {
                await commands.answerAskUser(askId, JSON.stringify(next), isSkipped);
            } catch (err) {
                setSubmitting(false);
                const detail =
                    err instanceof Error && err.message
                        ? err.message
                        : "Could not submit your response. Please try again.";
                notificationStore.add(detail, "error");
            }
        },
        [askId, submitting],
    );

    const advanceOrSubmit = useCallback(
        (next: QuestionAnswers) => {
            if (index < questions.length - 1) {
                setIndex(index + 1);
                return;
            }
            void submit(next);
        },
        [index, questions.length, submit],
    );

    const selectOption = useCallback(
        (option: QuestionOption) => {
            if (!current || !pending || submitting) return;
            if (current.allowMultiple) {
                setPicked((prev) => {
                    const prevVal = prev[current.id];
                    const prevList = Array.isArray(prevVal)
                        ? prevVal
                        : typeof prevVal === "string" && prevVal
                          ? [prevVal]
                          : [];
                    const nextList = prevList.includes(option.id)
                        ? prevList.filter((id) => id !== option.id)
                        : [...prevList, option.id];
                    return { ...prev, [current.id]: nextList };
                });
                return;
            }
            const next = { ...picked, [current.id]: option.id };
            setPicked(next);
            setCustomOpen(false);
            advanceOrSubmit(next);
        },
        [current, pending, submitting, picked, advanceOrSubmit],
    );

    useEffect(() => {
        if (!pending || submitting || customOpen || !current) return undefined;
        const onKey = (e: KeyboardEvent) => {
            if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const target = e.target instanceof Element ? e.target : null;
            if (
                target?.closest(
                    "textarea, input, select, [contenteditable='true'], [role='menu'], [role='dialog']",
                )
            ) {
                return;
            }
            const cardEl = cardRef.current;
            const activeEl = document.activeElement instanceof Element ? document.activeElement : null;
            const focusInsideCard = Boolean(cardEl && activeEl && cardEl.contains(activeEl));
            if (!focusInsideCard && activeEl && activeEl !== document.body && activeEl !== document.documentElement) {
                if (
                    activeEl.closest(
                        "button, a, input, textarea, select, [role='button'], [role='tab'], [role='menuitem'], [role='option'], [role='dialog'], [contenteditable='true'], [tabindex]:not([tabindex='-1'])",
                    )
                ) {
                    return;
                }
            }
            if (/^[1-9]$/.test(e.key)) {
                const optIdx = Number(e.key) - 1;
                const opt = current.options.at(optIdx);
                if (opt) {
                    e.preventDefault();
                    selectOption(opt);
                }
            } else if (
                e.key === "Enter" &&
                current.allowMultiple &&
                Array.isArray(picked[current.id]) &&
                (picked[current.id] as string[]).length > 0
            ) {
                e.preventDefault();
                advanceOrSubmit(picked);
            } else if (e.key === "ArrowLeft" && index > 0) {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === "ArrowRight" && index < questions.length - 1) {
                e.preventDefault();
                setIndex((i) => Math.min(questions.length - 1, i + 1));
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [pending, submitting, customOpen, current, index, questions.length, picked, selectOption, advanceOrSubmit]);

    function submitCustom() {
        if (!current || !pending) return;
        const text = customText.trim();
        if (!text) return;
        const value = current.allowMultiple
            ? [
                  ...(Array.isArray(picked[current.id]) ? (picked[current.id] as string[]) : []),
                  text,
              ]
            : text;
        const next = { ...picked, [current.id]: value };
        setPicked(next);
        setCustomOpen(false);
        setCustomText("");
        advanceOrSubmit(next);
    }

    if (!questions.length) return null;

    if (answered && recap) {
        return (
            <div className="my-2 overflow-hidden rounded-xl border border-border-subtle bg-surface-3 p-3">
                <div className="flex flex-col gap-2.5">
                    {recap.map((row) => (
                        <div key={row.id} className="flex items-start gap-2 min-w-0">
                            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-success">
                                <DrawnCheck motion="compact" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="whitespace-pre-line text-[13px] leading-snug text-text-secondary">
                                    {row.prompt}
                                </p>
                                <p className="mt-0.5 whitespace-pre-line text-[13px] font-medium leading-snug text-text-primary">
                                    {row.answer}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (!current) return null;

    const currentSelection = picked[current.id];
    const selectedMultiCount = Array.isArray(currentSelection) ? currentSelection.length : 0;

    return (
        <div
            ref={cardRef}
            tabIndex={-1}
            data-pending-approval={pending && !submitting ? "true" : undefined}
            data-pending-approval-kind={pending && !submitting ? "question" : undefined}
            className="my-2 overflow-hidden rounded-xl border border-border-subtle bg-surface-3 outline-none"
        >
            <div data-find-skip className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-text-muted">
                <div className="flex items-center gap-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-[24px] text-text-muted hover:text-text-primary enabled:active:scale-[0.95]"
                        disabled={index <= 0}
                        aria-label="Previous question"
                        onClick={() => {
                            setCustomOpen(false);
                            setIndex((i) => Math.max(0, i - 1));
                        }}
                    >
                        <Icon icon={ChevronLeft20Regular} />
                    </Button>
                    <span className="min-w-[2.5rem] text-center text-xs tabular-nums">
                        <SwapText value={`${index + 1}/${total}`} />
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-[24px] text-text-muted hover:text-text-primary enabled:active:scale-[0.95]"
                        disabled={index >= questions.length - 1}
                        aria-label="Next question"
                        onClick={() => {
                            setCustomOpen(false);
                            setIndex((i) => Math.min(questions.length - 1, i + 1));
                        }}
                    >
                        <Icon icon={ChevronRight20Regular} />
                    </Button>
                </div>
                <Tooltip content="Skip questions">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-[24px] text-text-muted hover:text-text-primary enabled:active:scale-[0.95]"
                        aria-label="Skip questions"
                        disabled={!pending || submitting}
                        onClick={() => void submit(picked, true)}
                    >
                        <Icon icon={Dismiss20Regular} />
                    </Button>
                </Tooltip>
            </div>

            <div className="px-3 pb-2.5">
                <p className="whitespace-pre-line text-[13px] font-medium leading-snug text-text-primary">
                    {current.prompt}
                </p>
                {current.allowMultiple ? (
                    <p className="mt-0.5 text-xs text-text-muted">Select all that apply</p>
                ) : null}
                <div className="mt-2 flex max-h-60 flex-col gap-0.5 overflow-y-auto custom-scrollbar">
                    {current.options.map((opt, i) => {
                        const selected = isOptionSelected(currentSelection, opt.id);
                        return (
                            <button
                                key={opt.id}
                                type="button"
                                aria-pressed={current.allowMultiple ? selected : undefined}
                                disabled={!pending || submitting}
                                onClick={() => selectOption(opt)}
                                className={cn(
                                    "group/opt flex min-h-[28px] items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] leading-snug",
                                    "transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] motion-reduce:transform-none motion-reduce:transition-none",
                                    "text-text-secondary hover:bg-[var(--row-hover)] hover:text-text-primary enabled:active:scale-[0.985]",
                                    selected && "bg-[var(--row-selected)] text-text-primary hover:bg-[var(--row-selected-hover)]",
                                    (!pending || submitting) && "cursor-default",
                                )}
                            >
                                <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-border-subtle bg-surface-2 text-[11px] tabular-nums text-text-muted group-hover/opt:border-border-secondary group-hover/opt:text-text-secondary">
                                    {selected ? <DrawnCheck motion="compact" /> : i + 1}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block whitespace-pre-line">{opt.label}</span>
                                    {opt.description ? (
                                        <span className="mt-0.5 block whitespace-pre-line text-xs text-text-muted">
                                            {opt.description}
                                        </span>
                                    ) : null}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-3 py-2">
                {customOpen ? (
                    <form
                        className="flex w-full items-center gap-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            submitCustom();
                        }}
                    >
                        <input
                            ref={customInputRef}
                            value={customText}
                            onChange={(e) => setCustomText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    submitCustom();
                                    return;
                                }
                                if (e.key === "Escape") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setCustomOpen(false);
                                }
                            }}
                            placeholder="Type your answer... (Esc to cancel)"
                            className="h-7 min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface-1 px-2.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-border-secondary"
                        />
                        <Button type="submit" size="sm" className="h-7 px-2.5 text-xs" disabled={!customText.trim()}>
                            Send
                        </Button>
                    </form>
                ) : (
                    <>
                        <button
                            type="button"
                            disabled={!pending || submitting}
                            onClick={() => setCustomOpen(true)}
                            className="flex min-h-[24px] items-center gap-2 rounded-md px-1 py-0.5 -ml-1 text-[13px] text-text-secondary transition-[background-color,color,transform] duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--row-hover)] hover:text-text-primary enabled:active:scale-[0.98]"
                        >
                            <Icon icon={Attach20Regular} className="text-text-muted" />
                            Something else
                        </button>
                        {current.allowMultiple ? (
                            <Button
                                type="button"
                                size="sm"
                                disabled={!pending || submitting || selectedMultiCount === 0}
                                onClick={() => advanceOrSubmit(picked)}
                                className="h-7 px-2.5 text-xs"
                            >
                                {index < questions.length - 1 ? "Next" : "Submit"}
                                {selectedMultiCount > 0 ? ` (${selectedMultiCount})` : ""}
                            </Button>
                        ) : null}
                    </>
                )}
            </div>
        </div>
    );
}
