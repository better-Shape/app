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
 * Awaiting the promise costs one microtask, far below the 100ms threshold where a
 * confirmation starts to feel laggy.
 */
export function useCopyToClipboard({
    resetMs = 1400,
    successDescription,
    silent = false,
}: UseCopyOptions = {}) {
    const [state, setState] = useState<CopyState>("idle");
    // The value as well as the state: a list of hashes needs to know *which* one is
    // showing its confirmation, not just that one of them is.
    const [copiedText, setCopiedText] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            if (timer.current) clearTimeout(timer.current);
        };
    }, []);

    const copy = useCallback(
        async (text: string, description?: string): Promise<boolean> => {
            if (timer.current) {
                clearTimeout(timer.current);
                timer.current = null;
            }

            let ok = false;
            try {
                if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
                await navigator.clipboard.writeText(text);
                ok = true;
            } catch {
                ok = false;
            }

            if (!mounted.current) return ok;

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

            // Copy is clicked repeatedly, and each click used to leave its own timer armed:
            // the older one then cleared the newer confirmation while it was still showing.
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
                timer.current = null;
                if (mounted.current) {
                    setState("idle");
                    setCopiedText(null);
                }
            }, ok ? resetMs : Math.max(resetMs, 2200));

            return ok;
        },
        [resetMs, silent, successDescription],
    );

    return {
        state,
        copied: state === "copied",
        failed: state === "failed",
        copiedText: state === "copied" ? copiedText : null,
        copy,
    };
}
