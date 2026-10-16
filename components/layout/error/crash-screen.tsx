"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight20Regular } from "@fluentui/react-icons/headless/svg/chevron-right";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { submitProblemReport } from "@/lib/feedback/report";
import { redactText } from "@/lib/diagnostics/scrub";

export interface CrashScreenProps {
    /** What failed, in the user's terms: "Something went wrong", "IDE crashed". */
    title: string;
    /** Plain-language line under the headline. Never the exception, which stays folded away. */
    hint: string;
    /** Carried into the report and the details disclosure. Never shown by default. */
    message: string;
    /** React's error digest, when the crash came through an error boundary. */
    digest?: string;
    /** Retry the render that failed. */
    onRetry: () => void;
    /** Restart from scratch when a retry cannot help. */
    onReload: () => void;
    /** Optional stack, carried into the report and shown in the disclosure. */
    stack?: string;
}

/**
 * The screen shown when the app has already failed.
 *
 * Names the next safe action rather than listing every possible one, and keeps the
 * exception off the surface: it is written for a developer, and a crash is the moment a
 * developer is not what the user needs.
 */
export function CrashScreen({ title, hint, message, digest, onRetry, onReload, stack }: CrashScreenProps) {
    const retryRef = useRef<HTMLButtonElement>(null);

    // `autoFocus` does not fire in a boundary that mounts mid-render, so focus is
    // claimed explicitly and only when nothing useful already holds it.
    useEffect(() => {
        const active = document.activeElement;
        const alreadyInteractive =
            active instanceof HTMLElement &&
            active !== document.body &&
            (active.tagName === "BUTTON" || active.tagName === "INPUT" || active.tagName === "A");
        if (!alreadyInteractive) retryRef.current?.focus();
    }, []);

    return (
        <div className="flex h-full flex-1 items-center justify-center bg-background p-8 select-none">
            <div
                role="alert"
                aria-live="assertive"
                className="flex w-full max-w-[26rem] flex-col items-center rounded-3xl border border-border-subtle bg-panel-secondary/60 px-8 py-9 text-center shadow-lg"
            >
                <CrashMark />

                <h1 className="mt-5 text-lg font-semibold tracking-tight text-text-primary">{title}</h1>

                <p className="mt-2 max-w-[22rem] text-sm leading-relaxed text-text-muted text-pretty">{hint}</p>

                {/*
                  * One primary. `Reload IDE` costs the session, so it is an outline. */}
                <div className="mt-7 flex items-center gap-3">
                    <Button ref={retryRef} size="lg" onClick={onRetry} className="min-w-[7.5rem]">
                        Try again
                    </Button>
                    <Button size="lg" variant="outline" onClick={onReload}>
                        Reload IDE
                    </Button>
                </div>

                <ReportBlock
                    title={title}
                    hint={hint}
                    digest={digest}
                    message={message}
                    stack={stack}
                />
            </div>
        </div>
    );
}

interface ReportBlockProps {
    title: string;
    hint: string;
    digest?: string;
    message: string;
    stack?: string;
}

/**
 * Builds the report body. The exception stays out unless the user asks for it, and it
 * goes through the same scrubber the chat reports use: a crash message can carry a path
 * or a token, and a prefilled issue puts the text in a URL.
 */
function reportBody({
    title,
    hint,
    where,
    digest,
    message,
    stack,
    withTechnical,
}: {
    title: string;
    hint: string;
    where: string;
    digest?: string;
    message: string;
    stack?: string;
    withTechnical: boolean;
}): string {
    const technical = withTechnical
        ? ["", "### Error", "```", redactText(message || "no message", 1500), "```", "", "### Stack", "```", redactText(stack ?? "no stack captured", 3000), "```"]
        : [];
    return [`**${title}**`, "", hint, "", "### Where", `- Screen: ${where}`, `- Digest: ${digest ?? "none"}`, ...technical].join("\n");
}

/**
 * Reporting is a sub-feature of the crash screen, not part of its recovery surface, and it
 * owns the state that belongs to it: whether a report is in flight, whether it landed,
 * whether the user asked for the exception, and whether the details are open.
 */
