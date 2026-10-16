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
 * Whether the document already has a keyboard affordance worth keeping.
 *
 * A boundary can mount while the pointer or the keyboard is already on a control in the
 * page around it, and moving focus then throws the user out of what they were doing.
 */
const holdsFocus = (node: Element | null): boolean =>
    node instanceof HTMLElement &&
    node !== document.body &&
    (node.tagName === "BUTTON" || node.tagName === "INPUT" || node.tagName === "A");

/**
 * The screen shown when the app has already failed.
 *
 * Names the next safe action rather than listing every possible one, and keeps the
 * exception off the surface: it is written for a developer, and a crash is the moment a
 * developer is not what the user needs.
 */
export const CrashScreen = ({ title, hint, message, digest, onRetry, onReload, stack }: CrashScreenProps) => {
    const retryRef = useRef<HTMLButtonElement>(null);

    // `autoFocus` does not fire in a boundary that mounts mid-render, so focus is
    // claimed explicitly and only when nothing useful already holds it.
    useEffect(() => {
        if (!holdsFocus(document.activeElement)) retryRef.current?.focus();
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

                <ReportBlock title={title} hint={hint} digest={digest} message={message} stack={stack} />
            </div>
        </div>
    );
};

interface ReportBlockProps {
    title: string;
    hint: string;
    digest?: string;
    message: string;
    stack?: string;
}

/** The exception and its stack, both scrubbed, as the fenced blocks the report carries. */
const technicalSection = (message: string, stack?: string): string[] => [
    "",
    "### Error",
    "```",
    redactText(message || "no message", 1500),
    "```",
    "",
    "### Stack",
    "```",
    redactText(stack ?? "no stack captured", 3000),
    "```",
];

/**
 * Builds the report body. The exception stays out unless the user asks for it, and it
 * goes through the same scrubber the chat reports use: a crash message can carry a path
 * or a token, and a prefilled issue puts the text in a URL.
 */
const reportBody = ({
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
}): string => {
    const lines = [`**${title}**`, "", hint, "", "### Where", `- Screen: ${where}`, `- Digest: ${digest ?? "none"}`];
    if (withTechnical) lines.push(...technicalSection(message, stack));
    return lines.join("\n");
};

/**
 * Copies the report and opens the prefilled issue, reporting whether it landed.
 *
 * Best-effort by design: the screen stays usable either way, and the details disclosure
 * keeps the text selectable for a manual copy.
 */
const sendReport = async (props: ReportBlockProps & { withTechnical: boolean }): Promise<boolean> => {
    const where = typeof window === "undefined" ? "unknown" : window.location.pathname + window.location.search;
    try {
        await submitProblemReport({ category: "Crash", message: reportBody({ ...props, where }) });
        return true;
    } catch {
        return false;
    }
};

/**
 * The attach toggle and the line under it, which say what the next click will include.
 *
 * A labelled native checkbox: the words toggle it, the keyboard reaches it and no handler
 * sits on a non-interactive element.
 */
const AttachDetails = ({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) => (
    <>
        <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-2xs text-text-muted transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:text-text-primary">
            <input
                type="checkbox"
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
                aria-label="Attach technical details to the report"
                className="size-3.5 shrink-0 cursor-pointer rounded border border-border-subtle bg-input-bg accent-accent"
            />
            Attach technical details
        </label>

        <p className="mt-1 max-w-[19rem] text-2xs leading-relaxed text-text-disabled">
            Copies a redacted report and opens a prefilled issue. Nothing is sent until you submit it.
            {checked ? " The stack is included and scrubbed." : " The stack stays out."}
        </p>
    </>
);

/**
 * The exception behind a disclosure, so the same information is reachable without sitting
 * between the user and the recovery.
 */
const CrashDetails = ({
    open,
    onToggle,
    message,
    digest,
    stack,
}: {
    open: boolean;
    onToggle: () => void;
    message: string;
    digest?: string;
    stack?: string;
}) => (
    <>
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="mt-7 flex items-center gap-1 rounded-md px-2 py-1 text-2xs text-text-disabled transition-colors duration-[var(--spring-tap-dur)] ease-[var(--spring-tap)] hover:bg-[var(--btn-hover)] hover:text-text-muted"
        >
            <Icon
                icon={ChevronRight20Regular}
                className={open ? "rotate-90 transition-transform" : "transition-transform"}
                style={{ ["--icon-size" as string]: "12px" }}
            />
            Technical details
        </button>

        {open ? (
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

/**
 * Reporting is a sub-feature of the crash screen, not part of its recovery surface, and it
 * owns the state that belongs to it: whether a report is in flight, whether it landed,
 * whether the user asked for the exception, and whether the details are open.
 */
const ReportBlock = ({ title, hint, digest, message, stack }: ReportBlockProps) => {
    const [reporting, setReporting] = useState(false);
    const [reported, setReported] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [attachDetails, setAttachDetails] = useState(false);

    const report = async () => {
        setReporting(true);
        setReported(await sendReport({ title, hint, digest, message, stack, withTechnical: attachDetails }));
        setReporting(false);
    };

    return (
        <>
            <Button
                size="sm"
                variant="ghost"
                loading={reporting}
                disabled={reported}
                onClick={() => report()}
                className="mt-4 text-text-muted"
            >
                {reported ? "Report copied" : "Report this crash"}
                {reported ? null : <Icon icon={ChevronRight20Regular} />}
            </Button>

            <AttachDetails checked={attachDetails} onChange={setAttachDetails} />

            <CrashDetails
                open={detailsOpen}
                onToggle={() => setDetailsOpen((open) => !open)}
                message={message}
                digest={digest}
                stack={stack}
            />
        </>
    );
};

/** A window whose panel edge has come away. Drawn in the app's panel vocabulary. */
const CrashMark = () => (
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
