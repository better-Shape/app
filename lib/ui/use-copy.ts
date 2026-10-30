"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/features/notifications";

export type CopyState = "idle" | "copied" | "failed";

export interface UseCopyOptions {
    /** How long the confirmation stays up before the control settles back. */
    resetMs?: number;
    /** Describe the payload in the toast: "Commit hash copied to clipboard". */
    successDescription?: string;
    /** Opt out of toasts for surfaces that show their own confirmation. */
    silent?: boolean;
}

/**
 * One clipboard write, one truthful answer.
 *
 * Copy is the most repeated action in the app and every call site used to write
 * the clipboard and announce success without waiting for the promise, so a denied
 * or unavailable clipboard still produced a green "Copied" toast. The write is
 * awaited here: `copied` only goes true when the text actually landed, and the
 * failure path points at the next safe action instead of offering a retry that
 * would fail the same way.
 *
 * The write is also the hook's own business: `copy` is synchronous and settles both
 * outcomes itself, so a click handler never has to return a promise it cannot await.
 */
export const useCopyToClipboard = ({
    resetMs = 1400,
    successDescription,
    silent = false,
}: UseCopyOptions = {}) => {
    const [state, setState] = useState<CopyState>("idle");
    // The value as well as the state: a list of hashes needs to know *which* one is
    // showing its confirmation, not just that one of them is.
    const [copiedText, setCopiedText] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Which copy owns the confirmation. A slower earlier write must not take it back. */
    const latest = useRef(0);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            if (timer.current) clearTimeout(timer.current);
        };
    }, []);

    const copy = useCallback(
        (text: string, description?: string): void => {
            // Two clicks in flight resolve in whatever order the clipboard answers, so the
            // newer click claims the confirmation before either write starts and the older
            // one returns without touching state or the timer.
            const mine = ++latest.current;
            if (timer.current) {
                clearTimeout(timer.current);
                timer.current = null;
            }

            const settle = (ok: boolean) => {
                if (!mounted.current || mine !== latest.current) return;

                setState(ok ? "copied" : "failed");
                setCopiedText(text);
                if (!silent) {
                    if (ok) {
                        notify.success("Copied", description ?? successDescription ?? "Copied to clipboard");
                    } else {
                        // A retry would hit the same wall, so name the way out instead.
                        notify.error("Couldn't copy", "Clipboard unavailable, select the text and copy manually");
                    }
                }

                // Only the call holding the claim gets here, so it is the only one holding a
                // timer: no second clear is needed, and no older timer can cut this one short.
                timer.current = setTimeout(() => {
                    timer.current = null;
                    if (mounted.current) {
                        setState("idle");
                        setCopiedText(null);
                    }
                }, ok ? resetMs : Math.max(resetMs, 2200));
            };

            const clipboard = navigator.clipboard;
            if (!clipboard?.writeText) {
                settle(false);
                return;
            }

            // Started from inside `then` rather than called directly, so a clipboard that
            // throws on the call itself arrives as the rejection below instead of escaping
            // through the click handler. Both outcomes are named here; neither is dropped.
            Promise.resolve()
                .then(() => clipboard.writeText(text))
                .then(
                    () => settle(true),
                    () => settle(false),
                );
        },
        [resetMs, silent, successDescription],
    );

    return {
        state,
        copied: state === "copied",
        failed: state === "failed",
        copiedText: state === "copied" ? copiedText : null,
        failedText: state === "failed" ? copiedText : null,
        copy,
    };
};