function ReportBlock({ title, hint, digest, message, stack }: ReportBlockProps) {
    const [reporting, setReporting] = useState(false);
    const [reported, setReported] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [attachDetails, setAttachDetails] = useState(false);

    const report = async () => {
        setReporting(true);
        try {
            // Read the location here rather than into state: the report needs to know where
            // the crash happened, and nothing else does.
            const where =
                typeof window === "undefined" ? "unknown" : window.location.pathname + window.location.search;
            await submitProblemReport({
                category: "Crash",
                message: reportBody({ title, hint, where, digest, message, stack, withTechnical: attachDetails }),
            });
            setReported(true);
        } catch {
            // Best-effort: the screen has to stay usable either way, and the details above
            // are selectable for a manual copy.
            setReported(false);
        } finally {
            setReporting(false);
        }
    };

    return (
        <>
            <Button
                size="sm"
                variant="ghost"
                loading={reporting}
                disabled={reported}
                onClick={() => void report()}
                className="mt-4 text-text-muted"
            >
                {reported ? "Report copied" : "Report this crash"}
                {reported ? null : <Icon icon={ChevronRight20Regular} />}
            </Button>

            {/*
              * A labelled native checkbox: the words toggle it, the keyboard reaches it and
              * no handler sits on a non-interactive element. The settings dialogs use the
              * same control for the same kind of secondary option.
              */}
            <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-2xs text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:text-text-primary">
                <input
                    type="checkbox"
                    checked={attachDetails}
                    onChange={(event) => setAttachDetails(event.target.checked)}
                    aria-label="Attach technical details to the report"
                    className="size-3.5 shrink-0 cursor-pointer rounded border border-border-subtle bg-input-bg accent-accent"
                />
                Attach technical details
            </label>

            <p className="mt-1 max-w-[19rem] text-2xs leading-relaxed text-text-disabled">
                Copies a redacted report and opens a prefilled issue. Nothing is sent until you submit it.
                {attachDetails ? " The stack is included and scrubbed." : " The stack stays out."}
            </p>

            {/*
              * Behind a disclosure, so the same information is reachable without sitting
              * between the user and the recovery. */}
            <button
                type="button"
                onClick={() => setDetailsOpen((open) => !open)}
                aria-expanded={detailsOpen}
                className="mt-7 flex items-center gap-1 rounded-md px-2 py-1 text-2xs text-text-disabled transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-muted"
            >
                <Icon
                    icon={ChevronRight20Regular}
                    className={detailsOpen ? "rotate-90 transition-transform" : "transition-transform"}
                    style={{ ["--icon-size" as string]: "12px" }}
                />
                Technical details
            </button>

            {detailsOpen ? (
                <div className="mt-2 w-full rounded-xl border border-border-subtle bg-background/60 p-3 text-left">
                    <p className="text-2xs text-text-muted">Error</p>
                    <pre className="mt-1 max-h-32 overflow-auto font-mono text-2xs leading-relaxed whitespace-pre-wrap text-text-secondary select-text">
                        {message || "An unexpected application error occurred."}
                    </pre>
                    {digest ? (
                        <p className="mt-2 text-2xs text-text-disabled">
                            Digest <span className="font-mono select-text">{digest}</span>
                        </p>
                    ) : null}
                    {stack ? (
                        <>
                            {/*
                              * The report carries the stack, so this is where a user
                              * checks it, and where they fall back to copying it by hand
                              * when the report cannot open. Scrubbed the same way the
                              * report scrubs it, so what is read is what is sent.
                              */}
                            <p className="mt-3 text-2xs text-text-muted">Stack, scrubbed</p>
                            <pre className="mt-1 max-h-40 overflow-auto font-mono text-2xs leading-relaxed whitespace-pre-wrap text-text-disabled select-text">
                                {redactText(stack, 3000)}
                            </pre>
                        </>
                    ) : null}
                </div>
            ) : null}
        </>
    );
}

/** A window whose panel edge has come away. Drawn in the app's panel vocabulary. */
function CrashMark() {
    return (
        <svg viewBox="0 0 24 24" className="size-14" aria-hidden focusable="false">
            {/*
             * Two shapes, no seam. A dashed seam collapses into texture at a 24px
             * render, so the right edge is genuinely missing instead.
             */}
            <path
                d="M17 9.7A2.2 2.2 0 0 0 14.8 7.5H4.7A2.2 2.2 0 0 0 2.5 9.7v4.6A2.2 2.2 0 0 0 4.7 16.5h10.1A2.2 2.2 0 0 0 17 14.3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                className="text-text-disabled"
            />
            {/*
             * The only coloured element, and it spans the edge it left. The frame is
             * landscape because a near-square one reads as a camera below 32px.
             */}
            <rect x="19.4" y="9.2" width="1.9" height="6.6" rx="0.95" className="text-error" fill="currentColor" />
        </svg>
    );
}
